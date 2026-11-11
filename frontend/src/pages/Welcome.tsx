import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Pause, Play, RotateCcw, ShieldAlert, ShieldCheck, SkipForward } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrandMark, Wordmark } from "../components/Brand";
import { ThemeSwitch } from "../components/ThemeSwitch";
import { get } from "../lib/api";
import { fmtMoney, fmtProb } from "../lib/format";
import type { Paged, Tx } from "../lib/types";

/* =====================================================================
   THE JOURNEY OF A TRANSACTION
   Scenes 1-4 tell a short story on one continuous illustrated street;
   scene 5 is the welcome screen with an interactive intelligence orbit.
   Everything is SVG + Framer Motion + CSS: no video, no heavy assets.
   Colours come from theme tokens, so both themes are supported.
   ===================================================================== */

const SCENES = [
  { n: "01", title: "Everyday banking", line: "Every day, people trust a card, an ATM and a balance they never think twice about.", ms: 6500 },
  { n: "02", title: "Transactions begin", line: "A coffee, a new jacket, an online order, a flight abroad. Every payment leaves a pattern.", ms: 7500 },
  { n: "03", title: "The unexpected problem", line: "03:14. A payment the customer never made. By morning, €2,450 has gone.", ms: 6500 },
  { n: "04", title: "TRANZIQ intervenes", line: "Every transaction is scored against learned patterns. The unusual one is stopped for review.", ms: 8000 },
];
const WELCOME = SCENES.length; // index of the final welcome scene

const S = {
  line: { stroke: "rgb(var(--ink-3) / 0.55)" },
  soft: { stroke: "rgb(var(--ink-3) / 0.28)" },
  body: { fill: "rgb(var(--panel))", stroke: "rgb(var(--ink-3) / 0.55)" },
  primary: { fill: "rgb(var(--primary))" },
  secondary: { fill: "rgb(var(--secondary))" },
  coral: { fill: "rgb(var(--coral))" },
  text: { fill: "rgb(var(--ink-2))", fontFamily: "JetBrains Mono, monospace" },
};
const GROUND = 468;
const STOPS = [-40, 300, 455, 650, 820, 960]; // person x per location
const TX = [
  { key: "atm", x: 360, y: 300, label: "Cash withdrawal", amt: 200 },
  { key: "cafe", x: 520, y: 300, label: "Harbor Café", amt: 18.4 },
  { key: "shop", x: 720, y: 270, label: "Velvet Boutique", amt: 129 },
  { key: "online", x: 890, y: 250, label: "Online order", amt: 54.99 },
  { key: "intl", x: 1070, y: 250, label: "Tokyo · international", amt: 60 },
];
const FRAUD = { x: 1090, y: 96, amt: 2450 };
const CENTER = { x: 600, y: 230 };

