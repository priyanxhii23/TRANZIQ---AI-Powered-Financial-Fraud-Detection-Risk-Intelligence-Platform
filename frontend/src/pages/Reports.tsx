import { motion } from "framer-motion";
import { CheckCircle2, Database, Download, FileDown, FileJson, FileSpreadsheet, FileText, Loader2, RefreshCw, XCircle } from "lucide-react";
import { useState } from "react";
import { API_BASE, download, get, post, qs } from "../lib/api";
import { useApp } from "../lib/app-context";
import { fmtDate, fmtInt } from "../lib/format";
import { useApi } from "../lib/hooks";
import { MODEL_LABELS, MODELS, type ModelName, type Source } from "../lib/types";
import { ErrorState, Loading, PageHeader, Panel, PanelHead, PulseDot, Select, Toggle } from "../components/ui";

interface Monitoring {
  active_model: ModelName;
  training: { generated_at: string; total_training_seconds: number; best_model: ModelName; selection_criterion: string; random_seed: number; quick_mode: boolean } | null;
  models: { name: ModelName; label: string; version: string; trained_at: string; loaded: boolean; prediction_count: number; last_prediction: string | null; mean_probability: number | null; flagged: number }[];
  database: { transactions: number; predictions: number; alerts: number; size_bytes: number | null };
  uptime_seconds: number;
}
interface DatasetInfo {
  dataset_present: boolean; expected_path: string; source_url: string; download_instructions: string[];
  statistics: { rows: number; class_distribution: { legitimate: number; fraudulent: number; fraud_percentage: number } } | null;
  cleaning: { rows_loaded: number; duplicate_rows_dropped: number } | null;
  splits: Record<string, { rows: number; fraud: number; fraud_pct: number }> | null;
}
const PLOTS = ["class_distribution", "amount_distribution", "time_distribution", "correlation_heatmap"];

function PdfButton() {
  const { notify } = useApp();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const go = async () => {
    setState("busy");
    try {
      const res = await fetch(`${API_BASE}/api/reports/pdf`);
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "tranziq_report.pdf";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setState("done");
      notify({ tone: "success", title: "PDF report downloaded", body: `${name} · ${(blob.size / 1024).toFixed(0)} KB` });
      setTimeout(() => setState("idle"), 3000);
    } catch (e) {
      setState("idle");
      notify({ tone: "danger", title: "Could not generate the PDF report", body: String(e) });
    }
  };
  return (
    <motion.button whileTap={{ scale: 0.97 }} onClick={go} disabled={state === "busy"} className="btn-primary px-5 py-2.5 tracking-wider">
      {state === "busy" ? <Loader2 size={15} className="animate-spin" /> : state === "done" ? <CheckCircle2 size={15} /> : <FileDown size={15} />}
      {state === "busy" ? "GENERATING PDF…" : state === "done" ? "PDF DOWNLOADED" : "DOWNLOAD PDF REPORT"}
    </motion.button>
  );
}

