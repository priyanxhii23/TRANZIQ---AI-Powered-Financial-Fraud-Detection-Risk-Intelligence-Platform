import { motion } from "framer-motion";
import { Banknote, Beaker, Check, Layers, Loader2, Play, ShieldCheck, Skull, Timer, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import { del, get, post } from "../lib/api";
import { useApp, useChartColors } from "../lib/app-context";
import { RISK_META, fmtMoney, fmtProb } from "../lib/format";
import { useApi } from "../lib/hooks";
import { MODEL_LABELS, MODELS, RISK_LEVELS, type ModelName, type Paged, type RiskLevel, type Tx } from "../lib/types";
import { ChartTip, Confirm, EmptyState, Field, InfoTip, Insight, PageHeader, Panel, PanelHead, Select, Toggle } from "../components/ui";

type ScenarioId = "unusual_spending" | "rapid_activity" | "fraud_patterns" | "legit_patterns" | "custom";
interface Catalog { scenarios: { id: ScenarioId; title: string; summary: string; method: string }[]; note: string }
interface Item { i: number; amount: number; time: number; probability: number; predicted_label: number; risk_level: RiskLevel }
interface Run {
  key: number; scenario: ScenarioId; title: string; method: string; model: ModelName; model_label: string; threshold: number;
  bands: { medium: number; high: number; critical: number }; reference_probability: number; reference_label: string;
  base: { id: number; external_id: string; ground_truth: number | null } | null;
  summary: { count: number; mean_probability: number; max_probability: number; predicted_fraud: number; risk_levels: Record<RiskLevel, number> };
  items: Item[]; persisted: number; params: Record<string, unknown>;
}

const ICON: Record<ScenarioId, typeof Beaker> = { unusual_spending: Banknote, rapid_activity: Timer, fraud_patterns: Skull, legit_patterns: ShieldCheck, custom: Layers };
const NEEDS_BASE: ScenarioId[] = ["unusual_spending", "rapid_activity", "custom"];
const classify = (p: number, b: Run["bands"]): RiskLevel => (p >= b.critical ? "critical" : p >= b.high ? "high" : p >= b.medium ? "medium" : "low");
const BINS = Array.from({ length: 10 }, (_, i) => i / 10);

function stats(run: Run, thr: number) {
  const flagged = run.items.filter((i) => i.probability >= thr).length;
  const lv = Object.fromEntries(RISK_LEVELS.map((l) => [l, 0])) as Record<RiskLevel, number>;
  run.items.forEach((i) => { lv[classify(i.probability, run.bands)] += 1; });
  return { flagged, levels: lv };
}

let RUN_KEY = 1;

export default function ScenarioLab() {
  const c = useChartColors();
  const { settings, notify, bumpData } = useApp();
  const catalog = useApi(() => get<Catalog>("/api/scenarios/catalog"), []);
  const bases = useApi(() => Promise.all([
    get<Paged<Tx>>("/api/transactions?source=kaggle&ground_truth=0&page_size=8&sort_by=amount&sort_dir=asc"),
    get<Paged<Tx>>("/api/transactions?source=kaggle&ground_truth=1&page_size=8&sort_by=amount&sort_dir=asc"),
  ]).then(([a, b]) => [...a.items, ...b.items]), []);

  const [scenario, setScenario] = useState<ScenarioId>("fraud_patterns");
  const [count, setCount] = useState(60);
  const [intensity, setIntensity] = useState(0.4);
  const [amount, setAmount] = useState("");
  const [interval, setIntervalS] = useState(20);
  const [profile, setProfile] = useState<"legit" | "fraud">("legit");
  const [baseId, setBaseId] = useState("");
  const [model, setModel] = useState<ModelName | "">("");
  const [seed, setSeed] = useState("");
  const [persist, setPersist] = useState(false);
  const [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [compare, setCompare] = useState<number[]>([]);
  const [thr, setThr] = useState<number | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const synthStats = useApi(() => get<{ synthetic_transactions: number }>("/api/synthetic/stats"), [runs.length]);

  const run = runs.find((r) => r.key === current) ?? null;
  useEffect(() => { if (run) setThr(run.threshold); }, [run?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = thr ?? run?.threshold ?? 0.5;

  const execute = async (override?: Partial<{ scenario: ScenarioId; count: number; intensity: number }>) => {
    setBusy(true);
    const sc = override?.scenario ?? scenario;
    try {
      const r = await post<Omit<Run, "key">>("/api/scenarios/run", {
        scenario: sc, count: override?.count ?? count, intensity: override?.intensity ?? intensity,
        amount: amount ? Number(amount) : null, interval_seconds: interval, base_profile: profile,
        base_transaction_id: baseId && NEEDS_BASE.includes(sc) ? Number(baseId) : null,
        model: model || null, seed: seed ? Number(seed) : null, persist,
      });
      const key = RUN_KEY++;
      setRuns((rs) => [{ ...r, key } as Run, ...rs].slice(0, 8));
      setCurrent(key);
      setCompare((cs) => [key, ...cs].slice(0, 3));
      if (persist) bumpData();
    } catch (e) { notify({ tone: "danger", title: "Scenario failed", body: String(e) }); }
    finally { setBusy(false); }
  };

  const quickCompare = async () => {
    // Run legitimate vs fraud-like patterns with identical settings for a fair comparison
    await execute({ scenario: "legit_patterns" });
    await execute({ scenario: "fraud_patterns" });
  };

  const reset = async () => {
    setConfirmReset(false);
    try { const r = await del<{ deleted_transactions: number }>("/api/synthetic"); notify({ tone: "success", title: "Simulated records removed", body: `${r.deleted_transactions} records deleted. Historical data untouched.` }); bumpData(); synthStats.reload(); }
    catch (e) { notify({ tone: "danger", title: "Reset failed", body: String(e) }); }
  };

  const cmpRuns = runs.filter((r) => compare.includes(r.key));
  const palette = [c.primary, c.secondary, c.tertiary];
  const histData = useMemo(() => BINS.map((lo) => {
    const row: Record<string, number | string> = { bin: lo.toFixed(1) };
    cmpRuns.forEach((r) => { row[`#${r.key} ${r.title}`] = r.items.filter((i) => i.probability >= lo && (lo === 0.9 ? i.probability <= 1 : i.probability < lo + 0.1)).length; });
    return row;
  }), [cmpRuns]);
  const riskData = cmpRuns.map((r) => ({ name: `#${r.key} ${r.title}`, ...stats(r, r.threshold).levels }));

  const xKey = run?.scenario === "unusual_spending" ? "amount" : run?.scenario === "rapid_activity" ? "time" : "i";
  const st = run ? stats(run, t) : null;
  const meanDelta = run ? run.summary.mean_probability - run.reference_probability : 0;

  return (
    <div>
      <PageHeader index="07" kicker="Fraud Scenario Lab" title="Stress-test the" accent="models.">
        <span className="font-mono text-[11px] text-ink-3">{synthStats.data?.synthetic_transactions.toLocaleString() ?? "—"} simulated records stored</span>
        <button className="btn-danger px-3 py-1.5 text-[12px]" onClick={() => setConfirmReset(true)} disabled={!synthStats.data?.synthetic_transactions}><Trash2 size={13} />Reset simulated data</button>
      </PageHeader>

      {/* scenario picker */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {(catalog.data?.scenarios ?? []).map((s, i) => {
          const Icon = ICON[s.id];
          const on = s.id === scenario;
          return (
            <motion.button key={s.id} type="button" onClick={() => setScenario(s.id)} aria-pressed={on}
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} whileHover={{ y: -3 }}
              className={`panel p-4 text-left transition-colors ${on ? "border-primary/60" : "hover:border-line/30"}`}>
              {on && <motion.span layoutId="scenario-on" className="absolute inset-0 rounded-md bg-gradient-to-br from-primary/15 to-transparent" />}
              <span className="relative flex items-center justify-between">
                <span className={`flex h-9 w-9 items-center justify-center rounded-full ${on ? "bg-primary text-[rgb(var(--on-primary))]" : "bg-primary/10 text-primary"}`}><Icon size={16} /></span>
                <span className="font-mono text-[10px] text-ink-3">0{i + 1}</span>
              </span>
              <span className="relative mt-3 block text-[14px] font-semibold">{s.title}</span>
              <span className="relative mt-1 block text-[12px] leading-snug text-ink-3">{s.summary}</span>
            </motion.button>
          );
        })}
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-12">
        {/* configuration */}
        <Panel className="xl:col-span-4">
          <PanelHead kicker="Configuration" title={catalog.data?.scenarios.find((s) => s.id === scenario)?.title ?? "Scenario"} />
          <div className="space-y-5 p-5">
            <Field label="Number of transactions" hint={<span className="num">{count}</span>}>
              <input type="range" className="range" min={5} max={200} step={5} value={count} onChange={(e) => setCount(Number(e.target.value))} />
            </Field>
            <Field label="Perturbation intensity" hint={<span className="flex items-center gap-2"><span className="num">{intensity.toFixed(2)}</span><InfoTip text="How far generated feature vectors move away from the real training records they start from." /></span>}>
              <input type="range" className="range" min={0} max={1} step={0.05} value={intensity} onChange={(e) => setIntensity(Number(e.target.value))} />
            </Field>
            {(scenario === "unusual_spending" || scenario === "custom") && (
              <Field label={scenario === "custom" ? "Transaction amount (optional)" : "Starting amount (optional)"} hint={<InfoTip text={scenario === "custom" ? "Fix every generated amount to this value (±3%). Leave empty to keep the seeds' amounts." : "Amounts are multiplied from this value. Leave empty to start from the base record's own amount."} />}>
                <input className="input num" inputMode="decimal" placeholder="e.g. 250.50" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
            )}
            {(scenario === "rapid_activity" || scenario === "custom") && (
              <Field label="Time interval between transactions" hint={<span className="num">{interval}s</span>}>
                <input type="range" className="range" min={1} max={600} step={1} value={interval} onChange={(e) => setIntervalS(Number(e.target.value))} />
              </Field>
            )}
            {scenario === "custom" && (
              <Field label="Base profile">
                <Select value={profile} onChange={setProfile} options={[{ value: "legit", label: "Legitimate-labelled training records" }, { value: "fraud", label: "Fraud-labelled training records" }]} />
              </Field>
            )}
            {NEEDS_BASE.includes(scenario) && (
              <Field label="Start from historical sample" hint={<InfoTip text="Optional. A held-out labelled record to perturb. Leave as random to draw a training record from the selected profile." />}>
                <Select value={baseId} onChange={setBaseId} options={[{ value: "", label: "Random training record" },
                  ...(bases.data ?? []).map((b) => ({ value: String(b.id), label: `${b.external_id} · ${fmtMoney(b.amount)} · ${b.ground_truth ? "fraud" : "legit"}-labelled` }))]} />
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Model">
                <Select value={model} onChange={setModel} options={[{ value: "", label: `Active${settings ? ` (${MODEL_LABELS[settings.active_model].replace("Logistic Regression", "LogReg")})` : ""}` }, ...MODELS.map((m) => ({ value: m, label: MODEL_LABELS[m] }))]} />
              </Field>
              <Field label="Random seed"><input className="input num" placeholder="random" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))} /></Field>
            </div>
            <Toggle checked={persist} onChange={setPersist} label="Save to the transaction database" />
            <p className="font-mono text-[10.5px] leading-relaxed text-ink-3">{catalog.data?.scenarios.find((s) => s.id === scenario)?.method}</p>
            <div className="flex flex-col gap-2">
              <motion.button whileTap={{ scale: 0.97 }} className="btn-primary py-2.5" onClick={() => execute()} disabled={busy}>
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}Run scenario
              </motion.button>
              <button className="btn-ghost text-[12px]" onClick={quickCompare} disabled={busy}>Compare legitimate vs fraud-like patterns</button>
            </div>
          </div>
        </Panel>

        {/* result */}
        <Panel className="xl:col-span-8" delay={0.06}>
          <PanelHead kicker="Model response" title={run ? `#${run.key} ${run.title} · ${run.model_label}` : "Run a scenario"} />
          {!run || !st ? <EmptyState title="No scenario run yet" body="Pick a scenario, configure it and press Run. Every transaction is scored by a real trained model." /> : (
              <motion.div key={run.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <div className="grid grid-cols-2 gap-4 border-b border-line/[0.08] p-5 sm:grid-cols-5">
                  {[
                    ["Transactions", run.summary.count.toLocaleString(), undefined],
                    ["Avg probability", fmtProb(run.summary.mean_probability), undefined],
                    ["Highest", fmtProb(run.summary.max_probability), "rgb(var(--coral))"],
                    ["Predicted fraud", `${st.flagged}`, st.flagged ? "rgb(var(--coral))" : undefined],
                    ["Low-risk", `${st.levels.low}`, "rgb(var(--mint))"],
                  ].map(([k, v, tone]) => (
                    <div key={k}><div className="label">{k}</div><motion.div key={String(v)} initial={{ opacity: 0.4, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-1 font-display text-[32px] leading-none" style={tone ? { color: tone } : undefined}>{v}</motion.div></div>
                  ))}
                </div>
                <div className="grid gap-5 p-5 lg:grid-cols-[1fr_260px]">
                  <div className="h-[260px]">
                    <ResponsiveContainer>
                      <ScatterChart margin={{ left: -10, right: 10 }}>
                        <CartesianGrid />
                        <XAxis type="number" dataKey={xKey} name={xKey} tickLine={false} axisLine={false} scale={xKey === "amount" ? "log" : "auto"} domain={["auto", "auto"]}
                          label={{ value: xKey === "amount" ? "amount (log)" : xKey === "time" ? "time (s)" : "transaction #", position: "insideBottomRight", offset: -4 }} />
                        <YAxis type="number" dataKey="probability" domain={[0, 1]} tickLine={false} axisLine={false} />
                        <ZAxis range={[28, 28]} />
                        <ReferenceLine y={t} stroke={c.ink2} strokeDasharray="4 4" label={{ value: `threshold ${t.toFixed(2)}`, position: "insideTopRight", fill: c.ink3, fontSize: 10 }} />
                        <Tooltip content={({ active, payload }) => active && payload?.length ? (
                          <div className="rounded border border-line/20 bg-bg-2/95 px-3 py-2 font-mono text-[11.5px]">
                            <div>#{String(payload[0].payload.i)} · amount {fmtMoney(Number(payload[0].payload.amount))}</div>
                            <div className="text-ink-2">probability {fmtProb(Number(payload[0].payload.probability))}</div>
                          </div>) : null} />
                        <Scatter data={run.items.filter((i) => i.probability < t)} fill={c.secondary} name="below threshold" />
                        <Scatter data={run.items.filter((i) => i.probability >= t)} fill={c.coral} name="predicted fraud" />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <div className="label mb-1 flex items-center justify-between">Threshold experiment <span className="num normal-case text-ink">{t.toFixed(2)}</span></div>
                      <input type="range" className="range" min={0.01} max={0.99} step={0.01} value={t} onChange={(e) => setThr(Number(e.target.value))} aria-label="Experiment threshold" />
                      <button className="mt-1 font-mono text-[10.5px] text-primary" onClick={() => setThr(run.threshold)}>reset to model default {run.threshold.toFixed(2)}</button>
                    </div>
                    <div>
                      <div className="label mb-2">Risk distribution</div>
                      <div className="flex h-3 overflow-hidden rounded-full bg-line/10">
                        {RISK_LEVELS.map((l) => <motion.span key={l} layout style={{ width: `${(st.levels[l] / run.summary.count) * 100}%`, background: RISK_META[l].color }} title={`${RISK_META[l].label}: ${st.levels[l]}`} />)}
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-[11px]">{RISK_LEVELS.map((l) => <span key={l} style={{ color: RISK_META[l].color }}>{RISK_META[l].label} {st.levels[l]}</span>)}</div>
                    </div>
                    <div className="rounded border border-line/[0.1] bg-bg/40 p-3 text-[12px]">
                      <div className="label">{run.reference_label}</div>
                      <div className="num mt-1">{fmtProb(run.reference_probability)} → <span className={meanDelta > 0.01 ? "text-coral" : "text-ink"}>{fmtProb(run.summary.mean_probability)}</span> avg</div>
                      {run.base && <div className="mt-1 text-ink-3">base {run.base.external_id}{run.base.ground_truth != null && ` · ${run.base.ground_truth ? "fraud" : "legit"}-labelled`}</div>}
                    </div>
                  </div>
                </div>
                <Insight title="What this scenario shows" defaultOpen>
                  <p>{run.summary.count} simulated transactions were scored by <b>{run.model_label}</b>. At threshold {t.toFixed(2)}, <b>{st.flagged}</b> ({((st.flagged / run.summary.count) * 100).toFixed(0)}%)
                    are predicted fraud, and the average probability moved from {fmtProb(run.reference_probability)} ({run.reference_label.toLowerCase()}) to {fmtProb(run.summary.mean_probability)}.</p>
                  <p>{Math.abs(meanDelta) < 0.02
                    ? <>The model barely reacted. These models learned mostly from the anonymised V-component patterns, so changing {run.scenario === "unusual_spending" ? "only the amount" : run.scenario === "rapid_activity" ? "only the timing" : "the inputs this way"} does not
                      look like fraud to them. That is a real limitation worth knowing: amount or velocity rules would need separate features.</>
                    : meanDelta > 0
                      ? <>The perturbation pushed scores <b>up</b> by {fmtProb(meanDelta)} on average. The generated vectors moved towards regions the model associates with fraud.</>
                      : <>The perturbation pulled scores <b>down</b> by {fmtProb(-meanDelta)} on average. Noise blurred the fraud pattern of the seed records, a sign of how sensitive the model is to small feature changes.</>}</p>
                  <p className="text-ink-3">Simulated transactions have no ground-truth label. A high score means the model finds the pattern suspicious, not that fraud occurred.{run.persisted ? ` ${run.persisted} records were saved as simulated data.` : ""}</p>
                </Insight>
              </motion.div>
          )}
        </Panel>
      </div>

      {/* history + comparison */}
      {runs.length > 0 && (
        <Panel className="mt-5" delay={0.1}>
          <PanelHead kicker="Compare scenarios" title="Select up to three runs" />
          <div className="flex flex-wrap gap-2 border-b border-line/[0.08] p-4">
            {runs.map((r) => {
              const on = compare.includes(r.key);
              return (
                <button key={r.key} onClick={() => { setCompare((cs) => on ? cs.filter((k) => k !== r.key) : [r.key, ...cs].slice(0, 3)); setCurrent(r.key); }}
                  className={`flex items-center gap-2 rounded border px-3 py-1.5 text-[12px] transition-colors ${on ? "border-primary/50 bg-primary/10 text-ink" : "border-line/[0.14] text-ink-3 hover:text-ink-2"}`}>
                  {on ? <Check size={12} /> : <span className="h-3 w-3" />}#{r.key} {r.title}<span className="num text-ink-3">{fmtProb(r.summary.mean_probability)}</span>
                  <X size={11} className="ml-1 opacity-50 hover:opacity-100" onClick={(e) => { e.stopPropagation(); setRuns((rs) => rs.filter((x) => x.key !== r.key)); setCompare((cs) => cs.filter((k) => k !== r.key)); }} />
                </button>
              );
            })}
          </div>
          {cmpRuns.length < 2 ? <EmptyState title="Select at least two runs" body="Try “Compare legitimate vs fraud-like patterns” for a ready-made comparison." /> : (
            <div className="grid gap-5 p-5 xl:grid-cols-[1.3fr_1fr]">
              <div className="h-[280px]">
                <div className="label mb-2">Fraud probability distribution</div>
                <ResponsiveContainer>
                  <BarChart data={histData} margin={{ left: -14 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="bin" tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip content={<ChartTip labelFmt={(l) => `probability ≥ ${l}`} />} />
                    <Legend />
                    {cmpRuns.map((r, i) => <Bar key={r.key} dataKey={`#${r.key} ${r.title}`} fill={palette[i]} radius={[2, 2, 0, 0]} />)}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-4">
                <table className="w-full text-[12.5px]">
                  <thead className="table-head"><tr><th>Run</th><th className="text-right">Avg</th><th className="text-right">Max</th><th className="text-right">Flagged</th></tr></thead>
                  <tbody>{cmpRuns.map((r, i) => (
                    <tr key={r.key} className="border-t border-line/[0.06]">
                      <td className="py-2"><span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: palette[i] }} />#{r.key} {r.title}<div className="font-mono text-[10.5px] text-ink-3">{r.model_label} · thr {r.threshold.toFixed(2)}</div></td>
                      <td className="num text-right">{fmtProb(r.summary.mean_probability)}</td><td className="num text-right">{fmtProb(r.summary.max_probability)}</td>
                      <td className="num text-right">{stats(r, r.threshold).flagged}/{r.summary.count}</td>
                    </tr>))}</tbody>
                </table>
                <div className="h-[130px]">
                  <ResponsiveContainer>
                    <BarChart data={riskData} layout="vertical" margin={{ left: 0 }}>
                      <XAxis type="number" hide /><YAxis type="category" dataKey="name" width={130} tickLine={false} axisLine={false} />
                      <Tooltip content={<ChartTip />} />
                      {RISK_LEVELS.map((l) => <Bar key={l} dataKey={l} stackId="r" name={RISK_META[l].label} fill={c.risk[l]} />)}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {cmpRuns.length >= 2 && (
                  <p className="text-[12px] leading-relaxed text-ink-2">
                    #{cmpRuns[0].key} vs #{cmpRuns[1].key}: average probability {fmtProb(cmpRuns[0].summary.mean_probability)} vs {fmtProb(cmpRuns[1].summary.mean_probability)}; predicted fraud {stats(cmpRuns[0], cmpRuns[0].threshold).flagged} vs {stats(cmpRuns[1], cmpRuns[1].threshold).flagged}.
                    {cmpRuns[0].model !== cmpRuns[1].model && " Different models were used, so compare with care."}
                  </p>
                )}
              </div>
            </div>
          )}
        </Panel>
      )}
      <p className="mt-3 font-mono text-[10.5px] text-ink-3">{catalog.data?.note}</p>
      <Confirm open={confirmReset} danger title="Remove simulated data?" confirmLabel="Delete simulated records" onCancel={() => setConfirmReset(false)} onConfirm={reset}
        body={<>Deletes all <b>{synthStats.data?.synthetic_transactions.toLocaleString()}</b> stored simulated transactions with their predictions and alerts. Historical and user-submitted records are not affected.</>} />
    </div>
  );
}