/* ---------------- persistent street ---------------- */
function Street({ dim }: { dim: number }) {
  return (
    <motion.g animate={{ opacity: dim }} transition={{ duration: 0.9 }}>
      <line x1="0" y1={GROUND} x2="1200" y2={GROUND} style={S.line} strokeWidth="1.2" />
      {Array.from({ length: 30 }, (_, i) => <line key={i} x1={i * 42} y1={GROUND + 18} x2={i * 42 + 18} y2={GROUND + 18} style={S.soft} />)}
      {/* Bank */}
      <g strokeWidth="1.3">
        <polygon points="50,250 175,192 300,250" style={S.body} />
        <rect x="60" y="250" width="230" height="18" style={S.body} />
        <text x="175" y="263" textAnchor="middle" style={{ ...S.text, fontSize: 10, letterSpacing: "0.4em" }}>BANK</text>
        {[82, 132, 182, 232].map((x) => <rect key={x} x={x} y="268" width="18" height="162" style={S.body} />)}
        <rect x="55" y="430" width="240" height="14" style={S.body} />
        <rect x="45" y="444" width="260" height="12" style={S.body} />
        <rect x="35" y="456" width="280" height="12" style={S.body} />
      </g>
      {/* ATM */}
      <g strokeWidth="1.3">
        <rect x="325" y="330" width="70" height="138" rx="6" style={S.body} />
        <rect x="337" y="346" width="46" height="30" rx="3" style={{ fill: "rgb(var(--primary) / 0.14)", stroke: "rgb(var(--primary) / 0.5)" }} />
        {[0, 1, 2].map((r) => [0, 1, 2].map((c) => <circle key={`${r}${c}`} cx={347 + c * 13} cy={392 + r * 11} r="2.4" style={{ fill: "rgb(var(--ink-3) / 0.5)" }} />))}
        <line x1="345" y1="430" x2="375" y2="430" style={S.line} strokeWidth="2" />
        <text x="360" y="455" textAnchor="middle" style={{ ...S.text, fontSize: 8 }}>ATM</text>
      </g>
      {/* Café */}
      <g strokeWidth="1.3">
        <rect x="440" y="340" width="160" height="128" style={S.body} />
        <path d="M432 340 L608 340 L600 316 L440 316 Z" style={{ fill: "rgb(var(--secondary) / 0.18)", stroke: "rgb(var(--ink-3) / 0.55)" }} />
        {Array.from({ length: 8 }, (_, i) => <path key={i} d={`M${440 + i * 20} 340 q10 12 20 0`} style={{ fill: "rgb(var(--secondary) / 0.35)", stroke: "rgb(var(--ink-3) / 0.4)" }} />)}
        <rect x="455" y="370" width="70" height="50" style={{ fill: "rgb(var(--secondary) / 0.08)", stroke: "rgb(var(--ink-3) / 0.45)" }} />
        <rect x="545" y="380" width="38" height="88" style={S.body} />
        <text x="520" y="333" textAnchor="middle" style={{ ...S.text, fontSize: 9, letterSpacing: "0.3em" }}>CAFÉ</text>
      </g>
      {/* Boutique */}
      <g strokeWidth="1.3">
        <rect x="640" y="300" width="160" height="168" style={S.body} />
        <rect x="652" y="330" width="96" height="80" style={{ fill: "rgb(var(--primary) / 0.06)", stroke: "rgb(var(--ink-3) / 0.45)" }} />
        <path d="M685 372 h30 l-4 26 h-22 z M692 372 q8 -14 16 0" style={{ fill: "none", stroke: "rgb(var(--primary) / 0.6)" }} />
        <rect x="762" y="380" width="28" height="88" style={S.body} />
        <text x="720" y="320" textAnchor="middle" style={{ ...S.text, fontSize: 9, letterSpacing: "0.3em" }}>BOUTIQUE</text>
      </g>
      {/* Phone / online */}
      <motion.g animate={{ y: [0, -6, 0] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }} strokeWidth="1.3">
        <rect x="860" y="300" width="60" height="110" rx="10" style={S.body} />
        <rect x="868" y="314" width="44" height="72" rx="3" style={{ fill: "rgb(var(--primary) / 0.1)", stroke: "rgb(var(--ink-3) / 0.4)" }} />
        <rect x="874" y="364" width="32" height="12" rx="6" style={S.primary} />
        <text x="890" y="373" textAnchor="middle" style={{ fill: "rgb(var(--on-primary))", fontSize: 7, fontFamily: "JetBrains Mono" }}>PAY</text>
      </motion.g>
      <line x1="860" y1="440" x2="920" y2="440" style={S.soft} />
      {/* Globe */}
      <g strokeWidth="1.2">
        <circle cx="1070" cy="370" r="68" style={S.body} />
        <ellipse cx="1070" cy="370" rx="28" ry="68" style={{ fill: "none", ...S.soft }} />
        <ellipse cx="1070" cy="370" rx="68" ry="24" style={{ fill: "none", ...S.soft }} />
        <line x1="1002" y1="370" x2="1138" y2="370" style={S.soft} />
        <path id="flight" d="M990 310 Q1070 230 1150 320" style={{ fill: "none", stroke: "rgb(var(--secondary) / 0.6)" }} strokeDasharray="4 5" />
        <path d="M-6 -4 L8 0 L-6 4 Z" style={S.secondary}>
          <animateMotion dur="5s" repeatCount="indefinite" rotate="auto" path="M990 310 Q1070 230 1150 320" />
        </path>
        <line x1="1070" y1="438" x2="1070" y2={GROUND} style={S.line} />
      </g>
    </motion.g>
  );
}

/* ---------------- the person ---------------- */
function Person({ x, phoneAlert }: { x: number; phoneAlert: boolean }) {
  const reduce = useReducedMotion();
  // legs swing only while the figure travels to a new stop
  const [walking, setWalking] = useState(false);
  useEffect(() => {
    if (reduce) return;
    setWalking(true);
    const t = setTimeout(() => setWalking(false), 1600);
    return () => clearTimeout(t);
  }, [x, reduce]);
  const swing = walking ? { rotate: [18, -18, 18] } : { rotate: 0 };
  const t = { duration: 0.7, repeat: walking ? Infinity : 0, ease: "easeInOut" as const };
  return (
    <motion.g initial={{ x: STOPS[0] }} animate={{ x }} transition={{ duration: 1.6, ease: [0.45, 0, 0.25, 1] }}>
      <g transform={`translate(0 ${GROUND - 92})`}>
        <circle cx="0" cy="0" r="11" style={{ fill: "rgb(var(--ink-2))" }} />
        <rect x="-11" y="15" width="22" height="40" rx="10" style={{ fill: "rgb(var(--primary) / 0.85)" }} />
        <motion.line x1="-4" y1="52" x2="-6" y2="92" style={{ stroke: "rgb(var(--ink-2))", originX: "-4px", originY: "52px" }} strokeWidth="5" strokeLinecap="round" animate={swing} transition={t} />
        <motion.line x1="4" y1="52" x2="6" y2="92" style={{ stroke: "rgb(var(--ink-2))", originX: "4px", originY: "52px" }} strokeWidth="5" strokeLinecap="round" animate={walking ? { rotate: [-18, 18, -18] } : { rotate: 0 }} transition={t} />
        <rect x="9" y="26" width="9" height="15" rx="2" style={{ fill: phoneAlert ? "rgb(var(--coral))" : "rgb(var(--secondary))" }} />
      </g>
    </motion.g>
  );
}

