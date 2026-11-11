import { motion } from "framer-motion";
import { Crown, Info } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { get } from "../lib/api";
import { useApp, useChartColors } from "../lib/app-context";
import { fmtDate, fmtInt, titleCase } from "../lib/format";
import { useApi, useDebounced } from "../lib/hooks";
import { MODEL_LABELS, MODELS, type Metrics, type ModelEval, type ModelInfo, type ModelName } from "../lib/types";
import { ChartTip, ErrorState, Loading, PageHeader, Panel, PanelHead, Segmented, Stat } from "../components/ui";
import { ConfusionMatrix } from "../components/viz";

interface Comparison {
  ranking: { rank: number; name: ModelName; label: string; validation_pr_auc: number; test: ModelInfo["test_summary"] }[];
  best_model: ModelName; selection_criterion: string; generated_at: string; quick_mode: boolean;
  imbalance_experiments: { model: ModelName; strategy: string; train_seconds: number; validation: { pr_auc: number; roc_auc: number; precision: number; recall: number; f1: number } }[];
  settings: { smote_sampling_strategy: number; split: string };
}
interface MetricsResp { models: Record<ModelName, ModelEval>; dataset: { splits: Record<string, { rows: number; fraud: number }> } }
type TA = Metrics & { flagged: number; missed_fraud: number; false_alarms: number; test_rows: number; test_fraud: number };

const METRIC_LABEL = { precision: "Precision", recall: "Recall", f1: "F1-score", pr_auc: "PR-AUC", roc_auc: "ROC-AUC", accuracy: "Accuracy" };

