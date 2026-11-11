import { useEffect, useRef } from "react";
import { useApp } from "../lib/app-context";

/**
 * Ambient intelligence background.
 * Drifting transaction nodes, faint network links between nearby nodes and
 * small signals travelling along those links. Deliberately quiet:
 * - capped at ~30 fps and devicePixelRatio 1.5
 * - pauses when the tab is hidden
 * - a single static frame when the user prefers reduced motion
 * - pointer-events: none, sits behind all content (z-0)
 */
type Node = { x: number; y: number; vx: number; vy: number; r: number; hot: boolean };
type Signal = { a: number; b: number; t: number; speed: number };

export function AmbientBackground({ density = 1 }: { density?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { theme } = useApp();

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const css = getComputedStyle(document.documentElement);
    const rgb = (n: string) => css.getPropertyValue(`--${n}`).trim().split(" ").join(",");
    const P = rgb("primary"), S = rgb("secondary"), C = rgb("coral");
    const alpha = theme === "dark" ? 1 : 0.75;

    let w = 0, h = 0, raf = 0, last = 0;
    let nodes: Node[] = [];
    const signals: Signal[] = [];
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);

    const resize = () => {
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round(Math.min(46, (w * h) / 32000) * density);
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.18, vy: (Math.random() - 0.5) * 0.18,
        r: 0.8 + Math.random() * 1.6, hot: Math.random() < 0.06,
      }));
    };
    const LINK = 150;

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
          const d = Math.hypot(dx, dy);
          if (d < LINK) {
            ctx.strokeStyle = `rgba(${P},${(1 - d / LINK) * 0.13 * alpha})`;
            ctx.lineWidth = 0.6;
            ctx.beginPath(); ctx.moveTo(nodes[i].x, nodes[i].y); ctx.lineTo(nodes[j].x, nodes[j].y); ctx.stroke();
          }
        }
      }
      for (const s of signals) {
        const a = nodes[s.a], b = nodes[s.b];
        if (!a || !b) continue;
        const x = a.x + (b.x - a.x) * s.t, y = a.y + (b.y - a.y) * s.t;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 6);
        g.addColorStop(0, `rgba(${S},${0.7 * alpha})`); g.addColorStop(1, `rgba(${S},0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
      }
      for (const n of nodes) {
        ctx.fillStyle = n.hot ? `rgba(${C},${0.55 * alpha})` : `rgba(${P},${0.4 * alpha})`;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
      }
    };

    const step = (now: number) => {
      raf = requestAnimationFrame(step);
      if (document.hidden || now - last < 33) return;
      last = now;
      for (const n of nodes) {
        n.x += n.vx; n.y += n.vy;
        if (n.x < -20) n.x = w + 20; if (n.x > w + 20) n.x = -20;
        if (n.y < -20) n.y = h + 20; if (n.y > h + 20) n.y = -20;
      }
      // spawn a signal between two linked nodes now and then
      if (signals.length < 6 && Math.random() < 0.04 && nodes.length > 2) {
        const a = Math.floor(Math.random() * nodes.length);
        let best = -1, bd = LINK;
        nodes.forEach((m, k) => { const d = Math.hypot(m.x - nodes[a].x, m.y - nodes[a].y); if (k !== a && d < bd) { bd = d; best = k; } });
        if (best >= 0) signals.push({ a, b: best, t: 0, speed: 0.008 + Math.random() * 0.01 });
      }
      for (let i = signals.length - 1; i >= 0; i--) { signals[i].t += signals[i].speed; if (signals[i].t >= 1) signals.splice(i, 1); }
      draw();
    };

    resize();
    window.addEventListener("resize", resize);
    if (reduce) draw(); else raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, [theme, density]);

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
      <div className="ambient-orb -left-40 -top-40 h-[520px] w-[520px] bg-primary/[0.10]" />
      <div className="ambient-orb -right-40 top-1/3 h-[460px] w-[460px] bg-secondary/[0.08]" style={{ animationDelay: "-9s" }} />
      <div className="ambient-orb bottom-[-200px] left-1/3 h-[520px] w-[520px] bg-space/[0.35]" style={{ animationDelay: "-17s" }} />
      <canvas ref={ref} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
