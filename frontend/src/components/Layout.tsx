import { AnimatePresence, motion } from "framer-motion";
import {
  Activity, BellRing, BrainCircuit, FileBarChart2, FlaskConical, Gauge, LayoutGrid, Menu, Play, ScanLine,
  Search, Swords, TrendingUp, X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { get } from "../lib/api";
import { useApp } from "../lib/app-context";
import { fmtMoney, fmtProb } from "../lib/format";
import { useApi } from "../lib/hooks";
import { MODEL_LABELS, MODELS, type AlertSummary, type ModelName, type Tx } from "../lib/types";
import { AmbientBackground } from "./Ambient";
import { BrandMark, Logo } from "./Brand";
import { ThemeSwitch } from "./ThemeSwitch";
import { PulseDot } from "./ui";

export const NAV = [
  { to: "/", label: "Command Center", icon: LayoutGrid, n: "01" },
  { to: "/scanner", label: "Fraud Scanner", icon: ScanLine, n: "02" },
  { to: "/models", label: "Model Lab", icon: FlaskConical, n: "03" },
  { to: "/transactions", label: "Explorer", icon: Search, n: "04" },
  { to: "/risk", label: "Risk Center", icon: Gauge, n: "05" },
  { to: "/explain", label: "XAI Studio", icon: BrainCircuit, n: "06" },
  { to: "/scenarios", label: "Scenario Lab", icon: Swords, n: "07" },
  { to: "/alerts", label: "Alert Center", icon: BellRing, n: "08" },
  { to: "/analytics", label: "Trends", icon: TrendingUp, n: "09" },
  { to: "/reports", label: "Reports", icon: FileBarChart2, n: "10" },
];

function NavItems({ onNavigate, pending }: { onNavigate?: () => void; pending: number }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.to === "/"} onClick={onNavigate}
          className={({ isActive }) =>
            `group relative flex items-center gap-3 rounded px-3 py-2 text-[13px] transition-colors ${
              isActive ? "text-ink" : "text-ink-3 hover:bg-line/[0.05] hover:text-ink-2"}`}>
          {({ isActive }) => (
            <>
              {isActive && (
                <motion.span layoutId="nav-active" className="absolute inset-0 rounded border border-primary/30 bg-gradient-to-r from-primary/20 to-transparent"
                  transition={{ type: "spring", stiffness: 420, damping: 36 }} />
              )}
              {isActive && <motion.span layoutId="nav-bar" className="absolute -left-3 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-primary" />}
              <span className={`relative font-mono text-[10px] ${isActive ? "text-primary" : "text-ink-3/70"}`}>{item.n}</span>
              <item.icon size={15} strokeWidth={1.7} className="relative" />
              <span className="relative font-medium">{item.label}</span>
              {item.to === "/alerts" && pending > 0 && (
                <span className="num relative ml-auto rounded-xs bg-coral/15 px-1.5 text-[10.5px] text-coral">{pending}</span>
              )}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function ModelSwitch() {
  const { settings, setActiveModel } = useApp();
  if (!settings) return null;
  return (
    <div className="rounded border border-line/[0.12] bg-bg/40 p-2.5">
      <div className="label mb-2 flex items-center justify-between">Active model {settings.active_model === settings.best_model && <span className="text-primary">best</span>}</div>
      <div className="flex flex-col gap-1">
        {MODELS.map((m) => (
          <button key={m} onClick={() => m !== settings.active_model && setActiveModel(m as ModelName)}
            className={`flex items-center gap-2 rounded-sm px-2 py-1 text-left text-[12px] transition-colors ${
              settings.active_model === m ? "bg-primary/15 text-ink" : "text-ink-3 hover:text-ink-2"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${settings.active_model === m ? "bg-primary" : "bg-line/30"}`} />
            {MODEL_LABELS[m]}
          </button>
        ))}
      </div>
    </div>
  );
}

function SystemStatus() {
  const { health, healthError } = useApp();
  const ok = health?.status === "ok" && !healthError;
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2" title={healthError ?? health?.message ?? "All systems nominal"}>
        <PulseDot color={ok ? "rgb(var(--mint))" : "rgb(var(--coral))"} size={7} />
        <span className="font-mono text-[10.5px] uppercase tracking-wider text-ink-3">{ok ? "API online" : healthError ? "API offline" : "Degraded"}</span>
      </div>
      <ThemeSwitch compact />
    </div>
  );
}

/** Live transaction tape across the top - latest ingested records with the active model's probability. */
function Ticker() {
  const { dataVersion, settings } = useApp();
  const { data } = useApi(() => get<{ items: Tx[] }>("/api/transactions?sort_by=id&page_size=24"), [dataVersion, settings?.active_model], { interval: 20000 });
  const items = data?.items ?? [];
  if (!items.length) return <div className="h-9 border-b border-line/[0.08]" />;
  const row = (k: string) => (
    <div className="flex shrink-0 items-center" key={k}>
      {items.map((t) => {
        const p = t.prediction?.probability ?? 0;
        const hot = (t.prediction?.predicted_label ?? 0) === 1;
        return (
          <span key={`${k}${t.id}`} className="flex items-center gap-2 border-r border-line/[0.08] px-4 font-mono text-[11px]">
            <span className={hot ? "text-coral" : "text-ink-3"}>{hot ? "▲" : "•"}</span>
            <span className="text-ink-2">{t.external_id}</span>
            <span className="text-ink-3">{fmtMoney(t.amount)}</span>
            <span className={hot ? "text-coral" : p > 0.25 ? "text-amber" : "text-mint"}>{fmtProb(p)}</span>
          </span>
        );
      })}
    </div>
  );
  return (
    <div className="group relative flex h-9 items-center overflow-hidden border-b border-line/[0.08] bg-bg-2/40" aria-label="Live transaction stream">
      <div className="z-10 flex h-full shrink-0 items-center gap-2 border-r border-line/[0.1] bg-bg-2 px-3">
        <Activity size={12} className="text-secondary" />
        <span className="font-mono text-[10px] uppercase tracking-kicker text-ink-3">Live feed</span>
      </div>
      <div className="flex animate-ticker group-hover:[animation-play-state:paused]">{row("a")}{row("b")}</div>
    </div>
  );
}

/** Polls alert counts and pops a floating notification when new alerts arrive. */
function useAlertWatcher() {
  const { notify, dataVersion } = useApp();
  const { data } = useApi(() => get<AlertSummary>("/api/alerts/summary"), [dataVersion], { interval: 15000 });
  const prev = useRef<number | null>(null);
  useEffect(() => {
    if (!data) return;
    if (prev.current != null && data.total > prev.current) {
      const n = data.total - prev.current;
      notify({ tone: "danger", title: `${n} new fraud alert${n > 1 ? "s" : ""}`, body: "Raised by the active model. Open the Alert Center to investigate.", href: "/alerts" });
    }
    prev.current = data.total;
  }, [data, notify]);
  return data?.by_status.pending ?? 0;
}

function Toasts() {
  const { toasts, dismiss } = useApp();
  const nav = useNavigate();
  const tone = { info: "primary", success: "mint", danger: "coral", warn: "amber" } as const;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} layout initial={{ opacity: 0, x: 40, scale: 0.96 }} animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40 }} className="panel pointer-events-auto overflow-hidden p-3.5 pl-4">
            <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: `rgb(var(--${tone[t.tone]}))` }} />
            <div className="flex items-start gap-3">
              <div className="mt-1"><PulseDot color={`rgb(var(--${tone[t.tone]}))`} size={7} pulse={t.tone === "danger"} /></div>
              <button className="min-w-0 flex-1 text-left" onClick={() => { if (t.href) { nav(t.href); dismiss(t.id); } }}>
                <div className="text-[13px] font-semibold">{t.title}</div>
                {t.body && <div className="mt-0.5 text-[12px] leading-snug text-ink-2">{t.body}</div>}
              </button>
              <button onClick={() => dismiss(t.id)} className="text-ink-3 hover:text-ink" aria-label="Dismiss"><X size={13} /></button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function NotTrainedBanner() {
  const { health, healthError } = useApp();
  if (healthError)
    return (
      <div className="border-b border-coral/30 bg-coral/10 px-6 py-2 text-[12.5px] text-coral">
        {healthError} Start it with <code className="font-mono">run_project.bat</code> or <code className="font-mono">uvicorn app.main:app --port 8000</code> (inside <code>backend/</code>).
      </div>
    );
  if (health && !health.checks.models_trained)
    return (
      <div className="border-b border-amber/30 bg-amber/10 px-6 py-2 text-[12.5px] text-amber">
        Models are not trained yet. Run <code className="font-mono">python backend/scripts/train_models.py</code> then restart the backend.
      </div>
    );
  return null;
}

