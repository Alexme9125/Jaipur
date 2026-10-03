import { TOKENS_PER_RUPEE } from './engine/constants';

export function rupeesToTokens(r: number): number {
  return r * TOKENS_PER_RUPEE;
}

const UNITS: [number, string][] = [
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'K'],
];

/**
 * Base-1000 compact format. Below 1,000 → integer string; otherwise the
 * largest fitting unit with at most 2 decimals and trailing zeros trimmed.
 * 7000 → "7K", 23000 → "23K", 1250000 → "1.25M", 999 → "999".
 */
export function formatTokens(tokens: number): string {
  const abs = Math.abs(tokens);
  if (abs < 1000) return String(Math.trunc(tokens));
  for (const [unit, suffix] of UNITS) {
    if (abs >= unit) {
      const v = tokens / unit;
      const s = v.toFixed(2).replace(/\.?0+$/, '');
      return `${s}${suffix}`;
    }
  }
  return String(Math.trunc(tokens));
}
