import { useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { get, qs } from "../lib/api";
import { useApp, useChartColors } from "../lib/app-context";
import { SOURCE_META, fmtDate, fmtMoney, fmtNum } from "../lib/format";
import { useApi } from "../lib/hooks";
import { MODEL_LABELS, MODELS, type ModelName, type Source } from "../lib/types";
import { ChartTip, ErrorState, Loading, PageHeader, Panel, PanelHead, Segmented, Select } from "../components/ui";

interface Trends {
  model: ModelName; model_label: string; empty: boolean; granularity: string;
  timeline: { bucket: string; total: number; predicted_fraud: number; mean_probability: number; kaggle: number; synthetic: number; user: number }[];
  probability_distribution: Record<string, number | string>[];
  amount_analysis: { bucket: string; count: number; predicted_fraud: number; flag_rate_pct: number; mean_probability: number }[];
  hourly_activity: { hour: number; count: number; predicted_fraud: number; mean_probability: number }[];
  daily_pattern: { day: string; count: number; predicted_fraud: number }[];
  source_comparison: { source: Source; count: number; mean_amount: number; median_amount: number; mean_probability: number; predicted_fraud: number; flag_rate_pct: number; high_or_critical: number }[];
}
interface Eda {
  statistics: { rows: number; class_distribution: { legitimate: number; fraudulent: number; fraud_percentage: number; imbalance_ratio: number }; amount: Record<string, number>; time_span_hours: number };
  cleaning: { rows_loaded: number; duplicate_rows_dropped: number; invalid_rows_dropped: number }; missing_values_total: number;
  amount_histogram: { bucket: string; legitimate: number; fraud: number; fraud_rate_pct: number }[];
  time_histogram: { hour: number; legitimate: number; fraud: number }[];
  feature_comparison: { feature: string; legit_mean: number; fraud_mean: number; corr_with_class: number }[];
  correlation: { columns: string[]; matrix: number[][] };
}

function Heatmap({ eda }: { eda: Eda }) {
  const [hover, setHover] = useState<string | null>(null);
  const cols = eda.correlation.columns;
  const color = (v: number) => (v >= 0 ? `rgb(var(--coral) / ${Math.min(1, Math.abs(v)) * 0.95})` : `rgb(var(--cyan) / ${Math.min(1, Math.abs(v)) * 0.95})`);
  return (
    <div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[560px] gap-px" style={{ gridTemplateColumns: `44px repeat(${cols.length}, minmax(0, 1fr))` }}>
          <span />
          {cols.map((c) => <span key={c} className="truncate text-center font-mono text-[8px] text-ink-3">{c.replace("Amount", "Amt").replace("Class", "Cls")}</span>)}
          {eda.correlation.matrix.map((row, i) => (
            <div key={cols[i]} className="contents">
              <span className="pr-1 text-right font-mono text-[8.5px] leading-[14px] text-ink-3">{cols[i]}</span>
              {row.map((v, j) => (
                <span key={j} className="aspect-square min-h-[12px] cursor-crosshair rounded-[1px] transition-transform hover:scale-150"
                  style={{ background: color(v) }} onMouseEnter={() => setHover(`${cols[i]} × ${cols[j]} = ${v.toFixed(3)}`)} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between font-mono text-[11px] text-ink-3">
        <span className="text-ink-2">{hover ?? "Hover a cell"}</span>
        <span className="flex items-center gap-2">−1<span className="h-1.5 w-24 rounded-full" style={{ background: "linear-gradient(90deg, rgb(var(--cyan)), transparent, rgb(var(--coral)))" }} />+1</span>
      </div>
      <p className="mt-2 text-[11.5px] text-ink-3">V1–V28 are PCA components, so they are uncorrelated with each other by construction — the informative row is <b>Class</b>.</p>
    </div>
  );
}

export default function Analytics() {
  const c = useChartColors();
  const { dataVersion, settings } = useApp();
  const [gran, setGran] = useState<"day" | "hour">("day");
  const [source, setSource] = useState<Source | "">("");
  const [model, setModel] = useState<ModelName | "">("");
  const t = useApi(() => get<Trends>(`/api/analytics/trends${qs({ granularity: gran, source, model })}`), [gran, source, model, dataVersion, settings?.active_model]);
  const eda = useApi(() => get<Eda>("/api/dataset/eda"), []);
  const corr = useMemo(() => eda.data?.feature_comparison.slice().sort((a, b) => Math.abs(b.corr_with_class) - Math.abs(a.corr_with_class)).slice(0, 14) ?? [], [eda.data]);
  const tick = (v: string) => (gran === "hour" ? fmtDate(v) : fmtDate(v, false).slice(0, 6));

  return (
    <div>
      <PageHeader index="09" kicker="Fraud Trends & Analytics" title="Patterns over" accent="time."
        intro="Live trends use the selected model's latest prediction for every stored transaction. The second half profiles the real Kaggle dataset itself.">
        <Segmented size="sm" value={gran} onChange={setGran} options={[{ value: "day", label: "Daily" }, { value: "hour", label: "Hourly" }]} />
        <Select value={source} onChange={setSource} className="w-36" options={[{ value: "", label: "All sources" }, { value: "kaggle", label: "Real (Kaggle)" }, { value: "synthetic", label: "Synthetic" }, { value: "user", label: "User" }]} />
        <Select value={model} onChange={setModel} className="w-44" options={[{ value: "", label: "Active model" }, ...MODELS.map((m) => ({ value: m, label: MODEL_LABELS[m] }))]} />
      </PageHeader>

      {t.error ? <ErrorState message={t.error} onRetry={t.reload} /> : !t.data ? <Loading /> : t.data.empty ? <ErrorState message="No transactions for this selection." /> : (
        <>
          <div className="grid gap-5 xl:grid-cols-12">
            <Panel className="xl:col-span-8">
              <PanelHead kicker="Transaction volume over time" title="Volume by data source" />
              <div className="h-[290px] p-4">
                <ResponsiveContainer>
                  <AreaChart data={t.data.timeline} margin={{ left: -14, right: 6 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="bucket" tickFormatter={tick} tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTip labelFmt={(l) => fmtDate(String(l))} />} />
                    <Legend />
                    {(["kaggle", "synthetic", "user"] as Source[]).map((s) => (
                      <Area key={s} type="monotone" stackId="1" dataKey={s} name={SOURCE_META[s].label} stroke={c.source[s]} fill={c.source[s]} fillOpacity={0.25} strokeWidth={1.5} />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel className="xl:col-span-4" delay={0.05}>
              <PanelHead kicker="Real vs synthetic" title="Source comparison" />
              <div className="divide-y divide-line/[0.07] px-5">
                {t.data.source_comparison.map((s) => (
                  <div key={s.source} className="py-3.5">
                    <div className="flex items-center justify-between"><span className="text-[13px] font-semibold" style={{ color: c.source[s.source] }}>{SOURCE_META[s.source].label}</span><span className="num text-[12px] text-ink-3">{s.count.toLocaleString()} txns</span></div>
                    <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-[11.5px]">
                      <div><div className="label">mean amt</div>{fmtMoney(s.mean_amount)}</div>
                      <div><div className="label">mean prob</div>{(s.mean_probability * 100).toFixed(2)}%</div>
                      <div><div className="label">flag rate</div><span className="text-coral">{s.flag_rate_pct}%</span></div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="px-5 pb-4 text-[11px] text-ink-3">Kaggle rows in the demo DB deliberately over-sample fraud (all test-set frauds are included), so their flag rate is higher than the real 0.17%.</p>
            </Panel>
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-12">
            <Panel className="xl:col-span-6" delay={0.08}>
              <PanelHead kicker="Predicted fraud trend" title="Flagged transactions & mean probability" />
              <div className="h-[270px] p-4">
                <ResponsiveContainer>
                  <ComposedChart data={t.data.timeline} margin={{ left: -14, right: 0 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="bucket" tickFormatter={tick} tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis yAxisId="a" tickLine={false} axisLine={false} allowDecimals={false} />
                    <YAxis yAxisId="b" orientation="right" tickLine={false} axisLine={false} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                    <Tooltip content={<ChartTip fmt={(v, n) => (n === "Mean probability" ? `${(v * 100).toFixed(2)}%` : v.toLocaleString())} labelFmt={(l) => fmtDate(String(l))} />} />
                    <Legend />
                    <Bar yAxisId="a" dataKey="predicted_fraud" name="Predicted fraud" fill={c.coral} radius={[2, 2, 0, 0]} />
                    <Line yAxisId="b" dataKey="mean_probability" name="Mean probability" stroke={c.violet} dot={false} strokeWidth={2} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel className="xl:col-span-6" delay={0.1}>
              <PanelHead kicker="Fraud probability distribution" title="Stored predictions by probability (log scale)" />
              <div className="h-[270px] p-4">
                <ResponsiveContainer>
                  <BarChart data={t.data.probability_distribution} margin={{ left: -14 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="bin" tickLine={false} axisLine={false} />
                    <YAxis scale="log" domain={[0.8, "auto"]} allowDataOverflow tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTip labelFmt={(l) => `probability ≥ ${l}`} />} />
                    <Legend />
                    {(["kaggle", "synthetic", "user"] as Source[]).filter((s) => t.data!.probability_distribution.some((r) => s in r)).map((s) => (
                      <Bar key={s} dataKey={s} name={SOURCE_META[s].label} stackId="p" fill={c.source[s]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-12">
            <Panel className="xl:col-span-5" delay={0.12}>
              <PanelHead kicker="Transaction amount analysis" title="Volume & flag rate by amount" />
              <div className="h-[270px] p-4">
                <ResponsiveContainer>
                  <ComposedChart data={t.data.amount_analysis} margin={{ left: -14, right: 0 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="bucket" tickLine={false} axisLine={false} />
                    <YAxis yAxisId="a" tickLine={false} axisLine={false} />
                    <YAxis yAxisId="b" orientation="right" tickLine={false} axisLine={false} unit="%" />
                    <Tooltip content={<ChartTip />} />
                    <Bar yAxisId="a" dataKey="count" name="Transactions" fill={c.cyan} fillOpacity={0.7} radius={[2, 2, 0, 0]} />
                    <Line yAxisId="b" dataKey="flag_rate_pct" name="Flag rate %" stroke={c.coral} strokeWidth={2} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel className="xl:col-span-4" delay={0.14}>
              <PanelHead kicker="Hourly activity" title="24-hour pattern" />
              <div className="h-[270px] p-2">
                <ResponsiveContainer>
                  <RadarChart data={t.data.hourly_activity.map((h) => ({ ...h, label: `${h.hour}h` }))} outerRadius="75%">
                    <PolarGrid stroke={c.grid} />
                    <PolarAngleAxis dataKey="label" tick={{ fontSize: 9, fill: c.ink3 }} />
                    <Radar dataKey="count" name="Transactions" stroke={c.cyan} fill={c.cyan} fillOpacity={0.2} />
                    <Radar dataKey="predicted_fraud" name="Predicted fraud" stroke={c.coral} fill={c.coral} fillOpacity={0.35} />
                    <Tooltip content={<ChartTip />} />
                    <Legend />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel className="xl:col-span-3" delay={0.16}>
              <PanelHead kicker="Daily patterns" title="Day of week" />
              <div className="h-[270px] p-4">
                <ResponsiveContainer>
                  <BarChart data={t.data.daily_pattern} margin={{ left: -20 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="day" tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTip />} />
                    <Bar dataKey="count" name="Transactions" fill={c.violet} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="predicted_fraud" name="Predicted fraud" fill={c.coral} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>
        </>
      )}

      {/* EDA on the real dataset */}
      <div className="mb-6 mt-14 flex items-center gap-4">
        <h2 className="font-display text-4xl">Dataset <em className="grad-text">anatomy</em></h2>
        <span className="h-px flex-1 bg-line/15" />
        <span className="kicker">Exploratory analysis · real Kaggle data</span>
      </div>
      {eda.error ? <ErrorState message={eda.error} /> : !eda.data ? <Loading /> : (
        <>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {[
              ["Rows after cleaning", eda.data.statistics.rows.toLocaleString(), `${eda.data.cleaning.duplicate_rows_dropped.toLocaleString()} duplicates removed`],
              ["Fraudulent", eda.data.statistics.class_distribution.fraudulent.toLocaleString(), `${eda.data.statistics.class_distribution.fraud_percentage.toFixed(3)}% of all rows`],
              ["Imbalance ratio", `${eda.data.statistics.class_distribution.imbalance_ratio} : 1`, "legitimate per fraud"],
              ["Missing values", eda.data.missing_values_total.toLocaleString(), `${eda.data.statistics.time_span_hours} hours of transactions`],
            ].map(([k, v, s], i) => (
              <Panel key={k} className="p-5" delay={i * 0.04}>
                <div className="label">{k}</div><div className="mt-1 font-display text-[40px] leading-none">{v}</div><div className="mt-1 text-[12px] text-ink-3">{s}</div>
              </Panel>
            ))}
          </div>
          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            <Panel>
              <PanelHead kicker="Amount distribution" title="Rows per amount bucket (log) & fraud rate" />
              <div className="h-[270px] p-4">
                <ResponsiveContainer>
                  <ComposedChart data={eda.data.amount_histogram} margin={{ left: -6 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="bucket" tickLine={false} axisLine={false} />
                    <YAxis yAxisId="a" scale="log" domain={[1, "auto"]} allowDataOverflow tickLine={false} axisLine={false} />
                    <YAxis yAxisId="b" orientation="right" unit="%" tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTip />} />
                    <Legend />
                    <Bar yAxisId="a" dataKey="legitimate" name="Legitimate" fill={c.cyan} fillOpacity={0.7} />
                    <Bar yAxisId="a" dataKey="fraud" name="Fraud" fill={c.coral} />
                    <Line yAxisId="b" dataKey="fraud_rate_pct" name="Fraud rate %" stroke={c.violet} strokeWidth={2} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel delay={0.05}>
              <PanelHead kicker="Time distribution" title="Transactions per hour since first record (48h)" />
              <div className="h-[270px] p-4">
                <ResponsiveContainer>
                  <ComposedChart data={eda.data.time_histogram} margin={{ left: -6 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="hour" tickLine={false} axisLine={false} />
                    <YAxis yAxisId="a" tickLine={false} axisLine={false} />
                    <YAxis yAxisId="b" orientation="right" tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTip labelFmt={(l) => `hour ${l}`} />} />
                    <Legend />
                    <Area yAxisId="a" dataKey="legitimate" name="Legitimate" stroke={c.cyan} fill={c.cyan} fillOpacity={0.2} />
                    <Line yAxisId="b" dataKey="fraud" name="Fraud (right axis)" stroke={c.coral} strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel delay={0.08}>
              <PanelHead kicker="Fraud vs legitimate comparison" title="Strongest correlation with Class" />
              <div className="h-[380px] p-4">
                <ResponsiveContainer>
                  <BarChart data={corr} layout="vertical" margin={{ left: 0, right: 16 }}>
                    <CartesianGrid horizontal={false} />
                    <XAxis type="number" domain={[-0.4, 0.2]} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="feature" width={52} tickLine={false} axisLine={false} />
                    <Tooltip content={({ active, payload }) => active && payload?.length ? (
                      <div className="rounded border border-line/20 bg-bg-2/95 px-3 py-2 font-mono text-[11.5px]">
                        <div>{String(payload[0].payload.feature)} · corr {fmtNum(Number(payload[0].payload.corr_with_class), 3)}</div>
                        <div className="text-ink-3">mean legit {fmtNum(Number(payload[0].payload.legit_mean), 3)} · fraud {fmtNum(Number(payload[0].payload.fraud_mean), 3)}</div>
                      </div>) : null} />
                    <Bar dataKey="corr_with_class" name="Correlation" radius={2}>{corr.map((d) => <Cell key={d.feature} fill={d.corr_with_class < 0 ? c.cyan : c.coral} />)}</Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel delay={0.1}>
              <PanelHead kicker="Correlation heatmap" title="Pearson correlation · all 31 columns" />
              <div className="p-5"><Heatmap eda={eda.data} /></div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
