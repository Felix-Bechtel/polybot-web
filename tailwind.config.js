/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Stitch "Kinetic Terminal" obsidian surface hierarchy.
        // Dividers come from background shifts, not borders.
        canvas:    "#0c1324",   // Level 0 floor
        surface:   "#191f31",   // Level 1 base cards
        "surface-hi":"#23293c", // Level 2 active/nested
        "surface-top":"#2b3249",// Level 3 inputs, focused wells
        signal:    "#204DEE",   // brand Signal Color
        "signal-hi":"#1c4aec",
        "signal-lo":"#b9c3ff",
        // Muted outcome hues (no 100% saturation per Stitch don'ts).
        yes:       "#7FDFB8",
        "yes-bg":  "rgba(127,223,184,0.12)",
        no:        "#FFB4AB",
        "no-bg":   "rgba(255,180,171,0.12)",
        // Accents (also muted).
        opp:       "#93C5FD",  // sky-300
        warn:      "#F5C47A",  // amber-ish but dimmer
        tertiary:  "#FFB59E",  // Stitch's tertiary token
      },
      fontFamily: {
        sans: ['"Inter Tight"', "-apple-system", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SF Mono", "Menlo", "monospace"],
      },
      borderRadius: {
        // Stitch: max xl = 0.75rem. Feel "engineered," not "bubbly."
        "2xl": "0.75rem",
        "3xl": "0.75rem",
      },
      boxShadow: {
        // Ambient, studio-light shadow for floating elements.
        ambient: "0 12px 48px rgba(0,0,0,0.12)",
      },
      backdropBlur: {
        xs: "8px",
      },
    },
  },
  plugins: [],
};
