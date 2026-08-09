/**
 * Deterministic PRNG. sfc32 — small, fast, high quality, 128-bit state.
 * Everything stochastic in the simulation MUST come from here so a given
 * (seed + config + initial population) always replays identically.
 *
 * State is 4x uint32 so it can be serialised into a save file verbatim.
 */
export class Rng {
  private a = 0;
  private b = 0;
  private c = 0;
  private d = 0;

  constructor(seed: number | string = 1) {
    this.seedWith(seed);
  }

  seedWith(seed: number | string): void {
    let h = typeof seed === 'string' ? hashString(seed) : (seed >>> 0) || 1;
    // splitmix32 to expand the seed into the 4 words of state.
    const next = () => {
      h = (h + 0x9e3779b9) >>> 0;
      let z = h;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
      return (z ^ (z >>> 15)) >>> 0;
    };
    this.a = next();
    this.b = next();
    this.c = next();
    this.d = next();
    // Warm up so early draws are well mixed.
    for (let i = 0; i < 12; i++) this.next();
  }

  /** Raw uint32. */
  nextU32(): number {
    const t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    const r = (t + this.d) | 0;
    this.c = (this.c + r) | 0;
    return r >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return (this.nextU32() % n) >>> 0;
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /**
   * Standard normal via Box-Muller.
   *
   * The usual optimisation is to cache the second value of the pair and return
   * it on the next call. We deliberately do not: that cached float is RNG state
   * that the four state words do not describe, so a saved-and-restored stream
   * would sit one draw away from where it was — enough for a forked world to
   * diverge from its parent within a few hundred ticks, which quietly breaks
   * every controlled experiment. Discarding the twin keeps the entire stream
   * position in `saveState()`. normal() is only called during mutation, so the
   * extra draws cost nothing measurable.
   */
  normal(mean = 0, sd = 1): number {
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = this.next() * 2 - 1;
      v = this.next() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    return mean + u * Math.sqrt((-2 * Math.log(s)) / s) * sd;
  }

  /**
   * Serialise / restore. These four words are the *complete* state — there is
   * deliberately no cached or derived value anywhere else in this class.
   */
  saveState(): Uint32Array {
    return new Uint32Array([this.a >>> 0, this.b >>> 0, this.c >>> 0, this.d >>> 0]);
  }

  loadState(s: ArrayLike<number>): void {
    this.a = s[0] | 0;
    this.b = s[1] | 0;
    this.c = s[2] | 0;
    this.d = s[3] | 0;
  }

  /** A child stream deterministically derived from this one (for sub-systems). */
  fork(): Rng {
    return new Rng(this.nextU32());
  }
}

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0 || 1;
}
