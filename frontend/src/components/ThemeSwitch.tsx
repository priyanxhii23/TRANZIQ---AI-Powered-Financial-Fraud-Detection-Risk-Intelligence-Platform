import { motion } from "framer-motion";
import { Moon, Sun } from "lucide-react";
import { useApp } from "../lib/app-context";

/** Animated pill toggle. The knob slides and morphs between sun and moon;
 *  the page itself switches with a circular reveal from the click point. */
export function ThemeSwitch({ compact = false }: { compact?: boolean }) {
  const { theme, toggleTheme } = useApp();
  const dark = theme === "dark";
  return (
    <button
      type="button" role="switch" aria-checked={dark} aria-label={`Switch to ${dark ? "light" : "dark"} theme`}
      onClick={(e) => toggleTheme({ x: e.clientX, y: e.clientY })}
      className={`relative flex items-center rounded-full border border-line/[0.2] bg-bg/60 p-0.5 transition-colors hover:border-primary/50 ${compact ? "h-7 w-[52px]" : "h-8 w-[60px]"}`}
    >
      <span className="absolute left-2 text-ink-3"><Sun size={11} /></span>
      <span className="absolute right-2 text-ink-3"><Moon size={11} /></span>
      <motion.span
        layout transition={{ type: "spring", stiffness: 500, damping: 32 }}
        className={`relative z-10 flex items-center justify-center rounded-full bg-primary text-[rgb(var(--on-primary))] shadow ${compact ? "h-6 w-6" : "h-7 w-7"} ${dark ? "ml-auto" : ""}`}
      >
        <motion.span key={theme} initial={{ rotate: -90, scale: 0.4, opacity: 0 }} animate={{ rotate: 0, scale: 1, opacity: 1 }} transition={{ duration: 0.35 }}>
          {dark ? <Moon size={13} /> : <Sun size={13} />}
        </motion.span>
      </motion.span>
    </button>
  );
}
