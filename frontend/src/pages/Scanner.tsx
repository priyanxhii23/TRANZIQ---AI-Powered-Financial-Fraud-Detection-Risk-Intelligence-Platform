import { AnimatePresence, motion } from "framer-motion";
import { Database, Dices, Download, FileUp, Loader2, ScanLine, ShieldAlert, ShieldCheck, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { downloadText, get, post } from "../lib/api";
import { useApp, useChartColors } from "../lib/app-context";
import { RISK_META, fmtMoney, fmtProb } from "../lib/format";
import { FEATURES, MODEL_LABELS, MODELS, RISK_LEVELS, type ModelName, type PredictResult, type RiskLevel } from "../lib/types";
import { ChartTip, EmptyState, Field, PageHeader, Pagination, Panel, PanelHead, ProbBar, RiskChip, Segmented, Toggle } from "../components/ui";
import { RiskMeter, ShapBars } from "../components/viz";

type Sample = { id: number; external_id: string; ground_truth: number; features: Record<string, number> };
interface BatchResult {
  model: ModelName; model_label: string; threshold: number;
  summary: { rows: number; predicted_fraud: number; predicted_legitimate: number; mean_probability: number; risk_levels: Record<RiskLevel, number> };
  results: { row: number; probability: number; predicted_label: number; prediction: string; risk_level: RiskLevel; amount: number; transaction_id?: number }[];
  validation?: { rows_in_file: number; valid_rows: number; invalid_rows: number; has_class_column: boolean; ignored_columns: string[]; errors: { row: number; error: string }[] };
}

const emptyFeatures = () => Object.fromEntries(FEATURES.map((f) => [f, ""])) as Record<string, string>;

function ModelThreshold({ model, setModel, threshold, setThreshold }: {
  model: ModelName; setModel: (m: ModelName) => void; threshold: number | null; setThreshold: (t: number | null) => void;
}) {
  const { settings } = useApp();
  const rec = settings?.decision_thresholds[model] ?? 0.5;
  const t = threshold ?? rec;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Prediction model">
        <Segmented size="sm" value={model} onChange={(m) => { setModel(m); setThreshold(null); }}
          options={MODELS.map((m) => ({ value: m, label: MODEL_LABELS[m].replace("Logistic Regression", "LogReg") }))} />
      </Field>
      <Field label="Probability threshold" hint={<button className="font-mono text-[10.5px] text-violet" onClick={() => setThreshold(null)}>
        {threshold == null ? "model default" : "reset"} · {rec.toFixed(2)}</button>}>
        <div className="flex items-center gap-3 pt-1.5">
          <input type="range" className="range" min={0.01} max={0.99} step={0.01} value={t}
            onChange={(e) => setThreshold(Number(e.target.value))} aria-label="Decision threshold" />
          <span className="num w-10 text-[13px]">{t.toFixed(2)}</span>
        </div>
      </Field>
    </div>
  );
}

