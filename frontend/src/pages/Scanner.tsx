import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown, Database, Dices, Download, FileUp, Loader2, Lock, RotateCcw, ScanLine, ShieldAlert, ShieldCheck, Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { download, downloadText, get, post } from "../lib/api";
import { useApp, useChartColors } from "../lib/app-context";
import { RISK_META, fmtMoney, fmtProb } from "../lib/format";
import { FEATURES, MODEL_LABELS, MODELS, RISK_LEVELS, type ModelName, type Paged, type PredictResult, type RiskLevel, type Tx } from "../lib/types";
import {
  ChartTip, EmptyState, Field, InfoTip, PageHeader, Pagination, Panel, PanelHead, ProbBar, RiskChip, Segmented, Select, Toggle,
} from "../components/ui";
import { RiskMeter, ShapBars } from "../components/viz";

/* ------------------------------------------------------------------
   The model needs ALL 30 features (Time, V1-V28, Amount). Quick Scan
   starts from a genuine labelled historical record so the 28 anonymised
   components are real; the user then adjusts Amount / Time.
   ------------------------------------------------------------------ */
type Sample = { id: number; external_id: string; ground_truth: number; features: Record<string, number> };
type Vals = Record<string, string>;
const V_FEATURES = FEATURES.filter((f) => f.startsWith("V"));
const emptyVals = (): Vals => Object.fromEntries(FEATURES.map((f) => [f, ""]));
const TX_TYPES = ["Card present (POS)", "Online purchase", "ATM withdrawal", "Contactless", "International"] as const;

const TIP = {
  amount: "The transaction amount in the dataset's original currency units. It is one of the 30 model inputs.",
  time: "Seconds elapsed since the first transaction in the dataset (0 – 172,792 ≈ 48 hours). It is not a clock time.",
  type: "Stored with the transaction for your records. The model never uses it: it only understands Time, V1–V28 and Amount.",
  model: "Which trained model scores the transaction. The best model by validation PR-AUC is marked in the navigation rail.",
  threshold: "The decision threshold. A transaction is predicted fraud when its probability is at or above this value. The default was selected on validation data.",
  sample: "A genuine record from the held-out test split, with its known label. Its 28 anonymised components are kept when you edit Amount or Time.",
  pca: "V1–V28 are anonymised principal components published by the dataset authors. Their real-world meanings are confidential, so TRANZIQ never interprets them.",
};

interface ScanState {
  vals: Vals; setVals: (v: Vals) => void;
  sample: Sample | null; setSample: (s: Sample | null) => void;
  original: Vals | null; setOriginal: (v: Vals | null) => void;
  model: ModelName; setModel: (m: ModelName) => void;
  threshold: number | null; setThreshold: (t: number | null) => void;
  txType: string; setTxType: (t: string) => void;
  persist: boolean; setPersist: (p: boolean) => void;
}

function useLoadSample(st: ScanState, onLoaded: () => void) {
  const { notify } = useApp();
  return async (label: "fraud" | "legitimate" | "any" | number) => {
    try {
      const s = typeof label === "number"
        ? await get<Tx & { features: Record<string, number> }>(`/api/transactions/${label}`).then((t) => ({ id: t.id, external_id: t.external_id, ground_truth: t.ground_truth ?? 0, features: t.features }))
        : await get<Sample>(`/api/transactions/sample?label=${label}`);
      const v = Object.fromEntries(FEATURES.map((f) => [f, String(s.features[f])]));
      st.setSample(s); st.setVals(v); st.setOriginal(v);
      onLoaded();
    } catch (e) {
      notify({ tone: "danger", title: "Could not load a historical sample", body: String(e) });
    }
  };
}

function validate(vals: Vals): Record<string, string> {
  const errs: Record<string, string> = {};
  FEATURES.forEach((f) => {
    const v = vals[f].trim();
    if (v === "" || !Number.isFinite(Number(v))) errs[f] = "number required";
    else if ((f === "Amount" || f === "Time") && Number(v) < 0) errs[f] = "must be ≥ 0";
    else if (f === "Time" && Number(v) > 172800) errs[f] = "max 172,800";
  });
  return errs;
}

