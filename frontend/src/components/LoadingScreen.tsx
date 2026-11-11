import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { BrandMark, Wordmark } from "./Brand";

const STEPS = ["Connecting to intelligence API", "Loading fraud models", "Calibrating risk engine", "Ready"];

/** Branded boot sequence. Shown once per browser session, waits for the API health check. */
export function LoadingScreen({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    let alive = true;
    const t0 = Date.now();
    const tick = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 2)), 420);
    fetch("/api/health").catch(() => null).finally(() => {
      const wait = Math.max(0, 1700 - (Date.now() - t0));
      setTimeout(() => {
        if (!alive) return;
        clearInterval(tick);
        setStep(STEPS.length - 1);
        setTimeout(onDone, 450);
      }, wait);
    });
    return () => { alive = false; clearInterval(tick); };
  }, [onDone]);

  return (
    <motion.div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-bg"
      exit={{ opacity: 0, scale: 1.02 }} transition={{ duration: 0.5 }}>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {Array.from({ length: 14 }, (_, i) => (
          <motion.span key={i} className="absolute h-px bg-gradient-to-r from-transparent via-violet/50 to-transparent"
            style={{ top: `${8 + i * 6.5}%`, width: "40%" }}
            initial={{ x: "-50vw" }} animate={{ x: "150vw" }}
            transition={{ duration: 2.4 + (i % 4) * 0.5, delay: i * 0.12, repeat: Infinity, ease: "linear" }} />
        ))}
      </div>
      <BrandMark size={104} animate />
      <motion.div initial={{ opacity: 0, y: 12, letterSpacing: "0.6em" }} animate={{ opacity: 1, y: 0, letterSpacing: "0.32em" }}
        transition={{ delay: 0.6, duration: 0.9 }} className="mt-8">
        <Wordmark className="text-[34px]" />
      </motion.div>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1 }}
        className="mt-3 font-display text-[22px] italic text-ink-2">Intelligence Behind Every Transaction.</motion.p>
      <div className="mt-10 w-64">
        <div className="h-px w-full overflow-hidden bg-line/15">
          <motion.div className="h-full bg-gradient-to-r from-violet to-cyan" animate={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>
        <div className="mt-3 text-center font-mono text-[10px] uppercase tracking-kicker text-ink-3">{STEPS[step]}</div>
      </div>
    </motion.div>
  );
}
