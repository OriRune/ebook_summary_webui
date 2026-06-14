import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Raw palette (supplied) — available directly when a literal swatch is wanted.
        ink: "var(--ink)",
        wisteria: "var(--wisteria)",
        lavender: "var(--lavender)",
        coral: "var(--coral)",
        tea: "var(--tea)",

        // Semantic tokens backed by CSS variables (see globals.css) so the whole
        // palette switches with the data-theme attribute.
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        fg: "var(--fg)",
        muted: "var(--muted)",
        border: "var(--border)",
        accent: "var(--accent)",
        "accent-fg": "var(--accent-fg)",
        selected: "var(--selected)",
        "selected-fg": "var(--selected-fg)",
        heading: "var(--heading)",
        link: "var(--link)",
        success: "var(--success)",
        warn: "var(--warn)",
      },
      fontFamily: {
        serif: "var(--font-serif)",
      },
      boxShadow: {
        soft: "var(--shadow)",
      },
    },
  },
  plugins: [],
};

export default config;
