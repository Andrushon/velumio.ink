import { useState, useRef, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { uploadPoemRecording } from "@/utils/poemUploadUtils";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { GiftCardModal } from "@/components/GiftCardModal";
import TrashBin from "@/components/TrashBin";
import { CompanionBubble } from "@/components/CompanionBubble";
import { getCompanion, COMPANIONS, COMPANION_STORAGE_KEY, CHILD_AGE_GROUP_KEY, type AgeGroup } from "@/lib/companions";
import { CompanionPicker } from "@/components/CompanionPicker";


function useSessionId(): number {
  const [location] = useLocation();
  const m = location.match(/\/session\/(\d+)\/poem-learn/);
  return m?.[1] ? parseInt(m[1]) : 0;
}

const ART_STYLES = [
  { id: "cartoon",       emoji: "🖼️" },
  { id: "watercolor",    emoji: "💧" },
  { id: "impressionism", emoji: "🌸" },
  { id: "anime",         emoji: "✨" },
  { id: "artnouveau",    emoji: "🌿" },
  { id: "romantic",      emoji: "🌅" },
  { id: "baroque",       emoji: "👑" },
  { id: "medieval",      emoji: "📜" },
  { id: "engraving",     emoji: "🖋️" },
] as const;

const CONFETTI_COLORS = ["#f97316", "#facc15", "#4ade80", "#60a5fa", "#c084fc", "#f472b6"];

function Confetti() {
  const pieces = Array.from({ length: 26 }, (_, i) => i);
  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {pieces.map((i) => (
        <motion.div
          key={i}
          className="absolute w-2.5 h-2.5 rounded-sm"
          style={{
            left: `${(i * 3.9 + 1) % 100}%`,
            backgroundColor: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          }}
          initial={{ y: -20, opacity: 1, rotate: 0 }}
          animate={{
            y: typeof window !== "undefined" ? window.innerHeight + 50 : 900,
            opacity: [1, 1, 0],
            rotate: 360,
          }}
          transition={{ duration: 2.6 + (i % 5) * 0.35, delay: i * 0.055, ease: "easeIn" }}
        />
      ))}
    </div>
  );
}

