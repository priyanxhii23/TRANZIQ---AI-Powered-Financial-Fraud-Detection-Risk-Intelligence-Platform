import { motion } from "framer-motion";
import { ArrowUpRight, Loader2, RefreshCcw, Save, ShieldAlert, ShieldCheck, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { get, post, put } from "../lib/api";
import { useApp } from "../lib/app-context";
import { RISK_META } from "../lib/format";
import { useApi } from "../lib/hooks";
import { MODEL_LABELS, MODELS, RISK_LEVELS, type ModelName, type RiskLevel, type Settings } from "../lib/types";
import { Confirm, Field, InfoTip, Loading, PageHeader, Panel, PanelHead, PulseDot, RiskChip, Segmented } from "../components/ui";
import { RiskMeter } from "../components/viz";

type Bands = Settings["risk_bands"];
interface Levels { model: string; bands: Bands; decision_threshold: number; levels: { level: RiskLevel; count: number }[] }
interface Reapply { updated_predictions: number; updated_alert_severities: number; total_predictions: number;
  distribution_before: Record<RiskLevel, number>; distribution_after: Record<RiskLevel, number> }

/** Decision-support guidance per band. These are recommendations, never automatic approvals or rejections. */
const GUIDE: Record<RiskLevel, { meaning: string; action: string }> = {
  low: { meaning: "The model assigns a low fraud probability.", action: "Routine monitoring." },
  medium: { meaning: "The transaction has some suspicious characteristics.", action: "Monitor and review if additional signals appear." },
  high: { meaning: "The transaction has a substantially elevated fraud probability.", action: "Prioritise analyst investigation." },
  critical: { meaning: "The transaction has an exceptionally high predicted fraud probability.", action: "Immediate review under the applicable payment-control procedure." },
};

const classify = (p: number, b: Bands): RiskLevel => (p >= b.critical ? "critical" : p >= b.high ? "high" : p >= b.medium ? "medium" : "low");
const edgesOf = (b: Bands) => [0, b.medium, b.high, b.critical, 1];
const valid = (b: Bands) => 0 < b.medium && b.medium < b.high && b.high < b.critical && b.critical < 1;

/** Probability scale showing both concepts at once: coloured risk bands + the decision threshold line. */
function DualScale({ bands, threshold, p }: { bands: Bands; threshold: number; p?: number }) {
  const e = edgesOf(bands);
  return (
    <div className="relative pt-7 pb-6">
      <div className="flex h-9 overflow-hidden rounded">
        {RISK_LEVELS.map((l, i) => (
          <motion.div key={l} layout transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="flex items-center justify-center overflow-hidden font-mono text-[10px] uppercase tracking-wider"
            style={{ width: `${(e[i + 1] - e[i]) * 100}%`, background: `color-mix(in srgb, ${RISK_META[l].color} 22%, transparent)`, color: RISK_META[l].color }}>
            {e[i + 1] - e[i] > 0.09 && RISK_META[l].label}
          </motion.div>
        ))}
      </div>
      {/* decision threshold */}
      <motion.div className="absolute bottom-6 top-5 w-0.5 bg-ink" animate={{ left: `${threshold * 100}%` }} transition={{ type: "spring", stiffness: 260, damping: 30 }}>
        <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] text-ink">threshold {threshold.toFixed(2)}</span>
      </motion.div>
      {/* current probability */}
      {p != null && (
        <motion.div className="absolute bottom-0 -translate-x-1/2" animate={{ left: `${p * 100}%` }} transition={{ type: "spring", stiffness: 260, damping: 28 }}>
          <div className="mx-auto h-0 w-0 border-x-[6px] border-b-[8px] border-x-transparent border-b-primary" />
          <div className="num mt-0.5 whitespace-nowrap text-center text-[10.5px] text-primary">{(p * 100).toFixed(1)}%</div>
        </motion.div>
      )}
      <div className="absolute bottom-0 left-0 font-mono text-[10px] text-ink-3">0.00</div>
      <div className="absolute bottom-0 right-0 font-mono text-[10px] text-ink-3">1.00</div>
    </div>
  );
}

