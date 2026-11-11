import type { RiskLevel, Source } from "./types";

export const fmtInt = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
export const fmtNum = (n: number | null | undefined, d = 2) =>
  n == null || Number.isNaN(n) ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmtPct = (n: number | null | undefined, d = 1) => (n == null ? "—" : `${(n * 100).toFixed(d)}%`);
export const fmtProb = (n: number | null | undefined) => {
  if (n == null) return "—";
  if (n > 0 && n < 0.0001) return "<0.01%";
  return `${(n * 100).toFixed(n < 0.1 ? 2 : 1)}%`;
};
export const fmtMoney = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fmtDate(iso: string | null | undefined, withTime = true) {
  if (!iso) return "—";
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z");
  return d.toLocaleString("en-GB", {
    day: "2-digit", month: "short", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : { year: "numeric" }),
  });
}
export function fmtTime(iso: string) {
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z");
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
export function timeAgo(iso: string) {
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z").getTime();
  const s = Math.max(0, (Date.now() - d) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const RISK_META: Record<RiskLevel, { label: string; color: string; tw: string }> = {
  low: { label: "Low", color: "rgb(var(--mint))", tw: "mint" },
  medium: { label: "Medium", color: "rgb(var(--amber))", tw: "amber" },
  high: { label: "High", color: "rgb(var(--coral) / 0.8)", tw: "coral" },
  critical: { label: "Critical", color: "rgb(var(--coral))", tw: "coral" },
};

export const SOURCE_META: Record<Source, { label: string; short: string; color: string }> = {
  kaggle: { label: "Real · Kaggle", short: "REAL", color: "rgb(var(--cyan))" },
  synthetic: { label: "Synthetic demo", short: "SYNTH", color: "rgb(var(--violet))" },
  user: { label: "User submitted", short: "USER", color: "rgb(var(--amber))" },
};

export const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