function SlotDots({ slotsCompleted, currentRound, phase }: {
  slotsCompleted: boolean[];
  currentRound: number;
  phase: string;
}) {
  const shouldReduceMotion = useReducedMotion();
  return (
    <div className="flex gap-2 mb-4">
      {slotsCompleted.map((done, i) => {
        const isActive = phase === "practice" ? i === currentRound : (phase === "recording" && i === 5);
        const isGold = i === 5;
        return (
          <motion.div
            key={i}
            animate={isActive && !shouldReduceMotion ? { scale: [1, 1.15, 1] } : {}}
            transition={{ duration: 1.2, repeat: Infinity }}
            className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all shadow-sm ${
              done
                ? "bg-green-400 text-white"
                : isActive && isGold
                ? "bg-yellow-400 text-yellow-900 border-2 border-yellow-500 shadow-md"
                : isActive
                ? "bg-orange-400 text-white shadow-md"
                : isGold
                ? "bg-yellow-100 text-yellow-500 border-2 border-yellow-300"
                : "bg-gray-100 text-gray-400 border border-gray-200"
            }`}
          >
            {isGold ? (done ? "✓" : "⭐") : done ? "✓" : i + 1}
          </motion.div>
        );
      })}
    </div>
  );
}

type Phase = "style" | "practice" | "recording" | "uploading" | "result";
type ReadingState = "idle" | "reading";

export default function PoemLearn() {
  const { t, i18n } = useTranslation();
  const [, setLocation] = useLocation();
  const sessionId = useSessionId();
  const base = (import.meta.env.BASE_URL ?? "").replace(/\/$/, "");
  const shouldReduceMotion = useReducedMotion();

  const [companionId, setCompanionId] = useState<string | null>(
    (typeof localStorage !== "undefined" ? localStorage.getItem(COMPANION_STORAGE_KEY) : null) ?? null
  );
  const [ageGroup, setAgeGroup] = useState<AgeGroup | null>(
    typeof localStorage !== "undefined" ? (localStorage.getItem(CHILD_AGE_GROUP_KEY) as AgeGroup | null) : null
  );
  const [showCompanionPicker, setShowCompanionPicker] = useState(!companionId);
  const companion = companionId ? (getCompanion(companionId) ?? COMPANIONS[0]!) : COMPANIONS[0]!;
  const [companionLoading, setCompanionLoading] = useState(false);
  const [companionMessage, setCompanionMessage] = useState<string | null>(null);

  const [poemText, setPoemText] = useState(
    typeof window !== "undefined"
      ? (sessionStorage.getItem(`poem-text-${sessionId}`) ?? "")
      : ""
  );

  const [phase, setPhase] = useState<Phase>("style");
  const [selectedStyle, setSelectedStyle] = useState("watercolor");
  const [currentRound, setCurrentRound] = useState(0);
  const [slotsCompleted, setSlotsCompleted] = useState([false, false, false, false, false, false]);
  const [readingState, setReadingState] = useState<ReadingState>("idle");

  const [isRecording, setIsRecording] = useState(false);
  const [localAudioUrl, setLocalAudioUrl] = useState<string | null>(null);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [illustrationUrl, setIllustrationUrl] = useState<string | null>(null);
  const [standaloneIllustrationLoading, setStandaloneIllustrationLoading] = useState(false);
  const [audioPlaybackUrl, setAudioPlaybackUrl] = useState<string | null>(null);

  const [showConfetti, setShowConfetti] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showGiftCard, setShowGiftCard] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [savedPoemId, setSavedPoemId] = useState<number | null>(null);
  const poemSavedRef = useRef(false);

  const [feedbackState, setFeedbackState] = useState<"idle" | "analyzing" | "showing">("idle");
  const [feedbackText, setFeedbackText] = useState<string | null>(null);
  const [micPermission, setMicPermission] = useState<"unknown" | "granted" | "denied">("unknown");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const practiceRecorderRef = useRef<MediaRecorder | null>(null);
  const practiceChunksRef = useRef<Blob[]>([]);
  const selectedStyleRef = useRef(selectedStyle);
  useEffect(() => { selectedStyleRef.current = selectedStyle; }, [selectedStyle]);

  // Save completed poem to the shelf (once per session)
  useEffect(() => {
    if (phase !== "result") return;
    if (poemSavedRef.current) return;
    if (standaloneIllustrationLoading) return;

    const title = typeof window !== "undefined" ? (sessionStorage.getItem("poem-title") ?? "") : "";
    const author = typeof window !== "undefined" ? (sessionStorage.getItem("poem-author") ?? "") : "";
    if (!title) return;

    poemSavedRef.current = true;
    fetch(`${base}/api/poems`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        author,
        poemText: poemText || null,
        recordingUrl: recordingUrl || null,
        illustrationUrl: illustrationUrl || null,
        illustrationStyle: illustrationUrl ? selectedStyleRef.current : null,
        sessionId: sessionId || null,
      }),
    })
      .then(r => r.ok ? r.json() : null)
      .then((poem: { id: number } | null) => { if (poem) setSavedPoemId(poem.id); })
      .catch(() => null);
  }, [phase, standaloneIllustrationLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Request microphone permission early so the browser dialog appears before recording
  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(s => {
        stream = s;
        s.getTracks().forEach(t => t.stop());
        setMicPermission("granted");
      })
      .catch(() => {
        setMicPermission("denied");
      });
    return () => { stream?.getTracks().forEach(t => t.stop()); };
  }, []);

  // Fallback: if sessionStorage was cleared (page refresh), fetch text from session API
  useEffect(() => {
    if (poemText || !sessionId) return;
    fetch(`${base}/api/sessions/${sessionId}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then((s: { lastReadText?: string | null; generatedPoemText?: string | null } | null) => {
        const text = s?.generatedPoemText || s?.lastReadText;
        if (text) {
          sessionStorage.setItem(`poem-text-${sessionId}`, text);
          setPoemText(text);
        }
      })
      .catch(() => { /* ignore */ });
  }, [sessionId, base]); // eslint-disable-line react-hooks/exhaustive-deps

  // Audio playback: prefer local blob URL; fall back to fetching persisted recording via auth route
  useEffect(() => {
    if (localAudioUrl) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAudioPlaybackUrl(localAudioUrl);
      return;
    }
    if (!recordingUrl) return;
    fetch(`${base}${recordingUrl}`, { credentials: "include" })
      .then(r => r.ok ? r.blob() : null)
      .then(blob => { if (blob) setAudioPlaybackUrl(URL.createObjectURL(blob)); })
      .catch(() => { /* ignore */ });
  }, [localAudioUrl, recordingUrl, base]);

  const roundMessages = [
    t("poem.roundMsg1", "Прочитай стихотворение первый раз. Не торопись! ⭐"),
    t("poem.roundMsg2", "Отлично! Теперь ещё раз. Запомни побольше! 🌟"),
    t("poem.roundMsg3", "Ты молодец! Половина пути! Попробуй подсматривать поменьше 💪"),
    t("poem.roundMsg4", "Почти выучил! Ещё разочек! 🎯"),
    t("poem.roundMsg5", "Последняя тренировка! Готовься к записи! 🏆"),
  ];

  const uploadAndGenerate = useCallback(async (blob: Blob) => {
    setUploadError(null);
    setPhase("uploading");

    // Standalone mode (launched from library without a reading session):
    // play back locally and generate an illustration without a session ID.
    if (!sessionId) {
      const localUrl = URL.createObjectURL(blob);
      setLocalAudioUrl(localUrl);
      setSlotsCompleted(prev => { const n = [...prev]; n[5] = true; return n; });
      setPhase("result");
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 3800);
      // Generate illustration in the background
      const style = selectedStyleRef.current;
      setStandaloneIllustrationLoading(true);
      fetch(`${base}/api/poem-illustration-standalone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ poemText, artStyle: style }),
      }).then(async r => {
        if (r.status === 402 || !r.ok) return null;
        return r.json() as Promise<{ imageUrl: string }>;
      }).then(result => {
        if (result) setIllustrationUrl(result.imageUrl);
      }).catch(() => null).finally(() => {
        setStandaloneIllustrationLoading(false);
      });
      return;
    }

    try {
      const style = selectedStyleRef.current;
      const { recordingUrl: savedRecordingUrl, illustrationUrl: generatedIllustrationUrl } =
        await uploadPoemRecording({
          base,
          sessionId,
          poemText,
          artStyle: style,
          audioBlob: blob,
        });

      setRecordingUrl(savedRecordingUrl);
      if (generatedIllustrationUrl) setIllustrationUrl(generatedIllustrationUrl);
      setSlotsCompleted(prev => { const n = [...prev]; n[5] = true; return n; });
      setPhase("result");
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 3800);
    } catch {
      setUploadError(t("poem.uploadError", "Что-то пошло не так. Попробуй ещё раз."));
      setPhase("recording");
      setIsRecording(false);
    }
  }, [sessionId, poemText, base, t]);

  const startRecording = useCallback(async () => {
    setUploadError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setLocalAudioUrl(URL.createObjectURL(blob));
        void uploadAndGenerate(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch {
      setUploadError(t("poem.micError", "Не удалось получить доступ к микрофону."));
    }
  }, [uploadAndGenerate, t]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  // For rounds 0-2: start recording automatically when child begins reading
  const startPracticeReading = useCallback(async () => {
    setReadingState("reading");
    if (currentRound > 2) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      practiceChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) practiceChunksRef.current.push(e.data); };
      recorder.start();
      practiceRecorderRef.current = recorder;
    } catch {
      // Mic unavailable — read without recording
    }
  }, [currentRound]);

  const handleDoneReading = useCallback(() => {
    setSlotsCompleted(prev => { const n = [...prev]; n[currentRound] = true; return n; });
    setReadingState("idle");

    const recorder = practiceRecorderRef.current;
    if (recorder && recorder.state === "recording" && currentRound <= 2) {
      setFeedbackState("analyzing");
      recorder.onstop = async () => {
        recorder.stream.getTracks().forEach(t => t.stop());
        practiceRecorderRef.current = null;
        const blob = new Blob(practiceChunksRef.current, { type: "audio/webm" });
        practiceChunksRef.current = [];
        if (blob.size > 0) {
          try {
            const fd = new FormData();
            fd.append("audio", blob, "practice.webm");
            fd.append("poemText", poemText);
            fd.append("language", i18n.language);
            fd.append("companionId", companionId ?? "lumi");
            const r = await fetch(`${base}/api/sessions/${sessionId}/poem-reading-feedback`, {
              method: "POST",
              credentials: "include",
              body: fd,
            });
            if (r.ok) {
              const data = await r.json() as { feedback?: string };
              setFeedbackText(data.feedback ?? null);
            }
          } catch { /* ignore */ }
        }
        setFeedbackState("showing");
      };
      recorder.stop();
    } else {
      if (recorder) {
        try { recorder.stop(); } catch { /* ignore */ }
        recorder.stream.getTracks().forEach(t => t.stop());
        practiceRecorderRef.current = null;
      }
      practiceChunksRef.current = [];
      if (currentRound < 4) {
        setCurrentRound(prev => prev + 1);
      } else {
        setPhase("recording");
      }
    }
  }, [currentRound, sessionId, poemText, base]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNextAfterFeedback = useCallback(() => {
    setFeedbackText(null);
    setFeedbackState("idle");
    if (currentRound < 4) {
      setCurrentRound(prev => prev + 1);
    } else {
      setPhase("recording");
    }
  }, [currentRound]);

  const handleCompanionHelp = useCallback(async () => {
    setCompanionLoading(true);
    setCompanionMessage(null);
    const title = typeof window !== "undefined" ? (sessionStorage.getItem("poem-title") ?? "") : "";
    const context = poemText.split(/\s+/).slice(0, 30).join(" ");
    try {
      const res = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          sessionId: sessionId || null,
          content: phase === "practice"
            ? `The child is learning the poem "${title}" (round ${currentRound + 1} of 5). Opening: "${context}". Encourage them and give a tip for memorizing.`
            : phase === "recording"
            ? `The child is preparing for the final recording of the poem "${title}". Support and inspire them!`
            : `The child has learned the poem "${title}"! Congratulate them!`,
          companionId: companionId ?? "lumi",
          lang: i18n.language,
        }),
      });
      const data = res.ok ? (await res.json() as { content?: string }) : null;
      setCompanionMessage(data?.content ?? "🌟");
    } catch {
      setCompanionMessage("🌟");
    } finally {
      setCompanionLoading(false);
    }
  }, [companionId, poemText, phase, currentRound, sessionId, base, i18n.language]);

  const handleCompanionReply = useCallback(async (spokenText: string) => {
    setCompanionLoading(true);
    setCompanionMessage(null);
    try {
      const res = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ sessionId: sessionId || null, content: spokenText, companionId: companionId ?? "lumi", lang: i18n.language }),
      });
      const data = res.ok ? (await res.json() as { content?: string }) : null;
      setCompanionMessage(data?.content ?? "🌟");
    } catch {
      setCompanionMessage("🌟");
    } finally {
      setCompanionLoading(false);
    }
  }, [companionId, sessionId, base, i18n.language]);

  const handleRestart = () => {
    setPhase("style");
    setCurrentRound(0);
    setSlotsCompleted([false, false, false, false, false, false]);
    setReadingState("idle");
    setLocalAudioUrl(null);
    setRecordingUrl(null);
    setIllustrationUrl(null);
    setUploadError(null);
    setIsRecording(false);
    setShowShare(false);
    setFeedbackState("idle");
    setFeedbackText(null);
    setSavedPoemId(null);
    poemSavedRef.current = false;
    if (practiceRecorderRef.current) {
      try { practiceRecorderRef.current.stop(); } catch { /* ignore */ }
      practiceRecorderRef.current.stream.getTracks().forEach(t => t.stop());
      practiceRecorderRef.current = null;
    }
    practiceChunksRef.current = [];
  };

  const absIllustrationUrl = illustrationUrl?.startsWith("/")
    ? `${window.location.origin}${illustrationUrl}`
    : (illustrationUrl ?? "");

  const handleDownloadImage = async () => {
    if (!illustrationUrl) return;
    try {
      const resp = await fetch(absIllustrationUrl);
      const blob = await resp.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "poem-illustration.png";
      a.click();
    } catch { /* ignore */ }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(absIllustrationUrl).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2500);
    }).catch(() => { /* ignore */ });
  };

  const _handleGiftShare = () => {
    if (navigator.share) {
      navigator.share({
        title: t("poem.shareNativeTitle", "Я выучил стихотворение!"),
        text: t("poem.shareNativeText", "Послушай, как я читаю стихотворение!"),
        url: absIllustrationUrl,
      }).catch(() => setShowShare(true));
    } else {
      setShowShare(true);
    }
  };

  const bg = "linear-gradient(160deg, #fffbf0 0%, #fef3c7 55%, #ecfdf5 100%)";

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
            className="fixed top-4 right-4 z-50 bg-white border border-orange-200 rounded-xl px-4 py-2 text-sm font-medium hover:bg-orange-50 transition-colors shadow"
          >
            Продолжить →
          </button>
        )}
      </div>
    );
  }

  if (!poemText) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: bg }}>
        <div className="text-center">
          <p className="text-gray-500 mb-4">{t("poem.noText", "Текст стихотворения не найден.")}</p>
          <button onClick={() => window.history.back()}
            className="px-6 py-3 rounded-xl text-white font-semibold shadow"
            style={{ backgroundColor: "#f97316" }}>
            ← {t("common.back", "Назад")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col pb-8" style={{ background: bg }}>
      {showConfetti && !shouldReduceMotion && <Confetti />}

      {/* ── Companion change button (top-left) ────────────────────────────── */}
      {phase !== "result" && (
        <div className="absolute top-4 left-4 z-10">
          <button
            onClick={() => setShowCompanionPicker(true)}
            title={t("session.changeCharacter")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/90 border border-orange-100 shadow-sm text-xs font-semibold text-orange-500 hover:bg-orange-50 transition-colors`}
          >
            <span className="text-base leading-none">{companion.emoji}</span>
            {companion.name} ✏️
          </button>
        </div>
      )}

      {/* ── Style Picker ──────────────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {phase === "style" && (
          <motion.div
            key="style"
            initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 20 }}
            animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -20 }}
            transition={shouldReduceMotion ? { duration: 0 } : undefined}
            className="flex flex-col items-center px-4 pt-8 max-w-md mx-auto w-full"
          >
            <div className="text-5xl mb-3">🎨</div>
            <h1 className="text-2xl font-black text-gray-800 text-center mb-1">
              {t("poem.stylePick", "Выбери стиль картинки")}
            </h1>
            <p className="text-sm text-gray-500 text-center mb-6 px-2">
              {t("poem.stylePickSub", "Иллюстрация будет нарисована в этом стиле")}
            </p>

            <div className="grid grid-cols-3 gap-2.5 w-full mb-8">
              {ART_STYLES.map((style) => (
                <motion.button
                  key={style.id}
                  whileTap={shouldReduceMotion ? undefined : { scale: 0.92 }}
                  onClick={() => setSelectedStyle(style.id)}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-2xl border-2 transition-all ${
                    selectedStyle === style.id
                      ? "border-orange-400 bg-orange-50 shadow-md"
                      : "border-gray-200 bg-white hover:border-orange-200"
                  }`}
                >
                  <span className="text-2xl">{style.emoji}</span>
                  <span className={`text-xs font-semibold leading-tight text-center ${
                    selectedStyle === style.id ? "text-orange-600" : "text-gray-600"
                  }`}>
                    {t(`poem.styles.${style.id}`, style.id)}
                  </span>
                </motion.button>
              ))}
            </div>

            <motion.button
              whileHover={shouldReduceMotion ? undefined : { scale: 1.03 }}
              whileTap={shouldReduceMotion ? undefined : { scale: 0.97 }}
              onClick={() => setPhase("practice")}
              className="w-full py-4 rounded-2xl text-white font-black text-lg shadow-lg"
              style={{ background: "linear-gradient(135deg, #f97316, #facc15)" }}
            >
              {t("poem.startPractice", "Начать учить!")} 📖
            </motion.button>
          </motion.div>
        )}

        {/* ── Practice Rounds 1–5 ──────────────────────────────────────── */}
        {phase === "practice" && (
          <motion.div
            key={`practice-${currentRound}`}
            initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x: 40 }}
            animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x: -40 }}
            transition={shouldReduceMotion ? { duration: 0 } : undefined}
            className="flex flex-col items-center px-4 pt-6 max-w-md mx-auto w-full"
          >
            <SlotDots slotsCompleted={slotsCompleted} currentRound={currentRound} phase="practice" />

            <AnimatePresence mode="wait">
              {/* ── Analyzing: spinner while AI listens ── */}
              {feedbackState === "analyzing" ? (
                <motion.div key="analyzing"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="flex flex-col items-center gap-4 py-14 w-full"
                >
                  <motion.div
                    animate={shouldReduceMotion ? {} : { rotate: 360 }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                    className="w-12 h-12 rounded-full border-4 border-orange-200 border-t-orange-500"
                  />
                  <p className="text-base font-bold text-gray-700 text-center">
                    {t("poem.feedback.analyzing", "Слушаю тебя... 🎵")}
                  </p>
                  <p className="text-sm text-gray-400 text-center">
                    {t("poem.feedback.analyzingSub", "Помощник слушает твоё чтение")}
                  </p>
                </motion.div>

              ) : feedbackState === "showing" ? (
                /* ── Showing feedback ── */
                <motion.div key="showing"
                  initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92 }} animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
                  transition={shouldReduceMotion ? { duration: 0 } : undefined}
                  className="flex flex-col items-center gap-4 py-6 w-full"
                >
                  <div className="text-5xl">🤖</div>
                  <div className="w-full bg-orange-50 border border-orange-200 rounded-3xl p-5 shadow-sm">
                    <p className="text-xs text-orange-400 font-bold mb-2 uppercase tracking-wide">
                      {t("poem.feedback.title", "💡")}
                    </p>
                    <p className="text-base text-gray-800 leading-relaxed">
                      {feedbackText ?? "🌟"}
                    </p>
                  </div>
                  <motion.button
                    whileTap={shouldReduceMotion ? undefined : { scale: 0.96 }}
                    onClick={handleNextAfterFeedback}
                    className="w-full py-4 rounded-2xl text-white font-black text-lg shadow-lg mt-1"
                    style={{ background: "linear-gradient(135deg, #f97316, #facc15)" }}
                  >
                    {currentRound < 4
                      ? t("poem.feedback.nextRound", "Следующий раунд →")
                      : t("poem.feedback.toRecording", "К финальной записи 🎤")}
                  </motion.button>
                </motion.div>

              ) : (
                /* ── Normal reading UI ── */
                <motion.div key="reading-content"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="flex flex-col items-center w-full"
                >
                  <p className="text-xs text-gray-400 mb-1 font-medium">
                    {t("poem.round", { n: currentRound + 1, defaultValue: `Раунд ${currentRound + 1} из 6` })}
                  </p>
                  <p className="text-base font-semibold text-gray-700 text-center mb-5 px-2 leading-snug">
                    {roundMessages[currentRound]}
                  </p>
                  <div className="w-full bg-white/90 rounded-3xl shadow-md p-5 mb-6 max-h-60 overflow-y-auto border border-orange-100">
                    <p className="text-sm leading-relaxed text-gray-800 whitespace-pre-wrap"
                      style={{ fontFamily: "Georgia, serif" }}>
                      {poemText}
                    </p>
                  </div>
                  <AnimatePresence mode="wait">
                    {readingState === "idle" ? (
                      <motion.button
                        key="start"
                        initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
                        animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                        exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
                        transition={shouldReduceMotion ? { duration: 0 } : undefined}
                        whileTap={shouldReduceMotion ? undefined : { scale: 0.95 }}
                        onClick={() => void startPracticeReading()}
                        className="w-full py-4 rounded-2xl text-white font-black text-lg shadow-lg"
                        style={{ background: "linear-gradient(135deg, #10b981, #34d399)" }}
                      >
                        🎤 {t("poem.startReading", "Читать!")}
                      </motion.button>
                    ) : (
                      <motion.div
                        key="reading"
                        initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
                        animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                        exit={{ opacity: 0 }}
                        transition={shouldReduceMotion ? { duration: 0 } : undefined}
                        className="w-full flex flex-col items-center gap-4"
                      >
                        <div className="flex items-center gap-2 text-emerald-600">
                          <motion.div
                            animate={shouldReduceMotion ? {} : { scale: [1, 1.4, 1], opacity: [1, 0.5, 1] }}
                            transition={{ duration: 0.85, repeat: Infinity }}
                            className="w-3 h-3 rounded-full bg-emerald-500"
                          />
                          <span className="text-sm font-bold">
                            {currentRound <= 2
                              ? "🎙 " + t("poem.startReading", "Читаю...").replace("!", "")
                              : "Читаю..."}
                          </span>
                        </div>
                        <motion.button
                          whileTap={shouldReduceMotion ? undefined : { scale: 0.95 }}
                          onClick={handleDoneReading}
                          className="w-full py-4 rounded-2xl text-white font-black text-lg shadow-lg"
                          style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}
                        >
                          ✅ {t("poem.doneReading", "Готово!")}
                        </motion.button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {/* ── Final Recording Round 6 ───────────────────────────────────── */}
        {phase === "recording" && (
          <motion.div
            key="recording"
            initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
            animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={shouldReduceMotion ? { duration: 0 } : undefined}
            className="flex flex-col items-center px-4 pt-6 max-w-md mx-auto w-full"
          >
            <SlotDots slotsCompleted={slotsCompleted} currentRound={5} phase="recording" />

            <motion.div
              animate={shouldReduceMotion ? {} : { scale: [1, 1.08, 1] }}
              transition={{ duration: 1.8, repeat: Infinity }}
              className="text-5xl mb-3 mt-2"
            >
              🎤
            </motion.div>
            <h2 className="text-xl font-black text-gray-800 text-center mb-1">
              {t("poem.recordRound", "Финальная запись! 🎤")}
            </h2>
            <p className="text-sm text-gray-600 text-center mb-5 px-2">
              {t("poem.recordMsg", "Прочитай стихотворение чётко и красиво. Мы записываем твой голос!")}
            </p>

            {micPermission === "denied" && (
              <div className="w-full bg-orange-50 border border-orange-200 rounded-2xl p-3 mb-4 text-sm text-orange-700 text-center">
                {t("poem.micDenied", "Разреши доступ к микрофону в настройках браузера, чтобы записать голос.")}
              </div>
            )}

            {uploadError && (
              <div className="w-full bg-red-50 border border-red-200 rounded-2xl p-3 mb-4 text-sm text-red-600 text-center">
                {uploadError}
              </div>
            )}

            <div className="w-full bg-white/90 rounded-3xl shadow-md p-5 mb-6 max-h-60 overflow-y-auto border border-yellow-200">
              <p className="text-sm leading-relaxed text-gray-800 whitespace-pre-wrap"
                style={{ fontFamily: "Georgia, serif" }}>
                {poemText}
              </p>
            </div>

            <AnimatePresence mode="wait">
              {!isRecording ? (
                <motion.button
                  key="start-rec"
                  initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
                  animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={shouldReduceMotion ? { duration: 0 } : undefined}
                  whileTap={shouldReduceMotion ? undefined : { scale: 0.95 }}
                  onClick={startRecording}
                  className="w-full py-4 rounded-2xl text-white font-black text-lg shadow-xl"
                  style={{ background: "linear-gradient(135deg, #f97316, #facc15)" }}
                >
                  🎙️ {t("poem.startRecording", "Начать запись")}
                </motion.button>
              ) : (
                <motion.div
                  key="stop-rec"
                  initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
                  animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={shouldReduceMotion ? { duration: 0 } : undefined}
                  className="w-full flex flex-col items-center gap-4"
                >
                  <div className="flex items-center gap-2 text-red-500">
                    <motion.div
                      animate={shouldReduceMotion ? {} : { scale: [1, 1.5, 1], opacity: [1, 0.4, 1] }}
                      transition={{ duration: 0.9, repeat: Infinity }}
                      className="w-4 h-4 rounded-full bg-red-500"
                    />
                    <span className="text-base font-black">Запись идёт...</span>
                  </div>
                  <motion.button
                    whileTap={shouldReduceMotion ? undefined : { scale: 0.95 }}
                    onClick={stopRecording}
                    className="w-full py-4 rounded-2xl text-white font-black text-lg shadow-xl"
                    style={{ backgroundColor: "#ef4444" }}
                  >
                    ⏹ {t("poem.stopRecording", "Остановить запись")}
                  </motion.button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {/* ── Uploading ────────────────────────────────────────────────────── */}
        {phase === "uploading" && (
          <motion.div
            key="uploading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col items-center justify-center px-4 py-16"
          >
            <motion.div
              animate={shouldReduceMotion ? {} : { rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              className="w-16 h-16 rounded-full border-4 border-orange-200 border-t-orange-500 mb-6"
            />
            <h2 className="text-xl font-bold text-gray-700 text-center mb-2">
              {t("poem.uploading", "Сохраняем твоё выступление...")}
            </h2>
            <p className="text-sm text-gray-500 text-center">
              {t("poem.uploadingSub", "Рисуем иллюстрацию и сохраняем запись ✨")}
            </p>
          </motion.div>
        )}

        {/* ── Result ───────────────────────────────────────────────────────── */}
        {phase === "result" && !showShare && (
          <motion.div
            key="result"
            initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 20 }}
            animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={shouldReduceMotion ? { duration: 0 } : undefined}
            className="flex flex-col items-center px-4 pt-6 max-w-md mx-auto w-full"
          >
            <div className="text-4xl mb-2">🎉</div>
            <h1 className="text-2xl font-black text-gray-800 text-center mb-1">
              {t("poem.resultTitle", "Ты молодец! 🎉")}
            </h1>
            <p className="text-sm text-gray-500 text-center mb-5">
              {t("poem.resultSub", "Ты выучил стихотворение и записал свой голос!")}
            </p>

            {standaloneIllustrationLoading && !illustrationUrl && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="w-full rounded-3xl mb-5 border-4 border-white bg-orange-50 flex flex-col items-center justify-center gap-3 py-10"
              >
                <div className="w-10 h-10 rounded-full border-4 border-orange-200 border-t-orange-400 animate-spin" />
                <p className="text-sm text-orange-400 font-semibold">
                  {t("poem.generatingIllustration", "Рисуем иллюстрацию…")}
                </p>
              </motion.div>
            )}

            {savedPoemId && (
              <motion.p
                initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                transition={shouldReduceMotion ? { duration: 0 } : undefined}
                className="text-xs text-emerald-600 font-semibold mb-3 flex items-center gap-1"
              >
                📖 Сохранено в полку стихов
              </motion.p>
            )}

            {illustrationUrl && (
              <motion.div
                initial={shouldReduceMotion ? { opacity: 0 } : { scale: 0.88, opacity: 0 }}
                animate={shouldReduceMotion ? { opacity: 1 } : { scale: 1, opacity: 1 }}
                transition={shouldReduceMotion ? { duration: 0 } : { type: "spring", stiffness: 240, damping: 22, delay: 0.1 }}
                className="w-full rounded-3xl overflow-hidden shadow-2xl mb-2 border-4 border-white"
                style={{ aspectRatio: "1 / 1" }}
              >
                <img
                  src={illustrationUrl}
                  alt="poem illustration"
                  className="w-full h-full object-cover"
                />
              </motion.div>
            )}
            {illustrationUrl && savedPoemId && (
              <button
                onClick={async () => {
                  await fetch(`${base}/api/poems/${savedPoemId}/illustration`, { method: "DELETE", credentials: "include" });
                  setIllustrationUrl(null);
                }}
                className="text-xs text-red-400 hover:text-red-600 mb-3 flex items-center gap-1 self-start"
              >
                🗑 {t("poem.deleteIllustration", "Удалить иллюстрацию")}
              </button>
            )}

            {audioPlaybackUrl && (
              <div className="w-full bg-white/90 rounded-2xl shadow-md p-4 mb-2 border border-orange-100">
                <p className="text-xs text-gray-500 text-center mb-2 font-semibold">
                  🎤 {t("poem.yourRecording", "Твоя запись")}
                </p>
                <audio src={audioPlaybackUrl} controls className="w-full" />
              </div>
            )}
            {audioPlaybackUrl && savedPoemId && (
              <button
                onClick={async () => {
                  await fetch(`${base}/api/poems/${savedPoemId}/recording`, { method: "DELETE", credentials: "include" });
                  setLocalAudioUrl(null);
                  setRecordingUrl(null);
                  setAudioPlaybackUrl(null);
                }}
                className="text-xs text-red-400 hover:text-red-600 mb-3 flex items-center gap-1 self-start"
              >
                🗑 {t("poem.deleteRecording", "Удалить запись")}
              </button>
            )}

            <div className="w-full flex flex-col gap-3">
              {(illustrationUrl || audioPlaybackUrl) && (
                <motion.button
                  whileHover={shouldReduceMotion ? undefined : { scale: 1.03 }}
                  whileTap={shouldReduceMotion ? undefined : { scale: 0.97 }}
                  onClick={() => setShowGiftCard(true)}
                  className="w-full py-4 rounded-2xl text-white font-black text-lg shadow-xl"
                  style={{ background: "linear-gradient(135deg, #8b5cf6, #f97316)" }}
                >
                  🎬 {t("poem.giftCardBtn", "Сделать открытку")}
                </motion.button>
              )}

              <motion.button
                whileTap={shouldReduceMotion ? undefined : { scale: 0.96 }}
                onClick={handleRestart}
                className="w-full py-3 rounded-2xl text-gray-500 font-semibold text-sm border-2 border-gray-200 bg-white hover:border-red-200 hover:text-red-500 transition-colors"
              >
                🔄 {t("poem.restartBtn", "Начать заново")}
              </motion.button>

              <motion.button
                whileTap={shouldReduceMotion ? undefined : { scale: 0.96 }}
                onClick={() => setLocation("/library")}
                className="w-full py-2.5 rounded-2xl text-gray-400 font-medium text-sm"
              >
                ← {t("poem.toLibrary", "В библиотеку")}
              </motion.button>

              <button
                onClick={() => setShowTrash(true)}
                className="w-full py-2 text-xs text-gray-400 hover:text-gray-600 transition-colors flex items-center justify-center gap-1"
              >
                🗑 {t("poem.openTrash", "Корзина")}
              </button>
            </div>
          </motion.div>
        )}

        {/* ── Share Panel ──────────────────────────────────────────────────── */}
        {phase === "result" && showShare && (
          <motion.div
            key="share"
            initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 32 }}
            animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={shouldReduceMotion ? { duration: 0 } : undefined}
            className="flex flex-col items-center px-4 pt-8 max-w-md mx-auto w-full"
          >
            <div className="text-5xl mb-3">🎁</div>
            <h2 className="text-xl font-black text-gray-800 text-center mb-1">
              {t("poem.shareTitle", "Поделиться подарком!")}
            </h2>
            <p className="text-sm text-gray-500 text-center mb-8">
              {t("poem.shareSub", "Поделись стихотворением с близкими!")}
            </p>

            <div className="w-full flex flex-col gap-3">
              <motion.button
                whileTap={shouldReduceMotion ? undefined : { scale: 0.96 }}
                onClick={handleDownloadImage}
                className="w-full py-4 rounded-2xl font-bold text-gray-700 border-2 border-gray-200 bg-white shadow-sm flex items-center justify-center gap-2 hover:border-gray-300 transition-colors"
              >
                ⬇️ {t("poem.downloadImg", "Скачать картинку")}
              </motion.button>

              <motion.button
                whileTap={shouldReduceMotion ? undefined : { scale: 0.96 }}
                onClick={handleCopyLink}
                className="w-full py-4 rounded-2xl font-bold border-2 bg-white shadow-sm flex items-center justify-center gap-2 transition-colors"
                style={{
                  borderColor: linkCopied ? "#10b981" : "#e5e7eb",
                  color: linkCopied ? "#10b981" : "#374151",
                }}
              >
                {linkCopied
                  ? `✅ ${t("poem.linkCopied", "Скопировано!")}`
                  : `📋 ${t("poem.copyLink", "Скопировать ссылку")}`}
              </motion.button>

              <motion.button
                whileTap={shouldReduceMotion ? undefined : { scale: 0.96 }}
                onClick={() => setShowShare(false)}
                className="w-full py-3 rounded-2xl text-gray-400 font-medium text-sm mt-1"
              >
                ← {t("poem.backToShare", "Назад")}
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {showGiftCard && (
        <GiftCardModal
          sessionId={sessionId}
          illustrationUrl={illustrationUrl}
          audioPlaybackUrl={audioPlaybackUrl}
          onClose={() => setShowGiftCard(false)}
        />
      )}

      <AnimatePresence>
        {showTrash && <TrashBin onClose={() => setShowTrash(false)} />}
      </AnimatePresence>

      {/* Companion sidebar — same as in child reading mode */}
      {phase !== "result" && (
        <CompanionBubble
          companion={companion}
          onHelp={handleCompanionHelp}
          onReply={handleCompanionReply}
          isLoading={companionLoading}
          lastMessage={companionMessage}
        />
      )}

    </div>
  );
}
