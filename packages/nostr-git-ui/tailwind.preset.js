// Tailwind preset for @nostr-git/ui
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--ng-border))",
        input: "hsl(var(--ng-input))",
        ring: "hsl(var(--ng-ring))",
        background: "hsl(var(--ng-background))",
        foreground: "hsl(var(--ng-foreground))",
        primary: {
          DEFAULT: "hsl(var(--ng-primary))",
          foreground: "hsl(var(--ng-primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--ng-secondary))",
          foreground: "hsl(var(--ng-secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--ng-destructive))",
          foreground: "hsl(var(--ng-destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--ng-muted))",
          foreground: "hsl(var(--ng-muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--ng-accent))",
          foreground: "hsl(var(--ng-accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--ng-popover))",
          foreground: "hsl(var(--ng-popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--ng-card))",
          foreground: "hsl(var(--ng-card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--ng-sidebar-background))",
          foreground: "hsl(var(--ng-sidebar-foreground))",
          primary: "hsl(var(--ng-sidebar-primary))",
          "primary-foreground": "hsl(var(--ng-sidebar-primary-foreground))",
          accent: "hsl(var(--ng-sidebar-accent))",
          "accent-foreground": "hsl(var(--ng-sidebar-accent-foreground))",
          border: "hsl(var(--ng-sidebar-border))",
          ring: "hsl(var(--ng-sidebar-ring))",
        },
        git: {
          DEFAULT: "#d7b42c",
          hover: "#bd971b",
          issue: "#f97316",
          patch: "#0ea5e9",
          merged: "#10b981",
          closed: "#ef4444",
          wiki: "#f59e0b",
          session: "#d7b42c",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
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
        "pulse-git": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.6" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pulse-git": "pulse-git 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
