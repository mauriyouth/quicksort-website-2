module.exports = {
  content: [
    "./src/**/*.{html,js,ts,jsx,tsx}",
    "app/**/*.{ts,tsx}",
    "components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        /* Brand families. Reach for these in new work. */
        "qs-display": "var(--qs-font-display)",
        "qs-sans": "var(--qs-font-sans)",
        "qs-mono": "var(--qs-font-mono)",

        /* Named steps of the site's type scale. Each pairs a family with
           its size, weight, tracking and leading via the vars in
           tailwind.css — display steps are Hanken Grotesk, text steps
           are Inter. */
        "display-lg-semibold": "var(--display-lg-semibold-font-family)",
        "display-md-semibold": "var(--display-md-semibold-font-family)",
        "display-sm-semibold": "var(--display-sm-semibold-font-family)",
        "display-xs-semibold": "var(--display-xs-semibold-font-family)",
        "text-xl-semibold": "var(--text-xl-semibold-font-family)",
        "text-xl-regular": "var(--text-xl-regular-font-family)",
        "text-lg-semibold": "var(--text-lg-semibold-font-family)",
        "text-md-semibold": "var(--text-md-semibold-font-family)",
        "text-md-medium": "var(--text-md-medium-font-family)",
        "text-md-regular": "var(--text-md-regular-font-family)",
        "text-sm-semibold": "var(--text-sm-semibold-font-family)",
        "text-sm-medium": "var(--text-sm-medium-font-family)",
        "m3-title-large": "var(--m3-title-large-font-family)",

        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
          '"Apple Color Emoji"',
          '"Segoe UI Emoji"',
          '"Segoe UI Symbol"',
          '"Noto Color Emoji"',
        ],
      },
      boxShadow: {
        "backdrop-blurs-backdrop-blur-lg":
          "var(--backdrop-blurs-backdrop-blur-lg)",
        "shadows-shadow-xs": "var(--shadows-shadow-xs)",
        "qs-1": "var(--qs-shadow-1)",
        "qs-2": "var(--qs-shadow-2)",
        "qs-3": "var(--qs-shadow-3)",
      },
      colors: {
        /* ── Quicksort design system · semantic tokens ──────────────
           Defined in tailwind.css. Never write a raw hex in a
           component — if a colour is missing, add a token there.
           Opacity modifiers work: text-ink/40, border-signal/20. */
        surface: {
          DEFAULT: "rgb(var(--qs-surface-rgb) / <alpha-value>)",
          raised: "rgb(var(--qs-surface-raised-rgb) / <alpha-value>)",
          sunken: "rgb(var(--qs-surface-sunken-rgb) / <alpha-value>)",
          inverse: "rgb(var(--qs-surface-inverse-rgb) / <alpha-value>)",
          "inverse-hover": "rgb(var(--qs-surface-inverse-hover-rgb) / <alpha-value>)",
          scrim: "var(--qs-surface-scrim)",
        },
        ink: {
          DEFAULT: "rgb(var(--qs-ink-rgb) / <alpha-value>)",
          2: "rgb(var(--qs-ink-2-rgb) / <alpha-value>)",
          muted: "rgb(var(--qs-ink-muted-rgb) / <alpha-value>)",
          faint: "rgb(var(--qs-ink-faint-rgb) / <alpha-value>)",
          inverse: "rgb(var(--qs-ink-inverse-rgb) / <alpha-value>)",
        },
        line: {
          DEFAULT: "rgb(var(--qs-line-rgb) / <alpha-value>)",
          strong: "var(--qs-line-strong)",
          faint: "var(--qs-line-faint)",
          hair: "var(--qs-hairline)",
        },
        signal: {
          DEFAULT: "rgb(var(--qs-signal-rgb) / <alpha-value>)",
          hover: "rgb(var(--qs-signal-hover-rgb) / <alpha-value>)",
          fg: "rgb(var(--qs-signal-fg-rgb) / <alpha-value>)",
          text: "rgb(var(--qs-signal-text-rgb) / <alpha-value>)",
          soft: "var(--qs-signal-soft)",
        },
        cat: {
          violet: "rgb(var(--qs-cat-violet-rgb) / <alpha-value>)",
          "violet-soft": "rgb(var(--qs-cat-violet-soft-rgb) / <alpha-value>)",
          pink: "rgb(var(--qs-cat-pink-rgb) / <alpha-value>)",
          "pink-soft": "rgb(var(--qs-cat-pink-soft-rgb) / <alpha-value>)",
          "pink-deep": "rgb(var(--qs-cat-pink-deep-rgb) / <alpha-value>)",
          blue: "rgb(var(--qs-cat-blue-rgb) / <alpha-value>)",
          red: "rgb(var(--qs-cat-red-rgb) / <alpha-value>)",
          "red-soft": "rgb(var(--qs-cat-red-soft-rgb) / <alpha-value>)",
          green: "rgb(var(--qs-cat-green-rgb) / <alpha-value>)",
          "green-deep": "rgb(var(--qs-cat-green-deep-rgb) / <alpha-value>)",
          "pink-tint": "rgb(var(--qs-cat-pink-tint-rgb) / <alpha-value>)",
          "pink-tint-fg": "rgb(var(--qs-cat-pink-tint-fg-rgb) / <alpha-value>)",
        },
        /* Text sitting on a saturated fill (lime, category chips) —
           white in both themes, because the fill stays saturated. */
        "on-fill": "rgb(var(--qs-on-fill-rgb) / <alpha-value>)",
        "photo-scrim": "var(--qs-photo-scrim)",

        /* ── shadcn/ui compatibility ────────────────────────────────
           Re-pointed at the same tokens so the ui/ primitives theme
           along with everything else. */
        border: "rgb(var(--qs-line-rgb) / <alpha-value>)",
        input: "rgb(var(--qs-line-rgb) / <alpha-value>)",
        ring: "rgb(var(--qs-signal-rgb) / <alpha-value>)",
        background: "rgb(var(--qs-surface-rgb) / <alpha-value>)",
        foreground: "rgb(var(--qs-ink-rgb) / <alpha-value>)",
        primary: {
          DEFAULT: "rgb(var(--qs-surface-inverse-rgb) / <alpha-value>)",
          foreground: "rgb(var(--qs-ink-inverse-rgb) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "rgb(var(--qs-surface-sunken-rgb) / <alpha-value>)",
          foreground: "rgb(var(--qs-ink-rgb) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "rgb(var(--qs-danger-rgb) / <alpha-value>)",
          foreground: "rgb(var(--qs-on-fill-rgb) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "rgb(var(--qs-surface-raised-rgb) / <alpha-value>)",
          foreground: "rgb(var(--qs-ink-muted-rgb) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--qs-surface-sunken-rgb) / <alpha-value>)",
          foreground: "rgb(var(--qs-ink-rgb) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "rgb(var(--qs-surface-raised-rgb) / <alpha-value>)",
          foreground: "rgb(var(--qs-ink-rgb) / <alpha-value>)",
        },
        card: {
          DEFAULT: "transparent",
          foreground: "rgb(var(--qs-ink-rgb) / <alpha-value>)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        /* Brand radii — cards 16, hero cards 20, capsules 10, pills. */
        "qs-sm": "var(--qs-radius-sm)",
        "qs-md": "var(--qs-radius-md)",
        "qs-lg": "var(--qs-radius-lg)",
        "qs-xl": "var(--qs-radius-xl)",
        "qs-pill": "var(--qs-radius-pill)",
      },
      spacing: {
        "qs-1": "var(--qs-space-1)",
        "qs-2": "var(--qs-space-2)",
        "qs-3": "var(--qs-space-3)",
        "qs-4": "var(--qs-space-4)",
        "qs-5": "var(--qs-space-5)",
        "qs-6": "var(--qs-space-6)",
        "qs-7": "var(--qs-space-7)",
        "qs-8": "var(--qs-space-8)",
        "qs-9": "var(--qs-space-9)",
        "qs-10": "var(--qs-space-10)",
      },
      transitionTimingFunction: {
        qs: "var(--qs-ease)",
        "qs-out": "var(--qs-ease-out)",
      },
      transitionDuration: {
        "qs-1": "120ms",
        "qs-2": "200ms",
        "qs-3": "360ms",
        "qs-4": "640ms",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
    container: { center: true, padding: "2rem", screens: { "2xl": "1400px" } },
  },
  plugins: [],
  darkMode: ["class", '[data-theme="dark"]'],
};