export default function RiskEngine() {
  const { settings, refreshSettings, notify, bumpData, dataVersion } = useApp();
  const levels = useApi(() => get<Levels>("/api/risk/levels"), [dataVersion, settings?.active_model]);
  const [bands, setBands] = useState<Bands | null>(null);
  const [simModel, setSimModel] = useState<ModelName | null>(null);
  const [p, setP] = useState(0.42);
  const [busy, setBusy] = useState<"save" | "apply" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [last, setLast] = useState<Reapply | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  useEffect(() => { if (settings && !bands) setBands(settings.risk_bands); }, [settings, bands]);
  useEffect(() => { if (settings && !simModel) setSimModel(settings.active_model); }, [settings, simModel]);
  useEffect(() => {
    if (settings) setOverrides(Object.fromEntries(MODELS.map((m) => [m, settings.threshold_overrides[m] != null ? String(settings.threshold_overrides[m]) : ""])));
  }, [settings]);

  if (!settings || !bands || !simModel) return <Loading className="h-[60vh]" />;
  const saved = settings.risk_bands;
  const dirty = JSON.stringify(bands) !== JSON.stringify(saved);
  const ok = valid(bands);
  const thr = settings.decision_thresholds[simModel];
  const level = classify(p, saved);
  const fraud = p >= thr;

  const setBand = (k: keyof Bands, v: number) => setBands({ ...bands, [k]: Math.round(Math.min(0.99, Math.max(0.01, v)) * 100) / 100 });

  const save = async () => {
    setBusy("save");
    try {
      await put("/api/settings", { risk_bands: bands });
      await refreshSettings();
      notify({ tone: "success", title: "Risk bands saved", body: "New predictions use them. Re-apply to update stored records." });
    } catch (e) { notify({ tone: "danger", title: "Could not save bands", body: String(e) }); }
    finally { setBusy(null); }
  };
  const reapply = async () => {
    setConfirm(false);
    setBusy("apply");
    try {
      const r = await post<Reapply>("/api/risk/reapply", { bands });
      setLast(r);
      await refreshSettings();
      bumpData();             // refreshes dashboard, alert counts, ticker
      levels.reload();        // refreshes the risk distribution cards
      notify({ tone: "success", title: `${r.updated_predictions.toLocaleString()} stored predictions re-classified`,
        body: `${r.total_predictions.toLocaleString()} checked · ${r.updated_alert_severities} alert severities updated.` });
    } catch (e) { notify({ tone: "danger", title: "Re-apply failed", body: String(e) }); }
    finally { setBusy(null); }
  };
  const saveOverrides = async () => {
    const body: Record<string, number | null> = {};
    for (const m of MODELS) {
      const v = overrides[m]?.trim();
      if (v && !(Number(v) >= 0.01 && Number(v) <= 0.99)) { notify({ tone: "warn", title: "Thresholds must be between 0.01 and 0.99" }); return; }
      body[m] = v ? Number(v) : null;
    }
    try { await put("/api/settings", { threshold_overrides: body }); await refreshSettings(); notify({ tone: "success", title: "Decision thresholds updated", body: "Applies to new predictions." }); }
    catch (e) { notify({ tone: "danger", title: "Could not save thresholds", body: String(e) }); }
  };

  return (
    <div>
      <PageHeader index="05" kicker="Transaction Risk Decision Center" title="Four levels of" accent="certainty." />

      {/* Simulator + concept explainer */}
      <div className="grid gap-5 xl:grid-cols-12">
        <Panel className="xl:col-span-7">
          <PanelHead kicker="Probability simulator" title="How would this probability be handled?">
            <Segmented size="sm" value={simModel} onChange={setSimModel} options={MODELS.map((m) => ({ value: m, label: MODEL_LABELS[m].replace("Logistic Regression", "LogReg") }))} />
          </PanelHead>
          <div className="grid items-center gap-6 p-5 md:grid-cols-[260px_1fr]">
            <RiskMeter probability={p} threshold={thr} bands={saved} level={level} size={260} />
            <dl className="divide-y divide-line/[0.08]">
              {[
                ["Fraud probability", <span key="p" className="font-display text-[34px] leading-none">{(p * 100).toFixed(1)}%</span>],
                ["Risk band", <RiskChip key="b" level={level} pulse />],
                ["Decision threshold", <span key="t" className="num">{thr.toFixed(2)} · {MODEL_LABELS[simModel]}</span>],
                ["Predicted class", <span key="c" className={`flex items-center gap-1.5 font-semibold ${fraud ? "text-coral" : "text-mint"}`}>
                  {fraud ? <ShieldAlert size={14} /> : <ShieldCheck size={14} />}{fraud ? "Predicted fraud" : "Predicted legitimate"}</span>],
                ["Recommended analyst action", <span key="a" className="text-[13px]">{GUIDE[level].action}</span>],
              ].map(([k, v]) => (
                <div key={String(k)} className="flex items-center justify-between gap-4 py-2.5"><dt className="label">{k}</dt><dd className="text-right">{v}</dd></div>
              ))}
            </dl>
          </div>
          <div className="border-t border-line/[0.1] px-5 py-4">
            <label className="label mb-2 flex items-center justify-between" htmlFor="simp"><span>Drag to simulate a fraud probability</span>
              <span className="flex gap-1">{[0.05, 0.3, 0.6, 0.9].map((v) => <button key={v} type="button" onClick={() => setP(v)} className="rounded-xs border border-line/20 px-1.5 font-mono text-[10px] normal-case hover:border-primary">{v}</button>)}</span></label>
            <input id="simp" type="range" className="range" min={0} max={1} step={0.005} value={p} onChange={(e) => setP(Number(e.target.value))} />
          </div>
        </Panel>

        <Panel className="xl:col-span-5" delay={0.06}>
          <PanelHead kicker="Two different questions" title="Risk band vs decision threshold" />
          <div className="space-y-4 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded border border-line/[0.12] p-3.5">
                <div className="label mb-1 text-primary">Risk band</div>
                <p className="text-[12.5px] leading-relaxed text-ink-2"><b className="text-ink">How high</b> is the model's estimated fraud probability? It sets how urgently an analyst should look.</p>
              </div>
              <div className="rounded border border-line/[0.12] p-3.5">
                <div className="label mb-1 text-primary">Decision threshold</div>
                <p className="text-[12.5px] leading-relaxed text-ink-2"><b className="text-ink">Does</b> the model classify the transaction as fraud or legitimate? It is chosen per model on validation data.</p>
              </div>
            </div>
            <DualScale bands={saved} threshold={thr} p={p} />
            <motion.p key={`${level}${fraud}`} initial={{ opacity: 0.4, y: 3 }} animate={{ opacity: 1, y: 0 }}
                className="rounded border border-line/[0.1] bg-bg/40 p-3.5 text-[13px] leading-relaxed text-ink-2">
                At <b className="num text-ink">{(p * 100).toFixed(1)}%</b> the transaction is <b style={{ color: RISK_META[level].color }}>{RISK_META[level].label} risk</b>{" "}
                {fraud ? "and" : "but"} {fraud ? "at or above" : "below"} the {thr.toFixed(2)} threshold, so it is classified as{" "}
                <b className={fraud ? "text-coral" : "text-mint"}>{fraud ? "predicted fraud" : "legitimate"}</b>.
                {(level === "medium" || level === "high") && !fraud && " A raised risk band does not by itself mean the model calls it fraud."}
                {fraud && level === "low" && " A low band can still be classified as fraud when the model's threshold is very low."}
              </motion.p>
          </div>
        </Panel>
      </div>

      {/* Risk distribution cards */}
      <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {RISK_LEVELS.map((l, i) => {
          const count = levels.data?.levels.find((x) => x.level === l)?.count;
          const [lo, hi] = [edgesOf(saved)[i], edgesOf(saved)[i + 1]];
          return (
            <motion.div key={l} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.06 }} whileHover={{ y: -3 }}>
              <Link to={`/transactions?risk=${l}`} className="panel group block h-full p-5 transition-colors hover:border-primary/40" aria-label={`Open ${RISK_META[l].label} risk transactions in the Explorer`}>
                <span className="absolute inset-x-0 top-0 h-[3px] rounded-t-md" style={{ background: RISK_META[l].color }} />
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: RISK_META[l].color }}>
                    <PulseDot color={RISK_META[l].color} size={7} pulse={l === "critical"} />{RISK_META[l].label} risk</span>
                  <span className="num text-[11px] text-ink-3">{lo.toFixed(2)} – {hi.toFixed(2)}</span>
                </div>
                <div className="mt-4 font-display text-5xl">{count?.toLocaleString() ?? "—"}</div>
                <div className="label mt-1">stored transactions · active model</div>
                <p className="mt-3 text-[12.5px] leading-relaxed text-ink-2">{GUIDE[l].meaning}</p>
                <p className="mt-2 text-[12.5px]"><span className="label">Suggested · </span>{GUIDE[l].action}</p>
                <span className="mt-3 inline-flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-wider text-primary opacity-70 group-hover:opacity-100">View in Explorer <ArrowUpRight size={11} /></span>
              </Link>
            </motion.div>
          );
        })}
      </div>
      <p className="mt-2 font-mono text-[10.5px] text-ink-3">Recommendations are decision support for analysts, not automatic approvals or rejections.</p>

      {/* Configuration */}
      <Panel className="mt-5" delay={0.2}>
        <PanelHead kicker="Configuration" title="Probability band editor">
          <button className="btn-ghost px-2.5 py-1 text-[12px]" onClick={() => setBands(saved)} disabled={!dirty}><Undo2 size={12} />Revert</button>
          <button className="btn-ghost px-2.5 py-1 text-[12px]" onClick={save} disabled={!dirty || !ok || busy != null}>{busy === "save" ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}Save bands</button>
          <button className="btn-primary px-3 py-1.5 text-[12px]" onClick={() => setConfirm(true)} disabled={!ok || busy != null}>
            {busy === "apply" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCcw size={13} />}{dirty ? "Save & re-apply to stored data" : "Re-apply to stored data"}</button>
        </PanelHead>
        <div className="grid gap-8 p-5 lg:grid-cols-[1fr_340px]">
          <div className="space-y-5">
            <DualScale bands={ok ? bands : saved} threshold={levels.data?.decision_threshold ?? thr} />
            {(["medium", "high", "critical"] as const).map((k) => (
              <div key={k} className="grid grid-cols-[120px_1fr_84px] items-center gap-4">
                <span className="flex items-center gap-2 text-[13px]"><RiskChip level={k} />
                  <InfoTip text={`Probabilities at or above this value are ${RISK_META[k].label} risk (until the next band starts).`} /></span>
                <input type="range" className="range" min={0.01} max={0.99} step={0.01} value={bands[k]} aria-label={`${k} band starts at`}
                  onChange={(e) => setBand(k, Number(e.target.value))} />
                <input type="number" className="input num px-2 py-1 text-right" min={0.01} max={0.99} step={0.01} value={bands[k]} aria-label={`${k} band start value`}
                  onChange={(e) => e.target.value !== "" && setBand(k, Number(e.target.value))} />
              </div>
            ))}
            {!ok && <p className="text-[12.5px] text-coral" role="alert">Bands must be ordered: Medium &lt; High &lt; Critical, all between 0.01 and 0.99.</p>}
            {dirty && ok && <p className="text-[12px] text-amber">Unsaved changes. Save them, or re-apply to save and update every stored prediction in one step.</p>}
          </div>
          <div className="rounded border border-line/[0.12] p-4">
            <div className="label mb-2">Last re-apply</div>
            {last ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3 text-[12.5px]">
                <div><span className="font-display text-3xl">{last.updated_predictions.toLocaleString()}</span> <span className="text-ink-3">of {last.total_predictions.toLocaleString()} predictions changed band</span></div>
                <table className="w-full text-[12px]"><thead className="table-head"><tr><th>Band</th><th className="text-right">Before</th><th className="text-right">After</th></tr></thead>
                  <tbody>{RISK_LEVELS.map((l) => <tr key={l} className="border-t border-line/[0.06]"><td className="py-1.5"><RiskChip level={l} /></td>
                    <td className="num text-right">{last.distribution_before[l].toLocaleString()}</td><td className="num text-right">{last.distribution_after[l].toLocaleString()}</td></tr>)}</tbody></table>
                <p className="text-ink-3">{last.updated_alert_severities} alert severities synced. Analyst statuses were not changed.</p>
              </motion.div>
            ) : <p className="text-[12.5px] text-ink-3">Re-applying updates the risk level of every stored prediction (all models) in the database, syncs alert severities, then refreshes the dashboard, alerts and these cards.</p>}
          </div>
        </div>
      </Panel>

      {/* Thresholds */}
      <Panel className="mt-5" delay={0.24}>
        <PanelHead kicker="Decision thresholds" title="Per-model override (validation-optimised default)">
          <button className="btn-primary px-3 py-1.5 text-[12px]" onClick={saveOverrides}><Save size={13} />Save thresholds</button>
        </PanelHead>
        <div className="grid gap-4 p-5 md:grid-cols-3">
          {MODELS.map((m) => (
            <div key={m} className="rounded border border-line/[0.1] p-4">
              <div className="flex items-center justify-between"><span className="font-semibold">{MODEL_LABELS[m]}</span>
                <span className="num text-[11px] text-ink-3">recommended {settings.recommended_thresholds[m].toFixed(2)}</span></div>
              <Field label="Custom threshold" className="mt-3">
                <div className="flex items-center gap-2">
                  <input className="input num" placeholder={`default ${settings.recommended_thresholds[m].toFixed(2)}`} value={overrides[m] ?? ""}
                    onChange={(e) => setOverrides((o) => ({ ...o, [m]: e.target.value }))} inputMode="decimal" />
                  <button className="btn-ghost px-2.5" onClick={() => setOverrides((o) => ({ ...o, [m]: "" }))} title="Use recommended" aria-label="Use recommended threshold"><Undo2 size={13} /></button>
                </div>
              </Field>
              <div className="mt-2 font-mono text-[11px] text-ink-3">in use: <span className="text-ink">{settings.decision_thresholds[m].toFixed(2)}</span></div>
            </div>
          ))}
        </div>
      </Panel>

      <Confirm open={confirm} title="Re-apply risk bands?" confirmLabel={dirty ? "Save & re-apply" : "Re-apply"} onCancel={() => setConfirm(false)} onConfirm={reapply}
        body={<>This saves the bands <b className="num">{bands.medium.toFixed(2)} / {bands.high.toFixed(2)} / {bands.critical.toFixed(2)}</b> and re-classifies the risk level of
          <b> every stored prediction</b> in the database. Alert severities follow; analyst statuses and notes are not changed.</>} />
    </div>
  );
}
