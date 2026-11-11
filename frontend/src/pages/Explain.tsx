import { motion } from "framer-motion";
import { Image as ImageIcon, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { API_BASE, get, qs } from "../lib/api";
import { useApp, useChartColors } from "../lib/app-context";
import { fmtMoney, fmtNum, fmtProb } from "../lib/format";
import { useApi, useDebounced } from "../lib/hooks";
import { MODEL_LABELS, MODELS, type Explanation, type ModelName, type Paged, type RiskInfo, type Tx } from "../lib/types";
import { ChartTip, EmptyState, ErrorState, InfoTip, LabelChip, Loading, PageHeader, Panel, PanelHead, RiskChip, Segmented } from "../components/ui";

interface GlobalShap {
  model: ModelName; model_label: string; sample_description: string; base_value: number; output_units: string; plot_url: string | null;
  anonymised_feature_note: string;
  features: { feature: string; mean_abs_shap: number; mean_shap: number; note: string; points: { shap: number; value_norm: number }[] }[];
}
interface LocalShap extends Explanation {
  model: ModelName; model_label: string; probability: number; threshold: number; predicted_label: number; risk: RiskInfo;
  anonymised_feature_note: string; transaction: { id: number; external_id: string; source: Tx["source"]; amount: number; ground_truth: number | null };
}

/** Theme colours: low feature value (secondary) -> primary -> coral (high value), like SHAP's colour bar. */
let STOPS: number[][] = [[212, 163, 115], [183, 108, 222], [240, 112, 122]];
function valueColor(t: number) {
  const stops = STOPS;
  const seg = t < 0.5 ? 0 : 1;
  const k = t < 0.5 ? t * 2 : (t - 0.5) * 2;
  const a = stops[seg], b = stops[seg + 1];
  return `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * k)).join(",")})`;
}

function Waterfall({ exp }: { exp: LocalShap }) {
  const top = exp.contributions.slice(0, 12);
  const rest = exp.contributions.slice(12).reduce((s, c) => s + c.shap_value, 0);
  const steps: { name: string; start: number; end: number; value?: number }[] = [];
  let cum = exp.base_value;
  for (const c of top) { steps.push({ name: c.feature, start: cum, end: cum + c.shap_value, value: c.value }); cum += c.shap_value; }
  if (exp.contributions.length > 12) { steps.push({ name: `${exp.contributions.length - 12} others`, start: cum, end: cum + rest }); cum += rest; }
  const all = [exp.base_value, ...steps.map((s) => s.end), ...steps.map((s) => s.start)];
  const lo = Math.min(...all), hi = Math.max(...all);
  const x = (v: number) => ((v - lo) / (hi - lo || 1)) * 100;
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[120px_1fr_70px] items-center gap-3 text-[11.5px]">
        <span className="label text-right">base value</span>
        <div className="relative h-5"><span className="absolute top-0 h-full w-0.5 bg-ink-3" style={{ left: `${x(exp.base_value)}%` }} /></div>
        <span className="num text-ink-3">{fmtNum(exp.base_value, 3)}</span>
      </div>
      {steps.map((s, i) => {
        const pos = s.end > s.start;
        return (
          <div key={s.name} className="grid grid-cols-[120px_1fr_70px] items-center gap-3" title={s.value != null ? `feature value ${s.value}` : undefined}>
            <span className="num truncate text-right text-[12px] text-ink-2">{s.name}{s.value != null && <span className="text-ink-3"> = {fmtNum(s.value, s.name === "Time" ? 0 : 2)}</span>}</span>
            <div className="relative h-5">
              <motion.span className="absolute top-1 h-3 rounded-sm" style={{ left: `${x(Math.min(s.start, s.end))}%`, background: pos ? "rgb(var(--coral))" : "rgb(var(--secondary))" }}
                initial={{ width: 0 }} animate={{ width: `${Math.max(0.4, Math.abs(x(s.end) - x(s.start)))}%` }} transition={{ delay: i * 0.04, duration: 0.5 }} />
            </div>
            <span className={`num text-[11.5px] ${pos ? "text-coral" : "text-secondary"}`}>{pos ? "+" : ""}{fmtNum(s.end - s.start, 3)}</span>
          </div>
        );
      })}
      <div className="grid grid-cols-[120px_1fr_70px] items-center gap-3 border-t border-line/[0.1] pt-1.5 text-[11.5px]">
        <span className="label text-right">model output</span>
        <div className="relative h-5"><span className="absolute top-0 h-full w-0.5 bg-primary" style={{ left: `${x(cum)}%` }} /></div>
        <span className="num text-primary">{fmtNum(cum, 3)}</span>
      </div>
      <p className="pt-2 text-[11px] text-ink-3">Units: {exp.output_units}. base value + Σ contributions = model output{exp.output_units === "log-odds" ? " (converted to probability with the logistic function)" : ""}.</p>
    </div>
  );
}