export function Layout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const pending = useAlertWatcher();
  useEffect(() => { window.scrollTo({ top: 0 }); }, [loc.pathname]);

  return (
    <>
    <AmbientBackground />
    <div className="relative z-10 flex min-h-screen">
      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-screen w-[244px] shrink-0 flex-col border-r border-line/[0.10] bg-bg-2/60 px-3 py-5 backdrop-blur-xl lg:flex">
        <div className="px-3"><Logo /></div>
        <div className="kicker mb-2 mt-8 px-3">Navigation</div>
        <div className="flex-1 overflow-y-auto pl-3"><NavItems pending={pending} /></div>
        <div className="space-y-3 px-1 pt-4">
          <ModelSwitch />
          <SystemStatus />
        </div>
      </aside>

      {/* Mobile header + drawer */}
      <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-line/[0.1] bg-bg/85 px-4 backdrop-blur-xl lg:hidden">
        <Logo />
        <button className="btn-ghost px-2 py-1.5" onClick={() => setOpen(true)} aria-label="Open navigation"><Menu size={18} /></button>
      </div>
      <AnimatePresence>
        {open && (
          <>
            <motion.div className="fixed inset-0 z-40 bg-bg/70 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            <motion.aside className="fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col border-r border-line/[0.12] bg-bg-2 px-3 py-5 lg:hidden"
              initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }} transition={{ type: "spring", stiffness: 380, damping: 36 }}>
              <div className="flex items-center justify-between px-3"><Logo /><button onClick={() => setOpen(false)} aria-label="Close"><X size={18} /></button></div>
              <div className="mt-8 flex-1 overflow-y-auto pl-3"><NavItems pending={pending} onNavigate={() => setOpen(false)} /></div>
              <div className="space-y-3 px-1 pt-4"><ModelSwitch /><SystemStatus /></div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col pt-14 lg:pt-0">
        <Ticker />
        <NotTrainedBanner />
        <AnimatePresence mode="wait">
          <motion.main key={loc.pathname} className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-8 sm:px-6 lg:px-10"
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
            {children}
          </motion.main>
        </AnimatePresence>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line/[0.08] px-6 py-4 font-mono text-[10.5px] uppercase tracking-wider text-ink-3 lg:px-10">
          <span className="flex items-center gap-2"><BrandMark size={14} /> TRANZIQ · Intelligence Behind Every Transaction.
            <button className="ml-3 inline-flex items-center gap-1 text-primary hover:underline" onClick={() => window.dispatchEvent(new Event("tranziq:replay"))}><Play size={10} />Replay intro</button></span>
          <span>Educational portfolio project · predictions are not financial decisions</span>
        </footer>
      </div>
      <Toasts />
    </div>
    </>
  );
}