/* ---------------- transaction chip on the street ---------------- */
function Chip({ x, y, label, amount, tone = "primary", delay = 0, onClick, active }: {
  x: number; y: number; label: string; amount: string; tone?: "primary" | "coral" | "mint"; delay?: number; onClick?: () => void; active?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const c = `var(--${tone})`;
  return (
    <motion.g initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay, duration: 0.5 }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onClick={onClick}
      style={{ cursor: onClick ? "pointer" : "default" }}>
      <motion.rect x={x - 72} y={y - 22} width="144" height="40" rx="7"
        style={{ fill: "rgb(var(--panel))", stroke: `rgb(${c} / ${hover || active ? 0.95 : 0.5})`, filter: hover || active ? `drop-shadow(0 0 10px rgb(${c} / 0.55))` : "none" }}
        strokeWidth="1.3" animate={{ scale: hover ? 1.06 : 1 }} />
      <text x={x - 62} y={y - 6} style={{ ...S.text, fontSize: 8.5 }}>{label}</text>
      <text x={x - 62} y={y + 10} style={{ fill: `rgb(${c})`, fontSize: 13, fontFamily: "JetBrains Mono" }}>{amount}</text>
      <circle cx={x + 58} cy={y - 2} r="4" style={{ fill: `rgb(${c})` }} />
    </motion.g>
  );
}

