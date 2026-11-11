import { AnimatePresence, animate, motion, useInView, useReducedMotion } from "framer-motion";
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { RISK_META, SOURCE_META, fmtProb } from "../lib/format";
import type { RiskLevel, Source } from "../lib/types";

/* ---------- Panels ---------- */
export function Panel({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      className={`panel ${className}`}
    >
      {children}
    </motion.section>
  );
}

export function PanelHead({ kicker, title, children }: { kicker?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="panel-head">
      <div className="min-w-0">
        {kicker && <div className="kicker mb-0.5">{kicker}</div>}
        <h3 className="truncate text-[14px] font-semibold text-ink">{title}</h3>
      </div>
      {children && <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/* ---------- Page header: editorial title ---------- */
export function PageHeader({ index, kicker, title, accent, intro, children }: {
  index: string; kicker: string; title: string; accent?: string; intro?: ReactNode; children?: ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div className="max-w-3xl">
        <div className="kicker mb-3 flex items-center gap-3">
          <span className="text-violet">{index}</span>
          <span className="h-px w-8 bg-line/30" />
          {kicker}
        </div>
        <h1 className="font-display text-[44px] leading-[0.95] tracking-tight text-ink sm:text-[58px]">
          {title} {accent && <em className="grad-text pr-1">{accent}</em>}
        </h1>
        {intro && <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-ink-2">{intro}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

/* ---------- Numbers ---------- */
export function AnimatedNumber({ value, format = (n) => Math.round(n).toLocaleString("en-US"), className = "" }: {
  value: number; format?: (n: number) => string; className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const prev = useRef(0);
  useEffect(() => {
    if (!ref.current || !inView) return;
    if (reduce) {
      ref.current.textContent = format(value);
      return;
    }
    const ctrl = animate(prev.current, value, {
      duration: 1.1, ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => { if (ref.current) ref.current.textContent = format(v); },
    });
    prev.current = value;
    return () => ctrl.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, inView, reduce]);
  return <span ref={ref} className={className}>{format(0)}</span>;
}

/* ---------- Chips ---------- */
export function RiskChip({ level, pulse = false }: { level: RiskLevel; pulse?: boolean }) {
  const m = RISK_META[level];
  return (
    <span className="chip" style={{ color: m.color, borderColor: `color-mix(in srgb, ${m.color} 40%, transparent)` }}>
      <PulseDot color={m.color} pulse={pulse && (level === "critical" || level === "high")} size={6} />
      {m.label}
    </span>
  );
}

export function SourceChip({ source }: { source: Source }) {
  const m = SOURCE_META[source];
  return (
    <span className="chip border-current/30" style={{ color: m.color }} title={m.label}>
      {m.short}
    </span>
  );
}

export function LabelChip({ label }: { label: number | null }) {
  if (label == null) return <span className="font-mono text-[11px] text-ink-3" title="No ground truth for this record">n/a</span>;
  return (
    <span className={`chip ${label ? "border-coral/40 text-coral" : "border-mint/40 text-mint"}`} title="Known Kaggle label (ground truth)">
      {label ? "Fraud" : "Legit"}
    </span>
  );
}

export function PulseDot({ color, pulse = true, size = 8 }: { color: string; pulse?: boolean; size?: number }) {
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {pulse && <span className="absolute inset-0 animate-pulse-ring rounded-full" style={{ background: color }} />}
      <span className="relative inline-block rounded-full" style={{ width: size, height: size, background: color }} />
    </span>
  );
}

export function ProbBar({ p, threshold }: { p: number; threshold?: number }) {
  const color = p >= 0.8 ? "rgb(var(--coral))" : p >= 0.5 ? "rgb(var(--coral) / 0.75)" : p >= 0.25 ? "rgb(var(--amber))" : "rgb(var(--mint))";
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-20 overflow-hidden rounded-full bg-line/15">
        <motion.div className="h-full rounded-full" style={{ background: color }}
          initial={{ width: 0 }} animate={{ width: `${Math.max(2, p * 100)}%` }} transition={{ duration: 0.6 }} />
        {threshold != null && <span className="absolute top-0 h-full w-px bg-ink/60" style={{ left: `${threshold * 100}%` }} />}
      </div>
      <span className="num w-14 text-[12px]" style={{ color }}>{fmtProb(p)}</span>
    </div>
  );
}

/* ---------- Controls ---------- */
export function Segmented<T extends string>({ options, value, onChange, size = "md" }: {
  options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; size?: "sm" | "md";
}) {
  const id = useRef(`seg${Math.random().toString(36).slice(2)}`).current;
  return (
    <div className="inline-flex max-w-full flex-wrap rounded border border-line/[0.14] bg-bg/50 p-0.5" role="tablist">
      {options.map((o) => (
        <button
          key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={`relative rounded-sm font-medium transition-colors ${size === "sm" ? "px-2.5 py-1 text-[11.5px]" : "px-3 py-1.5 text-[12.5px]"} ${value === o.value ? "text-ink" : "text-ink-3 hover:text-ink-2"}`}
        >
          {value === o.value && (
            <motion.span layoutId={id} className="absolute inset-0 rounded-sm border border-violet/40 bg-violet/15"
              transition={{ type: "spring", stiffness: 500, damping: 38 }} />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children, className = "" }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label mb-1.5 flex items-center justify-between gap-2"><span>{label}</span>{hint && <span className="normal-case tracking-normal">{hint}</span>}</span>
      {children}
    </label>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex items-center gap-2.5 text-[13px] text-ink-2" aria-pressed={checked}>
      <span className={`relative h-5 w-9 rounded-full border transition-colors ${checked ? "border-violet/60 bg-violet/40" : "border-line/20 bg-line/10"}`}>
        <motion.span layout className={`absolute top-0.5 h-3.5 w-3.5 rounded-full ${checked ? "right-0.5 bg-white" : "left-0.5 bg-ink-3"}`}
          transition={{ type: "spring", stiffness: 600, damping: 35 }} />
      </span>
      {label}
    </button>
  );
}

export function Select<T extends string>({ value, onChange, options, className = "" }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronRight size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rotate-90 text-ink-3" />
    </div>
  );
}

/* ---------- States ---------- */
export function Loading({ label = "Loading intelligence", className = "h-40" }: { label?: string; className?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 ${className}`}>
      <div className="relative h-8 w-8">
        <span className="absolute inset-0 animate-ping rounded-full border border-violet/50" />
        <Loader2 className="relative h-8 w-8 animate-spin text-violet" strokeWidth={1.5} />
      </div>
      <span className="kicker">{label}</span>
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`relative overflow-hidden rounded bg-line/[0.07] ${className}`}>
    <div className="absolute inset-0 -translate-x-full animate-[ticker_1.6s_linear_infinite] bg-gradient-to-r from-transparent via-line/10 to-transparent" />
  </div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <AlertTriangle className="text-coral" size={26} strokeWidth={1.5} />
      <p className="max-w-md text-[13px] text-ink-2">{message}</p>
      {onRetry && <button className="btn-ghost" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function EmptyState({ title, body, children }: { title: string; body?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <Inbox className="text-ink-3" size={26} strokeWidth={1.4} />
      <p className="text-[14px] font-semibold text-ink">{title}</p>
      {body && <p className="max-w-md text-[13px] text-ink-3">{body}</p>}
      {children}
    </div>
  );
}

export function Pagination({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (p: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line/[0.10] px-4 py-3">
      <span className="num text-[12px] text-ink-3">{total.toLocaleString()} records · page {page}/{pages}</span>
      <div className="flex items-center gap-1">
        <button className="btn-ghost px-2 py-1" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft size={14} /></button>
        <input className="input num w-14 px-2 py-1 text-center" value={page} aria-label="Page number"
          onChange={(e) => { const n = Number(e.target.value); if (n >= 1 && n <= pages) onPage(n); }} />
        <button className="btn-ghost px-2 py-1" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight size={14} /></button>
      </div>
    </div>
  );
}

/* ---------- Overlays ---------- */
export function Drawer({ open, onClose, title, kicker, children, width = 560 }: {
  open: boolean; onClose: () => void; title: ReactNode; kicker?: string; children: ReactNode; width?: number;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-bg/60 backdrop-blur-sm" onClick={onClose}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.aside
            className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line/[0.14] bg-bg-2/95 backdrop-blur-xl"
            style={{ maxWidth: width }}
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            role="dialog" aria-modal="true"
          >
            <div className="flex items-start justify-between gap-3 border-b border-line/[0.12] px-6 py-4">
              <div className="min-w-0">
                {kicker && <div className="kicker mb-1">{kicker}</div>}
                <div className="truncate text-[17px] font-semibold">{title}</div>
              </div>
              <button className="btn-ghost px-2 py-1.5" onClick={onClose} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

export function Confirm({ open, title, body, confirmLabel = "Confirm", onConfirm, onCancel, danger = false }: {
  open: boolean; title: string; body: ReactNode; confirmLabel?: string; onConfirm: () => void; onCancel: () => void; danger?: boolean;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/70 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onCancel}>
          <motion.div className="panel w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}
            initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }} role="alertdialog">
            <h3 className="font-display text-3xl">{title}</h3>
            <div className="mt-2 text-[13px] leading-relaxed text-ink-2">{body}</div>
            <div className="mt-6 flex justify-end gap-2">
              <button className="btn-ghost" onClick={onCancel}>Cancel</button>
              <button className={danger ? "btn-danger" : "btn-primary"} onClick={onConfirm}>{confirmLabel}</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------- Charts ---------- */
interface TipPayload { name?: string; value?: number | string; color?: string; dataKey?: string | number; payload?: Record<string, unknown> }
export function ChartTip({ active, payload, label, fmt, labelFmt }: {
  active?: boolean; payload?: TipPayload[]; label?: string | number;
  fmt?: (v: number, name?: string) => string; labelFmt?: (l: string | number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded border border-line/20 bg-bg-2/95 px-3 py-2 shadow-xl backdrop-blur">
      {label != null && <div className="label mb-1.5">{labelFmt ? labelFmt(label) : label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-[12px]">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-ink-2">{p.name}</span>
          <span className="num ml-auto pl-3 text-ink">{typeof p.value === "number" ? (fmt ? fmt(p.value, p.name) : p.value.toLocaleString()) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

export function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="num mt-1 text-[22px] font-medium" style={tone ? { color: tone } : undefined}>{value}</div>
      {sub && <div className="mt-0.5 text-[11.5px] text-ink-3">{sub}</div>}
    </div>
  );
}