function ThresholdLab({ evals }: { evals: Record<ModelName, ModelEval> }) {
  const c = useChartColors();
  const [model, setModel] = useState<ModelName>("xgboost");
  const [t, setT] = useState(evals.xgboost?.recommended_threshold ?? 0.5);
  const dt = useDebounced(t, 120);
  const [ta, setTa] = useState<TA | null>(null);
  useEffect(() => { setT(evals[model].recommended_threshold); }, [model, evals]);
  useEffect(() => {
    let alive = true;
    get<TA>(`/api/models/${model}/threshold-analysis?threshold=${dt}`).then((r) => alive && setTa(r)).catch(() => null);
    return () => { alive = false; };
  }, [model, dt]);
  const table = evals[model].test.threshold_table.map((r) => ({ t: r.threshold, Precision: r.precision, Recall: r.recall, F1: r.f1, FP: r.confusion_matrix.fp, FN: r.confusion_matrix.fn }));
  const rec = evals[model].recommended_threshold;
  return (
    <Panel delay={0.1}>
      <PanelHead kicker="Threshold optimisation" title="Decision threshold laboratory">
        <Segmented size="sm" value={model} onChange={setModel} options={MODELS.map((m) => ({ value: m, label: MODEL_LABELS[m] }))} />
      </PanelHead>
      <div className="grid gap-6 p-5 xl:grid-cols-[340px_1fr]">
        <div className="space-y-5">
          <div>
            <div className="flex items-baseline justify-between"><span className="label">Threshold</span><span className="font-display text-5xl">{t.toFixed(2)}</span></div>
            <input type="range" className="range mt-3" min={0.01} max={0.99} step={0.01} value={t} onChange={(e) => setT(Number(e.target.value))} aria-label="Threshold" />
            <div className="mt-2 flex justify-between font-mono text-[10.5px] text-ink-3">
              <button onClick={() => setT(rec)} className="text-violet hover:underline">recommended {rec.toFixed(2)}</button>
              <span>{[0.2, 0.3, 0.4, 0.5, 0.6].map((x) => <button key={x} onClick={() => setT(x)} className="ml-2 hover:text-ink">{x.toFixed(1)}</button>)}</span>
            </div>
          </div>
          {ta && (
            <motion.div key={`${model}${ta.threshold}`} initial={{ opacity: 0.6 }} animate={{ opacity: 1 }} className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Precision" value={ta.precision.toFixed(3)} />
                <Stat label="Recall" value={ta.recall.toFixed(3)} />
                <Stat label="F1" value={ta.f1.toFixed(3)} tone="rgb(var(--violet))" />
              </div>
              <ConfusionMatrix m={ta.confusion_matrix} compact />
              <p className="text-[12px] leading-relaxed text-ink-3">
                On {fmtInt(ta.test_rows)} held-out test transactions ({ta.test_fraud} fraud): this threshold flags <span className="text-ink">{ta.flagged}</span>,
                misses <span className="text-coral">{ta.missed_fraud}</span> fraud cases and raises <span className="text-amber">{ta.false_alarms}</span> false alarms.
              </p>
            </motion.div>
          )}
          <div className="flex gap-2 rounded border border-line/[0.1] bg-bg/40 p-3 text-[11.5px] leading-relaxed text-ink-3">
            <Info size={14} className="mt-0.5 shrink-0 text-violet" />{evals[model].threshold_objective}
          </div>
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="h-[300px]">
            <div className="label mb-2">Precision / recall / F1 vs threshold (test)</div>
            <ResponsiveContainer>
              <LineChart data={table} margin={{ left: -18, right: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="t" type="number" domain={[0, 1]} tickLine={false} axisLine={false} />
                <YAxis domain={[0, 1]} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTip fmt={(v) => v.toFixed(3)} labelFmt={(l) => `threshold ${l}`} />} />
                <Legend iconType="plainline" />
                <ReferenceLine x={t} stroke={c.ink2} strokeDasharray="3 3" />
                <Line dataKey="Precision" stroke={c.cyan} dot={{ r: 2.5 }} strokeWidth={2} />
                <Line dataKey="Recall" stroke={c.coral} dot={{ r: 2.5 }} strokeWidth={2} />
                <Line dataKey="F1" stroke={c.violet} dot={{ r: 2.5 }} strokeWidth={2.4} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="h-[300px]">
            <div className="label mb-2">False positives vs false negatives (test)</div>
            <ResponsiveContainer>
              <BarChart data={table} margin={{ left: -18, right: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="t" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTip labelFmt={(l) => `threshold ${l}`} />} />
                <Legend />
                <Bar dataKey="FP" name="False alarms (FP)" fill={c.amber} radius={[2, 2, 0, 0]} />
                <Bar dataKey="FN" name="Missed fraud (FN)" fill={c.coral} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function CurvePanel({ k, data, md, className }: { k: "pr_curve" | "roc_curve"; data: Record<string, number>[]; md: MetricsResp; className: string }) {
  const c = useChartColors();
  const pr = k === "pr_curve";
  return (
    <Panel className={className} delay={0.14}>
      <PanelHead kicker={pr ? "Precision-recall curve · test" : "ROC curve · test"} title={pr ? "Precision vs recall" : "True vs false positive rate"} />
      <div className="h-[330px] p-4">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ left: -18, right: 10, bottom: 6 }}>
            <CartesianGrid />
            <XAxis dataKey="x" type="number" domain={[0, 1]} tickLine={false} axisLine={false}
              label={{ value: pr ? "recall" : "false positive rate", position: "insideBottomRight", offset: -4 }} />
            <YAxis domain={[0, 1]} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTip fmt={(v) => v.toFixed(3)} labelFmt={(l) => `${pr ? "recall" : "FPR"} ${Number(l).toFixed(2)}`} />} />
            <Legend />
            {MODELS.map((m) => (
              <Line key={m} type={pr ? "stepAfter" : "monotone"} dataKey={m}
                name={`${MODEL_LABELS[m]} (${pr ? "AP" : "AUC"} ${(pr ? md.models[m].test.pr_auc : md.models[m].test.roc_auc).toFixed(3)})`}
                stroke={c.models[m]} dot={false} strokeWidth={2} animationDuration={1200} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

function HistPanel({ md }: { md: MetricsResp }) {
  const c = useChartColors();
  const [m, setM] = useState<ModelName>("xgboost");
  const data = md.models[m].test.probability_histogram.map((b) => ({ bin: b.bin.split("-")[0], Legitimate: b.legitimate, Fraud: b.fraud }));
  return (
    <Panel className="xl:col-span-7" delay={0.16}>
      <PanelHead kicker="Score separation · test split" title="Predicted probability by true class (log scale)">
        <Segmented size="sm" value={m} onChange={setM} options={MODELS.map((x) => ({ value: x, label: MODEL_LABELS[x] }))} />
      </PanelHead>
      <div className="h-[260px] p-4">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ left: -10 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="bin" tickLine={false} axisLine={false} />
            <YAxis scale="log" domain={[0.8, "auto"]} allowDataOverflow tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTip labelFmt={(l) => `probability ≥ ${l}`} />} />
            <Legend />
            <Bar dataKey="Legitimate" fill={c.cyan} radius={[2, 2, 0, 0]} />
            <Bar dataKey="Fraud" fill={c.coral} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

export default function ModelLab() {
  const c = useChartColors();
  const { settings, setActiveModel, dataVersion } = useApp();
  const comp = useApi(() => get<Comparison>("/api/models/comparison"), []);
  const metrics = useApi(() => get<MetricsResp>("/api/models/metrics"), []);
  const models = useApi(() => get<{ models: ModelInfo[] }>("/api/models"), [dataVersion]);
  const [at, setAt] = useState<"at_recommended" | "at_default">("at_recommended");

  const bars = useMemo(() => {
    if (!metrics.data) return [];
    return (["precision", "recall", "f1", "pr_auc"] as const).map((k) => {
      const row: Record<string, number | string> = { metric: METRIC_LABEL[k] };
      MODELS.forEach((m) => {
        const t = metrics.data!.models[m].test;
        row[m] = k === "pr_auc" ? t.pr_auc : t[at][k];
      });
      return row;
    });
  }, [metrics.data, at]);

  const curve = (key: "pr_curve" | "roc_curve") => {
    if (!metrics.data) return [];
    // merge each model's curve onto a common x grid
    const grid = Array.from({ length: 51 }, (_, i) => i / 50);
    return grid.map((x) => {
      const row: Record<string, number> = { x };
      MODELS.forEach((m) => {
        const pts = metrics.data!.models[m].test[key];
        let best = pts[0];
        for (const p of pts) if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
        row[m] = best.y;
      });
      return row;
    });
  };

  if (comp.loading || metrics.loading) return <Loading className="h-[60vh]" />;
  if (comp.error || metrics.error) return <ErrorState message={(comp.error ?? metrics.error)!} onRetry={() => { comp.reload(); metrics.reload(); }} />;
  const cd = comp.data!, md = metrics.data!;

  return (
    <div>
      <PageHeader index="03" kicker="Model Comparison Laboratory" title="Three models." accent="One evidence base."
        intro={<>Every number on this page comes from the training run of {fmtDate(cd.generated_at)} on the real Kaggle data. Models are ranked by
          <span className="text-ink"> validation</span> PR-AUC; the test split is used only for the final, untouched report.{cd.quick_mode && <span className="text-amber"> (Quick-mode run on subsampled data.)</span>}</>} />

      {/* Ranking podium */}
      <div className="grid gap-5 lg:grid-cols-3">
        {cd.ranking.map((r, i) => {
          const info = models.data?.models.find((m) => m.name === r.name);
          const isActive = settings?.active_model === r.name;
          return (
            <Panel key={r.name} delay={i * 0.06} className={`p-5 ${r.rank === 1 ? "border-violet/40" : ""}`}>
              {r.rank === 1 && <div className="pointer-events-none absolute inset-0 rounded-md bg-gradient-to-br from-violet/12 via-transparent to-cyan/5" />}
              <div className="relative">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="kicker flex items-center gap-2">Rank {r.rank} {r.rank === 1 && <Crown size={12} className="text-violet" />}</div>
                    <h3 className="mt-1 font-display text-[34px] leading-none">{r.label}</h3>
                    <div className="mt-2 font-mono text-[11px] text-ink-3">strategy: {info?.strategy} · thr {info?.recommended_threshold.toFixed(2)}</div>
                  </div>
                  <div className="text-right">
                    <div className="label">val PR-AUC</div>
                    <div className="num text-[22px] text-violet">{r.validation_pr_auc.toFixed(3)}</div>
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-4 gap-2 border-t border-line/[0.08] pt-4">
                  {(["pr_auc", "precision", "recall", "f1"] as const).map((k) => (
                    <div key={k}><div className="label">{METRIC_LABEL[k]}</div><div className="num mt-0.5 text-[15px]">{r.test[k].toFixed(3)}</div></div>
                  ))}
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <span className="font-mono text-[10.5px] text-ink-3">test · ROC-AUC {r.test.roc_auc.toFixed(3)} · acc {r.test.accuracy.toFixed(4)}</span>
                  <button className={isActive ? "chip border-violet/40 text-violet" : "btn-ghost px-2.5 py-1 text-[11.5px]"} disabled={isActive}
                    onClick={() => setActiveModel(r.name)}>{isActive ? "active" : "Make active"}</button>
                </div>
              </div>
            </Panel>
          );
        })}
      </div>
      <p className="mt-3 text-[12px] text-ink-3">Selection criterion: {cd.selection_criterion} Accuracy is shown for completeness only — with 0.17% fraud, a model that never flags anything is already 99.8% accurate.</p>

      {/* Metric comparison + curves */}
      <div className="mt-5 grid gap-5 xl:grid-cols-12">
        <Panel className="xl:col-span-5" delay={0.1}>
          <PanelHead kicker="Imbalance-aware metrics" title="Precision · Recall · F1 · PR-AUC">
            <Segmented size="sm" value={at} onChange={setAt} options={[{ value: "at_recommended", label: "Tuned thr" }, { value: "at_default", label: "@ 0.50" }]} />
          </PanelHead>
          <div className="h-[330px] p-4">
            <ResponsiveContainer>
              <BarChart data={bars} margin={{ left: -18 }} barCategoryGap="22%">
                <CartesianGrid vertical={false} />
                <XAxis dataKey="metric" tickLine={false} axisLine={false} />
                <YAxis domain={[0, 1]} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTip fmt={(v) => v.toFixed(4)} />} />
                <Legend />
                {MODELS.map((m) => <Bar key={m} dataKey={m} name={MODEL_LABELS[m]} fill={c.models[m]} radius={[3, 3, 0, 0]} animationDuration={900} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <CurvePanel k="pr_curve" data={curve("pr_curve")} md={md} className="xl:col-span-7" />
        <CurvePanel k="roc_curve" data={curve("roc_curve")} md={md} className="xl:col-span-5" />
        <HistPanel md={md} />
      </div>

      {/* Confusion matrices */}
      <Panel className="mt-5" delay={0.18}>
        <PanelHead kicker="Confusion matrices · test split" title={at === "at_recommended" ? "At each model's tuned threshold" : "At the default 0.50 threshold"} />
        <div className="grid gap-6 p-5 md:grid-cols-3">
          {MODELS.map((m) => (
            <div key={m}>
              <div className="mb-2 flex items-baseline justify-between"><span className="text-[13px] font-semibold">{MODEL_LABELS[m]}</span>
                <span className="num text-[11px] text-ink-3">thr {md.models[m].test[at].threshold.toFixed(2)}</span></div>
              <ConfusionMatrix m={md.models[m].test[at].confusion_matrix} />
            </div>
          ))}
        </div>
      </Panel>

      <div className="mt-5"><ThresholdLab evals={md.models} /></div>

      {/* Imbalance experiment */}
      <Panel className="mt-5" delay={0.2}>
        <PanelHead kicker="Class-imbalance experiment · validation split" title="Original vs class weighting vs SMOTE" />
        <div className="overflow-x-auto p-5">
          <table className="w-full min-w-[640px]">
            <thead className="table-head"><tr><th>Model</th><th>Strategy</th><th>PR-AUC</th><th>ROC-AUC</th><th>Precision@0.5</th><th>Recall@0.5</th><th>F1@0.5</th><th>Train time</th></tr></thead>
            <tbody>
              {cd.imbalance_experiments.map((e) => {
                const best = Math.max(...cd.imbalance_experiments.filter((x) => x.model === e.model).map((x) => x.validation.pr_auc));
                const chosen = e.validation.pr_auc === best;
                return (
                  <tr key={e.model + e.strategy} className={`table-row border-t border-line/[0.06] ${chosen ? "bg-violet/[0.06]" : ""}`}>
                    <td>{MODEL_LABELS[e.model]}</td>
                    <td className="font-mono text-[12px]">{titleCase(e.strategy)} {chosen && <span className="chip ml-1 border-violet/40 text-violet">selected</span>}</td>
                    {(["pr_auc", "roc_auc", "precision", "recall", "f1"] as const).map((k) => (
                      <td key={k} className="num">
                        <span className="relative inline-block min-w-[64px] px-1.5 py-0.5">
                          <span className="absolute inset-0 rounded-xs bg-violet" style={{ opacity: e.validation[k] * 0.28 }} />
                          <span className="relative">{e.validation[k].toFixed(4)}</span>
                        </span>
                      </td>
                    ))}
                    <td className="num text-ink-3">{e.train_seconds.toFixed(1)}s</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-[12px] leading-relaxed text-ink-3">SMOTE oversamples the minority class to {cd.settings.smote_sampling_strategy * 100}% of the majority — inside the training pipeline only. Validation and test data are never resampled. For each model the strategy with the best validation PR-AUC is kept.</p>
        </div>
      </Panel>

      {/* Hyperparameters */}
      {models.data && (
        <Panel className="mt-5" delay={0.22}>
          <PanelHead kicker="Reproducibility" title="Hyper-parameters & artifacts" />
          <div className="grid gap-5 p-5 md:grid-cols-3">
            {models.data.models.map((m) => (
              <div key={m.name} className="rounded border border-line/[0.1] p-4">
                <div className="flex items-center justify-between"><span className="font-semibold">{m.label}</span><span className="num text-[11px] text-ink-3">v{m.version}</span></div>
                <dl className="mt-3 space-y-1">
                  {Object.entries(m.hyperparameters).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2 font-mono text-[11.5px]"><dt className="text-ink-3">{k}</dt><dd className="text-ink-2">{String(v)}</dd></div>
                  ))}
                  <div className="flex justify-between gap-2 font-mono text-[11.5px]"><dt className="text-ink-3">train time</dt><dd className="text-ink-2">{m.train_seconds}s</dd></div>
                </dl>
                <div className="mt-3 truncate font-mono text-[10.5px] text-ink-3" title={m.artifact}>{m.artifact}</div>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
