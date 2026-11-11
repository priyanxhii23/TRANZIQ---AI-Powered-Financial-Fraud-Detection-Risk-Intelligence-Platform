import { motion } from "framer-motion";
import { BrainCircuit, CheckCircle2, CircleDot, Download, Loader2, Search, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { download, get, patch, qs } from "../lib/api";
import { useApp } from "../lib/app-context";
import { RISK_META, fmtDate, fmtMoney, fmtProb, timeAgo } from "../lib/format";
import { useApi } from "../lib/hooks";
import { MODEL_LABELS, type Alert, type AlertStatus, type AlertSummary, type Paged, type RiskLevel, type Source } from "../lib/types";
import { EmptyState, ErrorState, LabelChip, Loading, PageHeader, Pagination, Panel, PanelHead, PulseDot, RiskChip, Segmented, Select, SourceChip } from "../components/ui";
import { RiskMeter } from "../components/viz";

const STATUS: { value: AlertStatus; label: string; icon: typeof CircleDot; tone: string }[] = [
  { value: "pending", label: "Pending", icon: CircleDot, tone: "amber" },
  { value: "investigating", label: "Investigating", icon: Search, tone: "primary" },
  { value: "confirmed", label: "Confirmed", icon: CheckCircle2, tone: "coral" },
  { value: "dismissed", label: "Dismissed", icon: XCircle, tone: "ink-3" },
];

function StatusBadge({ s }: { s: AlertStatus }) {
  const m = STATUS.find((x) => x.value === s)!;
  return <span className="chip" style={{ color: `rgb(var(--${m.tone}))`, borderColor: `rgb(var(--${m.tone}) / 0.35)` }}><m.icon size={10} />{m.label}</span>;
}

function Investigation({ alert, onSaved }: { alert: Alert; onSaved: (a: Alert) => void }) {
  const { settings, notify, bumpData } = useApp();
  const [note, setNote] = useState(alert.analyst_note ?? "");
  const [busy, setBusy] = useState<AlertStatus | "note" | null>(null);
  useEffect(() => setNote(alert.analyst_note ?? ""), [alert.id, alert.analyst_note]);
  const save = async (status?: AlertStatus) => {
    setBusy(status ?? "note");
    try {
      const a = await patch<Alert>(`/api/alerts/${alert.id}`, { ...(status ? { status } : {}), analyst_note: note });
      onSaved(a); bumpData();
      notify({ tone: "success", title: `Alert #${a.id} ${status ? `marked ${status}` : "note saved"}`, body: "Analyst decision stored in SQLite." });
    } catch (e) { notify({ tone: "danger", title: "Update failed", body: String(e) }); }
    finally { setBusy(null); }
  };
  const t = alert.transaction, p = alert.prediction;
  return (
    <div className="space-y-5 p-5">
      <div className="flex flex-wrap items-center gap-2"><RiskChip level={alert.severity} pulse /><StatusBadge s={alert.status} /><SourceChip source={t.source} />
        <span className="ml-auto font-mono text-[11px] text-ink-3">detected {fmtDate(alert.created_at)}</span></div>
      <div className="flex flex-col items-center">
        {settings && <RiskMeter probability={p.probability} threshold={p.threshold} bands={settings.risk_bands} level={p.risk_level} size={230} />}
        <div className="font-mono text-[11px] text-ink-3">{MODEL_LABELS[p.model_name]} · v{p.model_version}</div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
        <div><dt className="label">Transaction</dt><dd className="num">{t.external_id}</dd></div>
        <div><dt className="label">Amount</dt><dd className="num">{fmtMoney(t.amount)}</dd></div>
        <div><dt className="label">Event time</dt><dd className="num">{fmtDate(t.event_time)}</dd></div>
        <div><dt className="label">Known label</dt><dd><LabelChip label={t.ground_truth} /></dd></div>
        {t.merchant && <div><dt className="label">Merchant</dt><dd>{t.merchant}</dd></div>}
        {t.city && <div><dt className="label">Location</dt><dd>{t.city}, {t.country}</dd></div>}
        {t.channel && <div><dt className="label">Channel</dt><dd>{t.channel}</dd></div>}
        {t.customer_id && <div><dt className="label">Customer</dt><dd className="num">{t.customer_id}</dd></div>}
      </dl>
      <div>
        <div className="label mb-2">Investigation status</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {STATUS.map((s) => (
            <motion.button key={s.value} whileTap={{ scale: 0.95 }} onClick={() => save(s.value)} disabled={busy != null || alert.status === s.value}
              className={`flex items-center justify-center gap-1.5 rounded border px-2 py-2 text-[12px] font-semibold transition-colors disabled:cursor-default ${alert.status === s.value ? "" : "border-line/[0.14] text-ink-3 hover:text-ink"}`}
              style={alert.status === s.value ? { color: `rgb(var(--${s.tone}))`, borderColor: `rgb(var(--${s.tone}) / 0.5)`, background: `rgb(var(--${s.tone}) / 0.1)` } : undefined}>
              {busy === s.value ? <Loader2 size={12} className="animate-spin" /> : <s.icon size={12} />}{s.label}
            </motion.button>
          ))}
        </div>
      </div>
      <div>
        <div className="label mb-2">Analyst note</div>
        <textarea className="input min-h-[90px]" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Findings, contact attempts, rationale…" />
        <div className="mt-2 flex justify-between">
          <span className="font-mono text-[10.5px] text-ink-3">updated {timeAgo(alert.updated_at)}</span>
          <button className="btn-ghost px-3 py-1.5 text-[12px]" onClick={() => save()} disabled={busy != null || note === (alert.analyst_note ?? "")}>Save note</button>
        </div>
      </div>
      <p className="rounded border border-line/[0.1] bg-bg/40 p-3 text-[11.5px] leading-relaxed text-ink-3">
        Statuses record <b className="text-ink-2">analyst decisions</b>. “Confirmed” does not change the dataset's ground-truth label and is not fed back into training.
      </p>
      <div className="flex gap-2">
        <Link to={`/explain?tx=${t.id}`} className="btn-primary flex-1"><BrainCircuit size={14} />Explain</Link>
        <Link to={`/transactions?open=${t.id}`} className="btn-ghost flex-1">Full record</Link>
      </div>
    </div>
  );
}

export default function Alerts() {
  const { dataVersion } = useApp();
  const [params] = useSearchParams();
  const [status, setStatus] = useState<AlertStatus | "all">("all");
  const [severity, setSeverity] = useState<RiskLevel | "">("");
  const [source, setSource] = useState<Source | "">("");
  const [sort, setSort] = useState<"newest" | "severity" | "updated">("newest");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Alert | null>(null);
  useEffect(() => setPage(1), [status, severity, source, sort]);

  const summary = useApi(() => get<AlertSummary>("/api/alerts/summary"), [dataVersion]);
  const list = useApi(() => get<Paged<Alert>>(`/api/alerts${qs({ status: status === "all" ? "" : status, severity, source, sort, page, page_size: 15 })}`),
    [status, severity, source, sort, page, dataVersion], { interval: 20000 });

  useEffect(() => {
    const f = params.get("focus");
    if (f) get<Alert>(`/api/alerts/${f}`).then(setSelected).catch(() => null);
  }, [params]);
  useEffect(() => { if (!selected && list.data?.items.length && window.innerWidth >= 1280) setSelected(list.data.items[0]); }, [list.data, selected]);

  const onSaved = (a: Alert) => { setSelected(a); list.setData((d) => d && { ...d, items: d.items.map((x) => (x.id === a.id ? a : x)) }); summary.reload(); };

  return (
    <div>
      <PageHeader index="08" kicker="Fraud Alert & Investigation Center" title="Triage," accent="investigate, decide.">
        <button className="btn-ghost" onClick={() => download("/api/reports/alerts.csv")}><Download size={14} />Export alerts</button>
      </PageHeader>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[{ value: "all" as const, label: "All alerts", tone: "ink", n: summary.data?.total }, ...STATUS.map((s) => ({ ...s, n: summary.data?.by_status[s.value] }))].map((s, i) => (
          <motion.button key={s.value} onClick={() => setStatus(s.value)} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className={`panel p-4 text-left transition-colors ${status === s.value ? "border-primary/50" : "hover:border-line/25"}`}>
            <div className="label flex items-center gap-2">{s.value === "pending" && <PulseDot color="rgb(var(--amber))" size={6} />}{s.label}</div>
            <div className="mt-1 font-display text-4xl" style={{ color: `rgb(var(--${s.tone}))` }}>{s.n?.toLocaleString() ?? "—"}</div>
          </motion.button>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-12">
        <Panel className="xl:col-span-7">
          <div className="flex flex-wrap items-center gap-3 border-b border-line/[0.1] p-4">
            <Select value={severity} onChange={setSeverity} className="w-36" options={[{ value: "", label: "Any severity" }, ...(["critical", "high", "medium", "low"] as RiskLevel[]).map((l) => ({ value: l, label: RISK_META[l].label }))]} />
            <Select value={source} onChange={setSource} className="w-36" options={[{ value: "", label: "Any source" }, { value: "kaggle", label: "Real (Kaggle)" }, { value: "synthetic", label: "Synthetic" }, { value: "user", label: "User" }]} />
            <div className="ml-auto"><Segmented size="sm" value={sort} onChange={setSort} options={[{ value: "newest", label: "Newest" }, { value: "severity", label: "Severity" }, { value: "updated", label: "Updated" }]} /></div>
          </div>
          {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : !list.data.items.length ? <EmptyState title="No alerts here" body="Nothing matches these filters." /> : (
            <div className="divide-y divide-line/[0.06]">
              {list.data.items.map((a) => (
                <button key={a.id} onClick={() => setSelected(a)}
                  className={`flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors ${selected?.id === a.id ? "bg-primary/[0.08]" : "hover:bg-line/[0.04]"}`}>
                  <PulseDot color={RISK_META[a.severity].color} pulse={a.status === "pending" && (a.severity === "critical" || a.severity === "high")} size={9} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><span className="num text-[13px]">#{a.id} · {a.transaction.external_id}</span><SourceChip source={a.transaction.source} /></div>
                    <div className="mt-0.5 truncate text-[11.5px] text-ink-3">{a.transaction.merchant ? `${a.transaction.merchant} · ${a.transaction.city}` : "Kaggle record — no metadata"} · {timeAgo(a.created_at)}</div>
                  </div>
                  <div className="hidden sm:block"><StatusBadge s={a.status} /></div>
                  <div className="w-20 text-right">
                    <div className="num text-[14px]" style={{ color: RISK_META[a.severity].color }}>{fmtProb(a.prediction.probability)}</div>
                    <div className="num text-[11px] text-ink-3">{fmtMoney(a.transaction.amount)}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
          {list.data && <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} onPage={setPage} />}
        </Panel>
        <Panel className="xl:sticky xl:top-6 xl:col-span-5 xl:self-start" delay={0.08}>
          <PanelHead kicker="Investigation" title={selected ? `Alert #${selected.id}` : "Select an alert"} />
          {selected ? <Investigation alert={selected} onSaved={onSaved} /> : <EmptyState title="No alert selected" body="Choose an alert from the queue." />}
        </Panel>
      </div>
    </div>
  );
}