/* ---------------- scene overlays ---------------- */
function SceneArt({ scene, beat, revealFraud, setRevealFraud }: { scene: number; beat: number; revealFraud: boolean; setRevealFraud: (v: boolean) => void }) {
  const reduce = useReducedMotion();
  // scattered (chaos) vs aligned (order) particles for scenes 3 -> 4
  const dots = useMemo(() => Array.from({ length: 28 }, (_, i) => ({
    cx: 80 + ((i * 397) % 1040), cy: 60 + ((i * 211) % 170), gx: 300 + (i % 14) * 46, gy: 520 + Math.floor(i / 14) * 18,
  })), []);
  return (
    <>
      {/* Scene 1: card into ATM, background people, floating cards */}
      {scene === 0 && (
        <g>
          {[[150, 0.9], [215, 1.4]].map(([x, d]) => (
            <motion.g key={x} initial={{ opacity: 0 }} animate={{ opacity: 0.45 }} transition={{ delay: d }}>
              <circle cx={x} cy={GROUND - 60} r="7" style={{ fill: "rgb(var(--ink-3))" }} />
              <rect x={x - 7} y={GROUND - 50} width="14" height="26" rx="6" style={{ fill: "rgb(var(--ink-3))" }} />
            </motion.g>
          ))}
          {beat >= 1 && (
            <motion.rect x="290" y={GROUND - 66} width="22" height="14" rx="2" style={{ fill: "rgb(var(--secondary))" }}
              initial={{ x: 0, opacity: 1 }} animate={{ x: 48, y: -38, opacity: [1, 1, 0] }} transition={{ duration: 1.2 }} />
          )}
          {beat >= 2 && <Chip x={TX[0].x} y={TX[0].y} label={TX[0].label} amount={`−€${fmtMoney(TX[0].amt)}`} />}
          {[0, 1, 2].map((i) => (
            <motion.g key={i} initial={{ opacity: 0 }} animate={reduce ? { opacity: 0.5 } : { opacity: [0, 0.6, 0], y: [0, -40] }}
              transition={{ duration: 5, delay: i * 1.4, repeat: Infinity }}>
              <rect x={470 + i * 190} y={170 + (i % 2) * 40} width="46" height="30" rx="4" style={{ fill: "rgb(var(--primary) / 0.12)", stroke: "rgb(var(--primary) / 0.5)" }} />
              <rect x={476 + i * 190} y={178 + (i % 2) * 40} width="10" height="7" rx="1" style={{ fill: "rgb(var(--secondary) / 0.7)" }} />
            </motion.g>
          ))}
        </g>
      )}
      {/* Scene 2: transactions pop up at each stop */}
      {scene === 1 && TX.slice(1).map((t, i) => beat > i && (
        <Chip key={t.key} x={t.x} y={t.y} label={t.label} amount={`−€${fmtMoney(t.amt)}`} tone="mint" delay={1.1} />
      ))}
      {/* Scene 3: the unknown transaction */}
      {scene === 2 && (
        <g>
          {dots.map((d, i) => (
            <motion.g key={i} animate={reduce ? {} : { x: [0, 14, -10, 0], y: [0, -8, 10, 0] }} transition={{ duration: 2.4 + (i % 5) * 0.3, repeat: Infinity }}>
              <circle cx={d.cx} cy={d.cy} r={2.2} style={{ fill: "rgb(var(--coral) / 0.5)" }} />
            </motion.g>
          ))}
          <motion.g initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.5 }} style={{ originX: `${FRAUD.x}px`, originY: `${FRAUD.y}px` }}>
            <circle cx={FRAUD.x} cy={FRAUD.y} r="22" style={{ fill: "rgb(var(--coral) / 0.12)", stroke: "rgb(var(--coral))" }} strokeDasharray="3 3" />
            <text x={FRAUD.x} y={FRAUD.y + 6} textAnchor="middle" style={{ fill: "rgb(var(--coral))", fontSize: 18, fontFamily: "JetBrains Mono" }}>?</text>
            <text x={FRAUD.x} y={FRAUD.y + 40} textAnchor="middle" style={{ ...S.text, fontSize: 8.5 }}>Unknown device · 03:14</text>
          </motion.g>
          <motion.path d={`M${FRAUD.x - 20} ${FRAUD.y + 10} Q 700 40 300 228`} style={{ fill: "none", stroke: "rgb(var(--coral))" }} strokeWidth="1.6" strokeDasharray="6 5"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 1, duration: 1.6 }} />
          {beat >= 2 && (
            <>
              <Chip x={520} y={150} label="Unrecognised merchant" amount={`−€${fmtMoney(FRAUD.amt)}`} tone="coral" onClick={() => setRevealFraud(!revealFraud)} active={revealFraud} />
              <motion.g initial={{ opacity: 0 }} animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.4, repeat: Infinity }}>
                <path d="M175 180 l18 32 h-36 z" style={{ fill: "rgb(var(--coral) / 0.15)", stroke: "rgb(var(--coral))" }} strokeWidth="1.5" />
                <text x="175" y="207" textAnchor="middle" style={{ fill: "rgb(var(--coral))", fontSize: 14, fontWeight: 700 }}>!</text>
              </motion.g>
            </>
          )}
          <motion.text x={STOPS[5] + 20} y={GROUND - 110} style={{ ...S.text, fontSize: 9 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.6 }}>
            customer unaware
          </motion.text>
          <AnimatePresence>
            {revealFraud && (
              <motion.g initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <rect x="440" y="178" width="250" height="46" rx="6" style={{ fill: "rgb(var(--panel))", stroke: "rgb(var(--coral) / 0.6)" }} />
                <text x="452" y="196" style={{ fill: "rgb(var(--coral))", fontSize: 10, fontFamily: "JetBrains Mono" }}>⚠ Never authorised by the customer</text>
                <text x="452" y="213" style={{ ...S.text, fontSize: 9 }}>new device · unusual hour · unusual amount</text>
              </motion.g>
            )}
          </AnimatePresence>
        </g>
      )}
      {/* Scene 4: TRANZIQ engine, data streams, pipeline */}
      {scene === 3 && (
        <g>
          {dots.map((d, i) => (
            <motion.g key={i} initial={{ x: 0, y: 0, opacity: 0.5 }} animate={{ x: d.gx - d.cx, y: d.gy - d.cy, opacity: 0.8 }}
              transition={{ duration: 1.6, delay: 0.4 + i * 0.03, ease: [0.22, 1, 0.36, 1] }}>
              <circle cx={d.cx} cy={d.cy} r={2.2} style={{ fill: i % 9 === 4 ? "rgb(var(--coral))" : "rgb(var(--primary))" }} />
            </motion.g>
          ))}
          {[...TX.map((t) => ({ x: t.x, y: t.y, tone: "primary" })), { x: FRAUD.x, y: FRAUD.y, tone: "coral" }].map((p, i) => {
            const d = `M${p.x} ${p.y} Q ${(p.x + CENTER.x) / 2} ${Math.min(p.y, CENTER.y) - 60} ${CENTER.x} ${CENTER.y}`;
            return (
              <g key={i}>
                <motion.path d={d} style={{ fill: "none", stroke: `rgb(var(--${p.tone}) / 0.45)` }} strokeWidth="1.3" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.3 + i * 0.12, duration: 1 }} />
                {!reduce && (
                  <circle r="3.5" style={{ fill: `rgb(var(--${p.tone}))`, filter: `drop-shadow(0 0 6px rgb(var(--${p.tone})))` }}>
                    <animateMotion dur={`${2 + (i % 3) * 0.5}s`} begin={`${1.2 + i * 0.2}s`} repeatCount="indefinite" path={d} />
                  </circle>
                )}
              </g>
            );
          })}
          <motion.circle cx={CENTER.x} cy={CENTER.y} r="70" style={{ fill: "rgb(var(--primary) / 0.12)", stroke: "rgb(var(--primary) / 0.5)" }}
            initial={{ scale: 0 }} animate={{ scale: [0, 1.05, 1] }} transition={{ duration: 1.1 }} />
          {!reduce && <motion.circle cx={CENTER.x} cy={CENTER.y} r={70} style={{ fill: "none", stroke: "rgb(var(--primary))" }} animate={{ scale: [1, 1.7], opacity: [0.6, 0] }} transition={{ duration: 2.2, repeat: Infinity }} />}
          <g transform={`translate(${CENTER.x - 48} ${CENTER.y - 48}) scale(1.5)`}><BrandMark size={64} animate /></g>
          {beat >= 3 && (
            <motion.g initial={{ opacity: 0, scale: 1.3 }} animate={{ opacity: 1, scale: 1 }} style={{ originX: "600px", originY: "345px" }}>
              <rect x="470" y="324" width="260" height="40" rx="6" style={{ fill: "rgb(var(--panel))", stroke: "rgb(var(--coral))" }} strokeWidth="1.5" />
              <text x="600" y="341" textAnchor="middle" style={{ fill: "rgb(var(--coral))", fontSize: 11, fontFamily: "JetBrains Mono", letterSpacing: "0.12em" }}>INTERCEPTED · CRITICAL RISK</text>
              <text x="600" y="356" textAnchor="middle" style={{ ...S.text, fontSize: 9 }}>€2,450.00 held for analyst review</text>
            </motion.g>
          )}
        </g>
      )}
    </>
  );
}

