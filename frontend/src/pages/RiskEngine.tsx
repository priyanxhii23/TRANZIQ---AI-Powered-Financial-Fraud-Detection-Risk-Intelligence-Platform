import { motion } from "framer-motion";
import { Loader2, RefreshCcw, Save, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { post, put, get } from "../lib/api";
import { useApp } from "../lib/app-context";
import { RISK_META } from "../lib/format";
import { useApi } from "../lib/hooks";
import { MODEL_LABELS, MODELS, type RiskInfo, type RiskLevel, type Settings } from "../lib/types";
import { Loading, PageHeader, Panel, PanelHead, RiskChip } from "../components/ui";
import { RiskMeter } from "../components/viz";

interface Levels { model: string; bands: Settings["risk_bands"]; decision_threshold: number;
  levels: { level: RiskLevel; label: string; action: string; range: [number, number]; count: number }[] }

export default function RiskEngine() {
  const { settings, refreshSettings, notify, bumpData, dataVersion } = useApp();
  const levels = useApi(() => get<Levels>("/api/risk/levels"), [dataVersion, settings?.active_model]);
  const [bands, setBands] = useState<Settings["risk_bands"] | null>(null);
  const [saving, setSaving] = useState(false);
  const [reapplying, setReapplying] = useState(false);
  const [sim, setSim] = useState(0.42);
  const [assess, setAssess] = useState<RiskInfo | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  useEffect(() => { if (settings && !bands) setBands(settings.risk_bands); }, [settings, bands]);
  useEffect(() => {
    if (settings) setOverrides(Object.fromEntries(MODELS.map((m) => [m, settings.threshold_overrides[m] != null ? String(settings.threshold_overrides[m]) : ""])));
  }, [settings]);
  useEffect(() => {
    const t = setTimeout(() => post<RiskInfo>("/api/risk/assess", { probability: sim }).then(setAssess).catch(() => null), 120);
    return () => clearTimeout(t);
  }, [sim, settings]);

  if (!settings || !bands) return <Loading className="h-[60vh]" />;
  const valid = 0 < bands.medium && bands.medium < bands.high && bands.high < bands.critical && bands.critical < 1;
  const dirty = JSON.stringify(bands) !== JSON.stringify(settings.risk_bands);

  const save = async () => {
    setSaving(true);
    try {
      await put("/api/settings", { risk_bands: bands });
      await refreshSettings();
      notify({ tone: "success", title: "Risk bands saved", body: "New predictions use them. Re-apply to update stored predictions." });
    } catch (e) { notify({ tone: "danger", title: "Could not save", body: String(e) }); }
    finally { setSaving(false); }
  };
  const reapply = async () => {
    setReapplying(true);
    try {
      const r = await post<{ updated_predictions: number }>("/api/risk/reclassify");
      notify({ tone: "success", title: "Stored predictions re-classified", body: `${r.updated_predictions.toLocaleString()} predictions changed risk level.` });
      bumpData(); levels.reload();
    } catch (e) { notify({ tone: "danger", title: "Re-apply failed", body: String(e) }); }
    finally { setReapplying(false); }
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

  const edges = [0, bands.medium, bands.high, bands.critical, 1];
  const lvls: RiskLevel[] = ["low", "medium", "high", "critical"];

  return (
    <div>
      <PageHeader index="05" kicker="Risk Assessment Engine" title="Four levels of" accent="certainty."
        intro="Fraud probability is split into four configurable bands that tell an analyst how urgently to act. Separately, each model's decision threshold decides whether a transaction is labelled 'predicted fraud'." />

      <div className="grid gap-5 xl:grid-cols-12">
        <Panel className="xl:col-span-7">
          <PanelHead kicker="Configuration" title="Probability band editor">
            <button className="btn-ghost px-2.5 py-1 text-[12px]" onClick={() => setBands(settings.risk_bands)} disabled={!dirty}><Undo2 size={12} />Revert</button>
            <button className="btn-primary px-3 py-1.5 text-[12px]" onClick={save} disabled={!dirty || !valid || saving}>{saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}Save bands</button>
          </PanelHead>
          <div className="space-y-6 p-5">
            <div>
              <div className="relative flex h-11 overflow-hidden rounded">
                {lvls.map((l, i) => (
                  <motion.div key={l} layout className="flex items-center justify-center overflow-hidden font-mono text-[10.5px] uppercase tracking-wider"
                    style={{ width: `${(edges[i + 1] - edges[i]) * 100}%`, background: `color-mix(in srgb, ${RISK_META[l].color} 22%, transparent)`, color: RISK_META[l].color }}>
                    {(edges[i + 1] - edges[i]) > 0.08 && RISK_META[l].label}
                  </motion.div>
                ))}
                <span className="absolute top-0 h-full w-0.5 bg-ink" style={{ left: `${levels.data?.decision_threshold ? levels.data.decision_threshold * 100 : 50}%` }} title="Active model decision threshold" />
              </div>
              <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-3"><span>0.00</span><span>decision threshold │ {levels.data?.decision_threshold.toFixed(2)}</span><span>1.00</span></div>
            </div>
            {(["medium", "high", "critical"] as const).map((k) => (
              <div key={k} className="grid grid-cols-[110px_1fr_56px] items-center gap-4">
                <span className="flex items-center gap-2 text-[13px]"><RiskChip level={k} /> starts at</span>
                <input type="range" className="range" min={0.01} max={0.99} step={0.01} value={bands[k]} aria-label={`${k} band start`}
                  onChange={(e) => setBands({ ...bands, [k]: Number(e.target.value) })} />
                <span className="num text-right text-[14px]">{bands[k].toFixed(2)}</span>
              </div>
            ))}
            {!valid && <p className="text-[12.5px] text-coral">Bands must increase: medium &lt; high &lt; critical.</p>}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-line/[0.1] bg-bg/40 p-3.5">
              <p className="max-w-md text-[12px] text-ink-3">Stored predictions keep the level they were given. Re-apply the saved bands to every stored prediction to update dashboards.</p>
              <button className="btn-ghost text-[12px]" onClick={reapply} disabled={reapplying || dirty}>{reapplying ? <Loader2 size={13} className="animate-spin" /> : <RefreshCcw size={13} />}Re-apply to stored data</button>
            </div>
          </div>
        </Panel>

        <Panel className="xl:col-span-5" delay={0.08}>
          <PanelHead kicker="Simulator" title="How would a probability be classified?" />
          <div className="flex flex-col items-center p-5">
            {assess && <RiskMeter probability={sim} threshold={assess.threshold ?? undefined} bands={settings.risk_bands} level={assess.level} size={250} />}
            <input type="range" className="range mt-2" min={0} max={1} step={0.005} value={sim} onChange={(e) => setSim(Number(e.target.value))} aria-label="Simulated probability" />
            {assess && <p className="mt-4 text-[12.5px] leading-relaxed text-ink-2">{assess.explanation} <span className="text-ink">{assess.recommended_action}</span></p>}
            <p className="mt-2 text-[11px] text-ink-3">Uses the saved bands and the active model ({MODEL_LABELS[settings.active_model]}).</p>
          </div>
        </Panel>
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {(levels.data?.levels ?? []).map((l, i) => (
          <Panel key={l.level} delay={0.1 + i * 0.05} className="p-5">
            <span className="absolute inset-x-0 top-0 h-[2px] rounded-t-md" style={{ background: RISK_META[l.level].color }} />
            <div className="flex items-center justify-between"><RiskChip level={l.level} pulse /><span className="num text-[11px] text-ink-3">{l.range[0].toFixed(2)} – {l.range[1].toFixed(2)}</span></div>
            <Link to={`/transactions?risk=${l.level}`} className="mt-4 block font-display text-5xl hover:text-violet">{l.count.toLocaleString()}</Link>
            <div className="label mt-1">stored transactions · active model</div>
            <p className="mt-3 text-[12.5px] leading-relaxed text-ink-2">{l.action}</p>
          </Panel>
        ))}
      </div>

      <Panel className="mt-5" delay={0.2}>
        <PanelHead kicker="Decision thresholds" title="Per-model override (validation-optimised default)">
          <button className="btn-primary px-3 py-1.5 text-[12px]" onClick={saveOverrides}><Save size={13} />Save thresholds</button>
        </PanelHead>
        <div className="grid gap-4 p-5 md:grid-cols-3">
          {MODELS.map((m) => (
            <div key={m} className="rounded border border-line/[0.1] p-4">
              <div className="flex items-center justify-between"><span className="font-semibold">{MODEL_LABELS[m]}</span>
                <span className="num text-[11px] text-ink-3">recommended {settings.recommended_thresholds[m].toFixed(2)}</span></div>
              <div className="mt-3 flex items-center gap-2">
                <input className="input num" placeholder={`default ${settings.recommended_thresholds[m].toFixed(2)}`} value={overrides[m] ?? ""}
                  onChange={(e) => setOverrides((o) => ({ ...o, [m]: e.target.value }))} inputMode="decimal" aria-label={`${m} threshold`} />
                <button className="btn-ghost px-2.5" onClick={() => setOverrides((o) => ({ ...o, [m]: "" }))} title="Use recommended"><Undo2 size={13} /></button>
              </div>
              <div className="mt-2 font-mono text-[11px] text-ink-3">in use: <span className="text-ink">{settings.decision_thresholds[m].toFixed(2)}</span></div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
