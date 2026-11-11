import { motion } from "framer-motion";
import { useId } from "react";

/**
 * TRANZIQ brand symbol - "the Signal Q".
 * An open ring (the monitored transaction network) carrying three nodes,
 * pierced by a transaction path that exits through the gap and becomes the
 * tail of the Q: every transaction passes through the intelligence layer.
 */
export function BrandMark({ size = 32, animate = false, className = "" }: { size?: number; animate?: boolean; className?: string }) {
  const id = useId().replace(/:/g, "");
  const draw = animate
    ? { initial: { pathLength: 0, opacity: 0 }, animate: { pathLength: 1, opacity: 1 } }
    : { initial: false as const };
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="rgb(124,92,255)" />
          <stop offset="1" stopColor="rgb(34,211,238)" />
        </linearGradient>
      </defs>
      <motion.path
        d="M44.5 41.8A17 17 0 1 1 49 32"
        fill="none" stroke={`url(#g${id})`} strokeWidth="4.2" strokeLinecap="round"
        {...draw} transition={{ duration: 1.1, ease: "easeInOut" }}
      />
      <motion.path
        d="M22 22L34 34l14 14"
        fill="none" stroke={`url(#g${id})`} strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round"
        strokeDasharray={animate ? undefined : "0"}
        {...draw} transition={{ duration: 0.8, delay: animate ? 0.7 : 0, ease: "easeOut" }}
      />
      {[
        [15, 32, 0.9],
        [32, 15, 1.0],
        [34, 34, 1.2],
      ].map(([cx, cy, d], i) => (
        <motion.circle
          key={i} cx={cx} cy={cy} r={i === 2 ? 4.2 : 3}
          fill={i === 2 ? "rgb(34,211,238)" : "rgb(124,92,255)"}
          initial={animate ? { scale: 0 } : false} animate={{ scale: 1 }}
          transition={{ delay: animate ? d : 0, type: "spring", stiffness: 300, damping: 15 }}
        />
      ))}
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`select-none font-sans font-extrabold tracking-brand ${className}`}>
      TRANZ<span className="grad-text">IQ</span>
    </span>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark size={30} />
      {!compact && (
        <div className="leading-none">
          <Wordmark className="text-[15px]" />
          <div className="mt-1 font-mono text-[8.5px] uppercase tracking-[0.2em] text-ink-3">Risk Intelligence</div>
        </div>
      )}
    </div>
  );
}
