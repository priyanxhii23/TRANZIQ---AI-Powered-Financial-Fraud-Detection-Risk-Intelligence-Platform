/** TRANZIQ design tokens. Colours are CSS variables (see src/styles/index.css)
 *  so the same class works in light and dark mode. */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: v("bg"),
        "bg-2": v("bg-2"),
        panel: v("panel"),
        ink: v("ink"),
        "ink-2": v("ink-2"),
        "ink-3": v("ink-3"),
        line: v("line"),
        primary: v("primary"),
        tertiary: v("tertiary"),
        aubergine: v("aubergine"),
        space: v("space"),
        secondary: v("secondary"),
        coral: v("coral"),
        amber: v("amber"),
        mint: v("mint"),
      },
      fontFamily: {
        display: ['"Instrument Serif"', "Georgia", "serif"],
        sans: ['"Manrope Variable"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      borderRadius: { xs: "3px", sm: "5px", DEFAULT: "7px", md: "9px", lg: "12px" },
      letterSpacing: { brand: "0.32em", kicker: "0.18em" },
      keyframes: {
        ticker: { "0%": { transform: "translateX(0)" }, "100%": { transform: "translateX(-50%)" } },
        pulseRing: {
          "0%": { transform: "scale(0.8)", opacity: "0.8" },
          "100%": { transform: "scale(2.4)", opacity: "0" },
        },
        scan: { "0%": { transform: "translateY(-100%)" }, "100%": { transform: "translateY(100%)" } },
      },
      animation: {
        ticker: "ticker 60s linear infinite",
        "pulse-ring": "pulseRing 1.8s cubic-bezier(0.2,0.6,0.4,1) infinite",
        scan: "scan 3.5s linear infinite",
      },
    },
  },
  plugins: [],
};
