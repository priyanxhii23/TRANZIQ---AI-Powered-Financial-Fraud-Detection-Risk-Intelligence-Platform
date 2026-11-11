import { motion, useReducedMotion } from "framer-motion";
import { RISK_META, fmtNum, fmtProb } from "../lib/format";
import type { Contribution, Metrics, RiskLevel } from "../lib/types";

/* ---------------------------------------------------------------
   Risk meter: a 240-degree arc gauge with the four risk bands,
   the model's decision threshold tick and an animated needle.
   --------------------------------------------------------------- */
const polar = (cx: number, cy: number, r: number, deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};
const arc = (cx: number, cy: number, r: number, a0: number, a1: number) => {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  return `M${x0} ${y0} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
};
const START = -120, SWEEP = 240;
const ang = (p: number) => START + SWEEP * Math.min(1, Math.max(0, p));

export function RiskMeter({ probability, threshold, bands, level, size = 260 }: {
  probability: number; threshold?: number; bands: { medium: number; high: number; critical: number }; level: RiskLevel; size?: number;
}) {
  const reduce = useReducedMotion();
  const cx = 130, cy = 130, r = 104;
  const segs: [number, number, string][] = [
    [0, bands.medium, "rgb(var(--mint))"], [bands.medium, bands.high, "rgb(var(--amber))"],
    [bands.high, bands.critical, "rgb(var(--coral) / 0.7)"], [bands.critical, 1, "rgb(var(--coral))"],
  ];
  const color = RISK_META[level].color;
  const [tx, ty] = threshold != null ? polar(cx, cy, r + 13, ang(threshold)) : [0, 0];
  return (
    <svg viewBox="0 0 260 228" width={size} height={size * 0.877} role="img" aria-label={`Fraud probability ${fmtProb(probability)}`}>
      <path d={arc(cx, cy, r, START, START + SWEEP)} stroke="rgb(var(--line) / 0.12)" strokeWidth="16" fill="none" strokeLinecap="round" />
      {segs.map(([a, b, c], i) => (
        <path key={i} d={arc(cx, cy, r, ang(a) + 0.8, ang(b) - 0.8)} stroke={c} strokeOpacity={0.28} strokeWidth="16" fill="none" />
      ))}
      <motion.path d={arc(cx, cy, r, START, START + SWEEP)} stroke={color} strokeWidth="16" fill="none" strokeLinecap="round"
        initial={{ pathLength: 0 }} animate={{ pathLength: Math.max(0.005, probability) }}
        transition={{ duration: reduce ? 0 : 1.2, ease: [0.22, 1, 0.36, 1] }} />
      {Array.from({ length: 41 }, (_, i) => {
        const [x0, y0] = polar(cx, cy, r - 16, ang(i / 40));
        const [x1, y1] = polar(cx, cy, r - (i % 10 === 0 ? 25 : 20), ang(i / 40));
        return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke="rgb(var(--ink-3))" strokeOpacity={i % 10 === 0 ? 0.7 : 0.3} strokeWidth="1" />;
      })}
      {threshold != null && (
        <g>
          <circle cx={tx} cy={ty} r="4" fill="rgb(var(--ink))" />
          <text x={tx} y={ty - 8} textAnchor="middle" className="fill-ink-2" style={{ fontSize: 9, fontFamily: "JetBrains Mono" }}>
            THR {threshold.toFixed(2)}
          </text>
        </g>
      )}
      <motion.g style={{ originX: `${cx}px`, originY: `${cy}px` }}
        initial={{ rotate: START }} animate={{ rotate: ang(probability) }}
        transition={{ duration: reduce ? 0 : 1.2, ease: [0.22, 1, 0.36, 1] }}>
        <line x1={cx} y1={cy} x2={cx} y2={cy - 52} stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      </motion.g>
      <circle cx={cx} cy={cy} r="6" fill="rgb(var(--bg))" stroke={color} strokeWidth="2.5" />
      <text x={cx} y={cy + 78} textAnchor="middle" className="fill-ink" style={{ fontSize: 34, fontFamily: "Instrument Serif" }}>
        {fmtProb(probability)}
      </text>
      <text x={cx} y={cy + 96} textAnchor="middle" style={{ fontSize: 10, fontFamily: "JetBrains Mono", letterSpacing: "0.18em", fill: color }}>
        {RISK_META[level].label.toUpperCase()} RISK
      </text>
    </svg>
  );
}

/* ---------------------------------------------------------------
   Risk Intelligence Core - concentric rings, one per risk level,
   arc length = share of transactions; centre = fraud prediction rate.
   --------------------------------------------------------------- */
export function RiskCore({ distribution, rate, total }: { distribution: Record<RiskLevel, number>; rate: number; total: number }) {
  const reduce = useReducedMotion();
  const levels: RiskLevel[] = ["critical", "high", "medium", "low"];
  // Log-scaled arcs: rare levels (critical/high) stay visible next to the huge "low" count.
  const max = Math.log1p(Math.max(1, ...levels.map((l) => distribution[l] ?? 0)));
  return (
    <svg viewBox="0 0 320 320" className="h-full w-full" role="img" aria-label="Risk distribution rings">
      <defs>
        <radialGradient id="coreGlow">
          <stop offset="0" stopColor="rgb(var(--violet))" stopOpacity="0.35" />
          <stop offset="1" stopColor="rgb(var(--violet))" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="160" cy="160" r="150" fill="url(#coreGlow)" />
      {[148, 60].map((r) => <circle key={r} cx="160" cy="160" r={r} fill="none" stroke="rgb(var(--line) / 0.10)" strokeDasharray="2 5" />)}
      <motion.g style={{ originX: "160px", originY: "160px" }} animate={reduce ? undefined : { rotate: 360 }}
        transition={{ duration: 80, repeat: Infinity, ease: "linear" }}>
        {Array.from({ length: 60 }, (_, i) => {
          const [x0, y0] = polar(160, 160, 141, i * 6);
          const [x1, y1] = polar(160, 160, i % 5 === 0 ? 134 : 137, i * 6);
          return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke="rgb(var(--ink-3))" strokeOpacity={0.4} />;
        })}
      </motion.g>
      {levels.map((l, i) => {
        const r = 122 - i * 15;
        const share = Math.log1p(distribution[l] ?? 0) / max;
        return (
          <g key={l}>
            <circle cx="160" cy="160" r={r} fill="none" stroke="rgb(var(--line) / 0.08)" strokeWidth="9" />
            <motion.circle cx="160" cy="160" r={r} fill="none" stroke={RISK_META[l].color} strokeWidth="9" strokeLinecap="round"
              transform="rotate(-90 160 160)"
              initial={{ pathLength: 0 }} animate={{ pathLength: Math.max(0.012, share * 0.92) }}
              transition={{ duration: reduce ? 0 : 1.4, delay: 0.15 * i, ease: [0.22, 1, 0.36, 1] }} />
          </g>
        );
      })}
      <text x="160" y="150" textAnchor="middle" className="fill-ink" style={{ fontSize: 44, fontFamily: "Instrument Serif" }}>
        {(rate * 100).toFixed(2)}%
      </text>
      <text x="160" y="172" textAnchor="middle" className="fill-ink-3" style={{ fontSize: 8.5, fontFamily: "JetBrains Mono", letterSpacing: "0.2em" }}>
        PREDICTED FRAUD RATE
      </text>
      <text x="160" y="188" textAnchor="middle" className="fill-ink-3" style={{ fontSize: 8.5, fontFamily: "JetBrains Mono" }}>
        n = {total.toLocaleString()}
      </text>
    </svg>
  );
}

/* ---------------------------------------------------------------
   SHAP contribution bars (diverging from zero)
   --------------------------------------------------------------- */
export function ShapBars({ contributions, max = 12, units }: { contributions: Contribution[]; max?: number; units?: string }) {
  const rows = contributions.slice(0, max);
  const m = Math.max(1e-9, ...rows.map((c) => Math.abs(c.shap_value)));
  return (
    <div className="space-y-1.5">
      {rows.map((c, i) => {
        const pos = c.shap_value > 0;
        const w = (Math.abs(c.shap_value) / m) * 50;
        return (
          <div key={c.feature} className="group grid grid-cols-[64px_1fr_74px] items-center gap-3" title={c.note}>
            <div className="num text-right text-[12px] text-ink-2">{c.feature}</div>
            <div className="relative h-5">
              <div className="absolute left-1/2 top-0 h-full w-px bg-line/25" />
              <motion.div
                className="absolute top-1 h-3 rounded-sm"
                style={{ background: pos ? "rgb(var(--coral))" : "rgb(var(--cyan))", [pos ? "left" : "right"]: "50%" }}
                initial={{ width: 0 }} animate={{ width: `${w}%` }} transition={{ duration: 0.7, delay: i * 0.035 }}
              />
            </div>
            <div className={`num text-[11.5px] ${pos ? "text-coral" : "text-cyan"}`}>{pos ? "+" : ""}{fmtNum(c.shap_value, 3)}</div>
          </div>
        );
      })}
      <div className="flex justify-between pt-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">
        <span className="text-cyan">← towards legitimate</span>
        {units && <span>SHAP · {units}</span>}
        <span className="text-coral">towards fraud →</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Confusion matrix
   --------------------------------------------------------------- */
export function ConfusionMatrix({ m, compact = false }: { m: Metrics["confusion_matrix"]; compact?: boolean }) {
  const cells = [
    { k: "TN", v: m.tn, d: "Legit predicted legit", tone: "mint", good: true },
    { k: "FP", v: m.fp, d: "False alarm", tone: "amber", good: false },
    { k: "FN", v: m.fn, d: "Missed fraud", tone: "coral", good: false },
    { k: "TP", v: m.tp, d: "Fraud caught", tone: "cyan", good: true },
  ];
  return (
    <div>
      <div className="mb-1 grid grid-cols-[28px_1fr_1fr] gap-1 text-center">
        <span />
        <span className="label">Pred legit</span>
        <span className="label">Pred fraud</span>
      </div>
      <div className="grid grid-cols-[28px_1fr_1fr] gap-1">
        {[0, 1].map((row) => (
          <div key={row} className="contents">
            <span className="label flex items-center justify-center [writing-mode:vertical-rl] rotate-180">{row ? "Fraud" : "Legit"}</span>
            {cells.slice(row * 2, row * 2 + 2).map((c) => (
              <div key={c.k} className={`rounded-sm border px-2 ${compact ? "py-2" : "py-3"} text-center`}
                style={{ borderColor: `rgb(var(--${c.tone}) / 0.3)`, background: `rgb(var(--${c.tone}) / ${c.good ? 0.1 : 0.08})` }}>
                <div className="num text-[18px] font-medium" style={{ color: `rgb(var(--${c.tone}))` }}>{c.v.toLocaleString()}</div>
                <div className="font-mono text-[9.5px] uppercase tracking-wider text-ink-3">{c.k} · {c.d}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* Small inline sparkline (no axes) */
export function Sparkline({ values, color = "rgb(var(--violet))", height = 36 }: { values: number[]; color?: string; height?: number }) {
  if (values.length < 2) return <div style={{ height }} />;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${height - (v / max) * (height - 4) - 2}`).join(" ");
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <motion.polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2 }} />
    </svg>
  );
}
