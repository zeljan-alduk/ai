import type { Config } from 'tailwindcss';

/**
 * Tailwind config.
 *
 * Two notable choices:
 *
 * 1. `darkMode: 'class'` — the html element gets/loses `class="dark"`
 *    via the ThemeToggle client island. The server reads the
 *    `aldo_theme` cookie and ships the right class on the SSR'd
 *    document so there is no flash-of-wrong-theme.
 *
 * 2. Semantic colour tokens. Components write `bg-bg`, `text-fg`,
 *    `border-border` etc.; the actual hex flips automatically when
 *    `html.dark` is set. Each token reads from a CSS custom property
 *    declared in `app/globals.css` using the `<alpha-value>`
 *    placeholder so `bg-accent/30` works.
 */
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    // Wave-15E — Tailwind ships sm/md/lg/xl/2xl by default. We add an
    // `xs` breakpoint at 480px so cards that need to widen between
    // iPhone SE (360px) and a phablet stop being either too cramped
    // or too sprawling. The default `screens` are spread back in so
    // we don't lose them by overriding the key.
    screens: {
      xs: '480px',
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
    extend: {
      // Safe-area-inset utilities for iPhone notch / Android gesture
      // bar. Use as `pt-safe`, `pb-safe`, `pl-safe`, `pr-safe`. The
      // `env(safe-area-inset-*)` values evaluate to `0px` on devices
      // that don't have an inset, so they're always safe to apply.
      padding: {
        safe: 'env(safe-area-inset-top)',
        'safe-b': 'env(safe-area-inset-bottom)',
        'safe-l': 'env(safe-area-inset-left)',
        'safe-r': 'env(safe-area-inset-right)',
      },
      // Minimum touch target — used as `min-h-touch min-w-touch` on
      // anything tappable to keep us above the WCAG 2.5.5 (and
      // platform-default) 44×44px target size.
      minWidth: {
        touch: '44px',
      },
      minHeight: {
        touch: '44px',
      },
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        'bg-elevated': 'rgb(var(--bg-elevated) / <alpha-value>)',
        'bg-subtle': 'rgb(var(--bg-subtle) / <alpha-value>)',
        fg: 'rgb(var(--fg) / <alpha-value>)',
        'fg-muted': 'rgb(var(--fg-muted) / <alpha-value>)',
        'fg-faint': 'rgb(var(--fg-faint) / <alpha-value>)',
        'fg-inverse': 'rgb(var(--fg-inverse) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        'border-strong': 'rgb(var(--border-strong) / <alpha-value>)',
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          fg: 'rgb(var(--accent-fg) / <alpha-value>)',
          hover: 'rgb(var(--accent-hover) / <alpha-value>)',
          subtle: 'rgb(var(--accent-subtle) / <alpha-value>)',
        },
        success: 'rgb(var(--success) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        ring: 'rgb(var(--ring) / <alpha-value>)',
      },
      borderRadius: {
        sm: '0.25rem',
        md: '0.375rem',
        lg: '0.5rem',
        xl: '0.75rem',
      },
      animation: {
        'fade-in': 'fade-in 0.6s ease-out both',
        'fade-in-slow': 'fade-in-slow 1.2s ease-out both',
        'blob-float': 'blob-float 18s ease-in-out infinite',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in-slow': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
