import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, Radar } from "lucide-react";
import { Link } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { get } from "../lib/api";
import { useApp, useChartColors } from "../lib/app-context";
import { RISK_META, fmtDate, fmtMoney, fmtPct, fmtTime, timeAgo } from "../lib/format";
import { useApi } from "../lib/hooks";
import { MODEL_LABELS, type Alert, type AlertSummary, type ModelInfo, type ModelName, type RiskLevel, type Tx } from "../lib/types";
import { AnimatedNumber, ChartTip, EmptyState, ErrorState, Loading, PageHeader, Panel, PanelHead, ProbBar, PulseDot, RiskChip } from "../components/ui";
import { RiskCore } from "../components/viz";

interface Summary {
  model: ModelName; model_label: string; empty: boolean; total_transactions: number; predicted_fraud: number;
  predicted_legitimate: number; fraud_prediction_rate: number; average_amount: number; total_amount: number;
  flagged_amount: number; high_risk: number; risk_distribution: Record<RiskLevel, number>; sources: Record<string, number>;
  known_label_agreement: { labelled_rows: number; tp: number; fp: number; fn: number; precision: number; recall: number } | null;
  last_24h: { hour: string; count: number; predicted_fraud: number }[];
  recent_alerts: Alert[]; alerts: AlertSummary; decision_threshold: number; recent_transactions: Tx[]; latest_ingested: Tx[];
}