/* ---------------- shared controls ---------------- */
function ModelThreshold({ st }: { st: ScanState }) {
  const { settings } = useApp();
  const rec = settings?.decision_thresholds[st.model] ?? 0.5;
  const t = st.threshold ?? rec;
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field label="Prediction model" hint={<InfoTip text={TIP.model} />}>
        <Segmented size="sm" value={st.model} onChange={(m) => { st.setModel(m); st.setThreshold(null); }}
          options={MODELS.map((m) => ({ value: m, label: MODEL_LABELS[m].replace("Logistic Regression", "LogReg") }))} />
      </Field>
      <Field label="Probability threshold" hint={<span className="flex items-center gap-2"><InfoTip text={TIP.threshold} />
        <button type="button" className="font-mono text-[10.5px] text-primary" onClick={() => st.setThreshold(null)}>{st.threshold == null ? "default" : "reset"} {rec.toFixed(2)}</button></span>}>
        <div className="flex items-center gap-3 pt-1.5">
          <input type="range" className="range" min={0.01} max={0.99} step={0.01} value={t} onChange={(e) => st.setThreshold(Number(e.target.value))} aria-label="Decision threshold" />
          <span className="num w-10 text-[13px]">{t.toFixed(2)}</span>
        </div>
      </Field>
    </div>
  );
}

function SampleBadge({ st }: { st: ScanState }) {
  if (!st.sample) return null;
  const fraud = st.sample.ground_truth === 1;
  const edited = !!st.original && FEATURES.some((f) => st.vals[f] !== st.original![f]);
  return (
    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-center gap-2">
      <span className={`chip ${fraud ? "border-coral/50 text-coral" : "border-mint/50 text-mint"}`}>
        <Database size={10} />{fraud ? "Fraud-labelled" : "Legitimate-labelled"} historical sample
      </span>
      <span className="num text-[12px] text-ink-2">{st.sample.external_id}</span>
      {edited && <span className="chip border-amber/50 text-amber" title="The known label described the original record, not your edited version">edited · known label no longer applies</span>}
    </motion.div>
  );
}

