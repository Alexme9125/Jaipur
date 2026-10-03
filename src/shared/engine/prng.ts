/**
 * Engine randomness.
 *
 * - GameState carries two independent sfc32 streams (128-bit state each):
 *   `rng` drives shuffles and all gameplay randomness; `idRng` only mints
 *   the opaque card/bonus ids that reach clients, so observed ids can't be
 *   used to recover the deck order.
 * - mulberry32 is kept for non-engine use (bot move sampling, tests).
 */

export type Sfc32State = [number, number, number, number];

/** Advance one sfc32 step. Returns [float in [0,1), next state]. */
export function sfc32Next(st: Sfc32State): [number, Sfc32State] {
  let [a, b, c, d] = st;
  a >>>= 0;
  b >>>= 0;
  c >>>= 0;
  d >>>= 0;
  const t0 = (a + b) | 0;
  a = (b ^ (b >>> 9)) | 0;
  b = (c + (c << 3)) | 0;
  c = ((c << 21) | (c >>> 11)) | 0;
  d = (d + 1) | 0;
  const t = (t0 + d) | 0;
  c = (c + t) | 0;
  return [(t >>> 0) / 4294967296, [a, b, c, d]];
}

export function splitmix32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x9e3779b9) | 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = (z ^ (z >>> 13)) | 0;
    z = Math.imul(z, 0xc2b2ae35);
    z = (z ^ (z >>> 16)) | 0;
    return z >>> 0;
  };
}

/**
 * Expand a seed into the two engine streams.
 * - number: splitmix32 expansion into 8 words (deterministic tests).
 * - number[8]: first 4 words = game stream, last 4 = id stream
 *   (servers pass crypto.getRandomValues(new Uint32Array(8))).
 */
export function expandSeed(seed: number | number[]): { rng: Sfc32State; idRng: Sfc32State } {
  if (Array.isArray(seed)) {
    if (seed.length !== 8) throw new Error('seed array must be 8 uint32 words');
    const w = seed.map((x) => x >>> 0);
    return {
      rng: [w[0]!, w[1]!, w[2]!, w[3]!],
      idRng: [w[4]!, w[5]!, w[6]!, w[7]!],
    };
  }
  const next = splitmix32(seed);
  const w = Array.from({ length: 8 }, () => next());
  return {
    rng: [w[0]!, w[1]!, w[2]!, w[3]!] as Sfc32State,
    idRng: [w[4]!, w[5]!, w[6]!, w[7]!] as Sfc32State,
  };
}

/** Advance one mulberry32 step. Returns [float in [0,1), next state]. */
export function rngNext(state: number): [number, number] {
  let s = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), s | 1);
  t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}

/** Non-engine helper (bot move sampling, tests). */
export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    const [v, next] = rngNext(s);
    s = next;
    return v;
  };
}
