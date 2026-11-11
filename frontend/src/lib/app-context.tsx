import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { get, put } from "./api";
import type { Health, ModelName, Settings } from "./types";

type Theme = "dark" | "light";
export interface Toast {
  id: number;
  tone: "info" | "success" | "danger" | "warn";
  title: string;
  body?: string;
  href?: string;
}

interface Ctx {
  theme: Theme;
  toggleTheme: (origin?: { x: number; y: number }) => void;
  settings: Settings | null;
  refreshSettings: () => Promise<void>;
  setActiveModel: (m: ModelName) => Promise<void>;
  health: Health | null;
  healthError: string | null;
  toasts: Toast[];
  notify: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
  /** increments whenever data changed somewhere (prediction, generation...) so pages can refetch */
  dataVersion: number;
  bumpData: () => void;
}

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.classList.contains("light") ? "light" : "dark",
  );
  const [settings, setSettings] = useState<Settings | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dataVersion, setDataVersion] = useState(0);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    try {
      localStorage.setItem("tranziq-theme", theme);
    } catch {
      /* storage blocked */
    }
  }, [theme]);

  /** Theme switch: circular reveal from the toggle via the View Transitions API, cross-fade fallback. */
  const toggleTheme = useCallback((origin?: { x: number; y: number }) => {
    const next = (t: Theme) => (t === "dark" ? "light" : "dark");
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!doc.startViewTransition || reduce) { setTheme(next); return; }
    const x = origin?.x ?? window.innerWidth / 2, y = origin?.y ?? 0;
    const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const vt = doc.startViewTransition(() => {
      const t = next(document.documentElement.classList.contains("light") ? "light" : "dark");
      document.documentElement.classList.remove("light", "dark");
      document.documentElement.classList.add(t);
      setTheme(t);
    });
    vt.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 650, easing: "cubic-bezier(0.22, 1, 0.36, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    }).catch(() => null);
  }, []);

  const notify = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 6000);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((x) => x.id !== id)), []);

  const refreshSettings = useCallback(async () => {
    try {
      setSettings(await get<Settings>("/api/settings"));
    } catch {
      /* surfaced by health */
    }
  }, []);

  const checkHealth = useCallback(async () => {
    try {
      setHealth(await get<Health>("/api/health"));
      setHealthError(null);
    } catch (e) {
      setHealthError(e instanceof Error ? e.message : "API unreachable");
    }
  }, []);

  useEffect(() => {
    checkHealth();
    refreshSettings();
    const t = setInterval(checkHealth, 30000);
    return () => clearInterval(t);
  }, [checkHealth, refreshSettings]);

  const setActiveModel = useCallback(
    async (m: ModelName) => {
      try {
        setSettings(await put<Settings>("/api/settings", { active_model: m }));
        setDataVersion((v) => v + 1);
        notify({ tone: "success", title: "Active model switched", body: `Dashboards now use ${m.replace(/_/g, " ")}.` });
      } catch (e) {
        notify({ tone: "danger", title: "Could not switch model", body: String(e) });
      }
    },
    [notify],
  );

  const value = useMemo<Ctx>(
    () => ({
      theme, toggleTheme,
      settings, refreshSettings, setActiveModel, health, healthError, toasts, notify, dismiss,
      dataVersion, bumpData: () => setDataVersion((v) => v + 1),
    }),
    [theme, toggleTheme, settings, refreshSettings, setActiveModel, health, healthError, toasts, notify, dismiss, dataVersion],
  );
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside AppProvider");
  return c;
}

/** Resolved colour strings for Recharts (SVG attributes can't read CSS variables). */
export function useChartColors() {
  const { theme } = useApp();
  return useMemo(() => {
    const css = getComputedStyle(document.documentElement);
    const c = (n: string, a = 1) => `rgb(${css.getPropertyValue(`--${n}`).trim().split(" ").join(",")}${a < 1 ? `,${a}` : ""})`.replace("rgb(", a < 1 ? "rgba(" : "rgb(");
    return {
      primary: c("primary"), secondary: c("secondary"), tertiary: c("tertiary"), coral: c("coral"), amber: c("amber"), mint: c("mint"),
      ink: c("ink"), ink2: c("ink-2"), ink3: c("ink-3"), grid: c("line", 0.12), panel: c("panel"), bg: c("bg"),
      primarySoft: c("primary", 0.25), secondarySoft: c("secondary", 0.22), coralSoft: c("coral", 0.25),
      models: { logistic_regression: c("tertiary"), random_forest: c("secondary"), xgboost: c("primary") } as Record<string, string>,
      risk: { low: c("mint"), medium: c("amber"), high: c("coral", 0.7), critical: c("coral") } as Record<string, string>,
      source: { kaggle: c("secondary"), synthetic: c("primary"), user: c("amber") } as Record<string, string>,
      raw: (n: string) => css.getPropertyValue(`--${n}`).trim().split(" ").map(Number) as [number, number, number],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);
}
