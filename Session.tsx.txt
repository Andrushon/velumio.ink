import { useState, useEffect, useRef, useCallback } from "react";
import { handleApiError } from "@/lib/api";
import { useTTS } from "@/hooks/useTTS";
import { setAudioBlob } from "@/lib/audioStore";
import { useTranslation } from "react-i18next";
import { CompanionPicker } from "@/components/CompanionPicker";
import { CompanionBubble } from "@/components/CompanionBubble";
import { getCompanion, COMPANION_STORAGE_KEY, CHILD_AGE_GROUP_KEY, type AgeGroup } from "@/lib/companions";
import { speechLang } from "@/lib/scene-keywords";
import { SOUND_TRIGGERS } from "@/lib/sound-triggers";
import {
  createStoryMemory, updateMemory, analyzeScene, resetIllustrationCooldown, buildForcedDecision,
} from "@/lib/scene-intelligence";
import type { StoryMemory, SceneDecision } from "@/lib/scene-intelligence";
import { useLocation, Link } from "wouter";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  useCreateSession, useGetSession, useUpdateSession, useCreateIllustration,
  useListSessionIllustrations, useGetBook, useDeleteIllustration, useGetBookScenePlan,
  useGetPreparedIllustrations,
} from "@workspace/api-client-react";
import type { PreparedScene } from "@workspace/api-client-react";
import {
  getGetSessionQueryKey, getListSessionIllustrationsQueryKey,
  getGetBookQueryKey, getListBooksQueryKey, getGetBookScenePlanQueryKey,
} from "@workspace/api-client-react";
import type { BookScenePlan } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { BookCover } from "@/components/BookCover";
import { AmbientSoundChip } from "@/components/AmbientSoundChip";
import { useAmbientSound } from "@/hooks/useAmbientSound";

function useSessionId() {
  const [location] = useLocation();
  const match = location.match(/\/session\/([^/?]+)/);
  return match ? match[1] : null;
}

function useBookId() {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("bookId");
}

function useMode() {
  if (typeof window === "undefined") return "adult";
  return new URLSearchParams(window.location.search).get("mode") ?? "adult";
}

function useChildProfileId(): number | undefined {
  if (typeof window === "undefined") return undefined;
  const v = new URLSearchParams(window.location.search).get("childProfileId");
  return v ? parseInt(v) : undefined;
}