export default function Reports() {
  const { health, healthError, notify, dataVersion } = useApp();
  const mon = useApi(() => get<Monitoring>("/api/monitoring"), [dataVersion], { interval: 30000 });
  const ds = useApi(() => get<DatasetInfo>("/api/dataset/info"), []);
  const [exp, setExp] = useState<{ model: ModelName | ""; source: Source | ""; features: boolean }>({ model: "", source: "", features: false });
  const [reloading, setReloading] = useState(false);

  const reload = async () => {
    setReloading(true);
    try { const r = await post<{ loaded: string[] }>("/api/models/reload"); notify({ tone: "success", title: "Models reloaded from disk", body: r.loaded.join(", ") }); mon.reload(); }
    catch (e) { notify({ tone: "danger", title: "Reload failed", body: String(e) }); }
    finally { setReloading(false); }
  };

  const checks = health ? [
    ["API reachable", !healthError], ["Database", health.checks.database], ["Models trained", health.checks.models_trained],
    ["Dataset file present", health.checks.dataset_present],
  ] as [string, boolean][] : [];

  return (
    <div>
      <PageHeader index="10" kicker="Reports & Model Monitoring" title="Evidence," accent="exported."><PdfButton /></PageHeader>

      <div className="grid gap-5 xl:grid-cols-12">
        <Panel className="xl:col-span-4">
          <PanelHead kicker="Application health" title={health?.status === "ok" && !healthError ? "All systems nominal" : "Attention needed"}>
            <PulseDot color={health?.status === "ok" && !healthError ? "rgb(var(--mint))" : "rgb(var(--coral))"} />
          </PanelHead>
          <div className="space-y-3 p-5">
            {checks.map(([k, ok]) => (
              <div key={k} className="flex items-center justify-between text-[13px]"><span className="text-ink-2">{k}</span>
                {ok ? <CheckCircle2 size={16} className="text-mint" /> : <XCircle size={16} className="text-coral" />}</div>
            ))}
            <div className="grid grid-cols-2 gap-3 border-t border-line/[0.08] pt-3 font-mono text-[11.5px]">
              <div><div className="label">API version</div>{health?.version ?? "—"}</div>
              <div><div className="label">Uptime</div>{mon.data ? `${Math.floor(mon.data.uptime_seconds / 60)} min` : "—"}</div>
              <div><div className="label">Loaded models</div>{health?.checks.models_loaded.length ?? 0} / 3</div>
              <div><div className="label">DB size</div>{mon.data?.database.size_bytes ? `${(mon.data.database.size_bytes / 1048576).toFixed(1)} MB` : "—"}</div>
            </div>
            {health?.message && <p className="text-[12px] text-amber">{health.message}</p>}
          </div>
        </Panel>

        <Panel className="xl:col-span-8" delay={0.05}>
          <PanelHead kicker="Model registry & monitoring" title="Versions and prediction activity">
            <button className="btn-ghost px-2.5 py-1 text-[12px]" onClick={reload} disabled={reloading}>{reloading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}Reload models</button>
          </PanelHead>
          {mon.error ? <ErrorState message={mon.error} /> : !mon.data ? <Loading /> : (
            <div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px]">
                  <thead className="table-head"><tr><th>Model</th><th>Version</th><th>Trained</th><th>Status</th><th className="text-right">Predictions</th><th className="text-right">Flagged</th><th>Last prediction</th></tr></thead>
                  <tbody>
                    {mon.data.models.map((m) => (
                      <tr key={m.name} className={`table-row border-t border-line/[0.06] ${m.name === mon.data!.active_model ? "bg-primary/[0.05]" : ""}`}>
                        <td className="font-semibold">{m.label} {m.name === mon.data!.active_model && <span className="chip ml-1 border-primary/40 text-primary">active</span>}{m.name === mon.data!.training?.best_model && <span className="chip ml-1 border-secondary/40 text-secondary">best</span>}</td>
                        <td className="num text-[12px] text-ink-2">{m.version}</td>
                        <td className="num text-[12px] text-ink-3">{fmtDate(m.trained_at)}</td>
                        <td>{m.loaded ? <span className="flex items-center gap-1.5 text-[12px] text-mint"><PulseDot color="rgb(var(--mint))" size={6} />loaded</span> : <span className="text-[12px] text-ink-3">on disk</span>}</td>
                        <td className="num text-right">{fmtInt(m.prediction_count)}</td>
                        <td className="num text-right text-coral">{fmtInt(m.flagged)}</td>
                        <td className="num text-[12px] text-ink-3">{fmtDate(m.last_prediction)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {mon.data.training && (
                <div className="grid gap-4 border-t border-line/[0.08] p-5 sm:grid-cols-4">
                  <div><div className="label">Last training</div><div className="num mt-1 text-[13px]">{fmtDate(mon.data.training.generated_at)}</div></div>
                  <div><div className="label">Training time</div><div className="num mt-1 text-[13px]">{mon.data.training.total_training_seconds}s</div></div>
                  <div><div className="label">Random seed</div><div className="num mt-1 text-[13px]">{mon.data.training.random_seed}</div></div>
                  <div><div className="label">Model selection</div><div className="mt-1 text-[13px]">{MODEL_LABELS[mon.data.training.best_model]}{mon.data.training.quick_mode && <span className="text-amber"> (quick)</span>}</div></div>
                  <p className="text-[11.5px] text-ink-3 sm:col-span-4">{mon.data.training.selection_criterion}</p>
                </div>
              )}
              <div className="grid grid-cols-3 gap-4 border-t border-line/[0.08] p-5">
                {(["transactions", "predictions", "alerts"] as const).map((k) => (
                  <div key={k}><div className="label">{k}</div><div className="font-display text-3xl">{fmtInt(mon.data!.database[k])}</div></div>
                ))}
              </div>
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-12">
        <Panel className="xl:col-span-5" delay={0.08}>
          <PanelHead kicker="Exports" title="Downloads" />
          <div className="space-y-5 p-5">
            <div className="rounded border border-line/[0.1] p-4">
              <div className="flex items-center gap-2 font-semibold"><FileSpreadsheet size={16} className="text-secondary" />Transaction export (CSV)</div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Select value={exp.model} onChange={(v) => setExp({ ...exp, model: v })} options={[{ value: "", label: "Active model" }, ...MODELS.map((m) => ({ value: m, label: MODEL_LABELS[m] }))]} />
                <Select value={exp.source} onChange={(v) => setExp({ ...exp, source: v })} options={[{ value: "", label: "All sources" }, { value: "kaggle", label: "Real (Kaggle)" }, { value: "synthetic", label: "Synthetic" }, { value: "user", label: "User" }]} />
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <Toggle checked={exp.features} onChange={(v) => setExp({ ...exp, features: v })} label="Include 30 model features" />
                <button className="btn-primary px-3 py-1.5 text-[12px]" onClick={() => download(`/api/reports/transactions.csv${qs({ model: exp.model, source: exp.source, include_features: exp.features || "" })}`)}><Download size={13} />Download</button>
              </div>
            </div>
            <div className="rounded border border-primary/30 bg-primary/[0.05] p-4">
              <div className="flex items-center gap-2 font-semibold"><FileDown size={16} className="text-primary" />Branded PDF report</div>
              <p className="mt-1 text-[12px] text-ink-3">Executive summary, model performance (validation &amp; test), evaluation charts, methodology, risk analysis. 5 pages, A4.</p>
              <div className="mt-3"><PdfButton /></div>
            </div>
            <div className="rounded border border-line/[0.1] p-4">
              <div className="flex items-center gap-2 font-semibold"><FileText size={16} className="text-primary" />Model evaluation report</div>
              <p className="mt-1 text-[12px] text-ink-3">Real training results: ranking, imbalance experiment, threshold trade-offs, confusion matrices.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn-ghost text-[12px]" onClick={() => download("/api/reports/evaluation?format=md")}><FileText size={13} />Markdown</button>
                <button className="btn-ghost text-[12px]" onClick={() => download("/api/reports/evaluation?format=csv")}><FileSpreadsheet size={13} />CSV</button>
                <button className="btn-ghost text-[12px]" onClick={() => download("/api/reports/evaluation?format=json")}><FileJson size={13} />JSON</button>
              </div>
            </div>
            <div className="rounded border border-line/[0.1] p-4">
              <div className="flex items-center gap-2 font-semibold"><Download size={16} className="text-coral" />Alert log</div>
              <p className="mt-1 text-[12px] text-ink-3">Every alert with analyst status and notes.</p>
              <button className="btn-ghost mt-3 text-[12px]" onClick={() => download("/api/reports/alerts.csv")}><Download size={13} />Alerts CSV</button>
            </div>
          </div>
        </Panel>

        <Panel className="xl:col-span-7" delay={0.1}>
          <PanelHead kicker="Dataset information" title="Kaggle Credit Card Fraud Detection (mlg-ulb)"><Database size={15} className="text-secondary" /></PanelHead>
          {!ds.data ? <Loading /> : (
            <div className="space-y-4 p-5">
              <div className="flex items-center gap-2 text-[13px]">{ds.data.dataset_present ? <CheckCircle2 size={15} className="text-mint" /> : <XCircle size={15} className="text-coral" />}
                <code className="font-mono text-[12px]">{ds.data.expected_path}</code> {ds.data.dataset_present ? "found" : "missing"}</div>
              {!ds.data.dataset_present && <ul className="list-inside list-disc text-[12.5px] text-ink-2">{ds.data.download_instructions.map((d) => <li key={d}>{d}</li>)}</ul>}
              {ds.data.statistics && ds.data.cleaning && (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div><div className="label">Rows loaded</div><div className="num text-[16px]">{fmtInt(ds.data.cleaning.rows_loaded)}</div></div>
                  <div><div className="label">After cleaning</div><div className="num text-[16px]">{fmtInt(ds.data.statistics.rows)}</div></div>
                  <div><div className="label">Fraud rows</div><div className="num text-[16px] text-coral">{fmtInt(ds.data.statistics.class_distribution.fraudulent)}</div></div>
                  <div><div className="label">Fraud share</div><div className="num text-[16px]">{ds.data.statistics.class_distribution.fraud_percentage.toFixed(3)}%</div></div>
                </div>
              )}
              {ds.data.splits && (
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(ds.data.splits).map(([k, s], i) => (
                    <motion.div key={k} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className="rounded border border-line/[0.1] p-3">
                      <div className="label">{k} split</div><div className="num text-[15px]">{fmtInt(s.rows)}</div><div className="font-mono text-[11px] text-ink-3">{s.fraud} fraud · {s.fraud_pct}%</div>
                    </motion.div>
                  ))}
                </div>
              )}
              <a className="inline-block font-mono text-[11.5px] text-primary hover:underline" href={ds.data.source_url} target="_blank" rel="noreferrer">{ds.data.source_url}</a>
            </div>
          )}
        </Panel>
      </div>

      <Panel className="mt-5" delay={0.12}>
        <PanelHead kicker="Static EDA figures (Matplotlib / Seaborn)" title="Generated during training" />
        <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
          {PLOTS.map((p) => (
            <a key={p} href={`${API_BASE}/static/plots/${p}.png`} target="_blank" rel="noreferrer" className="group block overflow-hidden rounded border border-line/[0.1] bg-white">
              <img src={`${API_BASE}/static/plots/${p}.png`} alt={p.replace(/_/g, " ")} loading="lazy" className="aspect-[4/3] w-full object-contain transition-transform group-hover:scale-[1.03]" />
            </a>
          ))}
        </div>
      </Panel>
    </div>
  );
}