/* ---------------- result panel ---------------- */
function Result({ result, st, onRescan }: { result: PredictResult | null; st: ScanState; onRescan: () => void }) {
  const { settings } = useApp();
  const unedited = st.sample && st.original && FEATURES.every((f) => st.vals[f] === st.original![f]);
  return (
    <Panel className="xl:sticky xl:top-6 xl:col-span-5 xl:self-start" delay={0.08}>
      <PanelHead kicker="Risk verdict" title={result ? `${result.model_label} · threshold ${result.threshold.toFixed(2)}` : "Awaiting a scan"} />
      {!result ? (
          <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <EmptyState title="No transaction scanned yet" body="Load a historical sample, adjust the amount or time if you like, then press Scan transaction." />
          </motion.div>
        ) : (
          <motion.div key={`${result.probability}-${result.threshold}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5 p-5">
            <div className="flex flex-col items-center">
              {settings && <RiskMeter probability={result.probability} threshold={result.threshold} bands={settings.risk_bands} level={result.risk.level} />}
              <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }}
                className={`mt-1 flex items-center gap-2 rounded px-4 py-2 text-[14px] font-bold tracking-wide ${result.predicted_label ? "bg-coral/12 text-coral" : "bg-mint/10 text-mint"}`}>
                {result.predicted_label ? <ShieldAlert size={16} /> : <ShieldCheck size={16} />}
                PREDICTED {result.prediction.toUpperCase()}
              </motion.div>
            </div>
            <dl className="grid grid-cols-2 gap-3">
              {[
                ["Fraud probability", fmtProb(result.probability)],
                ["Risk category", <RiskChip key="r" level={result.risk.level} pulse />],
                ["Model", result.model_label],
                ["Decision threshold", result.threshold.toFixed(2)],
              ].map(([k, v]) => (
                <div key={String(k)} className="rounded border border-line/[0.1] px-3 py-2.5"><dt className="label">{k}</dt><dd className="num mt-1 text-[14px]">{v}</dd></div>
              ))}
            </dl>
            <div className="rounded border border-line/[0.1] bg-bg/40 p-3.5 text-[12.5px] leading-relaxed text-ink-2">
              <div className="label mb-1.5">What this means</div>
              {result.risk.explanation}
              <div className="mt-2.5 border-t border-line/[0.08] pt-2.5"><span className="label">Recommended next action · </span><span className="text-ink">{result.risk.recommended_action}</span></div>
            </div>
            {st.sample && (
              <p className="text-[12px] text-ink-3">
                {unedited ? (
                  <>Known label of {st.sample.external_id}: <span className={st.sample.ground_truth ? "text-coral" : "text-mint"}>{st.sample.ground_truth ? "fraud" : "legitimate"}</span>. The model was{" "}
                    {st.sample.ground_truth === result.predicted_label ? <span className="text-mint">correct</span> : <span className="text-coral">incorrect</span>} at this threshold.</>
                ) : <>You edited the sample, so its known label no longer describes this transaction.</>}
              </p>
            )}
            {result.explanation && (
              <div>
                <div className="label mb-3">Why: the strongest SHAP feature contributions</div>
                <ShapBars contributions={result.explanation.contributions} units={result.explanation.output_units} max={10} />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost text-[12px]" onClick={onRescan}><RotateCcw size={13} />Scan again</button>
              {result.transaction_id && <Link className="btn-ghost text-[12px]" to={`/explain?tx=${result.transaction_id}`}>Open in XAI Studio</Link>}
              {result.transaction_id && <Link className="btn-ghost text-[12px]" to={`/transactions?open=${result.transaction_id}`}>View record</Link>}
            </div>
          </motion.div>
        )}
    </Panel>
  );
}

function useScan(st: ScanState, setResult: (r: PredictResult | null) => void, setErrors: (e: Record<string, string>) => void) {
  const { notify, bumpData } = useApp();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    const errs = validate(st.vals);
    setErrors(errs);
    if (Object.keys(errs).length) {
      notify({ tone: "warn", title: "The feature vector is incomplete", body: "All 30 features must be valid numbers. Load a historical sample to fill them." });
      return;
    }
    setBusy(true);
    try {
      const features = Object.fromEntries(FEATURES.map((f) => [f, Number(st.vals[f])]));
      const r = await post<PredictResult>("/api/predict", {
        features, model: st.model, threshold: st.threshold, persist: st.persist, explain: true,
        metadata: { channel: st.txType },
      });
      setResult(r);
      if (st.persist) bumpData();
    } catch (e) {
      notify({ tone: "danger", title: "Prediction failed", body: String(e) });
    } finally { setBusy(false); }
  };
  return { busy, run };
}

/* ---------------- MODE A: quick scan ---------------- */
function QuickScan({ st, setResult, onAdvanced }: { st: ScanState; setResult: (r: PredictResult | null) => void; onAdvanced: () => void }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const load = useLoadSample(st, () => { setErrors({}); setResult(null); });
  const { busy, run } = useScan(st, setResult, setErrors);
  const [history, setHistory] = useState<Tx[]>([]);
  useEffect(() => {
    Promise.all([
      get<Paged<Tx>>("/api/transactions?source=kaggle&ground_truth=1&sort_by=amount&sort_dir=desc&page_size=6"),
      get<Paged<Tx>>("/api/transactions?source=kaggle&ground_truth=0&sort_by=amount&sort_dir=desc&page_size=6"),
    ]).then(([f, l]) => setHistory([...f.items, ...l.items])).catch(() => null);
  }, []);
  const complete = V_FEATURES.every((f) => st.vals[f] !== "");

  return (
    <Panel className="xl:col-span-7">
      <PanelHead kicker="Mode A" title="Quick transaction scan" />
      <div className="space-y-6 p-5">
        {/* Step 1 */}
        <section>
          <div className="mb-3 flex items-center gap-2"><span className="num flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10.5px] text-primary">1</span>
            <span className="text-[13.5px] font-semibold">Start from a historical transaction</span><InfoTip text={TIP.sample} /></div>
          <div className="grid gap-2 sm:grid-cols-3">
            {([["fraud", "Fraud sample", "coral"], ["legitimate", "Legitimate sample", "mint"], ["any", "Random sample", "primary"]] as const).map(([k, label, tone]) => (
              <motion.button key={k} type="button" whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }} onClick={() => load(k)}
                className="group flex items-center gap-3 rounded border border-line/[0.14] bg-bg/40 px-3.5 py-3 text-left transition-colors hover:border-primary/40">
                <span className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: `rgb(var(--${tone}) / 0.14)`, color: `rgb(var(--${tone}))` }}><Dices size={15} /></span>
                <span><span className="block text-[13px] font-semibold">{label}</span><span className="block text-[11px] text-ink-3">real · held-out data</span></span>
              </motion.button>
            ))}
          </div>
          <div className="mt-3 grid items-end gap-3 sm:grid-cols-[1fr_auto]">
            <Field label="…or choose a specific historical transaction">
              <Select value={st.sample ? String(st.sample.id) : ""} onChange={(v) => v && load(Number(v))}
                options={[{ value: "", label: history.length ? "Select a labelled record" : "Loading records…" },
                  ...history.map((t) => ({ value: String(t.id), label: `${t.external_id} · ${fmtMoney(t.amount)} · ${t.ground_truth ? "fraud-labelled" : "legitimate"}` }))]} />
            </Field>
            <button type="button" className="btn-ghost" onClick={() => { st.setSample(null); st.setOriginal(null); st.setVals(emptyVals()); setErrors({}); setResult(null); }}>
              <RotateCcw size={13} />Reset</button>
          </div>
          <div className="mt-3"><SampleBadge st={st} /></div>
        </section>

        {/* Step 2 */}
        <section>
          <div className="mb-3 flex items-center gap-2"><span className="num flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10.5px] text-primary">2</span>
            <span className="text-[13.5px] font-semibold">Transaction details</span></div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Amount" hint={<span className="flex items-center gap-2">{errors.Amount && <span className="text-coral">{errors.Amount}</span>}<InfoTip text={TIP.amount} /></span>}>
              <input className={`input num text-[15px] ${errors.Amount ? "border-coral/60" : ""}`} inputMode="decimal" placeholder="Enter transaction amount (e.g. 250.50)"
                value={st.vals.Amount} onChange={(e) => st.setVals({ ...st.vals, Amount: e.target.value })} aria-label="Transaction amount" />
            </Field>
            <Field label="Transaction time" hint={<span className="flex items-center gap-2">{errors.Time && <span className="text-coral">{errors.Time}</span>}<InfoTip text={TIP.time} /></span>}>
              <input className={`input num text-[15px] ${errors.Time ? "border-coral/60" : ""}`} inputMode="numeric" placeholder="Seconds since the first transaction in the dataset"
                value={st.vals.Time} onChange={(e) => st.setVals({ ...st.vals, Time: e.target.value })} aria-label="Transaction time in seconds" />
            </Field>
            <Field label="Transaction type" hint={<InfoTip text={TIP.type} />}>
              <Select value={st.txType} onChange={st.setTxType} options={TX_TYPES.map((t) => ({ value: t, label: t }))} />
            </Field>
          </div>
          <div className={`mt-3 flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2.5 text-[12px] ${complete ? "border-mint/30 bg-mint/[0.06] text-ink-2" : "border-amber/30 bg-amber/[0.07] text-ink-2"}`}>
            <span className="flex items-center gap-2">
              {complete ? <ShieldCheck size={14} className="text-mint" /> : <Lock size={14} className="text-amber" />}
              {complete ? "28 anonymised components loaded from the sample. The complete 30-feature vector is ready."
                : "The model needs all 30 features. Amount and Time alone are not enough for a valid prediction, so load a historical sample first."}
            </span>
            <button type="button" className="font-mono text-[11px] text-primary hover:underline" onClick={onAdvanced}>view / edit components →</button>
          </div>
        </section>

        {/* Step 3 */}
        <section>
          <div className="mb-3 flex items-center gap-2"><span className="num flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10.5px] text-primary">3</span>
            <span className="text-[13.5px] font-semibold">Model & decision threshold</span></div>
          <ModelThreshold st={st} />
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line/[0.08] pt-4">
          <Toggle checked={st.persist} onChange={st.setPersist} label="Save to the transaction database" />
          <motion.button whileTap={{ scale: 0.97 }} className="btn-primary px-6 py-2.5 tracking-wider" onClick={run} disabled={busy || !complete}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <ScanLine size={15} />} SCAN TRANSACTION
          </motion.button>
        </div>
      </div>
    </Panel>
  );
}

/* ---------------- MODE B: advanced feature scan ---------------- */
function AdvancedScan({ st, setResult }: { st: ScanState; setResult: (r: PredictResult | null) => void }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(true);
  const load = useLoadSample(st, () => { setErrors({}); setResult(null); });
  const { busy, run } = useScan(st, setResult, setErrors);
  const filled = V_FEATURES.filter((f) => st.vals[f] !== "").length;
  const edit = (f: string, v: string) => st.setVals({ ...st.vals, [f]: v });

  return (
    <Panel className="xl:col-span-7">
      <PanelHead kicker="Mode B" title="Advanced feature scan">
        <button className="btn-ghost px-2.5 py-1 text-[12px]" onClick={() => download("/api/predict/template.csv")}><Download size={13} />Template</button>
        <button className="btn-ghost px-2.5 py-1 text-[12px]" onClick={() => download("/api/predict/template.csv?samples=6")}><Download size={13} />Sample file</button>
      </PanelHead>
      <div className="space-y-5 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-ghost text-[12px]" onClick={() => load("any")}><Dices size={13} />Fill from an example transaction</button>
          <button className="btn-ghost text-[12px]" onClick={() => load("fraud")}>Fraud example</button>
          <button className="btn-ghost text-[12px]" onClick={() => load("legitimate")}>Legitimate example</button>
          <button className="btn-ghost text-[12px]" onClick={() => { st.setSample(null); st.setOriginal(null); st.setVals(emptyVals()); setErrors({}); setResult(null); }}><RotateCcw size={13} />Clear</button>
        </div>
        <SampleBadge st={st} />
        <div className="grid gap-4 sm:grid-cols-2">
          {(["Amount", "Time"] as const).map((f) => (
            <Field key={f} label={f === "Amount" ? "Amount" : "Time (seconds since first transaction)"} hint={<span className="flex items-center gap-2">{errors[f] && <span className="text-coral">{errors[f]}</span>}<InfoTip text={f === "Amount" ? TIP.amount : TIP.time} /></span>}>
              <input className={`input num ${errors[f] ? "border-coral/60" : ""}`} inputMode="decimal" value={st.vals[f]} onChange={(e) => edit(f, e.target.value)}
                placeholder={f === "Amount" ? "e.g. 250.50" : "e.g. 52934"} />
            </Field>
          ))}
        </div>
        <div className="rounded border border-line/[0.12]">
          <div className="flex items-center gap-2 px-4 py-3">
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="text-left text-[13px] font-semibold">Anonymised components V1–V28</button>
            <InfoTip text={TIP.pca} />
            <button type="button" onClick={() => setOpen((o) => !o)} aria-label={open ? "Collapse components" : "Expand components"} className="ml-auto flex items-center gap-3">
              <span className="num text-[11.5px] text-ink-3">{filled}/28 filled</span>
              <motion.span animate={{ rotate: open ? 180 : 0 }}><ChevronDown size={15} /></motion.span>
            </button>
          </div>
          <AnimatePresence initial={false}>
            {open && (
              <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
                <div className="grid grid-cols-2 gap-2 border-t border-line/[0.1] p-4 sm:grid-cols-4 lg:grid-cols-7">
                  {V_FEATURES.map((f) => (
                    <label key={f} className="relative">
                      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 font-mono text-[10px] text-ink-3">{f}</span>
                      <input className={`input num py-1.5 pl-8 pr-1 text-[11.5px] ${errors[f] ? "border-coral/60" : ""}`} value={st.vals[f]} inputMode="decimal"
                        onChange={(e) => edit(f, e.target.value)} aria-label={`Component ${f}`} title={errors[f] ?? f} />
                    </label>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {Object.keys(errors).length > 0 && <p className="text-[12px] text-coral">{Object.keys(errors).length} field(s) need a valid number.</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line/[0.08] pt-4">
          <div className="flex flex-col gap-3"><ModelThreshold st={st} /></div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Toggle checked={st.persist} onChange={st.setPersist} label="Save to the transaction database" />
          <motion.button whileTap={{ scale: 0.97 }} className="btn-primary px-6 py-2.5 tracking-wider" onClick={run} disabled={busy}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <ScanLine size={15} />} SCAN TRANSACTION
          </motion.button>
        </div>
      </div>
    </Panel>
  );
}

/* ---------------- Batch CSV ---------------- */
interface BatchResult {
  model: ModelName; model_label: string; threshold: number;
  summary: { rows: number; predicted_fraud: number; predicted_legitimate: number; mean_probability: number; risk_levels: Record<RiskLevel, number> };
  results: { row: number; probability: number; predicted_label: number; prediction: string; risk_level: RiskLevel; amount: number; transaction_id?: number }[];
  validation?: { rows_in_file: number; valid_rows: number; invalid_rows: number; has_class_column: boolean; ignored_columns: string[]; errors: { row: number; error: string }[] };
}

function BatchScan({ st }: { st: ScanState }) {
  const { notify, bumpData } = useApp();
  const c = useChartColors();
  const [file, setFile] = useState<File | null>(null);
  const [persist, setPersist] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [res, setRes] = useState<BatchResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = async () => {
    if (!file) return;
    setBusy(true); setErr(null);
    const fd = new FormData();
    fd.append("file", file); fd.append("model", st.model);
    if (st.threshold != null) fd.append("threshold", String(st.threshold));
    fd.append("persist", String(persist));
    try {
      const r = await post<BatchResult>("/api/predict/upload", fd);
      setRes(r); setPage(1);
      if (persist) bumpData();
      notify({ tone: "success", title: `Scored ${r.summary.rows} transactions`, body: `${r.summary.predicted_fraud} predicted fraudulent.` });
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setRes(null); } finally { setBusy(false); }
  };
  const exportResults = () => {
    if (!res) return;
    downloadText(`tranziq_batch_predictions_${res.model}.csv`, ["row,amount,fraud_probability,predicted_label,prediction,risk_level",
      ...res.results.map((r) => `${r.row + 1},${r.amount},${r.probability},${r.predicted_label},${r.prediction},${r.risk_level}`)].join("\n"));
  };
  const pageSize = 15;
  const rows = res?.results.slice((page - 1) * pageSize, page * pageSize) ?? [];

  return (
    <div className="grid gap-5 xl:grid-cols-12">
      <Panel className="xl:col-span-5">
        <PanelHead kicker="Batch input" title="Upload a transaction CSV">
          <button className="btn-ghost px-2.5 py-1 text-[12px]" onClick={() => download("/api/predict/template.csv")}><Download size={13} />Template</button>
          <button className="btn-ghost px-2.5 py-1 text-[12px]" onClick={() => download("/api/predict/template.csv?samples=10")}><Download size={13} />Sample file</button>
        </PanelHead>
        <div className="space-y-5 p-5">
          <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}
            onClick={() => inputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded border border-dashed px-6 py-10 text-center transition-colors ${drag ? "border-primary bg-primary/10" : "border-line/25 hover:border-primary/50 hover:bg-line/[0.03]"}`}>
            <FileUp className="text-primary" size={28} strokeWidth={1.4} />
            <p className="mt-3 text-[13.5px] font-medium">{file ? file.name : "Drop a CSV here or click to browse"}</p>
            <p className="mt-1 text-[12px] text-ink-3">{file ? `${(file.size / 1024).toFixed(1)} KB` : "Columns: Time, V1…V28, Amount · up to 5,000 rows"}</p>
            <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <ModelThreshold st={st} />
          <Toggle checked={persist} onChange={setPersist} label="Save rows to the transaction database" />
          <button className="btn-primary w-full" onClick={run} disabled={!file || busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Run batch prediction</button>
          {err && <div className="rounded border border-coral/30 bg-coral/10 p-3 text-[12.5px] text-coral" role="alert">{err}</div>}
        </div>
      </Panel>
      <Panel className="xl:col-span-7" delay={0.08}>
        <PanelHead kicker="Batch output" title={res ? `${res.summary.rows.toLocaleString()} rows · ${res.model_label} @ ${res.threshold.toFixed(2)}` : "Results"}>
          {res && <button className="btn-ghost px-2.5 py-1 text-[12px]" onClick={exportResults}><Download size={13} />Download predictions</button>}
        </PanelHead>
        {!res ? <EmptyState title="No batch scored yet" body="Download the sample file to try it: it contains real held-out transactions." /> : (
          <div>
            <div className="grid gap-4 border-b border-line/[0.08] p-5 sm:grid-cols-[1fr_1.3fr]">
              <div className="grid grid-cols-2 gap-4">
                <div><div className="label">Predicted fraud</div><div className="font-display text-4xl text-coral">{res.summary.predicted_fraud}</div></div>
                <div><div className="label">Legitimate</div><div className="font-display text-4xl text-mint">{res.summary.predicted_legitimate}</div></div>
                <div><div className="label">Mean prob.</div><div className="num text-[15px]">{fmtProb(res.summary.mean_probability)}</div></div>
                {res.validation && <div><div className="label">Skipped rows</div><div className={`num text-[15px] ${res.validation.invalid_rows ? "text-amber" : ""}`}>{res.validation.invalid_rows}</div></div>}
              </div>
              <div className="h-[130px]">
                <ResponsiveContainer>
                  <BarChart data={RISK_LEVELS.map((l) => ({ level: RISK_META[l].label, n: res.summary.risk_levels[l] }))}>
                    <XAxis dataKey="level" tickLine={false} axisLine={false} /><YAxis hide />
                    <Tooltip content={<ChartTip />} />
                    <Bar dataKey="n" name="Transactions" radius={[3, 3, 0, 0]}>{RISK_LEVELS.map((l) => <Cell key={l} fill={c.risk[l]} />)}</Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            {res.validation && res.validation.errors.length > 0 && (
              <details className="border-b border-line/[0.08] px-5 py-3 text-[12.5px]" open>
                <summary className="cursor-pointer text-amber">{res.validation.errors.length} row(s) skipped by validation</summary>
                <ul className="mt-2 space-y-1 font-mono text-[11.5px] text-ink-3">{res.validation.errors.slice(0, 20).map((e) => <li key={e.row}>line {e.row}: {e.error}</li>)}</ul>
              </details>
            )}
            {res.validation?.has_class_column && <p className="border-b border-line/[0.08] px-5 py-2 text-[12px] text-ink-3">The file's <code>Class</code> column was ignored. Labels are never shown to the model.</p>}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="table-head"><tr><th>Row</th><th className="text-right">Amount</th><th>Fraud probability</th><th>Prediction</th><th>Risk</th></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.row} className="table-row border-t border-line/[0.06]">
                    <td className="num text-ink-3">{r.row + 1}</td><td className="num text-right">{fmtMoney(r.amount)}</td>
                    <td><ProbBar p={r.probability} threshold={res.threshold} /></td>
                    <td className={r.predicted_label ? "text-coral" : "text-mint"}>{r.prediction}</td><td><RiskChip level={r.risk_level} /></td>
                  </tr>))}</tbody>
              </table>
            </div>
            <Pagination page={page} pages={Math.max(1, Math.ceil(res.results.length / pageSize))} total={res.results.length} onPage={setPage} />
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ---------------- page ---------------- */
export default function Scanner() {
  const { settings } = useApp();
  const [mode, setMode] = useState<"quick" | "advanced" | "batch">("quick");
  const [vals, setVals] = useState<Vals>(emptyVals);
  const [sample, setSample] = useState<Sample | null>(null);
  const [original, setOriginal] = useState<Vals | null>(null);
  const [model, setModel] = useState<ModelName>(settings?.active_model ?? "xgboost");
  const [threshold, setThreshold] = useState<number | null>(null);
  const [txType, setTxType] = useState<string>(TX_TYPES[0]);
  const [persist, setPersist] = useState(true);
  const [result, setResult] = useState<PredictResult | null>(null);
  useEffect(() => { if (settings) setModel((m) => m ?? settings.active_model); }, [settings]);
  const st: ScanState = useMemo(() => ({ vals, setVals, sample, setSample, original, setOriginal, model, setModel, threshold, setThreshold, txType, setTxType, persist, setPersist }),
    [vals, sample, original, model, threshold, txType, persist]);

  return (
    <div>
      <PageHeader index="02" kicker="Transaction Fraud Scanner" title="Scan," accent="score, explain.">
        <Segmented value={mode} onChange={setMode} options={[{ value: "quick", label: "Quick scan" }, { value: "advanced", label: "Advanced features" }, { value: "batch", label: "Batch CSV" }]} />
      </PageHeader>
      {mode === "batch" ? <BatchScan st={st} /> : (
        <div className="grid gap-5 xl:grid-cols-12">
          {mode === "quick" ? <QuickScan st={st} setResult={setResult} onAdvanced={() => setMode("advanced")} /> : <AdvancedScan st={st} setResult={setResult} />}
          <Result result={result} st={st} onRescan={() => setResult(null)} />
        </div>
      )}
    </div>
  );
}
