/**
 * The app's theme system.
 *
 * There was no theme system before this: `index.css` hard-coded
 * `color-scheme: dark` on `:root` and every token was a dark value, so there
 * was nothing to hook into and this is the one place the light palette is
 * defined from. It follows the same shape as the other providers in the app
 * (`useAuth`, `useToast`): a context + a hook, mounted once in `App.tsx`.
 *
 * ## Three states, not two
 *
 * 'system' is the default and is a genuinely distinct state from 'dark': it
 * tracks the OS setting live, so a phone that flips to dark at sunset flips the
 * app with it. Choosing 'light' or 'dark' explicitly pins it and stops
 * following the OS. Storing 'system' as itself (rather than resolving it to a
 * concrete value at write time) is what keeps that live-follow behaviour.
 *
 * ## How it reaches the CSS
 *
 * `data-theme="light" | "dark"` is written on `<html>` with the RESOLVED value,
 * so CSS only ever has to match two cases and never has to know about 'system'.
 * `color-scheme` is set alongside it so native form controls, scrollbars and
 * the on-screen keyboard follow too — CSS variables alone do not do that.
 *
 * The theme is also applied in a blocking inline script in `index.html` before
 * first paint. Without that there is a white flash on every cold start for
 * dark-mode users, which is the single most visible bug a theme toggle can ship.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/** Shared with the inline boot script in `index.html`; keep the two in step. */
export const THEME_STORAGE_KEY = 'ff-theme';

interface ThemeContextValue {
  /** What the user picked, including 'system'. */
  choice: ThemeChoice;
  /** What that actually resolves to right now. */
  theme: ResolvedTheme;
  setChoice: (choice: ThemeChoice) => void;
  /** Cycles light -> dark -> system, for the header button. */
  cycle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const prefersDark = (): boolean => {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
};

const readStoredChoice = (): ThemeChoice => {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Private mode or blocked storage — 'system' is a fine default.
  }
  return 'system';
};

/**
 * Pure resolution rule, exported so `scripts/steps-proof.mjs` can prove it
 * without a DOM: 'system' follows the OS, an explicit choice pins.
 */
export const resolveTheme = (choice: ThemeChoice, systemPrefersDark: boolean): ResolvedTheme =>
  choice === 'system' ? (systemPrefersDark ? 'dark' : 'light') : choice;

const resolve = (choice: ThemeChoice): ResolvedTheme => resolveTheme(choice, prefersDark());

/** The one place the DOM is touched, so the boot script and React agree. */
const applyTheme = (theme: ResolvedTheme): void => {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  // Drives native controls, scrollbars and the keyboard, which CSS custom
  // properties cannot reach.
  root.style.colorScheme = theme;
  // Keeps the Android status bar and the PWA title bar in step with the app.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#04060A' : '#F4F6FB');
};

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [choice, setChoiceState] = useState<ThemeChoice>(readStoredChoice);
  const [theme, setTheme] = useState<ResolvedTheme>(() => resolve(readStoredChoice()));

  // Apply on mount and whenever the choice changes.
  useEffect(() => {
    const next = resolve(choice);
    setTheme(next);
    applyTheme(next);
  }, [choice]);

  // Follow the OS live, but only while the user is actually on 'system'.
  useEffect(() => {
    if (choice !== 'system' || typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const next: ResolvedTheme = media.matches ? 'dark' : 'light';
      setTheme(next);
      applyTheme(next);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Not persisting is survivable; not switching would not be.
    }
  }, []);

  const cycle = useCallback(() => {
    setChoiceState((current) => {
      const next: ThemeChoice = current === 'light' ? 'dark' : current === 'dark' ? 'system' : 'light';
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        /* see above */
      }
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ choice, theme, setChoice, cycle }),
    [choice, theme, setChoice, cycle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

/**
 * Falls back to a working dark default rather than throwing when used outside
 * the provider. A theme hook is not important enough to blank a screen over,
 * and several components here render inside error boundaries.
 */
export const useTheme = (): ThemeContextValue => {
  const context = useContext(ThemeContext);
  if (context) return context;
  return {
    choice: 'system',
    theme: 'dark',
    setChoice: () => {},
    cycle: () => {},
  };
};