export default function Session() {
  const shouldReduceMotion = useReducedMotion();
  const { t, i18n } = useTranslation();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const paramId = useSessionId();
  const bookId = useBookId();
  const defaultMode = useMode();
  const childProfileIdParam = useChildProfileId();

  const [sessionId, setSessionId] = useState<number | null>(
    paramId && paramId !== "new" ? parseInt(paramId) : null
  );
  const [listening, setListening] = useState(false);
  const [mode, setMode] = useState(defaultMode);
  const [showIllustration, setShowIllustration] = useState<{ id: number; imageUrl?: string | null; aspectRatio?: string | null } | null>(null);
  const [illustrationQuote, setIllustrationQuote] = useState<string>("");
  const [elapsed, setElapsed] = useState(0);
  const [transcript, setTranscript] = useState("");
  const transcriptRef = useRef("");
  const [autoIllustrating, setAutoIllustrating] = useState(false);
  const [poemGenerating, setPoemGenerating] = useState(false);
  const poemGeneratingRef = useRef(false);
  const [showEndSummary, setShowEndSummary]       = useState(false);
  const [endSummaryText, setEndSummaryText]       = useState<string | null>(null);
  const [endSummaryLoading, setEndSummaryLoading] = useState(false);
  const readingErrorsRef = useRef<string[]>([]);
  const [_detectedScene, setDetectedScene] = useState<string | null>(null);
  const [ambientTarget, setAmbientTarget] = useState<{ ambientId: string; urgency: "instant" | "fast" | "normal" } | null>(() => {
    try {
      const lastId = localStorage.getItem("velumio_last_ambient");
      return lastId ? { ambientId: lastId, urgency: "fast" as const } : null;
    } catch { return null; }
  });
  const [magicMsgIdx, setMagicMsgIdx] = useState(0);
  const [illustrationSparkle, setIllustrationSparkle] = useState(false);
  const sparkleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [generatingCover, setGeneratingCover] = useState(false);
  const [illustrationLimitReached, setIllustrationLimitReached] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [showMicWarning, setShowMicWarning] = useState(false);
  const [illustrationStyle, setIllustrationStyle] = useState<string>(
    defaultMode === "child" ? "watercolor" : "cinematic"
  );
  const illustrationStyleRef = useRef(illustrationStyle);

  // Magic Wand: words read since last illustration (child mode)
  const [wordsReadSinceLastGen, setWordsReadSinceLastGen] = useState(0);
  const wordsReadSinceLastGenRef = useRef(0);
  // Cumulative total words spoken (never resets — used for end-of-session stats)
  const totalWordsSpokenRef = useRef(0);
  // Magic Wand second unlock: child finishes a short story (6s silence after any speech)
  const [silenceUnlocked, setSilenceUnlocked] = useState(false);
  const silenceUnlockedRef = useRef(false);
  // Timestamp of last final speech result (child mode) — used for silence detection
  const lastSpeechTimeRef = useRef<number>(0);
  // Silence pause overlay (replaces 90s auto-illustration in child mode)
  const [showPauseOverlay, setShowPauseOverlay] = useState(false);
  // Timestamp of last voice activity (final OR interim) — drives the "still there?" nudge
  const lastVoiceActivityRef = useRef<number>(0);

  // Companion (children's mode)
  const [showCompanionPicker, setShowCompanionPicker] = useState(false);
  const [companionId, setCompanionId] = useState<string | null>(
    typeof localStorage !== "undefined" ? localStorage.getItem(COMPANION_STORAGE_KEY) : null
  );
  const [ageGroup, setAgeGroup] = useState<AgeGroup | null>(
    typeof localStorage !== "undefined" ? (localStorage.getItem(CHILD_AGE_GROUP_KEY) as AgeGroup | null) : null
  );
  const [companionMessage, setCompanionMessage] = useState<string | null>(null);
  const [companionLoading, setCompanionLoading] = useState(false);

  const _base = (import.meta.env.BASE_URL ?? "").replace(/\/$/, "");
  const { speak: speakTTS, stop: stopTTS } = useTTS(_base);

  // Speak end-summary message when it arrives
  useEffect(() => {
    if (endSummaryText && !endSummaryLoading && companionId) {
      void speakTTS(endSummaryText, companionId, i18n.language);
    }
  }, [endSummaryText, endSummaryLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Tracks whether this session was explicitly completed (vs just closed/left)
  const sessionCompletedRef = useRef(false);
  // Tracks last saved duration to avoid redundant patches
  const lastSavedDurationRef = useRef(0);
  // Debounce timer for last-read-text save (saves the last sentence every 4 s of silence)
  const lastReadSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Always-current elapsed ref (state is stale in cleanup closures)
  const elapsedRef = useRef(0);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  // Guards against the rapid stop/start loop that makes the mic blink and chime:
  // recRunningRef tracks whether the engine is live; recRestartTimerRef debounces
  // the auto-restart so coalesced `onend` events become one quiet restart.
  const recRunningRef     = useRef(false);
  const recRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // While the companion is doing voice I/O (speaking or listening for the child's
  // reply) we pause the session recognizer so it releases the mic — browsers allow
  // only one live SpeechRecognition, so without this the companion's recognizer
  // errors out and the voice-reply window never opens.
  const pausedForCompanionRef = useRef(false);
  // Pause flag for when the companion TTS is speaking — prevents the session
  // recognizer from picking up the companion's voice and creating a restart loop.
  const pausedForTTSRef = useRef(false);
  const mediaRecorderRef  = useRef<MediaRecorder | null>(null);
  const audioChunksRef    = useRef<Blob[]>([]);
  const audioMimeTypeRef  = useRef("audio/webm");
  const audioStreamRef    = useRef<MediaStream | null>(null);
  // Called by SpeechRecognition onstart to re-establish MediaRecorder after
  // an audio-capture conflict caused us to drop it.
  const restartRecordingRef = useRef<(() => void) | null>(null);
  // Raw mic-level detection (Web Audio) — refreshes the "still here?" silence timer
  // on ANY sound, independent of whether speech recognition produced a transcript.
  const audioCtxRef       = useRef<AudioContext | null>(null);
  const volumeRafRef      = useRef<number | null>(null);
  // Keeps the OS audio session alive between SpeechRecognition restarts so the
  // browser doesn't play an audible chime when it re-acquires the mic.
  const silentCtxRef      = useRef<AudioContext | null>(null);
  const silentSrcRef      = useRef<AudioBufferSourceNode | null>(null);
  // When set, the Web Audio voice-activity tick will restart SpeechRecognition
  // as soon as the mic detects sound, instead of on a fixed timer. This
  // eliminates the periodic chime that plays every ~5 s during silence.
  const waitingForVoiceRestartRef = useRef(false);

  // Scene Intelligence refs
  const storyMemoryRef        = useRef<StoryMemory>(createStoryMemory());
  const lastAnalysisLengthRef = useRef<number>(0);
  const autoIllustratingRef     = useRef<boolean>(false);
  const isFirstIllustrationRef  = useRef<boolean>(true);
  /** Timestamp (ms) when the last illustration was started — used by the timer-based
   *  fallback to avoid firing when the reactive pipeline is already working. */
  const lastIllustrationTimeRef = useRef<number>(0);
  /** Timestamp when the mic was last turned on — used for "can't hear you" warning. */
  const listeningStartTimeRef   = useRef<number>(0);
  const coverIllustrationIdRef  = useRef<number | null>(null);
  /** Accumulated character appearance profiles — filled after the first illustration */
  const characterProfilesRef    = useRef<Record<string, string>>({});
  // Mode ref to avoid stale closures inside interval callbacks
  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  const listeningRef = useRef(listening);
  useEffect(() => { listeningRef.current = listening; }, [listening]);

  // Scene plan refs — kept current so speech callbacks always see the latest data
  const scenePlanRef        = useRef<BookScenePlan | undefined>(undefined);
  const scenePlanFiredRef   = useRef<Set<number>>(new Set());
  const bookTotalPagesRef   = useRef<number | null>(null);

  // Proactively prepared illustrations (shared cross-reader library). Sorted by
  // triggerPercent; revealed at the right reading moment. Live reactive
  // generation stays as the fallback when this library is empty/not ready.
  // For paid users the API skips the shared library entirely and sets
  // exclusiveIllustrations=true — the reactive pipeline generates unique images.
  const preparedScenesRef   = useRef<PreparedScene[]>([]);
  const preparedFiredRef    = useRef<Set<number>>(new Set());
  // true = paid user (reactive pipeline, unique images); false/undefined = free user (shared library)
  const [exclusiveIllustrations, setExclusiveIllustrations] = useState(false);
  const showIllustrationRef = useRef<{ id: number } | null>(null);

  // ── Wake Lock: prevent screen sleep while session is open ──────────────
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;

    async function acquire() {
      try { lock = await navigator.wakeLock.request("screen"); } catch { /* denied or not supported */ }
    }

    acquire();

    // Re-acquire after tab becomes visible again (lock is auto-released on hide)
    function onVisibilityChange() {
      if (document.visibilityState === "visible") acquire();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      lock?.release().catch(() => {});
    };
  }, []);
  // ───────────────────────────────────────────────────────────────────────

  // Show companion picker for children who haven't chosen one yet
  useEffect(() => {
    if (mode === "child" && !companionId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowCompanionPicker(true);
    }
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const createSession    = useCreateSession();
  const updateSession    = useUpdateSession();
  const createIllustration = useCreateIllustration();
  const deleteIllustration = useDeleteIllustration();

  const { data: session } = useGetSession(
    sessionId ?? 0,
    { query: { enabled: !!sessionId, queryKey: getGetSessionQueryKey(sessionId ?? 0) } }
  );
  const { data: book } = useGetBook(
    session?.bookId ?? 0,
    { query: { enabled: !!session?.bookId, queryKey: getGetBookQueryKey(session?.bookId ?? 0) } }
  );
  const { data: scenePlan } = useGetBookScenePlan(
    session?.bookId ?? 0,
    { query: { enabled: !!session?.bookId, retry: false, queryKey: getGetBookScenePlanQueryKey(session?.bookId ?? 0) } }
  );
  // Keep refs in sync so speech-recognition callbacks always see the latest values
  useEffect(() => { scenePlanRef.current = scenePlan; }, [scenePlan]);
  useEffect(() => { bookTotalPagesRef.current = (book as { totalPages?: number | null } | undefined)?.totalPages ?? null; }, [book]);

  const { data: illustrations } = useListSessionIllustrations(
    sessionId ?? 0,
    { query: { enabled: !!sessionId, queryKey: getListSessionIllustrationsQueryKey(sessionId ?? 0) } }
  );
  const illustrationList = illustrations ?? [];

  // Restore elapsed time when an existing session loads
  useEffect(() => {
    if (!session) return;
    if (session.durationMinutes && elapsed === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setElapsed(session.durationMinutes * 60);
      lastSavedDurationRef.current = session.durationMinutes;
    }
    // Sync mode from DB if URL has no mode param (e.g. reload of existing session)
    const urlMode = new URLSearchParams(window.location.search).get("mode");
    if (!urlMode && session.mode && session.mode !== mode) {
      setMode(session.mode as "child" | "adult");
    }
  }, [session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-dismiss illustration bottom sheet after 12 s
  useEffect(() => {
    if (!showIllustration) return;
    const t = setTimeout(() => setShowIllustration(null), 12000);
    return () => clearTimeout(t);
  }, [showIllustration]);
  useEffect(() => { showIllustrationRef.current = showIllustration; }, [showIllustration]);

  // ── Proactively prepared illustrations + ambient preload ────────────────
  // Fetch the shared, pre-generated illustration library for this book once the
  // session is known. The variant chosen for this reader is pinned server-side
  // to the session (locality rotation), so reloads stay stable.
  const getPrepared = useGetPreparedIllustrations();
  const getPreparedRef = useRef(getPrepared);
  useEffect(() => { getPreparedRef.current = getPrepared; }, [getPrepared]);
  useEffect(() => {
    const bookId = session?.bookId;
    if (!bookId || !sessionId) return;
    let cancelled = false;
    getPreparedRef.current
      .mutateAsync({ id: bookId, data: { sessionId } })
      .then((res) => {
        if (cancelled) return;
        // Paid users: API returns exclusiveIllustrations=true and ready=false.
        // The reactive pipeline handles generation — just store the flag.
        if (res?.exclusiveIllustrations) {
          setExclusiveIllustrations(true);
          return;
        }
        if (!res?.ready || !res.scenes?.length) return;
        const sorted = [...res.scenes].sort((a, b) => a.triggerPercent - b.triggerPercent);
        preparedScenesRef.current = sorted;
      })
      .catch(() => { /* graceful: live reactive generation remains the fallback */ });
    return () => { cancelled = true; };
  }, [session?.bookId, sessionId]);

  // Warm ambient sound URLs from the scene plan so they play instantly when triggered.
  useEffect(() => {
    const scenes = scenePlan?.scenes;
    if (!scenes?.length) return;
    const ids = Array.from(new Set(scenes.map((s) => s.ambientId).filter(Boolean)));
    let cancelled = false;
    (async () => {
      for (const id of ids) {
        if (cancelled) return;
        try {
          const r = await fetch(`/api/sounds/${id}/url`);
          if (!r.ok) continue;
          const data = (await r.json()) as { url?: string };
          if (data.url) {
            const a = new Audio();
            a.preload = "auto";
            a.src = data.url;
          }
        } catch { /* best-effort preload */ }
      }
    })();
    return () => { cancelled = true; };
  }, [scenePlan?.id]); // eslint-disable-line react-hooks/exhaustive-deps


  // Cleanup on unmount — auto-pause session if not explicitly completed
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      // Close silent keepalive AudioContext if mic was still on
      try { silentSrcRef.current?.stop(); } catch { /* ignore */ }
      void silentCtxRef.current?.close().catch(() => {});
      silentCtxRef.current = null;
      silentSrcRef.current = null;

      // Auto-pause: save progress so user can resume later
      if (sessionId && !sessionCompletedRef.current) {
        const mins = Math.ceil(elapsedRef.current / 60);
        fetch(`/api/sessions/${sessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          body: JSON.stringify({ status: "paused", durationMinutes: mins }),
        }).catch(() => { /* silent */ });
      }
    };
  }, [sessionId]);

  // Auto-illustration: stable callback stored in ref to avoid stale closures in onresult
  const doAutoIllustrate = useCallback(async (decision: SceneDecision) => {
    if (autoIllustratingRef.current || !sessionId) return;
    autoIllustratingRef.current = true;
    setAutoIllustrating(true);

    lastIllustrationTimeRef.current = Date.now();
    storyMemoryRef.current = resetIllustrationCooldown(
      storyMemoryRef.current,
      decision.reason === "children_mid_milestone"
    );

    const enrichedDescription = decision.sceneDescription;

    try {
      const illustration = await createIllustration.mutateAsync({
        data: {
          sessionId,
          bookId:            session?.bookId ?? 0,
          sceneDescription:  enrichedDescription,
          style:             illustrationStyleRef.current,
          characterProfiles: characterProfilesRef.current,
        } as Parameters<typeof createIllustration.mutateAsync>[0]["data"],
      });
      const wasCover = isFirstIllustrationRef.current;
      isFirstIllustrationRef.current = false;
      // Save extracted character profiles so all future illustrations stay visually consistent
      if (illustration) {
        const asAny = illustration as unknown as Record<string, unknown>;
        const profiles = asAny["extractedCharacterProfiles"] as Record<string, string> | undefined;
        if (profiles && Object.keys(profiles).length > 0) {
          characterProfilesRef.current = { ...characterProfilesRef.current, ...profiles };
        }
        // Remember which illustration is the cover so we can overlay title/author text
        if (wasCover) coverIllustrationIdRef.current = illustration.id;
      }
      qc.invalidateQueries({ queryKey: getListSessionIllustrationsQueryKey(sessionId) });
      if (illustration) {
        setShowIllustration(illustration);
        setIllustrationQuote(decision.caption || "");
      }
    } catch (err: unknown) {
      // If free daily limit is reached — show a gentle notice, don't interrupt reading
      const status = (err as { status?: number })?.status ?? (err as { response?: { status?: number } })?.response?.status;
      if (status === 402) {
        setIllustrationLimitReached(true);
      }
      /* otherwise silent — don't interrupt reading */
    }

    // Reset Magic Wand counter and silence-unlock after any generation
    wordsReadSinceLastGenRef.current = 0;
    setWordsReadSinceLastGen(0);
    silenceUnlockedRef.current = false;
    setSilenceUnlocked(false);
    lastSpeechTimeRef.current = 0;
    autoIllustratingRef.current = false;
    setAutoIllustrating(false);
    // Clear poem-generating overlay (only set when triggered by manual wand tap)
    if (poemGeneratingRef.current) {
      poemGeneratingRef.current = false;
      setPoemGenerating(false);
    }
  }, [sessionId, session?.bookId, mode, createIllustration, qc]); // eslint-disable-line react-hooks/exhaustive-deps

  const doAutoIllustrateRef = useRef(doAutoIllustrate);
  useEffect(() => { doAutoIllustrateRef.current = doAutoIllustrate; }, [doAutoIllustrate]);
  useEffect(() => { illustrationStyleRef.current = illustrationStyle; }, [illustrationStyle]);

  // Speech recognition: start/stop with listening toggle
  useEffect(() => {
    const SpeechRecognitionImpl: (new () => SpeechRecognition) | undefined =
      (typeof SpeechRecognition !== "undefined" ? SpeechRecognition : undefined) ??
      (typeof webkitSpeechRecognition !== "undefined" ? webkitSpeechRecognition : undefined);
    if (!SpeechRecognitionImpl) return;

    if (listening) {
      // Start the silence countdown from the moment the mic turns on, so a child
      // who never speaks still gets nudged after a real stretch of quiet.
      const now = Date.now();
      lastVoiceActivityRef.current = now;
      listeningStartTimeRef.current = now;
      const rec = new SpeechRecognitionImpl();
      rec.continuous      = true;
      rec.interimResults  = true;
      rec.lang            = speechLang(i18n.language);

      rec.onresult = (event: SpeechRecognitionEvent) => {
        let finalText    = "";
        let currentInterim = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (!result) continue;
          const text: string = result[0]?.transcript ?? "";
          if (result.isFinal) {
            finalText += " " + text;
            // Track low-confidence words as potential reading errors
            const conf = result[0]?.confidence ?? 1;
            if (conf < 0.60 && text.trim()) readingErrorsRef.current.push(text.trim());
          } else {
            currentInterim += text;
          }
        }

        // Accumulate only confirmed final words — prevents interim duplicates in display
        if (finalText.trim()) {
          const next = (transcriptRef.current + " " + finalText.trim()).slice(-300);
          transcriptRef.current = next;
        }
        // Show finals + current partial word for visual feedback
        const display = (transcriptRef.current + " " + currentInterim).slice(-300);
        setTranscript(display);

        // Any voice activity (final OR interim) counts as "still here" — refresh the
        // silence timer and dismiss the pause nudge if it's showing.
        if (finalText.trim() || currentInterim.trim()) {
          lastVoiceActivityRef.current = Date.now();
          if (modeRef.current === "child") setShowPauseOverlay(false);
        }

        // Debounce-save last read sentence (4 s after last word — so the DB always
        // holds the most recent phrase even if the user closes the tab mid-session)
        if (finalText.trim() && sessionId) {
          const clean = finalText.trim().replace(/\s+/g, " ");
          if (lastReadSaveTimerRef.current) clearTimeout(lastReadSaveTimerRef.current);
          lastReadSaveTimerRef.current = setTimeout(() => {
            updateSession.mutate({ id: sessionId, data: { lastReadText: clean.slice(0, 300) } });
          }, 4000);
        }

        // Process final text through Scene Intelligence
        if (finalText.trim()) {
          // Use the live mode ref — this callback is created once when the mic
          // starts (effect deps are [listening]), so the `mode` state captured in
          // the closure is stale and would silently disable child-mode counting.
          const childMode = modeRef.current === "child";

          storyMemoryRef.current = updateMemory(storyMemoryRef.current, finalText, childMode);

          // Count words for Magic Wand cooldown (child mode only)
          if (childMode) {
            // Dismiss pause overlay when the child starts reading again
            setShowPauseOverlay(false);
            // Track last speech time for the short-story silence unlock
            lastSpeechTimeRef.current = Date.now();
            // If child speaks again after silence-unlock, reset it so counter resumes
            if (silenceUnlockedRef.current) {
              silenceUnlockedRef.current = false;
              setSilenceUnlocked(false);
            }
            const newWords = finalText.trim().split(/\s+/).filter(Boolean).length;
            wordsReadSinceLastGenRef.current = Math.min(wordsReadSinceLastGenRef.current + newWords, 30);
            setWordsReadSinceLastGen(wordsReadSinceLastGenRef.current);
            totalWordsSpokenRef.current += newWords;
          }

          // ── Ambient sound triggers ──────────────────────────────────────────────
          // Priority: (1) scene-plan keyword match (book-specific)
          //           (2) scene-plan progress trigger (% of book read)
          //           (3) generic SOUND_TRIGGERS dictionary (fallback)
          {
            let soundFiredByPlan = false;
            const currentPlan = scenePlanRef.current;

            if (currentPlan?.scenes?.length) {
              const lowerFinal = finalText.toLowerCase();

              // 1. Book-specific keyword match from the AI-generated scene plan
              for (const wp of currentPlan.scenes) {
                if (wp.triggerKeywords?.some(kw => lowerFinal.includes(kw.toLowerCase()))) {
                  setAmbientTarget({ ambientId: wp.ambientId, urgency: wp.urgency as "instant" | "fast" | "normal" });
                  soundFiredByPlan = true;
                  break;
                }
              }

              // 2. Progress-based waypoints (fires once per waypoint as reader advances)
              if (!soundFiredByPlan) {
                const estimatedTotal = (bookTotalPagesRef.current ?? 40) * 250;
                const pct = Math.min((totalWordsSpokenRef.current / estimatedTotal) * 100, 100);
                const sorted = [...currentPlan.scenes].sort((a, b) => a.triggerPercent - b.triggerPercent);
                for (const wp of sorted) {
                  if (!scenePlanFiredRef.current.has(wp.sceneIndex) && pct >= wp.triggerPercent) {
                    scenePlanFiredRef.current.add(wp.sceneIndex);
                    setAmbientTarget({ ambientId: wp.ambientId, urgency: wp.urgency as "instant" | "fast" | "normal" });
                    soundFiredByPlan = true;
                    break;
                  }
                }
              }
            }

            // 3. Generic SOUND_TRIGGERS fallback (multilingual keyword dictionary)
            if (!soundFiredByPlan) {
              const lowerText = finalText.toLowerCase();
              const spokenWords = lowerText.split(/\s+/).filter(Boolean);
              for (const trigger of SOUND_TRIGGERS) {
                const hit = trigger.words.some(tw =>
                  spokenWords.some(w => w.slice(0, 4) === tw.slice(0, 4))
                );
                if (hit) {
                  setAmbientTarget({ ambientId: trigger.ambientId, urgency: trigger.urgency });
                  break;
                }
              }
            }
          }

          // ── Prepared illustration reveal (proactive shared library) ───────────
          // Reveal pre-generated illustrations at their reading moment. Takes
          // precedence over live generation; live stays as the fallback below
          // when the prepared library is empty/not ready.
          {
            const prepared = preparedScenesRef.current;
            if (prepared.length && !autoIllustratingRef.current && !showIllustrationRef.current) {
              const estimatedTotal = (bookTotalPagesRef.current ?? 40) * 250;
              const pct = Math.min((totalWordsSpokenRef.current / estimatedTotal) * 100, 100);
              for (const scene of prepared) {
                if (!preparedFiredRef.current.has(scene.sceneIndex) && pct >= scene.triggerPercent) {
                  preparedFiredRef.current.add(scene.sceneIndex);
                  setShowIllustration({
                    id: -1 - scene.sceneIndex,
                    imageUrl: scene.imageUrl,
                    aspectRatio: scene.aspectRatio,
                  });
                  setIllustrationQuote(scene.sceneDescription || "");
                  break;
                }
              }
            }
          }

          // Run analysis every ~30 chars for faster ambient + scene response
          const newLen = storyMemoryRef.current.fullText.length;
          if (newLen - lastAnalysisLengthRef.current >= 30) {
            lastAnalysisLengthRef.current = newLen;

            const decision = analyzeScene(storyMemoryRef.current, childMode, i18n.language);

            // Update scene indicator in UI
            if (decision.sceneId) setDetectedScene(decision.sceneId);

            // Ambient: scene-intelligence result as fallback (if no keyword hit)
            if (decision.targetAmbientId) {
              setAmbientTarget(prev =>
                prev?.ambientId === decision.targetAmbientId ? prev
                : { ambientId: decision.targetAmbientId!, urgency: decision.urgency }
              );
            }

            // Auto-generate illustration if scene is meaningful enough.
            // Prepared illustrations take precedence while any remain unrevealed;
            // once the prepared library is exhausted (or was never ready), live
            // reactive generation resumes as the fallback for the rest of the book.
            const prepared = preparedScenesRef.current;
            const preparedExhausted =
              prepared.length === 0 || preparedFiredRef.current.size >= prepared.length;
            if (decision.shouldIllustrate && preparedExhausted) {
              doAutoIllustrateRef.current(decision);
            }
          }
        }
      };

      // On mobile/tablet browsers the recognition engine stops itself after
      // a few seconds of silence (even with continuous=true). We restart it
      // automatically as long as the user hasn't toggled the mic off.
      // `aborted` means we called .stop() ourselves — don't restart in that case.
      let aborted = false;
      rec.onstart = () => {
        recRunningRef.current = true;
        // If a previous audio-capture conflict caused us to drop MediaRecorder,
        // re-establish it now that SpeechRecognition is stable again.
        if (modeRef.current === "child" && !mediaRecorderRef.current && restartRecordingRef.current) {
          restartRecordingRef.current();
        }
      };
      rec.onend = () => {
        recRunningRef.current = false;
        if (aborted || !listeningRef.current || pausedForCompanionRef.current || pausedForTTSRef.current) return;
        // Smart restart: if the child has been silent for > 2 s, DON'T restart on a
        // fixed timer — that would make Chrome play its mic-acquisition chime every
        // ~5 s of silence. Instead, arm a flag so the Web Audio analyser tick
        // triggers the restart the moment voice is detected. The chime then plays
        // when the child actually starts speaking, at which point it is masked by
        // their own voice. In parent mode (no Web Audio analyser), fall back to the
        // timer-based restart so transcription always resumes.
        if (recRestartTimerRef.current) clearTimeout(recRestartTimerRef.current);
        const silentForMs = Date.now() - lastVoiceActivityRef.current;
        const recentVoice = lastVoiceActivityRef.current > 0 && silentForMs < 2000;
        const hasAudioAnalyser = audioCtxRef.current !== null;
        if (!recentVoice && hasAudioAnalyser) {
          // Arm voice-triggered restart; the tick loop will fire start() on next sound
          waitingForVoiceRestartRef.current = true;
        } else {
          recRestartTimerRef.current = setTimeout(() => {
            if (aborted || !listeningRef.current || recRunningRef.current) return;
            try { recognitionRef.current?.start(); } catch { /* ignore if already starting */ }
          }, 600);
        }
      };

      rec.onerror = (e: SpeechRecognitionErrorEvent) => {
        const err = e.error as string;
        if (err === "not-allowed" || err === "service-not-allowed") {
          aborted = true;
          setListening(false);
          setMicError(t("session.micErrorNotAllowed"));
        } else if (err === "service-not-available") {
          aborted = true;
          setListening(false);
          setMicError(t("session.micErrorServiceUnavailable"));
        }
        // audio-capture: MediaRecorder is competing for the mic on mobile.
        // Release MediaRecorder so it no longer holds the mic; onend will restart
        // SpeechRecognition cleanly. Once SpeechRecognition is stable (onstart),
        // MediaRecorder will be re-established automatically via restartRecordingRef.
        if (err === "audio-capture") {
          if (volumeRafRef.current !== null) {
            cancelAnimationFrame(volumeRafRef.current);
            volumeRafRef.current = null;
          }
          if (audioCtxRef.current) {
            void audioCtxRef.current.close().catch(() => {});
            audioCtxRef.current = null;
          }
          if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
            try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
          }
          mediaRecorderRef.current = null;
          audioStreamRef.current?.getTracks().forEach(t => t.stop());
          audioStreamRef.current = null;
        }
        // no-speech, network — onend will restart automatically
      };

      rec.start();
      recognitionRef.current = rec;
    } else {
      // listeningRef.current is already false here, so onend won't restart
      if (recRestartTimerRef.current) { clearTimeout(recRestartTimerRef.current); recRestartTimerRef.current = null; }
      waitingForVoiceRestartRef.current = false;
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    }

    return () => {
      if (recRestartTimerRef.current) { clearTimeout(recRestartTimerRef.current); recRestartTimerRef.current = null; }
      waitingForVoiceRestartRef.current = false;
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, [listening]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Audio recording for child mode (MediaRecorder alongside SpeechRecognition) ──
  useEffect(() => {
    if (mode !== "child" || !listening) return;
    let cancelled = false;

    async function startRecording() {
      // Guard: don't start if already running or stream exists
      if (mediaRecorderRef.current || audioStreamRef.current) return;
      try {
        // Delay before acquiring the mic so SpeechRecognition fully initialises first.
        // Without this, both grab the mic simultaneously on mobile — causing audio-capture
        // errors that interrupt recognition every few seconds.
        await new Promise<void>(resolve => setTimeout(resolve, 1500));
        if (cancelled) return;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        audioStreamRef.current = stream;
        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm"
          : MediaRecorder.isTypeSupported("audio/ogg") ? "audio/ogg"
          : "";
        audioMimeTypeRef.current = mimeType || "audio/webm";
        const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        audioChunksRef.current = [];
        rec.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
        rec.start(1000);
        mediaRecorderRef.current = rec;

        // Raw mic-level monitor: refresh the silence timer on ANY sound. On mobile
        // browsers SpeechRecognition often stops emitting results while the child is
        // still reading aloud (mic contention with MediaRecorder), which would
        // otherwise make the "still here?" nudge pop up mid-reading. Watching the
        // actual audio level keeps the timer alive regardless of transcription.
        try {
          const AudioCtxImpl: typeof AudioContext | undefined =
            typeof AudioContext !== "undefined"
              ? AudioContext
              : (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (AudioCtxImpl) {
            const audioCtx = new AudioCtxImpl();
            audioCtxRef.current = audioCtx;
            // Mobile browsers may start the context suspended (autoplay policy);
            // resume it so the analyser actually receives audio samples.
            if (audioCtx.state === "suspended") {
              void audioCtx.resume().catch(() => {});
            }
            const source = audioCtx.createMediaStreamSource(stream);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 512;
            source.connect(analyser);
            const data = new Uint8Array(analyser.frequencyBinCount);
            const tick = () => {
              if (cancelled) return;
              analyser.getByteTimeDomainData(data);
              // RMS amplitude around the 128 midpoint (silence ≈ 0)
              let sumSq = 0;
              for (let i = 0; i < data.length; i++) {
                const v = (data[i]! - 128) / 128;
                sumSq += v * v;
              }
              const rms = Math.sqrt(sumSq / data.length);
              if (rms > 0.04) {
                lastVoiceActivityRef.current = Date.now();
                if (modeRef.current === "child") setShowPauseOverlay(false);
                // Voice-triggered SpeechRecognition restart: if recognition ended
                // during silence we armed this flag instead of scheduling a timer,
                // so the chime plays when the child starts speaking (masked by their
                // voice) rather than every ~5 s of silence.
                if (waitingForVoiceRestartRef.current && !recRunningRef.current && listeningRef.current) {
                  waitingForVoiceRestartRef.current = false;
                  try { recognitionRef.current?.start(); } catch { /* ignore */ }
                }
              }
              volumeRafRef.current = requestAnimationFrame(tick);
            };
            volumeRafRef.current = requestAnimationFrame(tick);
          }
        } catch {
          // Web Audio unavailable — fall back to transcript-based detection only
        }
      } catch {
        // mic permission denied or already granted to SpeechRecognition — recording optional
      }
    }

    // Expose startRecording so SpeechRecognition's onstart can re-establish
    // MediaRecorder after an audio-capture conflict cleared it.
    restartRecordingRef.current = () => { void startRecording(); };
    void startRecording();

    return () => {
      restartRecordingRef.current = null;
      cancelled = true;
      if (volumeRafRef.current !== null) {
        cancelAnimationFrame(volumeRafRef.current);
        volumeRafRef.current = null;
      }
      if (audioCtxRef.current) {
        void audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      audioStreamRef.current?.getTracks().forEach(t => t.stop());
      audioStreamRef.current = null;
      mediaRecorderRef.current = null;
    };
  }, [listening, mode]);

  // ── Voice-activity analyser for adult mode ─────────────────────────────────
  // In child mode the MediaRecorder effect above already runs getUserMedia and
  // creates an AnalyserNode (audioCtxRef) that powers the voice-triggered restart.
  // Adult mode has no MediaRecorder, so without this effect audioCtxRef stays null
  // and onend always falls back to the 600ms timer restart → Chrome/Xiaomi plays
  // the mic-acquisition chime on every restart during silence.
  // This effect mirrors the child-mode analyser but skips MediaRecorder and the
  // pause-overlay reset, giving adult-mode sessions the same chime-free experience.
  useEffect(() => {
    if (mode !== "adult" || !listening) return;
    let cancelled = false;

    async function startAdultAnalyser() {
      try {
        // Brief pause so SpeechRecognition can acquire the mic first on devices
        // that don't share it well. 600ms is enough without MediaRecorder contention.
        await new Promise<void>(resolve => setTimeout(resolve, 600));
        if (cancelled) return;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        audioStreamRef.current = stream;

        const AudioCtxImpl: typeof AudioContext | undefined =
          typeof AudioContext !== "undefined"
            ? AudioContext
            : (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtxImpl) { stream.getTracks().forEach(t => t.stop()); return; }

        const audioCtx = new AudioCtxImpl();
        audioCtxRef.current = audioCtx;
        if (audioCtx.state === "suspended") void audioCtx.resume().catch(() => {});

        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);

        const tick = () => {
          if (cancelled) return;
          analyser.getByteTimeDomainData(data);
          let sumSq = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i]! - 128) / 128;
            sumSq += v * v;
          }
          const rms = Math.sqrt(sumSq / data.length);
          if (rms > 0.04) {
            lastVoiceActivityRef.current = Date.now();
            // Voice-triggered restart: fires start() the moment voice is detected so
            // the chime (if any) is masked by the user's own voice.
            if (waitingForVoiceRestartRef.current && !recRunningRef.current && listeningRef.current) {
              waitingForVoiceRestartRef.current = false;
              try { recognitionRef.current?.start(); } catch { /* ignore */ }
            }
          }
          volumeRafRef.current = requestAnimationFrame(tick);
        };
        volumeRafRef.current = requestAnimationFrame(tick);
      } catch {
        // getUserMedia unavailable or permission denied — no voice detection in adult mode
      }
    }

    void startAdultAnalyser();

    return () => {
      cancelled = true;
      if (volumeRafRef.current !== null) {
        cancelAnimationFrame(volumeRafRef.current);
        volumeRafRef.current = null;
      }
      if (audioCtxRef.current) {
        void audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
      audioStreamRef.current?.getTracks().forEach(t => t.stop());
      audioStreamRef.current = null;
    };
  }, [listening, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleMicToggle = useCallback(() => {
    const hasSpeech =
      typeof SpeechRecognition !== "undefined" ||
      typeof webkitSpeechRecognition !== "undefined";
    if (!hasSpeech) {
      setMicError(t("session.micErrorUnsupported"));
      return;
    }
    setMicError(null);
    setShowMicWarning(false);

    const willStart = !listeningRef.current;

    if (willStart && !silentCtxRef.current) {
      // ── Silent keepalive AudioContext ──────────────────────────────────────
      // MUST be created synchronously here, inside the user-gesture call stack.
      // React's setState callbacks and useEffects run asynchronously and are
      // outside the gesture window — the browser suspends AudioContexts created
      // there, making them useless. A running AudioContext holds the OS audio
      // session open between SpeechRecognition restarts so the hardware never
      // releases the mic, which eliminates the audible chime on each restart.
      //
      // We use an OscillatorNode at 1 Hz (completely inaudible) with gain
      // 0.00001 (-100 dB) instead of a zero-filled buffer. Chrome/Android
      // can silently discard zero-amplitude buffers and still close the audio
      // session; a running oscillator with nonzero gain produces real samples
      // that prevent the OS from releasing the audio focus between restarts.
      try {
        const AudioCtxImpl: typeof AudioContext | undefined =
          typeof AudioContext !== "undefined"
            ? AudioContext
            : (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioCtxImpl) {
          const ctx = new AudioCtxImpl();
          const osc = ctx.createOscillator();
          osc.type = "sine";
          osc.frequency.value = 1; // 1 Hz — far below human hearing (20 Hz)
          const gain = ctx.createGain();
          gain.gain.value = 0.00001; // −100 dB — completely inaudible in practice
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          // Some mobile browsers start the context suspended even inside a
          // gesture — resume immediately.
          if (ctx.state === "suspended") void ctx.resume().catch(() => {});
          silentCtxRef.current = ctx;
          silentSrcRef.current = osc as unknown as AudioBufferSourceNode;
        }
      } catch { /* Web Audio unavailable — won't suppress chime */ }
    } else if (!willStart) {
      try { silentSrcRef.current?.stop(); } catch { /* ignore */ }
      void silentCtxRef.current?.close().catch(() => {});
      silentCtxRef.current = null;
      silentSrcRef.current = null;
    }

    setListening(prev => !prev);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Session timer — ticks every second; saves duration to DB every 60 s
  useEffect(() => {
    if (listening) {
      timerRef.current = setInterval(() => {
        setElapsed(e => {
          const next = e + 1;
          elapsedRef.current = next;
          // Save to DB every 60 s of active listening
          if (sessionId && next % 60 === 0) {
            const mins = Math.floor(next / 60);
            if (mins !== lastSavedDurationRef.current) {
              lastSavedDurationRef.current = mins;
              updateSession.mutate({ id: sessionId, data: { durationMinutes: mins } });
            }
          }
          // Child mode — silence detection for Magic Wand short-story unlock (6s)
          // and the 90s "still there?" overlay (no API call)
          if (modeRef.current === "child") {
            // Short-story unlock: child spoke at least once, then went quiet for 6s
            if (
              lastSpeechTimeRef.current > 0 &&
              !silenceUnlockedRef.current &&
              !autoIllustratingRef.current &&
              Date.now() - lastSpeechTimeRef.current >= 6000
            ) {
              silenceUnlockedRef.current = true;
              setSilenceUnlocked(true);
            }
            // "Still there?" nudge — only after a real stretch of silence relative to
            // the child's last voice activity, NOT on a fixed wall-clock interval. This
            // prevents the overlay from popping up while the child is actively reading.
            if (
              lastVoiceActivityRef.current > 0 &&
              Date.now() - lastVoiceActivityRef.current >= 90000 &&
              !autoIllustratingRef.current
            ) {
              setShowPauseOverlay(true);
            }
            // "Can't hear you" warning: mic active >20s with no voice detected
            {
              const sinceStart = Date.now() - listeningStartTimeRef.current;
              const voiceStale = lastVoiceActivityRef.current <= listeningStartTimeRef.current + 1500;
              if (sinceStart >= 20_000 && voiceStale) {
                setShowMicWarning(true);
              } else if (!voiceStale) {
                setShowMicWarning(false);
              }
            }

            // Timer-based illustration fallback for child mode.
            // Fires ONCE — only when no illustration has been generated yet
            // (lastIllustrationTimeRef === 0) and 90 s have passed since mic start.
            // After the first illustration fires (via timer or reactive pipeline),
            // lastIllustrationTimeRef > 0 and this block never runs again,
            // so Velumio won't keep generating when the child has left.
            if (
              !autoIllustratingRef.current &&
              storyMemoryRef.current.wordCount > 0 &&
              lastIllustrationTimeRef.current === 0 &&
              listeningStartTimeRef.current > 0 &&
              Date.now() - listeningStartTimeRef.current >= 90_000
            ) {
              const forced = buildForcedDecision(storyMemoryRef.current, true, i18n.language);
              if (forced.targetAmbientId) {
                setAmbientTarget({ ambientId: forced.targetAmbientId, urgency: forced.urgency });
              }
              doAutoIllustrateRef.current(forced);
            }
          } else if (next > 0 && next % 120 === 0 && !autoIllustratingRef.current) {
            // Adult mode: auto-generate illustration every 2 min as before
            const forced = buildForcedDecision(storyMemoryRef.current, false, i18n.language);
            if (forced.targetAmbientId) {
              setAmbientTarget({ ambientId: forced.targetAmbientId, urgency: forced.urgency });
            }
            doAutoIllustrateRef.current(forced);
          }
          return next;
        });
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [listening, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (paramId === "new" && bookId && !sessionId) {
      createSession.mutateAsync({
        data: {
          bookId: parseInt(bookId),
          mode: mode as "child" | "adult",
          ...(childProfileIdParam !== undefined ? { childProfileId: childProfileIdParam } : {}),
        },
      }).then((res) => {
        const id = res?.id;
        if (id) { setSessionId(id); setLocation(`/session/${id}`, { replace: true }); }
      }).catch((err: unknown) => {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 403) {
          toast({
            title: t("session.limitReachedTitle"),
            description: t("session.limitReachedDesc"),
            variant: "destructive",
          });
          setTimeout(() => setLocation("/pricing"), 3000);
        } else {
          toast({ title: t("session.createError"), variant: "destructive" });
          setLocation("/library");
        }
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!poemGenerating) { setMagicMsgIdx(0); return; }
    const id = setInterval(() => setMagicMsgIdx(i => i + 1), 2600);
    return () => clearInterval(id);
  }, [poemGenerating]);

  useEffect(() => {
    if (ambientTarget?.ambientId) {
      try { localStorage.setItem("velumio_last_ambient", ambientTarget.ambientId); } catch { /* best-effort */ }
    }
  }, [ambientTarget?.ambientId]);

  useEffect(() => {
    if (!showIllustration?.id) return;
    if (sparkleTimerRef.current) clearTimeout(sparkleTimerRef.current);
    if (navigator.vibrate) navigator.vibrate(30);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIllustrationSparkle(true);
    sparkleTimerRef.current = setTimeout(() => setIllustrationSparkle(false), 1800);
    return () => { if (sparkleTimerRef.current) clearTimeout(sparkleTimerRef.current); };
  }, [showIllustration?.id]);

  // Manual illustration (kept as secondary option)
  async function handleGenerateIllustration() {
    if (!sessionId) return;
    const memory = storyMemoryRef.current;
    const manualDecision = analyzeScene(memory, mode === "child", i18n.language);
    const sceneDescription = manualDecision.sceneDescription;
    try {
      const illustration = await createIllustration.mutateAsync({
        data: {
          sessionId,
          bookId:            session?.bookId ?? 0,
          sceneDescription,
          style:             illustrationStyle,
          characterProfiles: characterProfilesRef.current,
        } as Parameters<typeof createIllustration.mutateAsync>[0]["data"],
      });
      isFirstIllustrationRef.current = false;
      // Save extracted profiles for future visual consistency
      if (illustration) {
        const asAny = illustration as unknown as Record<string, unknown>;
        const profiles = asAny["extractedCharacterProfiles"] as Record<string, string> | undefined;
        if (profiles && Object.keys(profiles).length > 0) {
          characterProfilesRef.current = { ...characterProfilesRef.current, ...profiles };
        }
      }
      qc.invalidateQueries({ queryKey: getListSessionIllustrationsQueryKey(sessionId) });
      // Reset cooldown so manual trigger also resets auto-trigger counter
      storyMemoryRef.current = resetIllustrationCooldown(storyMemoryRef.current, false);
      if (illustration) {
        setShowIllustration(illustration);
        setIllustrationQuote(manualDecision.caption || "");
      }
    } catch {
      toast({ title: t("session.illustrationError"), variant: "destructive" });
    }
  }

  // Magic Wand: manual comic generation — unlocks after 30 words OR 6s silence (child mode)
  async function handleMagicWand() {
    const canFire = sessionId && !autoIllustratingRef.current &&
      (wordsReadSinceLastGenRef.current >= 30 || silenceUnlockedRef.current);
    if (!canFire) return;
    if (navigator.vibrate) navigator.vibrate(30);
    // Lock immediately so button disables before the async call
    wordsReadSinceLastGenRef.current = 0;
    setWordsReadSinceLastGen(0);
    silenceUnlockedRef.current = false;
    setSilenceUnlocked(false);
    lastSpeechTimeRef.current = 0;
    // Show the full-screen poem-generating overlay (only for manual wand taps)
    poemGeneratingRef.current = true;
    setPoemGenerating(true);
    const decision = analyzeScene(storyMemoryRef.current, true, i18n.language);
    await doAutoIllustrate(decision);
  }

  // The companion bubble is about to use the mic (listen for the child's reply).
  // Release the session recognizer so the two don't fight over the device.
  function handleCompanionVoiceStart() {
    pausedForCompanionRef.current = true;
    if (recRestartTimerRef.current) { clearTimeout(recRestartTimerRef.current); recRestartTimerRef.current = null; }
    try { recognitionRef.current?.stop(); } catch { /* ignore */ }
  }

  // The companion finished its voice turn — resume session listening if the mic
  // is still toggled on and the engine isn't already live.
  function handleCompanionVoiceEnd() {
    pausedForCompanionRef.current = false;
    if (listeningRef.current && !recRunningRef.current && !pausedForTTSRef.current) {
      // If the audio analyser is running (both child and adult mode now),
      // arm voice-triggered restart so the chime is masked by the user's voice.
      if (audioCtxRef.current !== null) {
        waitingForVoiceRestartRef.current = true;
      } else {
        try { recognitionRef.current?.start(); } catch { /* ignore if already starting */ }
      }
    }
  }

  // The companion TTS started speaking — pause session recognizer so it doesn't
  // pick up the companion's voice and trigger a rapid restart/chime loop.
  function handleCompanionTTSStart() {
    pausedForTTSRef.current = true;
    if (recRestartTimerRef.current) { clearTimeout(recRestartTimerRef.current); recRestartTimerRef.current = null; }
    try { recognitionRef.current?.stop(); } catch { /* ignore */ }
  }

  // The companion TTS finished — resume session listening if mic is still on.
  function handleCompanionTTSEnd() {
    pausedForTTSRef.current = false;
    if (listeningRef.current && !recRunningRef.current && !pausedForCompanionRef.current) {
      if (audioCtxRef.current !== null) {
        // Analyser is running — arm voice-triggered restart so the chime is masked
        // by the user's voice rather than playing in silence after the companion speaks.
        waitingForVoiceRestartRef.current = true;
      } else {
        // No analyser (getUserMedia unavailable) — fall back to timed restart.
        recRestartTimerRef.current = setTimeout(() => {
          if (!listeningRef.current || recRunningRef.current || pausedForCompanionRef.current || pausedForTTSRef.current) return;
          try { recognitionRef.current?.start(); } catch { /* ignore */ }
        }, 400);
      }
    }
  }

  async function handleCompanionHelp() {
    if (!sessionId || !companionId) return;
    setCompanionLoading(true);
    setCompanionMessage(null);
    try {
      // Use ref for freshest value — transcript state may be stale in closure
      const freshTranscript = transcriptRef.current.trim();
      const storyText = storyMemoryRef.current.fullText.trim();
      // Prefer full story text; fall back to transcript
      const readingContext = storyText.length >= freshTranscript.length ? storyText : freshTranscript;
      const lastWords = readingContext.split(/\s+/).slice(-40).join(" ");

      const content = lastWords
        ? t("reading.companionHelpPromptWithText", { text: lastWords })
        : t("reading.companionHelpPrompt");
      const res = await fetch(`/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ sessionId, content, companionId, recentStoryText: lastWords, lang: i18n.language }),
      });
      if (res.ok) {
        const data = await res.json() as { content?: string };
        if (data.content) setCompanionMessage(data.content);
      } else {
        setCompanionMessage(t("reading.companionError", "Упс, не получилось! Попробуй ещё раз."));
      }
    } catch {
      setCompanionMessage(t("reading.companionError", "Упс, не получилось! Попробуй ещё раз."));
    } finally {
      setCompanionLoading(false);
    }
  }

  async function handleCompanionReply(spokenText: string) {
    if (!sessionId || !companionId) return;
    setCompanionLoading(true);
    setCompanionMessage(null);
    try {
      const res = await fetch(`/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ sessionId, content: spokenText, companionId, lang: i18n.language }),
      });
      if (res.ok) {
        const data = await res.json() as { content?: string };
        if (data.content) setCompanionMessage(data.content);
      } else {
        setCompanionMessage(t("reading.companionError", "⭐"));
      }
    } catch {
      setCompanionMessage(t("reading.companionError", "⭐"));
    } finally {
      setCompanionLoading(false);
    }
  }

  async function handleShowEndSummary() {
    if (mode !== "child" || !companionId || !sessionId) {
      await handleEndSession();
      return;
    }
    if (listening) setListening(false);
    setShowEndSummary(true);
    setEndSummaryLoading(true);

    const finalizedText = storyMemoryRef.current.fullText.trim();
    const fallbackText  = transcriptRef.current.trim();
    const storyText     = finalizedText.length >= fallbackText.length ? finalizedText : fallbackText;
    const textWc        = storyText ? storyText.split(/\s+/).filter(Boolean).length : 0;
    // Prefer the cumulative spoken-words counter (most accurate), then storyMemory, then text word-count
    const spokenWc      = totalWordsSpokenRef.current;
    const wc            = spokenWc > 0 ? spokenWc : storyMemoryRef.current.wordCount > 0 ? storyMemoryRef.current.wordCount : textWc;
    // Use elapsedRef (always current) instead of elapsed state (may be stale in closure)
    const totalElapsed  = elapsedRef.current > 0 ? elapsedRef.current : elapsed;
    const wpm           = totalElapsed > 0 && wc > 0 ? Math.round(wc / (totalElapsed / 60)) : 0;

    try {
      const res = await fetch(`/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          sessionId,
          content: "reading_session_summary",
          companionId,
          questionType: "session_summary",
          recentStoryText: storyText,
          sessionStats: { wordCount: wc, elapsed: totalElapsed, wpm, errors: readingErrorsRef.current.slice(0, 5) },
          lang: i18n.language,
        }),
      });
      const data = res.ok ? await res.json() as { content?: string } : null;
      const msg  = data?.content ?? "⭐";
      setEndSummaryText(msg);
      // Voice disabled — companion messages are shown as text only
    } catch {
      setEndSummaryText(t("session.wellDone"));
    } finally {
      setEndSummaryLoading(false);
    }
  }

  async function handleEndSession() {
    if (!sessionId) return;
    sessionCompletedRef.current = true;
    const finalMins = Math.ceil(elapsed / 60);
    await updateSession.mutateAsync({
      id: sessionId,
      data: { status: "completed", durationMinutes: finalMins },
    });
    if (mode === "child") {
      // Use finalized story text; fall back to recent transcript if memory is sparse
      const finalizedText = storyMemoryRef.current.fullText.trim();
      const fallbackText  = transcriptRef.current.trim();
      const storyText     = finalizedText.length >= fallbackText.length ? finalizedText : fallbackText;

      const wc = storyText ? storyText.split(/\s+/).filter(Boolean).length : 0;
      const isShortStory = wc >= 3 && wc < 300;

      // Stop audio recording and stash the blob for StoryBookPage
      const rec = mediaRecorderRef.current;
      if (rec && rec.state !== "inactive") {
        await new Promise<void>(resolve => {
          rec.onstop = () => {
            if (audioChunksRef.current.length > 0) {
              const blob = new Blob(audioChunksRef.current, { type: audioMimeTypeRef.current });
              setAudioBlob(blob, audioMimeTypeRef.current);
            }
            resolve();
          };
          rec.stop();
        });
      } else if (audioChunksRef.current.length > 0) {
        const blob = new Blob(audioChunksRef.current, { type: audioMimeTypeRef.current });
        setAudioBlob(blob, audioMimeTypeRef.current);
      }
      audioStreamRef.current?.getTracks().forEach(t => t.stop());

      if (isShortStory && storyText) {
        // Store full story text so the comic page can generate panels (kept for fallback)
        sessionStorage.setItem(`comic-text-${sessionId}`, storyText);
        setLocation(`/session/${sessionId}/storybook?reward=1`);
      } else {
        setLocation(`/session/${sessionId}/movie?reward=1`);
      }
    } else {
      setLocation("/library");
    }
  }

  async function handleGenerateCover() {
    if (!session?.bookId || generatingCover) return;
    setGeneratingCover(true);
    try {
      const res = await fetch(`/api/books/${session.bookId}/generate-cover`, { method: "POST" });
      if (!res.ok) await handleApiError(res, "Cover generation failed");
      toast({ title: t("session.coverCreated"), description: t("session.coverCreatedDesc") });
      qc.invalidateQueries({ queryKey: getGetBookQueryKey(session.bookId) });
      qc.invalidateQueries({ queryKey: getListBooksQueryKey() });
    } catch {
      toast({ title: t("session.coverFailed"), description: t("session.coverFailedDesc"), variant: "destructive" });
    } finally {
      setGeneratingCover(false);
    }
  }

  const formatTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const hasCompanion = mode === "child" && !!companionId && !!getCompanion(companionId);

  const {
    activeDisplay: ambientDisplay,
    volume: ambientVolume,
    setVolume: setAmbientVolume,
    enabled: ambientEnabled,
    setEnabled: setAmbientEnabled,
  } = useAmbientSound(listening ? ambientTarget : null, mode === "child");

  const wandBusy = autoIllustrating || createIllustration.isPending;
  const wandReady = (wordsReadSinceLastGen >= 30 || silenceUnlocked) && !wandBusy;

  if (createSession.isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full border-4 border-primary/30 border-t-primary animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">{t("session.starting")}</p>
        </div>
      </div>
    );
  }

  // Companion picker fullscreen overlay
  if (showCompanionPicker) {
    return (
      <div className="relative">
        <CompanionPicker
          selected={companionId}
          initialAgeGroup={ageGroup}
          onSelect={(c, ag) => {
            localStorage.setItem(COMPANION_STORAGE_KEY, c.id);
            localStorage.setItem(CHILD_AGE_GROUP_KEY, ag);
            setCompanionId(c.id);
            setAgeGroup(ag);
            setShowCompanionPicker(false);
          }}
        />
        {companionId && (
          <button
            onClick={() => setShowCompanionPicker(false)}
            className="fixed top-4 right-4 z-50 bg-card border border-border rounded-xl px-4 py-2 text-sm font-medium hover:bg-muted transition-colors shadow"
          >
            {t("common.next")} →
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`min-h-screen mx-auto py-8 transition-all duration-300 max-w-4xl ${
      hasCompanion
        ? "pl-4 pr-56 sm:pr-96 md:px-4 lg:max-w-6xl"
        : book
          ? "px-4 lg:max-w-6xl"
          : "px-4"
    }`}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link href="/library" className="text-muted-foreground hover:text-foreground transition-colors p-2 rounded-lg hover:bg-muted">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </Link>
          <div>
            {book?.title && (
              <p className="text-xs text-muted-foreground font-medium leading-none mb-0.5 line-clamp-1">{book.title}</p>
            )}
            <h1 className="font-serif font-bold text-lg leading-tight">
              {session?.status === "active" ? t("session.readingSession") : t("session.session")}
            </h1>
            <p className="text-sm text-muted-foreground">{formatTime(elapsed)} — {illustrationList.length} {illustrationList.length !== 1 ? t("session.illustrations") : t("session.illustration")}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {mode === "child" && companionId && getCompanion(companionId) && (
            <button
              onClick={() => setShowCompanionPicker(true)}
              title={t("session.changeCharacter")}
              className={`w-8 h-8 rounded-full bg-gradient-to-br ${getCompanion(companionId)!.gradient} flex items-center justify-center text-base border-2 border-white shadow-sm hover:scale-110 transition-transform`}
            >
              {getCompanion(companionId)!.emoji}
            </button>
          )}
          <button
            data-testid="generate-cover-btn"
            onClick={handleGenerateCover}
            disabled={generatingCover}
            title={t("session.generateCoverTitle")}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-xl border border-border/60 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {generatingCover ? (
              <>
                <span className="w-3.5 h-3.5 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                {t("session.generatingCover")}
              </>
            ) : (
              <>🎨 {t("session.coverBtn")}</>
            )}
          </button>

          <div className="flex items-center gap-1 bg-muted rounded-xl p-1">
            {["child", "adult"].map(m => (
              <button key={m} data-testid={`mode-${m}`}
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${mode === m ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {m === "child" ? "🌟 " + t("reading.child") : "🎭 " + t("reading.adult")}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-center justify-center gap-6 lg:gap-10 mb-4">
        {/* Book cover — left of the reading card, tablet+ only */}
        {book && (
          <div className="hidden md:flex flex-col items-center gap-2 shrink-0 w-44 lg:w-52 self-center">
            <div className="w-full rounded-2xl overflow-hidden shadow-lg border border-border/40">
              <div className="aspect-[3/4]">
                <BookCover
                  title={book.title ?? ""}
                  author={book.author ?? ""}
                  mode={mode}
                  bookId={session?.bookId ?? 0}
                  coverUrl={(book as { coverUrl?: string | null }).coverUrl}
                />
              </div>
            </div>
            {book.title && (
              <p className="text-xs text-muted-foreground text-center max-w-[8rem] leading-tight line-clamp-2">
                {book.title}
              </p>
            )}
          </div>
        )}

        {/* Reading card — center */}
        <div className="bg-card border border-border rounded-3xl p-5 sm:p-7 flex flex-col items-center flex-1 w-full md:max-w-xl">
        {/* Illustrating indicator */}
        <AnimatePresence>
          {autoIllustrating && listening && (
            <motion.div
              key="illustrating"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6 }}
              className="mb-5 flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/60 border border-border/40 text-xs text-muted-foreground"
            >
              <span className="w-2 h-2 rounded-full bg-primary/60 animate-pulse" />
              {t("session.capturingScene")}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="relative mb-6">
          {listening && (
            <>
              <div className="absolute inset-0 rounded-full animate-ping scale-150 pointer-events-none"
                style={{ backgroundColor: "rgba(134,197,132,0.10)", animationDuration: "2.4s" }} />
              <div className="absolute inset-0 rounded-full animate-ping scale-175 pointer-events-none"
                style={{ backgroundColor: "rgba(134,197,132,0.07)", animationDuration: "3.2s", animationDelay: "0.8s" }} />
              <div className="absolute inset-0 rounded-full animate-ping scale-200 pointer-events-none"
                style={{ backgroundColor: "rgba(134,197,132,0.04)", animationDuration: "4s", animationDelay: "1.6s" }} />
            </>
          )}
          <button
            data-testid="mic-btn"
            onClick={handleMicToggle}
            className={`relative w-28 h-28 rounded-full flex items-center justify-center transition-all duration-500 ${listening ? "scale-105 shadow-lg" : "bg-muted border-2 border-border hover:opacity-80 shadow-sm"}`}
            style={listening ? { backgroundColor: "#b8ddb6", boxShadow: "0 4px 24px rgba(134,197,132,0.28)" } : undefined}
          >
            <svg
              className="w-11 h-11 transition-colors duration-500"
              style={{ color: listening ? "#3d6e3b" : undefined }}
              fill="currentColor" viewBox="0 0 24 24"
            >
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2H3v2a9 9 0 0 0 8 8.94V23h2v-2.06A9 9 0 0 0 21 12v-2h-2z" />
            </svg>
          </button>
        </div>

        {micError && (
          <p className="text-xs text-red-500 text-center mb-2 max-w-xs px-2">
            {micError}
          </p>
        )}

        {showMicWarning && !micError && mode === "child" && (
          <div className="mb-3 mx-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-center max-w-xs">
            <p className="text-xs font-semibold text-amber-800 mb-0.5">
              🎤 {t("session.micWarningTitle", "Тебя не слышно")}
            </p>
            <p className="text-[10px] text-amber-700 leading-snug">
              {t("session.micWarningHint", "Проверь микрофон. Если читаешь с помощником — говори с ним только нажав его кнопку 👆")}
            </p>
          </div>
        )}

        <p className="font-semibold text-lg mb-2 transition-colors duration-500"
          style={{ color: listening ? "#5a8f58" : undefined }}>
          {listening ? t("reading.listening") : t("reading.startListening")}
        </p>

        {listening && (
          <div className="flex gap-1 mt-2">
            {[3, 5, 4, 7, 5, 3, 6, 4, 5, 3, 4, 6].map((h, i) => (
              <motion.div key={i} className="w-0.5 rounded-full"
                style={{ backgroundColor: "rgba(134,197,132,0.60)", height: h * 3 }}
                animate={{ height: [h * 2, h * 4.5, h * 2] }}
                transition={{ repeat: Infinity, duration: 0.8 + i * 0.07, delay: i * 0.08, ease: "easeInOut" }} />
            ))}
          </div>
        )}

        {/* Live transcript preview */}
        {transcript && listening && (
          <p className="mt-5 text-xs text-muted-foreground/60 text-center max-w-xs leading-relaxed italic line-clamp-2">
            {transcript.slice(-200)}
          </p>
        )}

        {/* Free plan daily illustration limit notice */}
        {illustrationLimitReached && (
          <div className="mt-5 flex items-start gap-2 px-4 py-3 rounded-2xl bg-amber-50 border border-amber-200 max-w-xs text-center">
            <span className="text-lg shrink-0">🎨</span>
            <div>
              <p className="text-xs font-semibold text-amber-800 leading-snug">
                {t("reading.freeIllustrationLimit", "На сегодня 2 картинки готовы!")}
              </p>
              <p className="text-xs text-amber-600 mt-0.5 leading-snug">
                {t("reading.freeIllustrationLimitSub", "Приходи завтра за новыми или")}
                {" "}
                <a href="/pricing" className="underline font-medium">{t("reading.upgradePlan", "перейди на платный план")}</a>
              </p>
            </div>
          </div>
        )}

        {/* ── Illustration style picker ── */}
        {(() => {
          const CHILD_STYLES = ["watercolor", "cartoon", "anime", "engraving"] as const;
          const ADULT_STYLES = ["cinematic", "watercolor", "impressionism", "artnouveau", "romantic", "baroque", "engraving"] as const;
          const STYLE_EMOJIS: Record<string, string> = {
            watercolor: "🎨", cinematic: "🎬", cartoon: "🎭",
            impressionism: "🖼", anime: "🌸", artnouveau: "🌿",
            romantic: "🏔", baroque: "🕍", engraving: "🖋",
          };
          const STYLE_I18N: Record<string, string> = {
            watercolor: "reading.styleWatercolor", cinematic: "reading.styleCinematic",
            cartoon: "reading.styleCartoon", impressionism: "reading.styleImpressionism",
            anime: "reading.styleAnime", artnouveau: "reading.styleArtnouveau",
            romantic: "reading.styleRomantic", baroque: "reading.styleBaroque",
            engraving: "reading.styleEngraving",
          };
          const styles: readonly string[] = mode === "child" ? CHILD_STYLES : ADULT_STYLES;
          return (
            <div className="flex items-center gap-1.5 flex-wrap justify-center mt-6 mb-1">
              <span className="text-xs text-muted-foreground/70 mr-0.5">{t("reading.styleLabel")}:</span>
              {styles.map(s => (
                <button
                  key={s}
                  onClick={() => setIllustrationStyle(s)}
                  title={t(STYLE_I18N[s], s)}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all duration-200 ${
                    illustrationStyle === s
                      ? "bg-primary text-primary-foreground shadow-sm scale-105"
                      : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground border border-border/40"
                  }`}
                >
                  <span>{STYLE_EMOJIS[s]}</span>
                  <span className="hidden sm:inline">{t(STYLE_I18N[s], s)}</span>
                </button>
              ))}
            </div>
          );
        })()}

        <div className="flex gap-3 mt-4 flex-wrap justify-center">
          {mode === "child" ? (
            /* ── Magic Wand: appears only when unlocked (30 words OR 6s silence) ── */
            (wandReady || wandBusy) && (
            <div className="flex flex-col items-center gap-1.5">
              <div className="relative">
                {wandReady && !wandBusy && (
                  <>
                    <motion.span
                      className="absolute inset-0 rounded-2xl pointer-events-none"
                      animate={{
                        scale: [1, 1.55],
                        opacity: [0.55, 0],
                        backgroundColor: ["#fde047", "#fbbf24", "#fb923c"],
                      }}
                      transition={{ duration: 1.1, repeat: Infinity, ease: "easeOut" }}
                    />
                    <motion.span
                      className="absolute inset-0 rounded-2xl pointer-events-none"
                      animate={{
                        scale: [1, 1.35],
                        opacity: [0.4, 0],
                        backgroundColor: ["#fef08a", "#fcd34d", "#f59e0b"],
                      }}
                      transition={{ duration: 1.1, repeat: Infinity, ease: "easeOut", delay: 0.35 }}
                    />
                  </>
                )}
                <motion.button
                  data-testid="magic-wand-btn"
                  onClick={() => void handleMagicWand()}
                  disabled={!wandReady}
                  animate={wandReady ? { scale: [1, 1.08, 1] } : { scale: 1 }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                  className="relative flex flex-col items-center gap-1 px-6 py-3 rounded-2xl font-semibold transition-all duration-300 bg-yellow-300 hover:bg-yellow-200 text-yellow-900 shadow-lg"
                >
                  {wandBusy ? (
                    <>
                      <span className="w-5 h-5 rounded-full border-2 border-current/30 border-t-current animate-spin" />
                      <span className="text-xs">{t("reading.generating")}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-2xl">✨</span>
                      <span className="text-xs font-bold">{t("reading.magicWandReady")}</span>
                    </>
                  )}
                </motion.button>
              </div>
            </div>
            )
          ) : (
            /* ── Adult mode: keep existing manual button ── */
            <button
              data-testid="generate-illustration-btn"
              onClick={handleGenerateIllustration}
              disabled={createIllustration.isPending || autoIllustrating}
              title={t("session.generateIllustrationTitle")}
              className="border border-border bg-background text-muted-foreground px-4 py-2 rounded-xl text-xs font-medium hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40 flex items-center gap-1.5"
            >
              {createIllustration.isPending ? (
                <><span className="w-3 h-3 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />{t("reading.generating")}</>
              ) : (
                <><span>🎨</span>{t("reading.illustrate")}</>
              )}
            </button>
          )}

          {sessionId && (
            <Link href={`/session/${sessionId}/chat`}
              className="border border-border bg-background text-foreground px-5 py-2 rounded-xl text-sm font-medium hover:bg-muted transition-colors flex items-center gap-2"
              data-testid="chat-btn">
              <span>💬</span>{t("reading.askAI")}
            </Link>
          )}

        </div>

        </div>

        {/* Companion — right of the reading card (floats on mobile, inline on tablet+) */}
        {hasCompanion && (
          <CompanionBubble
            companion={getCompanion(companionId!)!}
            onHelp={handleCompanionHelp}
            onReply={handleCompanionReply}
            onVoiceStart={handleCompanionVoiceStart}
            onVoiceEnd={handleCompanionVoiceEnd}
            onTTSStart={handleCompanionTTSStart}
            onTTSEnd={handleCompanionTTSEnd}
            isLoading={companionLoading}
            lastMessage={companionMessage}
            basePath={_base}
          />
        )}
      </div>

      {/* Sparkle burst — fires briefly when illustration first appears */}
      <AnimatePresence>
        {illustrationSparkle && !shouldReduceMotion && (
          <motion.div
            key="sparkle-burst"
            className="fixed inset-0 pointer-events-none z-[45]"
            initial={{ opacity: 1 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            {[...Array(14)].map((_, i) => {
              const angle = (i / 14) * 2 * Math.PI;
              const r = 80 + (i % 3) * 30;
              return (
                <motion.span
                  key={i}
                  className="absolute text-xl"
                  style={{ left: "50%", bottom: "18%" }}
                  initial={{ opacity: 0, x: 0, y: 0, scale: 0 }}
                  animate={{
                    opacity: [0, 1, 0],
                    x: Math.cos(angle) * r,
                    y: Math.sin(angle) * r,
                    scale: [0, 1.4, 0],
                  }}
                  transition={{ duration: 0.9, delay: i * 0.04, ease: "easeOut" }}
                >
                  {["✨", "⭐", "🌟", "💫"][i % 4]}
                </motion.span>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Illustration bottom sheet — slides up gently, non-blocking */}
      <AnimatePresence>
        {showIllustration && (
          <motion.div
            className="fixed bottom-0 left-0 right-0 z-40 flex justify-center px-4 pb-4"
            initial={{ opacity: 0, scale: 0.93, y: 28 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.93, y: 28 }}
            transition={{ type: "spring", damping: 26, stiffness: 240 }}
          >
            <div className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
              {/* Image — full width, portrait aspect ratio to match generated illustrations */}
              <div className="relative" style={{
                aspectRatio:
                  showIllustration.aspectRatio === "9:16" ? "9/16" :
                  showIllustration.aspectRatio === "1:1"  ? "1/1"  : undefined,
              }}>
                {showIllustration.imageUrl ? (
                  <img
                    src={showIllustration.imageUrl}
                    alt=""
                    className={`w-full h-full ${
                      showIllustration.aspectRatio === "9:16" ? "object-cover" :
                      showIllustration.aspectRatio === "1:1"  ? "object-cover" : "object-contain"
                    }`}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground text-sm">
                    {t("reading.generating")}
                  </div>
                )}
                {/* Book cover text overlay — title + author on first illustration only */}
                {showIllustration.id === coverIllustrationIdRef.current && book && (
                  <div className="absolute bottom-0 left-0 right-0 px-4 py-3"
                    style={{ background: "linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.30) 70%, transparent 100%)" }}>
                    <p className="text-white font-bold text-base leading-tight drop-shadow line-clamp-2">
                      {book.title}
                    </p>
                    {book.author && (
                      <p className="text-white/80 text-xs mt-0.5 drop-shadow">
                        {book.author}
                      </p>
                    )}
                  </div>
                )}
                {/* Close button — floating over image */}
                <button
                  onClick={() => setShowIllustration(null)}
                  className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors"
                  data-testid="close-illustration"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                {/* View full — subtle badge bottom-left (only for saved illustrations) */}
                {showIllustration.id > 0 && (
                  <Link
                    href={`/session/${sessionId}/illustration/${showIllustration.id}`}
                    className="absolute bottom-2 left-2 text-white/80 hover:text-white text-xs px-2 py-1 rounded-lg bg-black/30 hover:bg-black/50 transition-colors"
                    data-testid="view-illustration-btn"
                  >
                    ↗
                  </Link>
                )}
              </div>
              {/* Quote from the reading — shown only when transcript captured text */}
              {illustrationQuote && (
                <div className="px-4 py-3 border-t border-border/40">
                  <p className="text-xs italic text-muted-foreground leading-relaxed line-clamp-3">
                    «{illustrationQuote}»
                  </p>
                </div>
              )}
              {/* Upsell hint for free users — subtle, non-blocking */}
              {!exclusiveIllustrations && (
                <div className="px-4 py-2.5 border-t border-border/30 flex items-center gap-2">
                  <span className="text-base shrink-0">✨</span>
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    {t("reading.exclusiveUpsell", "На платном плане — уникальные иллюстрации только для тебя")}{" "}
                    <a href="/pricing" className="underline font-medium text-foreground/70 hover:text-foreground transition-colors">
                      {t("reading.learnMore", "Подробнее")}
                    </a>
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {illustrationList.length > 0 && (
        <div className="mb-6">
          <div className="mb-3" />
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {illustrationList.map(ill => (
              <div key={ill.id} className={`relative group rounded-xl overflow-hidden border border-border hover:shadow-md transition-shadow ${ill.aspectRatio === "9:16" ? "aspect-[9/16]" : "aspect-square"}`}>
                <Link href={`/session/${sessionId}/illustration/${ill.id}`}
                  data-testid={`illustration-thumb-${ill.id}`}
                  className="block w-full h-full">
                  <img src={ill.imageUrl ?? `https://picsum.photos/seed/${ill.id}/200/200`} alt=""
                    className={`w-full h-full ${ill.aspectRatio === "9:16" ? "object-cover" : "object-contain"}`} />
                </Link>
                <button
                  data-testid={`delete-illustration-${ill.id}`}
                  onClick={async (e) => {
                    e.preventDefault();
                    if (!confirm(t("session.deleteIllustrationConfirm"))) return;
                    await deleteIllustration.mutateAsync({ id: ill.id });
                    qc.invalidateQueries({ queryKey: getListSessionIllustrationsQueryKey(sessionId ?? 0) });
                    qc.invalidateQueries({ queryKey: ["trash"] });
                  }}
                  className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive"
                  title={t("session.deleteIllustrationTitle")}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}


      <div className="flex justify-center">
        <button data-testid="end-session-btn"
          onClick={() => { void (mode === "child" ? handleShowEndSummary() : handleEndSession()); }}
          className="text-sm font-medium text-rose-600 dark:text-rose-400 border border-rose-300 dark:border-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:border-rose-400 transition-colors px-5 py-2.5 rounded-xl">
          {t("reading.stopSession")}
        </button>
      </div>

      {/* ── Silence pause overlay — child mode (no API call, just a nudge) ── */}
      <AnimatePresence>
        {showPauseOverlay && mode === "child" && (
          <motion.div
            className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6"
            style={{ background: "rgba(255,252,220,0.97)" }}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.3 }}
          >
            <motion.div
              animate={{ rotate: [-8, 8, -8], y: [0, -6, 0] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
              className="text-8xl mb-6 select-none"
            >
              👋
            </motion.div>
            <h2
              className="text-2xl font-black text-center mb-2 text-amber-900"
              style={{ fontFamily: "Comic Sans MS, Chalkboard SE, cursive" }}
            >
              {t("reading.pauseTitle", "Ты ещё здесь?")}
            </h2>
            <p
              className="text-base text-center text-amber-700 mb-8 max-w-xs leading-relaxed"
              style={{ fontFamily: "Comic Sans MS, Chalkboard SE, cursive" }}
            >
              {t("reading.pauseSub", "Всё нормально! Продолжим читать вместе? 📖")}
            </p>
            <motion.button
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.92 }}
              onClick={() => setShowPauseOverlay(false)}
              className="px-10 py-4 rounded-full font-black text-xl shadow-2xl bg-yellow-300 hover:bg-yellow-200 text-amber-900"
              style={{ fontFamily: "Comic Sans MS, Chalkboard SE, cursive" }}
            >
              {t("reading.pauseContinue", "Я здесь! Читаем! 🚀")}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Magic Wand / Poem-generating loading overlay (child mode) ── */}
      <AnimatePresence>
        {mode === "child" && poemGenerating && (() => {
          const comp = companionId ? getCompanion(companionId) : null;
          const SPARKLES = ["✨", "⭐", "🌟", "💫", "🌠", "✦", "🎇"];
          const particles = Array.from({ length: 18 }, (_, i) => ({
            id: i,
            x: Math.sin(i * 1.9) * 42 + 50,
            delay: (i * 0.21) % 2.4,
            dur: 1.8 + (i % 5) * 0.35,
            symbol: SPARKLES[i % SPARKLES.length]!,
            size: 14 + (i % 4) * 8,
          }));
          return (
            <motion.div
              key="poem-gen-overlay"
              className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden"
              style={{
                background: "linear-gradient(160deg, #fffbf0 0%, #fef3c7 55%, #ecfdf5 100%)",
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.55 } }}
            >
              {/* Gradient tint using companion accent */}
              {comp && (
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background: `radial-gradient(ellipse 70% 60% at 50% 40%, ${comp.accentColor}22 0%, transparent 80%)`,
                  }}
                />
              )}

              {/* Floating sparkle particles */}
              {!shouldReduceMotion && particles.map(p => (
                <motion.span
                  key={p.id}
                  className="absolute pointer-events-none select-none"
                  style={{ left: `${p.x}%`, fontSize: p.size, top: "110%" }}
                  animate={{
                    top: ["-10%", "110%"],
                    x: [0, Math.sin(p.id * 0.9) * 60, Math.cos(p.id * 0.7) * 40],
                    rotate: [0, 180, 360],
                    opacity: [0, 1, 1, 0],
                  }}
                  transition={{
                    duration: p.dur,
                    delay: p.delay,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                >
                  {p.symbol}
                </motion.span>
              ))}

              {/* Companion — bouncing + pulsing glow ring */}
              <motion.div
                className="relative flex items-center justify-center mb-8"
                exit={{ scale: 0.22, y: "38vh", opacity: 0, transition: { duration: 0.5, ease: "easeIn" } }}
              >
                {/* Glow ring */}
                {!shouldReduceMotion && (
                  <>
                    <motion.div
                      className="absolute rounded-full"
                      style={{
                        width: 200,
                        height: 200,
                        background: comp ? `${comp.accentColor}30` : "rgba(251,191,36,0.2)",
                      }}
                      animate={{ scale: [1, 1.4, 1], opacity: [0.6, 0, 0.6] }}
                      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                    />
                    <motion.div
                      className="absolute rounded-full"
                      style={{
                        width: 200,
                        height: 200,
                        background: comp ? `${comp.accentColor}18` : "rgba(251,191,36,0.1)",
                      }}
                      animate={{ scale: [1, 1.75, 1], opacity: [0.4, 0, 0.4] }}
                      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
                    />
                  </>
                )}
                {/* Companion avatar */}
                <motion.div
                  animate={shouldReduceMotion ? {} : {
                    y: [0, -14, 0],
                    scale: [1, 1.05, 1],
                    rotate: [-3, 3, -3],
                  }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                  className={`relative z-10 w-36 h-36 rounded-full flex items-center justify-center text-7xl shadow-2xl border-4 border-white ${
                    comp ? `bg-gradient-to-br ${comp.gradient}` : "bg-gradient-to-br from-amber-100 to-yellow-200"
                  }`}
                >
                  {comp?.emoji ?? "✨"}
                </motion.div>
              </motion.div>

              {/* Writing quill + label + bouncing dots */}
              <motion.div
                className="flex flex-col items-center"
                exit={{ opacity: 0, y: 8, transition: { duration: 0.18 } }}
              >
                {/* Writing quill animation */}
                <motion.div
                  className="text-4xl mb-4 select-none"
                  animate={shouldReduceMotion ? {} : { rotate: [-12, 12, -12], x: [-6, 6, -6] }}
                  transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut" }}
                >
                  🪄
                </motion.div>

                {/* Animated dots label */}
                <motion.p
                  className="font-black text-xl text-center px-6"
                  style={{
                    fontFamily: "Comic Sans MS, Chalkboard SE, cursive",
                    color: comp?.accentColor ?? "#f59e0b",
                  }}
                  animate={shouldReduceMotion ? {} : { opacity: [0.7, 1, 0.7] }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                >
                  {(() => {
                    const MSGS = [
                      comp
                        ? t("reading.poemGeneratingMsg", "{{name}} рисует волшебную картинку", { name: comp.name })
                        : t("reading.generatingMagic", "Волшебство происходит..."),
                      t("reading.poemMsg2", "Волшебство происходит..."),
                      t("reading.poemMsg3", "Почти готово..."),
                      t("reading.poemMsg4", "Ещё немного..."),
                      t("reading.poemMsg5", "Картинка уже близко!"),
                    ];
                    return MSGS[magicMsgIdx % MSGS.length];
                  })()}
                </motion.p>

                {/* Bouncing dots */}
                <div className="flex gap-2 mt-4">
                  {[0, 1, 2].map(i => (
                    <motion.div
                      key={i}
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: comp?.accentColor ?? "#f59e0b" }}
                      animate={shouldReduceMotion ? {} : { y: [0, -10, 0], opacity: [0.5, 1, 0.5] }}
                      transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.18, ease: "easeInOut" }}
                    />
                  ))}
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* ── Auto-illustration sparkle banner (non-blocking corner animation) ── */}
      <AnimatePresence>
        {autoIllustrating && !poemGenerating && (() => {
          const comp = companionId ? getCompanion(companionId) : null;
          return (
            <motion.div
              key="auto-sparkle-banner"
              className="fixed top-4 right-4 z-40 flex items-center gap-2 px-3 py-2 rounded-2xl shadow-lg pointer-events-none select-none"
              style={{
                background: comp
                  ? `linear-gradient(135deg, ${comp.accentColor}22 0%, ${comp.accentColor}11 100%)`
                  : "linear-gradient(135deg, rgba(251,191,36,0.18) 0%, rgba(167,243,208,0.14) 100%)",
                border: `1.5px solid ${comp?.accentColor ?? "#f59e0b"}44`,
                backdropFilter: "blur(8px)",
              }}
              initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x: 48, scale: 0.85 }}
              animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, x: 0, scale: 1 }}
              exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x: 48, scale: 0.85 }}
              transition={shouldReduceMotion ? { duration: 0.15 } : { type: "spring", stiffness: 320, damping: 26 }}
            >
              {/* Pulsing sparkle */}
              <motion.span
                className="text-lg"
                animate={shouldReduceMotion ? {} : { rotate: [0, 20, -20, 0], scale: [1, 1.3, 1] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
              >
                ✨
              </motion.span>

              {/* Companion emoji (tiny) if available */}
              {comp && (
                <motion.span
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-sm bg-gradient-to-br ${comp.gradient}`}
                  animate={shouldReduceMotion ? {} : { y: [0, -3, 0] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                >
                  {comp.emoji}
                </motion.span>
              )}

              {/* Tiny label */}
              <motion.span
                className="text-xs font-bold leading-none max-w-[7rem] truncate"
                style={{
                  fontFamily: "Comic Sans MS, Chalkboard SE, cursive",
                  color: comp?.accentColor ?? "#f59e0b",
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={shouldReduceMotion ? { duration: 0 } : { delay: 0.3, duration: 0.4, ease: "easeOut" }}
              >
                {comp
                  ? t("reading.sparkleLabel", "{{name}} рисует…", { name: comp.name }).slice(0, 12)
                  : t("reading.sparkleLabelGeneric", "Рисую…")}
              </motion.span>

              {/* Bouncing dots */}
              <div className="flex gap-1 items-center">
                {[0, 1, 2].map(i => (
                  <motion.div
                    key={i}
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: comp?.accentColor ?? "#f59e0b" }}
                    animate={shouldReduceMotion ? {} : { y: [0, -4, 0], opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
                  />
                ))}
              </div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* ── Ambient sound chip ── */}
      <AmbientSoundChip
        display={ambientDisplay}
        volume={ambientVolume}
        onVolumeChange={setAmbientVolume}
        enabled={ambientEnabled}
        onToggle={() => setAmbientEnabled(!ambientEnabled)}
      />

      {/* ── End-of-story companion summary overlay (child mode) ── */}
      <AnimatePresence>
        {showEndSummary && (() => {
          const comp = companionId ? getCompanion(companionId) : null;
          return (
            <motion.div
              className="fixed inset-0 z-50 flex flex-col items-center justify-center px-4"
              style={{ background: "linear-gradient(160deg, rgba(255,249,196,0.97) 0%, rgba(220,237,200,0.97) 100%)" }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {/* Large bouncing companion */}
              <motion.div
                animate={{ scale: [1, 1.06, 1], y: [0, -8, 0] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
                className={`w-44 h-44 rounded-full flex items-center justify-center text-8xl shadow-2xl border-4 border-white mb-6 ${comp ? `bg-gradient-to-br ${comp.gradient}` : "bg-yellow-100"}`}
              >
                {comp?.emoji ?? "⭐"}
              </motion.div>

              {/* Speech bubble */}
              <motion.div
                className="bg-white rounded-3xl shadow-2xl px-6 py-5 max-w-sm w-full relative mb-6"
                initial={{ scale: 0.85, opacity: 0, y: 16 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 280, damping: 22, delay: 0.2 }}
              >
                {/* bubble tail */}
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-0 h-0"
                  style={{ borderLeft: "10px solid transparent", borderRight: "10px solid transparent", borderBottom: "14px solid white" }} />

                {endSummaryLoading ? (
                  <div className="flex items-center justify-center gap-2 py-3">
                    <span className="w-5 h-5 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                    <span className="text-sm text-muted-foreground">
                      {comp ? `${comp.name} думает...` : "Думаю..."}
                    </span>
                  </div>
                ) : (
                  <p className="text-sm leading-relaxed text-gray-800 text-center"
                    style={{ fontFamily: "Comic Sans MS, Chalkboard SE, cursive" }}>
                    {endSummaryText}
                  </p>
                )}
              </motion.div>

              {/* Дальше button */}
              <AnimatePresence>
                {!endSummaryLoading && endSummaryText && (
                  <motion.button
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.4 }}
                    whileHover={{ scale: 1.06 }}
                    whileTap={{ scale: 0.94 }}
                    onClick={() => {
                      stopTTS();
                      void handleEndSession();
                    }}
                    className="px-10 py-4 rounded-full text-white font-black text-xl shadow-xl"
                    style={{ backgroundColor: comp?.accentColor ?? "#f97316" }}
                  >
                    Дальше →
                  </motion.button>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })()}
      </AnimatePresence>

    </div>
  );
}