function SingleScan() {
  const { settings, notify, bumpData } = useApp();
  const [model, setModel] = useState<ModelName>(settings?.active_model ?? "xgboost");
  const [threshold, setThreshold] = useState<number | null>(null);
  const [vals, setVals] = useState<Record<string, string>>(emptyFeatures);
  const [sample, setSample] = useState<Sample | null>(null);
  const [persist, setPersist] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PredictResult | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = async (label: "fraud" | "legitimate" | "any") => {
    try {
      const s = await get<Sample>(`/api/transactions/sample?label=${label}`);
      setSample(s);
      setVals(Object.fromEntries(FEATURES.map((f) => [f, String(s.features[f])])));
      setErrors({}); setResult(null);
    } catch (e) {
      notify({ tone: "danger", title: "Could not load sample", body: String(e) });
    }
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    FEATURES.forEach((f) => {
      const v = vals[f].trim();
      if (v === "" || !Number.isFinite(Number(v))) errs[f] = "number required";
      else if ((f === "Amount" || f === "Time") && Number(v) < 0) errs[f] = "must be ≥ 0";
    });
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const run = async () => {
    if (!validate()) { notify({ tone: "warn", title: "Check the highlighted fields", body: "All 30 features must be valid numbers." }); return; }
    setBusy(true);
    try {
      const features = Object.fromEntries(FEATURES.map((f) => [f, Number(vals[f])]));
      const r = await post<PredictResult>("/api/predict", { features, model, threshold, persist, explain: true });
      setResult(r);
      if (persist) bumpData();
    } catch (e) {
      notify({ tone: "danger", title: "Prediction failed", body: String(e) });
    } finally { setBusy(false); }
  };

  const edited = (f: string, v: string) => { setVals((s) => ({ ...s, [f]: v })); if (sample) setSample(null); };

  return (
    <div className="grid gap-5 xl:grid-cols-12">
      <Panel className="xl:col-span-7">
        <PanelHead kicker="Input" title="Transaction feature vector">
          <button className="btn-ghost px-2.5 py-1 text-[12px]" onClick={() => load("fraud")}><Dices size={13} />Real fraud sample</button>
          <button className="btn-ghost px-2.5 py-1 text-[12px]" onClick={() => load("legitimate")}><Dices size={13} />Real legit sample</button>
          <button className="btn-ghost px-2.5 py-1 text-[12px]" onClick={() => { setVals(emptyFeatures()); setSample(null); setResult(null); setErrors({}); }}>Clear</button>
        </PanelHead>
        <div className="space-y-5 p-5">
          <ModelThreshold model={model} setModel={setModel} threshold={threshold} setThreshold={setThreshold} />
          {sample && (
            <div className="flex flex-wrap items-center gap-2 rounded border border-cyan/25 bg-cyan/[0.06] px-3 py-2 text-[12.5px] text-ink-2">
              <Database size={14} className="text-cyan" /> Loaded real Kaggle test record <span className="num text-ink">{sample.external_id}</span>
              — known label: <span className={sample.ground_truth ? "text-coral" : "text-mint"}>{sample.ground_truth ? "Fraud" : "Legitimate"}</span>
              <span className="text-ink-3">(held-out data the model never trained on)</span>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {["Amount", "Time"].map((f) => (
              <Field key={f} label={f === "Amount" ? "Amount (original units)" : "Time (seconds since first txn)"} hint={errors[f] && <span className="text-coral">{errors[f]}</span>}>
                <input className={`input num text-[15px] ${errors[f] ? "border-coral/60" : ""}`} inputMode="decimal" value={vals[f]}
                  onChange={(e) => edited(f, e.target.value)} placeholder="0.00" />
              </Field>
            ))}
          </div>
          <div>
            <div className="label mb-2">Anonymised PCA components V1 – V28</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {FEATURES.filter((f) => f.startsWith("V")).map((f) => (
                <label key={f} className="relative">
                  <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 font-mono text-[10px] text-ink-3">{f}</span>
                  <input className={`input num py-1.5 pl-8 pr-1 text-[11.5px] ${errors[f] ? "border-coral/60" : ""}`} value={vals[f]} inputMode="decimal"
                    onChange={(e) => edited(f, e.target.value)} title={errors[f] ?? f} />
                </label>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line/[0.08] pt-4">
            <Toggle checked={persist} onChange={setPersist} label="Save as a user transaction (raises alerts if risky)" />
            <motion.button whileTap={{ scale: 0.97 }} className="btn-primary px-5" onClick={run} disabled={busy}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <ScanLine size={15} />} Run fraud scan
            </motion.button>
          </div>
        </div>
      </Panel>

      <Panel className="xl:col-span-5" delay={0.08}>
        <PanelHead kicker="Output" title="Risk verdict" />
        <AnimatePresence mode="wait">
          {!result ? (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <EmptyState title="Awaiting a transaction" body="Load a real sample or enter all 30 features, then run the scan." />
            </motion.div>
          ) : (
            <motion.div key={result.probability} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5 p-5">
              <div className="flex flex-col items-center">
                {settings && <RiskMeter probability={result.probability} threshold={result.threshold} bands={settings.risk_bands} level={result.risk.level} />}
                <div className={`mt-1 flex items-center gap-2 rounded px-3 py-1.5 text-[13px] font-semibold ${result.predicted_label ? "bg-coral/12 text-coral" : "bg-mint/10 text-mint"}`}>
                  {result.predicted_label ? <ShieldAlert size={15} /> : <ShieldCheck size={15} />}
                  Predicted {result.prediction.toUpperCase()}
                </div>
                <div className="mt-2 font-mono text-[10.5px] text-ink-3">{result.model_label} · v{result.model_version}</div>
              </div>
              <p className="rounded border border-line/[0.1] bg-bg/40 p-3 text-[12.5px] leading-relaxed text-ink-2">
                {result.risk.explanation} <span className="text-ink">{result.risk.recommended_action}</span>
              </p>
              {sample && (
                <p className="text-[12px] text-ink-3">
                  Ground truth for this record: <span className={sample.ground_truth ? "text-coral" : "text-mint"}>{sample.ground_truth ? "fraud" : "legitimate"}</span> —
                  the model was {Number(sample.ground_truth) === result.predicted_label ? <span className="text-mint">correct</span> : <span className="text-coral">incorrect</span>} at this threshold.
                </p>
              )}
              {result.explanation && (
                <div>
                  <div className="label mb-3">Why — top SHAP feature contributions</div>
                  <ShapBars contributions={result.explanation.contributions} units={result.explanation.output_units} max={10} />
                </div>
              )}
              {result.transaction_id && (
                <div className="flex flex-wrap gap-2">
                  <Link className="btn-ghost text-[12px]" to={`/explain?tx=${result.transaction_id}`}>Open in XAI Studio</Link>
                  <Link className="btn-ghost text-[12px]" to={`/transactions?open=${result.transaction_id}`}>View {result.external_id}</Link>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </Panel>
    </div>
  );
}

function BatchScan() {
  const { settings, notify, bumpData } = useApp();
  const c = useChartColors();
  const [model, setModel] = useState<ModelName>(settings?.active_model ?? "xgboost");
  const [threshold, setThreshold] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [persist, setPersist] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [res, setRes] = useState<BatchResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const inputRef = useRef<HTMLInputElement>(null);

  const template = async () => {
    const rows: string[] = [FEATURES.join(",")];
    try {
      for (const l of ["fraud", "legitimate", "legitimate"] as const) {
        const s = await get<Sample>(`/api/transactions/sample?label=${l}`);
        rows.push(FEATURES.map((f) => s.features[f]).join(","));
      }
    } catch { /* header-only template */ }
    downloadText("tranziq_batch_template.csv", rows.join("\n"));
  };

  const run = async () => {
    if (!file) return;
    setBusy(true); setErr(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("model", model);
    if (threshold != null) fd.append("threshold", String(threshold));
    fd.append("persist", String(persist));
    try {
      const r = await post<BatchResult>("/api/predict/upload", fd);
      setRes(r); setPage(1);
      if (persist) bumpData();
      notify({ tone: "success", title: `Scored ${r.summary.rows} transactions`, body: `${r.summary.predicted_fraud} predicted fraudulent.` });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e)); setRes(null);
    } finally { setBusy(false); }
  };

  const exportResults = () => {
    if (!res) return;
    const lines = ["row,amount,fraud_probability,predicted_label,risk_level", ...res.results.map((r) => `${r.row + 1},${r.amount},${r.probability},${r.predicted_label},${r.risk_level}`)];
    downloadText(`tranziq_batch_results_${res.model}.csv`, lines.join("\n"));
  };

  const pageSize = 15;
  const rows = res?.results.slice((page - 1) * pageSize, page * pageSize) ?? [];

  return (
    <div className="grid gap-5 xl:grid-cols-12">
      <Panel className="xl:col-span-5">
        <PanelHead kicker="Batch input" title="Upload transaction CSV">
          <button className="btn-ghost px-2.5 py-1 text-[12px]" onClick={template}><Download size={13} /> Template</button>
        </PanelHead>
        <div className="space-y-5 p-5">
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}
            onClick={() => inputRef.current?.click()} role="button" tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded border border-dashed px-6 py-10 text-center transition-colors ${drag ? "border-violet bg-violet/10" : "border-line/25 hover:border-violet/50 hover:bg-line/[0.03]"}`}>
            <FileUp className="text-violet" size={28} strokeWidth={1.4} />
            <p className="mt-3 text-[13.5px] font-medium">{file ? file.name : "Drop a CSV here or click to browse"}</p>
            <p className="mt-1 text-[12px] text-ink-3">{file ? `${(file.size / 1024).toFixed(1)} KB` : "Required columns: Time, V1…V28, Amount · max 5,000 rows"}</p>
            <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <ModelThreshold model={model} setModel={setModel} threshold={threshold} setThreshold={setThreshold} />
          <Toggle checked={persist} onChange={setPersist} label="Save rows to the database as user transactions" />
          <button className="btn-primary w-full" onClick={run} disabled={!file || busy}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Run batch prediction
          </button>
          {err && <div className="rounded border border-coral/30 bg-coral/10 p-3 text-[12.5px] text-coral">{err}</div>}
        </div>
      </Panel>

      <Panel className="xl:col-span-7" delay={0.08}>
        <PanelHead kicker="Batch output" title={res ? `${res.summary.rows.toLocaleString()} rows · ${res.model_label} @ ${res.threshold.toFixed(2)}` : "Results"}>
          {res && <button className="btn-ghost px-2.5 py-1 text-[12px]" onClick={exportResults}><Download size={13} /> Export</button>}
        </PanelHead>
        {!res ? <EmptyState title="No batch scored yet" body="Download the template to see the expected format - it contains real Kaggle test rows." /> : (
          <div>
            <div className="grid gap-4 border-b border-line/[0.08] p-5 sm:grid-cols-[1fr_1.3fr]">
              <div className="grid grid-cols-2 gap-4">
                <div><div className="label">Predicted fraud</div><div className="font-display text-4xl text-coral">{res.summary.predicted_fraud}</div></div>
                <div><div className="label">Legitimate</div><div className="font-display text-4xl text-mint">{res.summary.predicted_legitimate}</div></div>
                <div><div className="label">Mean prob.</div><div className="num text-[15px]">{fmtProb(res.summary.mean_probability)}</div></div>
                {res.validation && <div><div className="label">Invalid rows</div><div className={`num text-[15px] ${res.validation.invalid_rows ? "text-amber" : ""}`}>{res.validation.invalid_rows}</div></div>}
              </div>
              <div className="h-[130px]">
                <ResponsiveContainer>
                  <BarChart data={RISK_LEVELS.map((l) => ({ level: RISK_META[l].label, n: res.summary.risk_levels[l], l }))}>
                    <XAxis dataKey="level" tickLine={false} axisLine={false} />
                    <YAxis hide />
                    <Tooltip content={<ChartTip />} />
                    <Bar dataKey="n" name="Transactions" radius={[3, 3, 0, 0]}>{RISK_LEVELS.map((l) => <Cell key={l} fill={c.risk[l]} />)}</Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            {res.validation && res.validation.errors.length > 0 && (
              <details className="border-b border-line/[0.08] px-5 py-3 text-[12.5px]">
                <summary className="cursor-pointer text-amber">{res.validation.errors.length} row(s) skipped by validation</summary>
                <ul className="mt-2 space-y-1 font-mono text-[11.5px] text-ink-3">{res.validation.errors.slice(0, 20).map((e) => <li key={e.row}>line {e.row}: {e.error}</li>)}</ul>
              </details>
            )}
            {res.validation?.has_class_column && <p className="border-b border-line/[0.08] px-5 py-2 text-[12px] text-ink-3">The file has a <code>Class</code> column — it was ignored for prediction (the model never sees labels).</p>}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="table-head"><tr><th>Row</th><th className="text-right">Amount</th><th>Fraud probability</th><th>Prediction</th><th>Risk</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.row} className="table-row border-t border-line/[0.06]">
                      <td className="num text-ink-3">{r.row + 1}</td>
                      <td className="num text-right">{fmtMoney(r.amount)}</td>
                      <td><ProbBar p={r.probability} threshold={res.threshold} /></td>
                      <td className={r.predicted_label ? "text-coral" : "text-mint"}>{r.prediction}</td>
                      <td><RiskChip level={r.risk_level} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pages={Math.max(1, Math.ceil(res.results.length / pageSize))} total={res.results.length} onPage={setPage} />
          </div>
        )}
      </Panel>
    </div>
  );
}

export default function Scanner() {
  const [mode, setMode] = useState<"single" | "batch">("single");
  return (
    <div>
      <PageHeader index="02" kicker="Transaction Fraud Scanner" title="Scan," accent="score, explain."
        intro="Score one transaction from its 30 model features, or upload a CSV for batch prediction. Every input is validated before it reaches the model.">
        <Segmented value={mode} onChange={setMode} options={[{ value: "single", label: "Single transaction" }, { value: "batch", label: "Batch CSV" }]} />
      </PageHeader>
      {mode === "single" ? <SingleScan /> : <BatchScan />}
    </div>
  );
}
