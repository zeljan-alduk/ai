'use client';

/**
 * ThemeToggle — sun/moon/laptop icon that cycles light -> dark -> system.
 *
 * Two responsibilities:
 *
 *  1. Persist the user's choice via the `setThemeAction` server action
 *     so it survives the next request.
 *
 *  2. Apply the right class to `<html>` immediately so the UI flips
 *     without waiting for a round-trip. On `'system'` we install a
 *     `matchMedia` listener so a system-level theme change still
 *     re-styles the page.
 *
 * Mounted once in the root layout. The initial theme is passed in
 * from the server (cookie read) so SSR + client agree on first paint.
 */

import { cn } from '@/lib/cn';
import { type Theme, nextTheme } from '@/lib/theme';
import { setThemeAction } from '@/lib/theme-actions';
import { Laptop, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

const ICON: Record<Theme, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Laptop,
};

const LABEL: Record<Theme, string> = {
  light: 'Light theme',
  dark: 'Dark theme',
  system: 'System theme',
};

function applyTheme(theme: Theme): void {
  const html = document.documentElement;
  if (theme === 'dark') {
    html.classList.add('dark');
    return;
  }
  if (theme === 'light') {
    html.classList.remove('dark');
    return;
  }
  // system — follow the media query.
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  html.classList.toggle('dark', prefersDark);
}

export interface ThemeToggleProps {
  /** Theme resolved server-side from the cookie. */
  initialTheme: Theme;
  className?: string;
}

export function ThemeToggle({ initialTheme, className }: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  // Re-sync the html class whenever the theme changes. Also subscribe
  // to system changes when in `'system'` mode.
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const Icon = ICON[theme];

  function handleClick() {
    const next = nextTheme(theme);
    setTheme(next);
    // Fire-and-forget — server action persists for the next request.
    void setThemeAction(next);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={LABEL[theme]}
      aria-label={LABEL[theme]}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        className,
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  );
}
