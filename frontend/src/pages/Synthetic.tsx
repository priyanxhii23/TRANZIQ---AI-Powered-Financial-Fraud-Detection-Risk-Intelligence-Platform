import { AnimatePresence, motion } from "framer-motion";
import { Download, FlaskConical, Loader2, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { del, downloadText, get, post } from "../lib/api";
import { useApp, useChartColors } from "../lib/app-context";
import { RISK_META, fmtDate, fmtMoney } from "../lib/format";
import { useApi } from "../lib/hooks";
import { MODEL_LABELS, RISK_LEVELS, type ModelName, type RiskLevel } from "../lib/types";
import { ChartTip, Confirm, EmptyState, Field, PageHeader, Pagination, Panel, PanelHead, ProbBar, RiskChip, Toggle } from "../components/ui";

interface GenItem { id: number | null; external_id: string; event_time: string; amount: number; customer_id: string; merchant: string; city: string; country: string;
  channel: string; device: string; status: string; generation_profile: string; probability: number; predicted_label: number; risk_level: RiskLevel }
interface GenResult { disclaimer: string; model: ModelName; persisted: boolean; count: number; predicted_fraud: number; alerts_created: number; risk_levels: Record<RiskLevel, number>; items: GenItem[] }

const COUNTS = [10, 50, 100, 500, 1000];

export default function Synthetic() {
  const c = useChartColors();
  const { notify, bumpData, dataVersion } = useApp();
  const stats = useApi(() => get<{ synthetic_transactions: number; last_generated: string | null; disclaimer: string }>("/api/synthetic/stats"), [dataVersion]);
  const [count, setCount] = useState(100);
  const [ratio, setRatio] = useState(0.05);
  const [noise, setNoise] = useState(0.15);
  const [days, setDays] = useState(14);
  const [seed, setSeed] = useState("");
  const [persist, setPersist] = useState(true);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<GenResult | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [page, setPage] = useState(1);

  const generate = async () => {
    setBusy(true);
    try {
      const r = await post<GenResult>("/api/synthetic/generate", { count, fraud_profile_ratio: ratio, noise_level: noise, days_back: days, seed: seed ? Number(seed) : null, persist });
      setRes(r); setPage(1);
      if (persist) { bumpData(); stats.reload(); }
      notify({ tone: "info", title: `Generated ${r.count} synthetic transactions`, body: `${r.predicted_fraud} predicted fraudulent by ${MODEL_LABELS[r.model]}${persist ? `, ${r.alerts_created} alerts raised` : " (not saved)"}.` });
    } catch (e) { notify({ tone: "danger", title: "Generation failed", body: String(e) }); }
    finally { setBusy(false); }
  };
  const reset = async () => {
    setConfirm(false);
    try {
      const r = await del<{ deleted_transactions: number; deleted_alerts: number }>("/api/synthetic");
      notify({ tone: "success", title: "Synthetic dataset reset", body: `Removed ${r.deleted_transactions} transactions and ${r.deleted_alerts} alerts. Real Kaggle data untouched.` });
      setRes(null); bumpData(); stats.reload();
    } catch (e) { notify({ tone: "danger", title: "Reset failed", body: String(e) }); }
  };
  const exportBatch = () => {
    if (!res) return;
    const cols = ["external_id", "event_time", "amount", "customer_id", "merchant", "city", "country", "channel", "device", "status", "generation_profile", "probability", "predicted_label", "risk_level"] as const;
    downloadText("tranziq_synthetic_batch.csv", [["data_source", ...cols].join(","), ...res.items.map((i) => ["SYNTHETIC", ...cols.map((k) => JSON.stringify(i[k] ?? ""))].join(","))].join("\n"));
  };

  const pageSize = 12;
  const items = res?.items.slice((page - 1) * pageSize, page * pageSize) ?? [];

  return (
    <div>
      <PageHeader index="07" kicker="Synthetic Transaction Generator" title="Simulate the" accent="stream."
        intro="Generate demonstration transactions and push them through the prediction pipeline. Features are perturbations of real training records; merchant, location and device metadata are randomly generated and never used by the models.">
        <button className="btn-danger" onClick={() => setConfirm(true)} disabled={!stats.data?.synthetic_transactions}><Trash2 size={14} />Reset synthetic data</button>
      </PageHeader>

      <div className="mb-5 flex items-center gap-3 rounded border border-violet/30 bg-violet/[0.07] px-4 py-3 text-[12.5px] text-ink-2">
        <span className="chip border-violet/40 text-violet">SYNTHETIC</span>
        Generated records have <span className="font-semibold text-ink">no ground-truth label</span>. A high score means the model finds the pattern suspicious — not that a real fraud occurred.
      </div>

      <div className="grid gap-5 xl:grid-cols-12">
        <Panel className="xl:col-span-4">
          <PanelHead kicker="Generation settings" title="Batch configuration" />
          <div className="space-y-5 p-5">
            <Field label="Volume">
              <div className="grid grid-cols-5 gap-1.5">
                {COUNTS.map((n) => (
                  <motion.button key={n} whileTap={{ scale: 0.94 }} onClick={() => setCount(n)}
                    className={`rounded border py-2 font-mono text-[12.5px] transition-colors ${count === n ? "border-violet/60 bg-violet/15 text-ink" : "border-line/[0.14] text-ink-3 hover:text-ink-2"}`}>{n.toLocaleString()}</motion.button>
                ))}
              </div>
            </Field>
            <Field label="Fraud-pattern seed share" hint={<span className="num">{(ratio * 100).toFixed(0)}%</span>}>
              <input type="range" className="range" min={0} max={0.5} step={0.01} value={ratio} onChange={(e) => setRatio(Number(e.target.value))} />
              <p className="mt-1.5 text-[11px] text-ink-3">How often a fraud-labelled training record is used as the perturbation seed.</p>
            </Field>
            <Field label="Perturbation noise" hint={<span className="num">{noise.toFixed(2)} × σ</span>}>
              <input type="range" className="range" min={0} max={0.6} step={0.01} value={noise} onChange={(e) => setNoise(Number(e.target.value))} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Spread over (days)"><input className="input num" type="number" min={1} max={90} value={days} onChange={(e) => setDays(Math.min(90, Math.max(1, Number(e.target.value) || 1)))} /></Field>
              <Field label="Random seed"><input className="input num" placeholder="random" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))} /></Field>
            </div>
            <Toggle checked={persist} onChange={setPersist} label="Save generated records to the database" />
            <motion.button whileTap={{ scale: 0.97 }} className="btn-primary w-full py-2.5" onClick={generate} disabled={busy}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Generate & score {count.toLocaleString()}
            </motion.button>
            <div className="grid grid-cols-2 gap-3 border-t border-line/[0.08] pt-4">
              <div><div className="label">Synthetic in DB</div><div className="font-display text-3xl">{stats.data?.synthetic_transactions.toLocaleString() ?? "—"}</div></div>
              <div><div className="label">Last generated</div><div className="num mt-2 text-[12px] text-ink-2">{fmtDate(stats.data?.last_generated)}</div></div>
            </div>
          </div>
        </Panel>

        <Panel className="xl:col-span-8" delay={0.08}>
          <PanelHead kicker="Pipeline output" title={res ? `${res.count.toLocaleString()} records scored by ${MODEL_LABELS[res.model]}` : "Generated batch"}>
            {res && <button className="btn-ghost px-2.5 py-1 text-[12px]" onClick={exportBatch}><Download size={13} />Save batch CSV</button>}
            {res?.persisted && <Link to="/transactions?source=synthetic" className="btn-ghost px-2.5 py-1 text-[12px]">Explorer</Link>}
          </PanelHead>
          {!res ? <EmptyState title="Nothing generated yet" body="Configure a batch on the left. Saved records appear in every dashboard, labelled SYNTHETIC." /> : (
            <div>
              <div className="grid gap-4 border-b border-line/[0.08] p-5 md:grid-cols-[1fr_1.4fr]">
                <div className="grid grid-cols-3 gap-3">
                  <div><div className="label">Flagged</div><div className="font-display text-4xl text-coral">{res.predicted_fraud}</div></div>
                  <div><div className="label">Alerts</div><div className="font-display text-4xl">{res.alerts_created}</div></div>
                  <div><div className="label">Saved</div><div className="mt-2 text-[13px]">{res.persisted ? "yes" : "preview only"}</div></div>
                </div>
                <div className="h-[110px]">
                  <ResponsiveContainer>
                    <BarChart data={RISK_LEVELS.map((l) => ({ l: RISK_META[l].label, n: res.risk_levels[l], k: l }))}>
                      <XAxis dataKey="l" tickLine={false} axisLine={false} /><YAxis hide />
                      <Tooltip content={<ChartTip />} />
                      <Bar dataKey="n" name="Records" radius={[3, 3, 0, 0]}>{RISK_LEVELS.map((l) => <Cell key={l} fill={c.risk[l]} />)}</Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px]">
                  <thead className="table-head"><tr><th>ID</th><th>Time</th><th>Merchant</th><th>Location</th><th>Channel</th><th className="text-right">Amount</th><th>Seed profile</th><th>Fraud prob.</th><th>Risk</th></tr></thead>
                  <tbody>
                    <AnimatePresence initial={false}>
                      {items.map((i, k) => (
                        <motion.tr key={i.external_id} className="table-row border-t border-line/[0.06]" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: k * 0.025 }}>
                          <td className="num text-ink-2">{i.external_id}</td>
                          <td className="num text-ink-3">{fmtDate(i.event_time)}</td>
                          <td className="max-w-[160px] truncate">{i.merchant}</td>
                          <td className="text-ink-2">{i.city}, <span className="text-ink-3">{i.country}</span></td>
                          <td className="text-ink-3">{i.channel}</td>
                          <td className="num text-right">{fmtMoney(i.amount)}</td>
                          <td className="font-mono text-[11px] text-ink-3"><FlaskConical size={11} className="mr-1 inline text-violet" />{i.generation_profile.replace(" seed", "")}</td>
                          <td><ProbBar p={i.probability} /></td>
                          <td><RiskChip level={i.risk_level} /></td>
                        </motion.tr>
                      ))}
                    </AnimatePresence>
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pages={Math.max(1, Math.ceil(res.items.length / pageSize))} total={res.items.length} onPage={setPage} />
            </div>
          )}
        </Panel>
      </div>
      <Confirm open={confirm} danger title="Reset synthetic data?" confirmLabel="Delete synthetic records" onCancel={() => setConfirm(false)} onConfirm={reset}
        body={<>This permanently deletes all <b>{stats.data?.synthetic_transactions.toLocaleString()}</b> synthetic transactions plus their predictions and alerts. Real Kaggle records and user submissions are not affected.</>} />
    </div>
  );
}