const PIPE = ["Transaction", "ML analysis", "Risk detection", "Fraud alert", "Analyst review"];

/* ---------------- ledger beside the story ---------------- */
function Ledger({ scene, beat }: { scene: number; beat: number }) {
  const rows: { label: string; amt: number; state: "ok" | "fraud" | "held" }[] = [];
  if (scene > 0 || beat >= 2) rows.push({ label: TX[0].label, amt: TX[0].amt, state: "ok" });
  TX.slice(1).forEach((t, i) => { if (scene > 1 || (scene === 1 && beat > i)) rows.push({ label: t.label, amt: t.amt, state: "ok" }); });
  if (scene === 2 && beat >= 2) rows.push({ label: "Unrecognised merchant", amt: FRAUD.amt, state: "fraud" });
  if (scene === 3) rows.push({ label: "Unrecognised merchant", amt: FRAUD.amt, state: beat >= 3 ? "held" : "fraud" });
  const start = 4820;
  const spent = rows.filter((r) => r.state !== "held").reduce((s, r) => s + r.amt, 0);
  const lost = rows.some((r) => r.state === "fraud");
  return (
    <div className="panel w-[270px] p-4">
      <div className="kicker mb-1">Customer account</div>
      <motion.div key={lost ? "l" : "n"} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }}
        className={`font-display text-[34px] leading-none ${lost ? "text-coral" : "text-ink"}`}>€{fmtMoney(start - spent)}</motion.div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-3">{lost ? "unexpected deduction" : scene === 3 && beat >= 3 ? "balance protected" : "available balance"}</div>
      <div className="mt-4 space-y-1.5">
        <AnimatePresence initial={false}>
          {rows.map((r) => (
            <motion.div key={r.label + r.state} layout initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
              className={`flex items-center justify-between rounded-sm border px-2.5 py-1.5 text-[11.5px] ${r.state === "fraud" ? "border-coral/50 bg-coral/10" : r.state === "held" ? "border-primary/50 bg-primary/10" : "border-line/[0.12]"}`}>
              <span className="truncate text-ink-2">{r.label}</span>
              <span className={`num ${r.state === "fraud" ? "text-coral" : r.state === "held" ? "text-primary" : "text-ink"}`}>
                {r.state === "held" ? "held" : `−${fmtMoney(r.amt)}`}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* =====================================================================
   Scene 5 - welcome + interactive intelligence orbit
   ===================================================================== */
interface OrbitNode { id: string; amount: number; probability: number; suspicious: boolean; r: number; a: number; real: boolean }

function useOrbitNodes(): { nodes: OrbitNode[]; live: boolean } {
  const [state, setState] = useState<{ nodes: OrbitNode[]; live: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([
      get<Paged<Tx>>("/api/transactions?sort_by=probability&sort_dir=desc&page_size=3"),
      get<Paged<Tx>>("/api/transactions?max_prob=0.05&sort_by=id&sort_dir=desc&page_size=9"),
    ]).then(([hot, calm]) => {
      if (!alive) return;
      const pick = [...hot.items.map((t) => ({ t, s: true })), ...calm.items.map((t) => ({ t, s: false }))];
      if (pick.length < 6) throw new Error("not enough");
      setState({ live: true, nodes: pick.map(({ t, s }, i) => ({
        id: t.external_id, amount: t.amount, probability: t.prediction?.probability ?? 0, suspicious: s, real: true,
        r: [120, 175, 228][i % 3], a: (i * 137.5) % 360,
      })) });
    }).catch(() => {
      if (!alive) return;
      // Offline fallback: clearly labelled illustrative nodes
      const demo = [[2450, 0.97, 1], [18.4, 0.002, 0], [129, 0.004, 0], [890, 0.91, 1], [54.99, 0.001, 0], [60, 0.006, 0], [1.0, 0.88, 1], [36.2, 0.003, 0], [212, 0.01, 0]];
      setState({ live: false, nodes: demo.map(([amt, p, s], i) => ({ id: `DEMO-${i + 1}`, amount: amt, probability: p, suspicious: !!s, real: false, r: [120, 175, 228][i % 3], a: (i * 137.5) % 360 })) });
    });
    return () => { alive = false; };
  }, []);
  return state ?? { nodes: [], live: false };
}

function Orbit({ onFound }: { onFound: (n: number, total: number) => void }) {
  const reduce = useReducedMotion();
  const { nodes, live } = useOrbitNodes();
  const [focus, setFocus] = useState<OrbitNode | null>(null);
  const [found, setFound] = useState<Set<string>>(new Set());
  const [alertPulse, setAlertPulse] = useState(0);
  const total = nodes.filter((n) => n.suspicious).length;
  useEffect(() => onFound(found.size, total), [found, total, onFound]);
  const pos = (n: OrbitNode) => ({ x: 260 + n.r * Math.cos((n.a * Math.PI) / 180), y: 260 + n.r * Math.sin((n.a * Math.PI) / 180) });
  const inspect = (n: OrbitNode) => {
    setFocus(n);
    if (n.suspicious && !found.has(n.id)) { setFound(new Set([...found, n.id])); setAlertPulse((p) => p + 1); }
  };
  return (
    <div className="relative mx-auto w-full max-w-[520px]">
      <svg viewBox="0 0 520 520" className="w-full" role="group" aria-label="Interactive transaction orbit">
        <defs>
          <radialGradient id="engineGlow"><stop offset="0" style={{ stopColor: "rgb(var(--primary))", stopOpacity: 0.35 }} /><stop offset="1" style={{ stopColor: "rgb(var(--primary))", stopOpacity: 0 }} /></radialGradient>
        </defs>
        <circle cx="260" cy="260" r="250" fill="url(#engineGlow)" />
        {[120, 175, 228].map((r) => <circle key={r} cx="260" cy="260" r={r} style={{ fill: "none", stroke: "rgb(var(--line) / 0.16)" }} strokeDasharray="2 6" />)}
        <g className={reduce ? "" : "orbit-spin"} style={{ transformOrigin: "260px 260px" }}>
          {nodes.map((n) => {
            const p = pos(n);
            const isFound = found.has(n.id);
            const isFocus = focus?.id === n.id;
            const c = isFound ? "var(--coral)" : n.suspicious ? "var(--secondary)" : "var(--primary)";
            return (
              <g key={n.id}>
                <line x1="260" y1="260" x2={p.x} y2={p.y} style={{ stroke: `rgb(${c} / ${isFocus ? 0.7 : 0.16})` }} strokeWidth={isFocus ? 1.4 : 1} />
                <g tabIndex={0} role="button" aria-label={`Transaction ${n.id}, amount ${fmtMoney(n.amount)}`}
                  onMouseEnter={() => setFocus(n)} onFocus={() => setFocus(n)} onClick={() => inspect(n)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inspect(n)} style={{ cursor: "pointer", outline: "none" }}>
                  <circle cx={p.x} cy={p.y} r="18" fill="transparent" />
                  <circle cx={p.x} cy={p.y} r={isFocus ? 10 : 7}
                    style={{ fill: `rgb(${c})`, filter: isFocus || isFound ? `drop-shadow(0 0 8px rgb(${c}))` : "none" }} />
                  {isFound && !reduce && <motion.circle cx={p.x} cy={p.y} r={10} style={{ fill: "none", stroke: "rgb(var(--coral))" }} animate={{ scale: [1, 2.4], opacity: [0.8, 0] }} transition={{ duration: 1.5, repeat: Infinity }} />}
                </g>
              </g>
            );
          })}
        </g>
        <motion.circle key={alertPulse} cx="260" cy="260" r="62" style={{ fill: "none", stroke: alertPulse ? "rgb(var(--coral))" : "rgb(var(--primary))" }}
          initial={{ scale: 1, opacity: 0.8 }} animate={{ scale: alertPulse ? 1.8 : 1, opacity: alertPulse ? 0 : 0.5 }} transition={{ duration: 1.2 }} />
        <circle cx="260" cy="260" r="58" style={{ fill: "rgb(var(--panel))", stroke: "rgb(var(--primary) / 0.5)" }} />
        <g transform="translate(212 212) scale(1.5)"><BrandMark size={64} /></g>
      </svg>
      <div className="mt-2 min-h-[64px]" aria-live="polite">
        {focus ? (
          <motion.div key={focus.id + found.has(focus.id)} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            className={`panel flex items-center gap-3 px-4 py-3 ${found.has(focus.id) ? "border-coral/50" : ""}`}>
            {found.has(focus.id) ? <ShieldAlert size={18} className="text-coral" /> : <ShieldCheck size={18} className={focus.suspicious ? "text-secondary" : "text-mint"} />}
            <div className="min-w-0 flex-1 text-[12.5px]">
              <div className="num truncate">{focus.id} · €{fmtMoney(focus.amount)}</div>
              <div className="text-ink-3">
                {found.has(focus.id) ? <span className="text-coral">Flagged · {fmtProb(focus.probability)} fraud probability · held for analyst review</span>
                  : focus.suspicious ? "Unusual signal. Click to inspect it." : `Normal pattern · ${fmtProb(focus.probability)} fraud probability`}
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center font-mono text-[11px] text-ink-3">
            Hover the signals · click the warm-coloured ones to inspect
          </motion.p>
        )}
        <p className="mt-2 text-center font-mono text-[10px] uppercase tracking-wider text-ink-3">
          {live ? "Signals from your TRANZIQ database · scored by the active model" : "Illustrative signals (API offline)"}
        </p>
      </div>
    </div>
  );
}

/* =====================================================================
   Page
   ===================================================================== */
export default function Welcome({ onEnter }: { onEnter: () => void }) {
  const reduce = useReducedMotion();
  const [scene, setScene] = useState(reduce ? WELCOME : 0);
  const [beat, setBeat] = useState(0);
  const [playing, setPlaying] = useState(!reduce);
  const [revealFraud, setRevealFraud] = useState(false);
  const [found, setFound] = useState<[number, number]>([0, 0]);
  const [leaving, setLeaving] = useState(false);
  const [stats, setStats] = useState<{ pr: number; model: string; rows: number } | null>(null);
  const started = useRef(Date.now());

  useEffect(() => {
    Promise.all([get<{ ranking: { label: string; test: { pr_auc: number } }[] }>("/api/models/comparison"), get<{ statistics: { rows: number } | null }>("/api/dataset/info")])
      .then(([c, d]) => setStats({ pr: c.ranking[0].test.pr_auc, model: c.ranking[0].label, rows: d.statistics?.rows ?? 0 }))
      .catch(() => null);
  }, []);

  // Beats inside a scene (staggered events) + auto-advance
  useEffect(() => {
    if (scene >= WELCOME) return;
    setBeat(0); setRevealFraud(false); started.current = Date.now();
    const beats = [1, 2, 3, 4].map((b) => setTimeout(() => setBeat(b), 300 + b * 1300));
    return () => beats.forEach(clearTimeout);
  }, [scene]);
  useEffect(() => {
    if (!playing || scene >= WELCOME) return;
    const t = setTimeout(() => setScene((s) => s + 1), SCENES[scene].ms);
    return () => clearTimeout(t);
  }, [playing, scene]);

  const go = useCallback((s: number) => setScene(Math.max(0, Math.min(WELCOME, s))), []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(scene + 1);
      if (e.key === "ArrowLeft") go(scene - 1);
      if (e.key === "Escape") go(WELCOME);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [scene, go]);

  const enter = () => { setLeaving(true); setTimeout(onEnter, reduce ? 50 : 1250); };
  const onFound = useCallback((n: number, t: number) => setFound([n, t]), []);

  // Person position per scene/beat
  const personX = scene === 0 ? STOPS[1] : scene === 1 ? STOPS[2 + Math.min(3, Math.max(0, beat - 1))] : STOPS[5];

  return (
    <motion.div className="fixed inset-0 z-[90] overflow-y-auto overflow-x-hidden bg-bg" exit={{ opacity: 0 }} transition={{ duration: 0.4 }}>
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="ambient-orb -left-32 -top-32 h-[480px] w-[480px] bg-primary/[0.14]" />
        <div className="ambient-orb -right-32 bottom-0 h-[420px] w-[420px] bg-secondary/[0.10]" style={{ animationDelay: "-11s" }} />
      </div>

      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between px-5 py-4 sm:px-10">
        <div className="flex items-center gap-2.5"><BrandMark size={28} /><Wordmark className="text-[14px]" /></div>
        <div className="flex items-center gap-2">
          <ThemeSwitch />
          {scene < WELCOME && <button className="btn-ghost px-3 py-1.5 text-[12px]" onClick={() => go(WELCOME)}>Skip story <SkipForward size={13} /></button>}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {scene < WELCOME ? (
          <motion.section key="story" className="relative z-10 mx-auto max-w-[1400px] px-4 pb-8 sm:px-10"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.5 }}>
            <div className="grid items-start gap-6 xl:grid-cols-[1fr_270px]">
              <svg viewBox="0 0 1200 600" className="w-full" role="img" aria-label={`Scene ${SCENES[scene].n}: ${SCENES[scene].title}`}>
                <Street dim={scene === 3 ? 0.28 : scene === 2 ? 0.5 : 1} />
                <Person x={personX} phoneAlert={scene === 2 && beat >= 2} />
                <AnimatePresence>
                  <SceneArt key={scene} scene={scene} beat={beat} revealFraud={revealFraud} setRevealFraud={setRevealFraud} />
                </AnimatePresence>
                {scene === 3 && (
                  <g>
                    {PIPE.map((p, i) => (
                      <motion.g key={p} initial={{ opacity: 0.25 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 + i * 0.45 }}>
                        <rect x={128 + i * 196} y="560" width="160" height="30" rx="15"
                          style={{ fill: i === 3 ? "rgb(var(--coral) / 0.14)" : "rgb(var(--primary) / 0.14)", stroke: i === 3 ? "rgb(var(--coral))" : "rgb(var(--primary))" }} />
                        <text x={208 + i * 196} y="579" textAnchor="middle" style={{ fill: "rgb(var(--ink))", fontSize: 11, fontFamily: "JetBrains Mono" }}>{p}</text>
                        {i < 4 && <text x={300 + i * 196} y="580" textAnchor="middle" style={{ fill: "rgb(var(--ink-3))", fontSize: 13 }}>→</text>}
                      </motion.g>
                    ))}
                  </g>
                )}
              </svg>
              <div className="hidden xl:block">
                <AnimatePresence>{scene >= 1 && <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}><Ledger scene={scene} beat={beat} /></motion.div>}</AnimatePresence>
              </div>
            </div>

            {/* Caption + controls */}
            <div className="mt-4 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
                <motion.div key={scene} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl">
                  <div className="kicker mb-2 flex items-center gap-3"><span className="text-primary">{SCENES[scene].n}</span><span className="h-px w-8 bg-line/30" />The journey of a transaction</div>
                  <h2 className="font-display text-[40px] leading-none sm:text-[54px]">{SCENES[scene].title}</h2>
                  <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{SCENES[scene].line}</p>
                  {scene === 2 && <p className="mt-2 font-mono text-[11px] text-ink-3">Tip: click the coral transaction.</p>}
                </motion.div>
              <div className="flex shrink-0 flex-col items-start gap-3 md:items-end">
                <div className="flex gap-1.5" role="tablist" aria-label="Story scenes">
                  {[...SCENES, { n: "05", title: "Welcome", ms: 0, line: "" }].map((s, i) => (
                    <button key={s.n} role="tab" aria-selected={i === scene} aria-label={`Scene ${s.n}: ${s.title}`} onClick={() => go(i)}
                      className="relative h-1.5 w-12 overflow-hidden rounded-full bg-line/20">
                      {i < scene && <span className="absolute inset-0 bg-primary" />}
                      {i === scene && (
                        <motion.span key={`${scene}-${playing}`} className="absolute inset-y-0 left-0 bg-primary"
                          initial={{ width: playing ? "0%" : "100%" }} animate={{ width: "100%" }}
                          transition={{ duration: playing ? SCENES[scene].ms / 1000 : 0, ease: "linear" }} />
                      )}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <button className="btn-ghost px-2.5 py-1.5" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause story" : "Play story"}>
                    {playing ? <Pause size={14} /> : <Play size={14} />}
                  </button>
                  <button className="btn-ghost px-3 py-1.5 text-[12px]" onClick={() => go(scene + 1)}>Next <ArrowRight size={13} /></button>
                  <button className="btn-primary px-4 py-1.5 text-[12px]" onClick={enter}>Enter TRANZIQ <ArrowRight size={13} /></button>
                </div>
              </div>
            </div>
          </motion.section>
        ) : (
          <motion.section key="welcome" className="relative z-10 mx-auto grid max-w-[1400px] items-center gap-10 px-5 pb-12 pt-4 sm:px-10 lg:min-h-[calc(100vh-80px)] lg:grid-cols-[1.05fr_1fr]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }}>
            <div>
              <motion.div className="kicker mb-5 flex items-center gap-3" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 }}>
                <span className="text-primary">05</span><span className="h-px w-8 bg-line/30" />AI-powered fraud detection & transaction risk intelligence
              </motion.div>
              <motion.h1 className="font-display text-[56px] leading-[0.92] tracking-tight sm:text-[84px] xl:text-[104px]"
                initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}>
                Welcome to<br /><em className="grad-text pr-2">TRANZIQ</em>
              </motion.h1>
              <motion.p className="mt-7 max-w-xl text-[19px] leading-relaxed text-ink" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}>
                Every transaction tells a story. Make sure fraud isn't writing yours.
              </motion.p>
              <motion.p className="mt-3 font-display text-[24px] italic text-ink-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}>
                Intelligence Behind Every Transaction.
              </motion.p>
              <motion.div className="mt-9 flex flex-wrap items-center gap-4" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 }}>
                <motion.button onClick={enter} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  className="btn-primary group px-7 py-4 text-[14px] tracking-[0.2em]">
                  ENTER TRANZIQ <ArrowRight size={17} className="transition-transform group-hover:translate-x-1" />
                </motion.button>
                <button className="btn-ghost px-3 py-2.5 text-[12px]" onClick={() => { setPlaying(true); go(0); }}><RotateCcw size={13} />Replay story</button>
              </motion.div>
              {stats && (
                <motion.dl className="mt-12 grid max-w-xl grid-cols-3 gap-5 border-t border-line/[0.14] pt-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }}>
                  <div><dt className="label">Transactions analysed</dt><dd className="mt-1 font-display text-[30px]">{stats.rows.toLocaleString()}</dd></div>
                  <div><dt className="label">Best model</dt><dd className="mt-1 font-display text-[30px]">{stats.model}</dd></div>
                  <div><dt className="label">Test PR-AUC</dt><dd className="mt-1 font-display text-[30px]">{stats.pr.toFixed(3)}</dd></div>
                </motion.dl>
              )}
            </div>
            <motion.div initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.4, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}>
              <div className="mb-3 flex items-center justify-between">
                <span className="kicker">Intelligence orbit</span>
                {found[1] > 0 && (
                  <span className={`chip ${found[0] === found[1] ? "border-mint/50 text-mint" : "border-secondary/40 text-secondary"}`}>
                    {found[0] === found[1] ? "✓ All unusual signals found" : `Unusual signals found ${found[0]}/${found[1]}`}
                  </span>
                )}
              </div>
              <Orbit onFound={onFound} />
            </motion.div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Exit: logo moment before the dashboard */}
      <AnimatePresence>
        {leaving && (
          <motion.div className="fixed inset-0 z-[95] flex flex-col items-center justify-center bg-bg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}>
            <motion.div initial={{ scale: 0.6, rotate: -20 }} animate={{ scale: [0.6, 1.15, 1], rotate: 0 }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}>
              <BrandMark size={110} animate />
            </motion.div>
            <motion.div className="mt-6" initial={{ opacity: 0, letterSpacing: "0.6em" }} animate={{ opacity: 1, letterSpacing: "0.32em" }} transition={{ delay: 0.3, duration: 0.7 }}>
              <Wordmark className="text-[28px]" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
