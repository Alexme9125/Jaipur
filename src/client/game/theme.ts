import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'jaipur.theme';
const listeners = new Set<() => void>();
let current: Theme = 'light';
let booted = false;

/** 'dark' only if the stored value is exactly 'dark' — light is the default,
    independent of prefers-color-scheme. */
export function loadTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(t: Theme): void {
  const changed = booted && t !== current;
  current = t;
  document.documentElement.dataset.theme = t;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', t === 'dark' ? '#11162E' : '#EDF2F3');
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* storage unavailable */
  }
  if (changed) {
    const el = document.documentElement;
    el.classList.add('theme-switching');
    window.setTimeout(() => el.classList.remove('theme-switching'), 400);
  }
  booted = true;
  listeners.forEach((l) => l());
}

export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => current,
    () => current,
  );
  return [theme, () => applyTheme(current === 'dark' ? 'light' : 'dark')];
}