export default function CommandCenter() {
  const { dataVersion, settings } = useApp();
  const c = useChartColors();
  const { data, error, loading, reload } = useApi(() => get<Summary>("/api/dashboard/summary"), [dataVersion, settings?.active_model], { interval: 20000 });
  const models = useApi(() => get<{ models: ModelInfo[] }>("/api/models"), [dataVersion]);

  if (loading && !data) return <Loading className="h-[60vh]" />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data || data.empty)
    return <EmptyState title="No transactions yet" body="Train the models and start the backend - the database is seeded automatically." />;

  const active = models.data?.models.find((m) => m.name === data.model);
  const ledger = [
    { k: "Total transactions", v: data.total_transactions, f: (n: number) => Math.round(n).toLocaleString(), tone: "ink" },
    { k: "Predicted fraudulent", v: data.predicted_fraud, f: (n: number) => Math.round(n).toLocaleString(), tone: "coral" },
    { k: "Predicted legitimate", v: data.predicted_legitimate, f: (n: number) => Math.round(n).toLocaleString(), tone: "mint" },
    { k: "High-risk (high + critical)", v: data.high_risk, f: (n: number) => Math.round(n).toLocaleString(), tone: "amber" },
    { k: "Average amount", v: data.average_amount, f: (n: number) => fmtMoney(n), tone: "ink" },
  ];

  return (
    <div>
      <PageHeader index="01" kicker="Intelligence Command Center" title="Every transaction," accent="read in real time.">
        <span className="font-mono text-[11px] text-ink-3">{data.model_label} · threshold {data.decision_threshold.toFixed(2)}</span>
        <Link to="/scanner" className="btn-primary"><Radar size={15} /> Scan a transaction</Link>
      </PageHeader>

      {/* Row 1: risk core + ledger */}
      <div className="grid gap-5 xl:grid-cols-12">
        <Panel className="overflow-hidden xl:col-span-7">
          <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
          <PanelHead kicker="Central risk intelligence · log-scaled rings" title="Risk distribution core">
            <span className="chip border-primary/30 text-primary">{MODEL_LABELS[data.model]}</span>
          </PanelHead>
          <div className="grid items-center gap-4 p-5 md:grid-cols-[1fr_220px]">
            <div className="mx-auto aspect-square w-full max-w-[360px]">
              <RiskCore distribution={data.risk_distribution} rate={data.fraud_prediction_rate} total={data.total_transactions} />
            </div>
            <div className="space-y-4">
              {(["critical", "high", "medium", "low"] as RiskLevel[]).map((l, i) => (
                <motion.div key={l} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.08 }}>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-[12.5px] text-ink-2">
                      <PulseDot color={RISK_META[l].color} pulse={l === "critical"} size={7} />{RISK_META[l].label}
                    </span>
                    <span className="num text-[14px]">{data.risk_distribution[l].toLocaleString()}</span>
                  </div>
                  <div className="mt-1.5 h-[3px] rounded-full bg-line/10">
                    <motion.div className="h-full rounded-full" style={{ background: RISK_META[l].color }}
                      initial={{ width: 0 }} animate={{ width: `${Math.max(1, (data.risk_distribution[l] / data.total_transactions) * 100)}%` }}
                      transition={{ duration: 1, delay: 0.4 + i * 0.1 }} />
                  </div>
                </motion.div>
              ))}
              <Link to="/risk" className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-primary hover:underline">
                Configure risk bands <ArrowUpRight size={12} />
              </Link>
            </div>
          </div>
        </Panel>

        <Panel className="xl:col-span-5" delay={0.08}>
          <PanelHead kicker="Monitoring ledger" title="System totals" />
          <div className="divide-y divide-line/[0.08] px-5">
            {ledger.map((r, i) => (
              <motion.div key={r.k} className="flex items-baseline justify-between gap-4 py-3.5"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 + i * 0.07 }}>
                <span className="text-[13px] text-ink-2">{r.k}</span>
                <AnimatedNumber value={r.v} format={r.f} className="font-display text-[34px] leading-none" />
              </motion.div>
            ))}
            <div className="grid grid-cols-2 gap-4 py-4">
              <div>
                <div className="label">Fraud prediction rate</div>
                <div className="num mt-1 text-[18px] text-coral">{fmtPct(data.fraud_prediction_rate, 2)}</div>
              </div>
              <div>
                <div className="label">Flagged amount</div>
                <div className="num mt-1 text-[18px]">{fmtMoney(data.flagged_amount)}</div>
              </div>
            </div>
          </div>
        </Panel>
      </div>

      {/* Row 2: activity timeline + alerts */}
      <div className="mt-5 grid gap-5 xl:grid-cols-12">
        <Panel className="xl:col-span-8" delay={0.12}>
          <PanelHead kicker="Transaction activity timeline" title="Last 24 hours of monitored activity">
            <span className="flex items-center gap-3 font-mono text-[10.5px] text-ink-3">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-secondary" />volume</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-coral" />predicted fraud</span>
            </span>
          </PanelHead>
          <div className="h-[340px] p-3 pr-5">
            <ResponsiveContainer>
              <AreaChart data={data.last_24h} margin={{ top: 10, left: -10, right: 0 }}>
                <defs>
                  <linearGradient id="vol" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={c.secondary} stopOpacity={0.35} /><stop offset="1" stopColor={c.secondary} stopOpacity={0} /></linearGradient>
                  <linearGradient id="frd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={c.coral} stopOpacity={0.5} /><stop offset="1" stopColor={c.coral} stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="hour" tickFormatter={(h) => fmtTime(h).slice(0, 5)} tickLine={false} axisLine={false} minTickGap={30} />
                <YAxis yAxisId="v" tickLine={false} axisLine={false} width={40} />
                <YAxis yAxisId="f" orientation="right" tickLine={false} axisLine={false} width={30} allowDecimals={false} />
                <Tooltip content={<ChartTip labelFmt={(l) => fmtDate(String(l))} />} />
                <Area yAxisId="v" type="monotone" dataKey="count" name="Transactions" stroke={c.secondary} fill="url(#vol)" strokeWidth={1.6} animationDuration={1200} />
                <Area yAxisId="f" type="monotone" dataKey="predicted_fraud" name="Predicted fraud" stroke={c.coral} fill="url(#frd)" strokeWidth={1.6} animationDuration={1400} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel className="flex flex-col xl:col-span-4" delay={0.16}>
          <PanelHead kicker="Recent alerts" title={`${data.alerts.by_status.pending} pending investigation`}>
            <Link to="/alerts" className="btn-ghost px-2.5 py-1 text-[12px]">Open <ArrowUpRight size={12} /></Link>
          </PanelHead>
          <div className="flex-1 divide-y divide-line/[0.07]">
            {data.recent_alerts.length === 0 && <EmptyState title="No alerts" body="Nothing has crossed the alert rule yet." />}
            {data.recent_alerts.map((a, i) => (
              <motion.div key={a.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + i * 0.05 }}>
                <Link to={`/alerts?focus=${a.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-line/[0.04]">
                  <PulseDot color={RISK_META[a.severity].color} pulse={a.status === "pending" && a.severity === "critical"} size={8} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="num truncate text-[12.5px]">{a.transaction.external_id}</span>
                    </div>
                    <div className="mt-0.5 font-mono text-[10.5px] text-ink-3">{a.status} · {timeAgo(a.created_at)}</div>
                  </div>
                  <div className="text-right">
                    <div className="num text-[13px] text-coral">{(a.prediction.probability * 100).toFixed(1)}%</div>
                    <div className="num text-[10.5px] text-ink-3">{fmtMoney(a.transaction.amount)}</div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        </Panel>
      </div>

      {/* Row 3: live stream + model performance */}
      <div className="mt-5 grid gap-5 xl:grid-cols-12">
        <Panel className="xl:col-span-7" delay={0.2}>
          <PanelHead kicker="Animated monitoring stream" title="Latest scored transactions">
            <Link to="/transactions" className="btn-ghost px-2.5 py-1 text-[12px]">Explorer <ArrowUpRight size={12} /></Link>
          </PanelHead>
          <div className="relative overflow-x-auto">
            <span className="pointer-events-none absolute inset-x-0 top-0 h-full animate-scan bg-gradient-to-b from-transparent via-primary/[0.04] to-transparent" />
            <table className="w-full">
              <thead className="table-head"><tr><th>Transaction</th><th className="text-right">Amount</th><th>Fraud prob.</th><th>Risk</th></tr></thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {data.latest_ingested.map((t, i) => (
                    <motion.tr key={t.id} layout className="table-row border-t border-line/[0.06]"
                      initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}>
                      <td className="num text-ink-2">{t.external_id}</td>
                      <td className="num text-right">{fmtMoney(t.amount)}</td>
                      <td>{t.prediction && <ProbBar p={t.prediction.probability} threshold={t.prediction.threshold} />}</td>
                      <td>{t.prediction && <RiskChip level={t.prediction.risk_level} pulse />}</td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel className="xl:col-span-5" delay={0.24}>
          <PanelHead kicker="Interactive model performance" title={`${data.model_label} · held-out test split`}>
            <Link to="/models" className="btn-ghost px-2.5 py-1 text-[12px]">Model Lab <ArrowUpRight size={12} /></Link>
          </PanelHead>
          <div className="space-y-4 p-5">
            {active ? (
              (["pr_auc", "precision", "recall", "f1"] as const).map((k, i) => (
                <div key={k} className="group">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[12.5px] text-ink-2">{{ pr_auc: "PR-AUC", precision: "Precision", recall: "Recall", f1: "F1-score" }[k]}</span>
                    <span className="num text-[15px]">{active.test_summary[k].toFixed(3)}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line/10">
                    <motion.div className="h-full rounded-full bg-gradient-to-r from-primary to-secondary" initial={{ width: 0 }}
                      animate={{ width: `${active.test_summary[k] * 100}%` }} transition={{ duration: 1, delay: 0.3 + i * 0.1 }} />
                  </div>
                </div>
              ))
            ) : <Loading className="h-32" />}
            {data.known_label_agreement && (
              <div className="rounded border border-line/[0.1] bg-bg/40 p-3.5">
                <div className="label mb-2">Live check on stored real records with known labels</div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div><div className="num text-[17px] text-secondary">{data.known_label_agreement.tp}</div><div className="label">caught</div></div>
                  <div><div className="num text-[17px] text-coral">{data.known_label_agreement.fn}</div><div className="label">missed</div></div>
                  <div><div className="num text-[17px] text-amber">{data.known_label_agreement.fp}</div><div className="label">false alarms</div></div>
                </div>
                <p className="mt-2.5 text-[11.5px] leading-snug text-ink-3">
                  On {data.known_label_agreement.labelled_rows.toLocaleString()} stored historical records with verified labels (fraud is
                  intentionally over-represented in this demo sample). Records without a verified label are excluded.
                </p>
              </div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