export default function Explain() {
  const c = useChartColors();
  STOPS = [c.raw("secondary"), c.raw("primary"), c.raw("coral")];
  const { settings } = useApp();
  const [params, setParams] = useSearchParams();
  const [model, setModel] = useState<ModelName>(settings?.active_model ?? "xgboost");
  const [txInput, setTxInput] = useState(params.get("tx") ?? "");
  const txId = params.get("tx");
  const [showPlot, setShowPlot] = useState(false);

  const glob = useApi(() => get<GlobalShap>(`/api/explain/global?model=${model}`), [model]);
  const local = useApi(() => (txId ? get<LocalShap>(`/api/explain/${txId}?model=${model}`) : Promise.resolve(null)), [txId, model]);
  const [list, setList] = useState<"risk" | "flagged" | "recent">("risk");
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 300);
  const picks = useApi(() => get<Paged<Tx>>(`/api/transactions${qs({
    model, q: dq, page_size: 25,
    sort_by: list === "risk" ? "probability" : "id", sort_dir: "desc", predicted_label: list === "flagged" ? 1 : "",
  })}`), [model, list, dq]);
  // Auto-select the first transaction so the page is immediately populated
  useEffect(() => {
    if (!txId && picks.data?.items.length) setParams({ tx: String(picks.data.items[0].id) }, { replace: true });
  }, [txId, picks.data, setParams]);

  const top = glob.data?.features.slice(0, 15) ?? [];
  const swarm = useMemo(() => {
    const feats = glob.data?.features.slice(0, 10) ?? [];
    return feats.flatMap((f, fi) => f.points.map((p, j) => ({ x: p.shap, y: feats.length - fi + ((j * 37) % 100 - 50) / 220, v: p.value_norm, feature: f.feature })));
  }, [glob.data]);
  const featNames = glob.data?.features.slice(0, 10).map((f) => f.feature) ?? [];

  return (
    <div>
      <PageHeader index="06" kicker="Explainable AI Studio" title="Why the model" accent="decided.">
        <Segmented value={model} onChange={setModel} options={MODELS.map((m) => ({ value: m, label: MODEL_LABELS[m] }))} />
      </PageHeader>


      {glob.error ? <ErrorState message={glob.error} onRetry={glob.reload} /> : !glob.data ? <Loading /> : (
        <div className="grid gap-5 xl:grid-cols-12">
          <Panel className="xl:col-span-5">
            <PanelHead kicker="Global feature importance" title="Mean |SHAP| — top 15">
              {glob.data.plot_url && <button className="btn-ghost px-2.5 py-1 text-[12px]" onClick={() => setShowPlot((s) => !s)}><ImageIcon size={13} />{showPlot ? "Interactive" : "SHAP plot"}</button>}
            </PanelHead>
            {showPlot && glob.data.plot_url ? (
              <div className="p-4"><img src={`${API_BASE}${glob.data.plot_url}`} alt={`SHAP summary plot for ${glob.data.model_label}`} className="w-full rounded bg-white" /></div>
            ) : (
              <div className="h-[460px] p-4">
                <ResponsiveContainer>
                  <BarChart data={top} layout="vertical" margin={{ left: 0, right: 16 }}>
                    <CartesianGrid horizontal={false} />
                    <XAxis type="number" tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="feature" width={56} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTip fmt={(v) => v.toFixed(4)} />} />
                    <Bar dataKey="mean_abs_shap" name="mean |SHAP|" radius={[0, 3, 3, 0]} animationDuration={1000}>
                      {top.map((f, i) => <Cell key={f.feature} fill={i < 3 ? c.primary : c.secondary} fillOpacity={1 - i * 0.04} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <p className="border-t border-line/[0.08] px-5 py-3 text-[11.5px] text-ink-3">Computed on {glob.data.sample_description}. Units: {glob.data.output_units}.</p>
          </Panel>

          <Panel className="xl:col-span-7" delay={0.08}>
            <PanelHead kicker="SHAP summary (beeswarm)" title="Contribution vs feature value — top 10">
              <span className="flex items-center gap-2 font-mono text-[10px] text-ink-3">low<span className="h-1.5 w-16 rounded-full" style={{ background: `linear-gradient(90deg, ${valueColor(0)}, ${valueColor(0.5)}, ${valueColor(1)})` }} />high value</span>
            </PanelHead>
            <div className="h-[460px] p-4">
              <ResponsiveContainer>
                <ScatterChart margin={{ left: 0, right: 16 }}>
                  <CartesianGrid />
                  <XAxis type="number" dataKey="x" name="SHAP" tickLine={false} axisLine={false} />
                  <YAxis type="number" dataKey="y" domain={[0.4, featNames.length + 0.6]} ticks={featNames.map((_, i) => featNames.length - i)}
                    tickFormatter={(v) => featNames[featNames.length - v] ?? ""} width={56} tickLine={false} axisLine={false} />
                  <ZAxis range={[14, 14]} />
                  <ReferenceLine x={0} stroke={c.ink3} />
                  <Tooltip content={({ active, payload }) => active && payload?.length ? (
                    <div className="rounded border border-line/20 bg-bg-2/95 px-3 py-2 text-[12px]">
                      <div className="num">{String(payload[0].payload.feature)}</div>
                      <div className="num text-ink-2">SHAP {Number(payload[0].payload.x).toFixed(3)} · value pct {(Number(payload[0].payload.v) * 100).toFixed(0)}</div>
                    </div>) : null} />
                  <Scatter data={swarm} isAnimationActive={false}>
                    {swarm.map((p, i) => <Cell key={i} fill={valueColor(p.v)} fillOpacity={0.75} />)}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>
      )}

      {/* Local explanation */}
      <div className="mt-5 grid gap-5 xl:grid-cols-12">
        <Panel className="flex flex-col xl:col-span-4" delay={0.1}>
          <PanelHead kicker="Individual prediction" title="Choose a transaction">
            <InfoTip side="bottom" text="V1–V28 are anonymised components. TRANZIQ shows how much each contributed, never what it means." />
          </PanelHead>
          <div className="space-y-3 border-b border-line/[0.08] p-4">
            <Segmented size="sm" value={list} onChange={setList} options={[{ value: "risk", label: "Highest risk" }, { value: "flagged", label: "Latest flagged" }, { value: "recent", label: "Recent" }]} />
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
              <input className="input pl-8" placeholder="Search ID, merchant, city…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search transactions" />
            </div>
          </div>
          <div className="max-h-[440px] flex-1 overflow-y-auto">
            {!picks.data ? <Loading className="h-32" /> : picks.data.items.length === 0 ? <EmptyState title="No transactions" body="Nothing matches this search." /> : (
              <ul className="divide-y divide-line/[0.06]">
                {picks.data.items.map((t) => (
                  <li key={t.id}>
                    <button onClick={() => { setTxInput(String(t.id)); setParams({ tx: String(t.id) }); }}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${String(t.id) === txId ? "bg-primary/10" : "hover:bg-line/[0.04]"}`}>
                      <span className={`h-6 w-[3px] rounded-full ${String(t.id) === txId ? "bg-primary" : "bg-transparent"}`} />
                      <span className="min-w-0 flex-1">
                        <span className="num block truncate text-[12.5px]">{t.external_id}</span>
                        <span className="block truncate text-[11px] text-ink-3">{fmtMoney(t.amount)}{t.merchant ? ` · ${t.merchant}` : ""}</span>
                      </span>
                      {t.prediction && <RiskChip level={t.prediction.risk_level} />}
                      <span className="num w-14 text-right text-[12px]" style={{ color: t.prediction && t.prediction.probability >= 0.5 ? "rgb(var(--coral))" : undefined }}>{fmtProb(t.prediction?.probability)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <form className="flex gap-2 border-t border-line/[0.08] p-4" onSubmit={(e) => { e.preventDefault(); if (txInput) setParams({ tx: txInput }); }}>
            <input className="input num py-1.5 text-[12px]" placeholder="Look up by database ID" value={txInput} onChange={(e) => setTxInput(e.target.value.replace(/\D/g, ""))} aria-label="Transaction database ID" />
            <button className="btn-ghost px-3 py-1.5 text-[12px]" type="submit">Explain</button>
          </form>
        </Panel>

        <Panel className="xl:col-span-8" delay={0.14}>
          <PanelHead kicker="Feature contribution analysis" title={local.data ? `${local.data.transaction.external_id} · ${local.data.model_label}` : "Waterfall explanation"}>
            {local.data && <RiskChip level={local.data.risk.level} pulse />}
          </PanelHead>
          {!txId ? <EmptyState title="No transaction selected" body="Pick one on the left to see why the model scored it the way it did." /> :
            local.error ? <ErrorState message={local.error} /> : !local.data ? <Loading /> : (
              <div className="grid gap-6 p-5 lg:grid-cols-[1fr_260px]">
                <Waterfall exp={local.data} />
                <div className="space-y-4">
                  <div><div className="label">Fraud probability</div><div className="font-display text-5xl">{fmtProb(local.data.probability)}</div>
                    <div className="font-mono text-[11px] text-ink-3">threshold {local.data.threshold.toFixed(2)} → {local.data.predicted_label ? <span className="text-coral">predicted fraud</span> : <span className="text-mint">predicted legitimate</span>}</div></div>
                  <div className="num text-[12px] text-ink-2">{local.data.transaction.external_id} · amount {fmtMoney(local.data.transaction.amount)}</div>
                  <div className="flex items-center gap-2 text-[12px] text-ink-3">Known label: <LabelChip label={local.data.transaction.ground_truth} /></div>
                  <div>
                    <div className="label mb-1.5 text-coral">Pushing towards fraud</div>
                    {local.data.contributions.filter((x) => x.shap_value > 0).slice(0, 4).map((x) => <div key={x.feature} className="num flex justify-between text-[12px]"><span>{x.feature}</span><span className="text-coral">+{x.shap_value.toFixed(3)}</span></div>)}
                  </div>
                  <div>
                    <div className="label mb-1.5 text-secondary">Pushing towards legitimate</div>
                    {local.data.contributions.filter((x) => x.shap_value < 0).slice(0, 4).map((x) => <div key={x.feature} className="num flex justify-between text-[12px]"><span>{x.feature}</span><span className="text-secondary">{x.shap_value.toFixed(3)}</span></div>)}
                  </div>
                  <p className="text-[11.5px] leading-relaxed text-ink-3">{local.data.risk.explanation}</p>
                </div>
              </div>
            )}
        </Panel>
      </div>
    </div>
  );
}
