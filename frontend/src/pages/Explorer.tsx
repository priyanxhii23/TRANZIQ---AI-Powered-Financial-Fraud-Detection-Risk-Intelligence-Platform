import { ArrowDown, ArrowUp, BrainCircuit, Download, Filter, RefreshCw, RotateCcw, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { download, get, post, qs } from "../lib/api";
import { useApp } from "../lib/app-context";
import { RISK_META, SOURCE_META, fmtDate, fmtMoney, fmtNum, fmtProb } from "../lib/format";
import { useApi, useDebounced } from "../lib/hooks";
import { FEATURES, MODEL_LABELS, MODELS, type ModelName, type Paged, type RiskLevel, type Source, type Tx, type TxDetail } from "../lib/types";
import { Drawer, EmptyState, ErrorState, Field, LabelChip, Loading, PageHeader, Pagination, Panel, ProbBar, RiskChip, Segmented, Select, SourceChip } from "../components/ui";

type SortKey = "event_time" | "amount" | "probability" | "external_id";
interface Filters {
  q: string; source: Source | ""; model: ModelName | ""; risk_level: RiskLevel | ""; predicted_label: "" | "0" | "1";
  ground_truth: "" | "0" | "1"; min_amount: string; max_amount: string; min_prob: number; max_prob: number; date_from: string; date_to: string;
}
const initialFilters: Filters = {
  q: "", source: "", model: "", risk_level: "", predicted_label: "",
  ground_truth: "", min_amount: "", max_amount: "", min_prob: 0, max_prob: 1, date_from: "", date_to: "",
};

function Detail({ id, onChanged }: { id: number; onChanged: () => void }) {
  const { settings, notify } = useApp();
  const { data, error, loading, setData } = useApi(() => get<TxDetail>(`/api/transactions/${id}`), [id]);
  const [busy, setBusy] = useState(false);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorState message={error ?? "Not found"} />;
  const meta: [string, string | null][] = [
    ["Customer", data.customer_id], ["Merchant", data.merchant], ["Category", data.merchant_category], ["City", data.city],
    ["Country", data.country], ["Channel", data.channel], ["Device", data.device], ["Status", data.status],
  ];
  const rescore = async () => {
    setBusy(true);
    try { setData(await post<TxDetail>(`/api/transactions/${id}/rescore`)); onChanged(); notify({ tone: "success", title: "Re-scored with all models" }); }
    catch (e) { notify({ tone: "danger", title: "Re-score failed", body: String(e) }); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <SourceChip source={data.source} />
        <span className="text-[12.5px] text-ink-2">{SOURCE_META[data.source].label}</span>
        <span className="ml-auto num text-[12px] text-ink-3">{fmtDate(data.event_time)}</span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div><div className="label">Amount</div><div className="font-display text-4xl">{fmtMoney(data.amount)}</div></div>
        <div><div className="label">Known label (ground truth)</div><div className="mt-2"><LabelChip label={data.ground_truth} /></div>
          <p className="mt-1 text-[11px] text-ink-3">{data.source === "kaggle" ? "From the Kaggle dataset (test split)." : "None — not a verified case."}</p></div>
      </div>
      {data.source === "kaggle" ? (
        <p className="rounded border border-line/[0.1] bg-bg/40 p-3 text-[12px] text-ink-3">Kaggle records carry no merchant / customer metadata. The timestamp is a replay: monitoring start + the dataset's <code>Time</code> offset.</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          {meta.map(([k, v]) => <div key={k}><dt className="label">{k}</dt><dd className="text-[13px]">{v ?? "—"}</dd></div>)}
          {data.generation_profile && <div className="col-span-2"><dt className="label">Generation profile</dt><dd className="text-[13px] text-violet">{data.generation_profile} <span className="text-ink-3">(provenance, not a label)</span></dd></div>}
        </dl>
      )}
      <div>
        <div className="mb-2 flex items-center justify-between"><span className="label">Model predictions</span>
          <button className="btn-ghost px-2 py-1 text-[11.5px]" onClick={rescore} disabled={busy}><RefreshCw size={12} className={busy ? "animate-spin" : ""} />Re-score</button></div>
        <div className="space-y-2">
          {data.predictions.map((p) => (
            <div key={p.id} className={`flex items-center gap-3 rounded border px-3 py-2.5 ${p.model_name === settings?.active_model ? "border-violet/30 bg-violet/[0.06]" : "border-line/[0.1]"}`}>
              <div className="min-w-0 flex-1"><div className="text-[13px] font-medium">{MODEL_LABELS[p.model_name]}</div>
                <div className="font-mono text-[10.5px] text-ink-3">thr {p.threshold.toFixed(2)} · {p.predicted_label ? "flagged" : "not flagged"}</div></div>
              <ProbBar p={p.probability} threshold={p.threshold} />
              <RiskChip level={p.risk_level} />
            </div>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-ink-3">{data.prediction_history_count} prediction record(s) stored for this transaction.</p>
      </div>
      {data.alerts.length > 0 && (
        <div><div className="label mb-2">Alerts</div>
          {data.alerts.map((a) => <Link key={a.id} to={`/alerts?focus=${a.id}`} className="flex items-center justify-between rounded border border-coral/25 px-3 py-2 text-[12.5px] hover:bg-coral/5">
            <span>Alert #{a.id} · {a.status}</span><RiskChip level={a.severity} /></Link>)}
        </div>
      )}
      <div>
        <div className="label mb-2">Model input features</div>
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
          {FEATURES.map((f) => (
            <div key={f} className="rounded-sm border border-line/[0.08] px-2 py-1.5">
              <div className="font-mono text-[9.5px] text-ink-3">{f}</div>
              <div className="num truncate text-[11.5px]">{fmtNum(data.features[f], f === "Time" ? 0 : 3)}</div>
            </div>
          ))}
        </div>
      </div>
      <Link to={`/explain?tx=${data.id}`} className="btn-primary w-full"><BrainCircuit size={15} />Explain this prediction</Link>
    </div>
  );
}

export default function Explorer() {
  const { dataVersion, settings } = useApp();
  const [params, setParams] = useSearchParams();
  const [f, setF] = useState<Filters>(() => ({ ...initialFilters, source: (params.get("source") as Source) ?? "", risk_level: (params.get("risk") as RiskLevel) ?? "" }));
  const [showFilters, setShowFilters] = useState(true);
  const [sort, setSort] = useState<{ by: SortKey; dir: "asc" | "desc" }>({ by: "event_time", dir: "desc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [openId, setOpenId] = useState<number | null>(params.get("open") ? Number(params.get("open")) : null);
  const df = useDebounced(f, 300);
  useEffect(() => setPage(1), [df, pageSize]);

  const query = {
    q: df.q, source: df.source, model: df.model, risk_level: df.risk_level, predicted_label: df.predicted_label, ground_truth: df.ground_truth,
    min_amount: df.min_amount, max_amount: df.max_amount, min_prob: df.min_prob > 0 ? df.min_prob : "", max_prob: df.max_prob < 1 ? df.max_prob : "",
    date_from: df.date_from ? `${df.date_from}T00:00:00` : "", date_to: df.date_to ? `${df.date_to}T23:59:59` : "",
  };
  const { data, error, loading, reload } = useApi(
    () => get<Paged<Tx> & { model: ModelName }>(`/api/transactions${qs({ ...query, sort_by: sort.by, sort_dir: sort.dir, page, page_size: pageSize })}`),
    [JSON.stringify(query), sort.by, sort.dir, page, pageSize, dataVersion, settings?.active_model],
  );
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((s) => ({ ...s, [k]: v }));
  const th = (k: SortKey, label: string, right = false) => (
    <th className={right ? "text-right" : ""}>
      <button className={`inline-flex items-center gap-1 hover:text-ink ${sort.by === k ? "text-violet" : ""}`}
        onClick={() => setSort((s) => ({ by: k, dir: s.by === k && s.dir === "desc" ? "asc" : "desc" }))}>
        {label}{sort.by === k && (sort.dir === "desc" ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
      </button>
    </th>
  );
  const close = () => { setOpenId(null); if (params.get("open")) { params.delete("open"); setParams(params, { replace: true }); } };
  const activeCount = (Object.keys(f) as (keyof Filters)[]).filter((k) => f[k] !== initialFilters[k]).length;

  return (
    <div>
      <PageHeader index="04" kicker="Transaction Intelligence Explorer" title="Search the" accent="ledger."
        intro="Every stored transaction with its latest prediction. Real Kaggle records, synthetic demo records and user submissions are always labelled.">
        <button className="btn-ghost" onClick={() => setShowFilters((s) => !s)}><Filter size={14} />Filters {activeCount > 0 && <span className="num text-violet">{activeCount}</span>}</button>
        <button className="btn-ghost" onClick={() => download(`/api/reports/transactions.csv${qs({ model: df.model, source: df.source, risk_level: df.risk_level, predicted_label: df.predicted_label, q: df.q, min_prob: query.min_prob })}`)}>
          <Download size={14} />Export CSV</button>
      </PageHeader>

      <Panel>
        <div className="flex flex-wrap items-center gap-3 border-b border-line/[0.1] p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input className="input pl-9" placeholder="Search ID, customer, merchant, city, country…" value={f.q} onChange={(e) => set("q", e.target.value)} />
          </div>
          <Segmented size="sm" value={f.source || "all"} onChange={(v) => set("source", v === "all" ? "" : (v as Source))}
            options={[{ value: "all", label: "All" }, { value: "kaggle", label: "Real" }, { value: "synthetic", label: "Synthetic" }, { value: "user", label: "User" }]} />
          {activeCount > 0 && <button className="btn-ghost px-2.5 py-1.5 text-[12px]" onClick={() => setF(initialFilters)}><RotateCcw size={12} />Reset</button>}
        </div>
        {showFilters && (
          <div className="grid gap-4 border-b border-line/[0.1] p-4 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
            <Field label="Model">
              <Select value={f.model} onChange={(v) => set("model", v)} options={[{ value: "", label: `Active (${settings ? MODEL_LABELS[settings.active_model] : "…"})` }, ...MODELS.map((m) => ({ value: m, label: MODEL_LABELS[m] }))]} />
            </Field>
            <Field label="Risk level">
              <Select value={f.risk_level} onChange={(v) => set("risk_level", v)} options={[{ value: "", label: "Any" }, ...(["low", "medium", "high", "critical"] as RiskLevel[]).map((l) => ({ value: l, label: RISK_META[l].label }))]} />
            </Field>
            <Field label="Prediction">
              <Select value={f.predicted_label} onChange={(v) => set("predicted_label", v)} options={[{ value: "", label: "Any" }, { value: "1", label: "Predicted fraud" }, { value: "0", label: "Predicted legit" }]} />
            </Field>
            <Field label="Known label">
              <Select value={f.ground_truth} onChange={(v) => set("ground_truth", v)} options={[{ value: "", label: "Any" }, { value: "1", label: "Fraud (Kaggle)" }, { value: "0", label: "Legit (Kaggle)" }]} />
            </Field>
            <Field label="Amount range">
              <div className="flex gap-1.5">
                <input className="input num" placeholder="min" inputMode="decimal" value={f.min_amount} onChange={(e) => set("min_amount", e.target.value)} />
                <input className="input num" placeholder="max" inputMode="decimal" value={f.max_amount} onChange={(e) => set("max_amount", e.target.value)} />
              </div>
            </Field>
            <Field label="Fraud probability" hint={<span className="num">{fmtProb(f.min_prob)}–{fmtProb(f.max_prob)}</span>}>
              <div className="space-y-2 pt-1">
                <input type="range" className="range" min={0} max={1} step={0.01} value={f.min_prob} aria-label="Minimum probability" onChange={(e) => set("min_prob", Math.min(Number(e.target.value), f.max_prob))} />
                <input type="range" className="range" min={0} max={1} step={0.01} value={f.max_prob} aria-label="Maximum probability" onChange={(e) => set("max_prob", Math.max(Number(e.target.value), f.min_prob))} />
              </div>
            </Field>
            <Field label="From date"><input type="date" className="input" value={f.date_from} onChange={(e) => set("date_from", e.target.value)} /></Field>
            <Field label="To date"><input type="date" className="input" value={f.date_to} onChange={(e) => set("date_to", e.target.value)} /></Field>
          </div>
        )}
        {error ? <ErrorState message={error} onRetry={reload} /> : loading && !data ? <Loading /> : !data?.items.length ? (
          <EmptyState title="No transactions match" body="Try widening the filters." />
        ) : (
          <div className={`overflow-x-auto transition-opacity ${loading ? "opacity-60" : ""}`}>
            <table className="w-full min-w-[960px]">
              <thead className="table-head"><tr>
                {th("external_id", "Transaction")}<th>Source</th>{th("event_time", "Time")}<th>Merchant / location</th>
                {th("amount", "Amount", true)}{th("probability", "Fraud prob.")}<th>Risk</th><th>Prediction</th><th>Known label</th>
              </tr></thead>
              <tbody>
                {data.items.map((t) => (
                  <tr key={t.id} onClick={() => setOpenId(t.id)} className="table-row cursor-pointer border-t border-line/[0.06] transition-colors hover:bg-violet/[0.05]">
                    <td className="num text-ink">{t.external_id}</td>
                    <td><SourceChip source={t.source} /></td>
                    <td className="num text-ink-3">{fmtDate(t.event_time)}</td>
                    <td className="max-w-[220px] truncate text-ink-2">{t.merchant ? <>{t.merchant} <span className="text-ink-3">· {t.city}</span></> : <span className="text-ink-3">—</span>}</td>
                    <td className="num text-right">{fmtMoney(t.amount)}</td>
                    <td>{t.prediction ? <ProbBar p={t.prediction.probability} threshold={t.prediction.threshold} /> : "—"}</td>
                    <td>{t.prediction && <RiskChip level={t.prediction.risk_level} />}</td>
                    <td className={t.prediction?.predicted_label ? "text-coral" : "text-ink-3"}>{t.prediction ? (t.prediction.predicted_label ? "fraud" : "legit") : "—"}</td>
                    <td><LabelChip label={t.ground_truth} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && (
          <div className="flex flex-wrap items-center justify-between">
            <div className="flex-1"><Pagination page={data.page} pages={data.pages} total={data.total} onPage={setPage} /></div>
            <div className="flex items-center gap-2 border-t border-line/[0.1] px-4 py-3">
              <span className="label">Rows</span>
              <Select value={String(pageSize)} onChange={(v) => setPageSize(Number(v))} options={["10", "25", "50", "100"].map((v) => ({ value: v, label: v }))} className="w-20" />
            </div>
          </div>
        )}
      </Panel>
      <Drawer open={openId != null} onClose={close} kicker="Transaction detail" title={data?.items.find((t) => t.id === openId)?.external_id ?? `#${openId}`}>
        {openId != null && <Detail id={openId} onChanged={reload} />}
      </Drawer>
    </div>
  );
}
