import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { speechLang } from "@/lib/scene-keywords";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Status = "idle" | "listening" | "success" | "error" | "unsupported";

export function MicTestModal({ open, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const [listening, setListening]       = useState(false);
  const [transcript, setTranscript]     = useState("");
  const [status, setStatus]             = useState<Status>("idle");
  const [errorMsg, setErrorMsg]         = useState("");
  const [isPermissionErr, setIsPermissionErr] = useState(false);

  const listeningRef   = useRef(listening);
  const transcriptRef  = useRef("");
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => { listeningRef.current = listening; }, [listening]);

  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setListening(false);
      setTranscript("");
      transcriptRef.current = "";
      setStatus("idle");
      setErrorMsg("");
      setIsPermissionErr(false);
    }
  }, [open]);

  useEffect(() => {
    const SpeechRecognitionImpl: (new () => SpeechRecognition) | undefined =
      (typeof SpeechRecognition !== "undefined" ? SpeechRecognition : undefined) ??
      (typeof webkitSpeechRecognition !== "undefined" ? webkitSpeechRecognition : undefined);

    if (!SpeechRecognitionImpl) return;

    if (listening) {
      const rec = new SpeechRecognitionImpl();
      rec.continuous     = true;
      rec.interimResults = true;
      rec.lang           = speechLang(i18n.language);

      rec.onresult = (event: SpeechRecognitionEvent) => {
        // Only walk results from resultIndex and accumulate finals once. Iterating
        // from 0 every event (and on each auto-restart) re-appends already-final
        // words, which is what made the same word appear several times.
        let finalText = "";
        let interim   = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (!result) continue;
          const piece = result[0]?.transcript ?? "";
          if (result.isFinal) finalText += piece + " ";
          else interim += piece;
        }
        if (finalText.trim()) {
          transcriptRef.current = (transcriptRef.current + " " + finalText.trim()).trim();
        }
        const display = (transcriptRef.current + " " + interim).trim();
        setTranscript(display);
        if (display.split(/\s+/).filter(Boolean).length >= 2) {
          setStatus("success");
        }
      };

      let aborted = false;
      rec.onend = () => {
        if (!aborted && listeningRef.current) {
          try { recognitionRef.current?.start(); } catch { /* ignore */ }
        }
      };

      rec.onerror = (e: SpeechRecognitionErrorEvent) => {
        const err = e.error as string;
        aborted = true;
        setListening(false);
        setStatus("error");
        setIsPermissionErr(false);
        if (err === "not-allowed" || err === "service-not-allowed") {
          setIsPermissionErr(true);
          setErrorMsg(t("micTest.errPermission"));
        } else if (err === "service-not-available") {
          setErrorMsg(t("micTest.errService"));
        } else if (err === "audio-capture") {
          setErrorMsg(t("micTest.errCapture"));
        } else {
          setErrorMsg(t("micTest.errGeneric", { code: err }));
        }
      };

      rec.start();
      recognitionRef.current = rec;
    } else {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    }

    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, [listening]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleToggle() {
    const hasSpeech =
      typeof SpeechRecognition !== "undefined" ||
      typeof webkitSpeechRecognition !== "undefined";

    if (!hasSpeech) {
      setStatus("unsupported");
      setIsPermissionErr(false);
      setErrorMsg(t("micTest.errUnsupported"));
      return;
    }

    if (listening) {
      setListening(false);
    } else {
      setTranscript("");
      transcriptRef.current = "";
      setStatus("listening");
      setErrorMsg("");
      setIsPermissionErr(false);
      setListening(true);
    }
  }

  function handleReset() {
    setTranscript("");
    transcriptRef.current = "";
    setStatus("idle");
    setErrorMsg("");
    setIsPermissionErr(false);
    setListening(false);
  }

  function handleClose() {
    setListening(false);
    onClose();
  }

  const isOk  = status === "success";
  const isErr = status === "error" || status === "unsupported";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={e => { if (e.target === e.currentTarget) handleClose(); }}
        >
          <motion.div
            className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm shadow-2xl"
            initial={{ scale: 0.93, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.93, y: 20 }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-serif text-lg font-bold">
                {t("micTest.title")}
              </h2>
              <button onClick={handleClose} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
            </div>

            <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
              {t("micTest.hint")}
            </p>

            <div className="flex flex-col items-center gap-4">
              <motion.button
                onClick={handleToggle}
                whileTap={{ scale: 0.92 }}
                className="w-20 h-20 rounded-full flex items-center justify-center shadow-lg transition-all duration-300 relative"
                style={{
                  background: isOk
                    ? "linear-gradient(135deg, #4ade80, #22c55e)"
                    : isErr
                      ? "hsl(var(--destructive))"
                      : listening
                        ? "linear-gradient(135deg, #86c584, #4ade80)"
                        : "hsl(var(--muted))",
                  border: listening || isOk || isErr ? "none" : "2px solid hsl(var(--border))",
                }}
              >
                {listening && (
                  <>
                    <div className="absolute inset-0 rounded-full animate-ping pointer-events-none"
                      style={{ backgroundColor: "rgba(134,197,132,0.18)", animationDuration: "1.8s" }} />
                    <div className="absolute inset-0 rounded-full animate-ping pointer-events-none"
                      style={{ backgroundColor: "rgba(134,197,132,0.10)", animationDuration: "2.6s", animationDelay: "0.6s" }} />
                  </>
                )}
                <svg
                  className="w-9 h-9 relative z-10"
                  style={{ color: listening || isOk ? "white" : isErr ? "white" : "hsl(var(--muted-foreground))" }}
                  fill="currentColor" viewBox="0 0 24 24"
                >
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2H3v2a9 9 0 0 0 8 8.94V23h2v-2.06A9 9 0 0 0 21 12v-2h-2z" />
                </svg>
              </motion.button>

              <p className="text-sm font-medium text-center">
                {isOk
                  ? <span className="text-green-600">✅ {t("micTest.works")}</span>
                  : isErr
                    ? <span className="text-red-500">❌ {t("micTest.noWork")}</span>
                    : listening
                      ? <span className="text-primary">{t("micTest.speak")}</span>
                      : <span className="text-muted-foreground">{t("micTest.tap")}</span>
                }
              </p>

              <AnimatePresence>
                {transcript && (
                  <motion.div
                    key="transcript"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="w-full bg-muted/60 border border-border rounded-xl px-4 py-3 text-sm text-foreground leading-relaxed min-h-[56px]"
                  >
                    «{transcript}»
                  </motion.div>
                )}
                {errorMsg && (
                  <motion.div
                    key="errorMsg"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="w-full"
                  >
                    <p className="text-xs text-red-500 text-center leading-relaxed mb-3">
                      {errorMsg}
                    </p>
                    {isPermissionErr && (
                      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3 text-xs text-amber-800 dark:text-amber-300 leading-relaxed space-y-1">
                        <p className="font-semibold">{t("micTest.fixStepsTitle")}</p>
                        <p>1. {t("micTest.fixStep1")}</p>
                        <p>2. {t("micTest.fixStep2")}</p>
                        <p>3. {t("micTest.fixStep3")}</p>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {isErr && (
                <div className="flex flex-col items-center gap-2 w-full">
                  {isPermissionErr && (
                    <button
                      onClick={() => window.location.reload()}
                      className="w-full bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold hover:bg-primary/90 transition-colors"
                    >
                      🔄 {t("micTest.reload")}
                    </button>
                  )}
                  <button
                    onClick={handleReset}
                    className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                  >
                    {t("micTest.tryAgain")}
                  </button>
                </div>
              )}
              {isOk && (
                <button
                  onClick={handleReset}
                  className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                >
                  {t("micTest.tryAgain")}
                </button>
              )}
            </div>

            <button
              onClick={handleClose}
              className="mt-6 w-full border border-border rounded-xl py-2.5 text-sm font-medium hover:bg-muted transition-colors"
            >
              {t("common.close")}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
