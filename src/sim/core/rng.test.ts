import { describe, expect, it } from 'vitest';
import { Rng } from './rng';

describe('Rng', () => {
  it('is reproducible from the same seed', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
  });

  it('diverges for different seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    let same = 0;
    for (let i = 0; i < 200; i++) if (a.next() === b.next()) same++;
    expect(same).toBeLessThan(3);
  });

  it('accepts string seeds', () => {
    const a = new Rng('ecosystem');
    const b = new Rng('ecosystem');
    const c = new Rng('ecosysten');
    expect(a.next()).toBe(b.next());
    expect(a.next()).not.toBe(c.next());
  });

  it('stays inside [0,1)', () => {
    const r = new Rng(7);
    for (let i = 0; i < 20000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int(n) covers the range without exceeding it', () => {
    const r = new Rng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const v = r.int(8);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(8);
      seen.add(v);
    }
    expect(seen.size).toBe(8);
  });

  it('produces a roughly uniform distribution', () => {
    const r = new Rng(4242);
    const buckets = new Array(10).fill(0);
    const n = 100000;
    for (let i = 0; i < n; i++) buckets[Math.floor(r.next() * 10)]++;
    for (const b of buckets) {
      expect(b).toBeGreaterThan(n / 10 - n / 100);
      expect(b).toBeLessThan(n / 10 + n / 100);
    }
  });

  it('normal() has approximately the requested mean and spread', () => {
    const r = new Rng(31337);
    let sum = 0;
    let sumSq = 0;
    const n = 50000;
    for (let i = 0; i < n; i++) {
      const v = r.normal(2, 3);
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / n;
    const sd = Math.sqrt(sumSq / n - mean * mean);
    expect(Math.abs(mean - 2)).toBeLessThan(0.08);
    expect(Math.abs(sd - 3)).toBeLessThan(0.08);
  });

  /**
   * Regression: normal() used to cache the second Box-Muller value, which is
   * stream state the four saved words do not describe. A restored stream then
   * sat one draw away from where it was, and a forked world drifted from its
   * parent within a few hundred ticks.
   */
  it('save/load restores the stream position even across normal()', () => {
    const r = new Rng(556);
    for (let i = 0; i < 10; i++) r.next();
    r.normal(); // would leave a hidden cached twin behind
    const state = r.saveState();
    const expected = Array.from({ length: 20 }, () => r.next());

    const restored = new Rng(1);
    restored.loadState(state);
    expect(Array.from({ length: 20 }, () => restored.next())).toEqual(expected);
  });

  it('save/load restores the exact stream position', () => {
    const r = new Rng(555);
    for (let i = 0; i < 50; i++) r.next();
    const state = r.saveState();
    const expected = Array.from({ length: 20 }, () => r.next());

    const restored = new Rng(1);
    restored.loadState(state);
    expect(Array.from({ length: 20 }, () => restored.next())).toEqual(expected);
  });

  it('fork() is deterministic and independent', () => {
    const a = new Rng(11);
    const b = new Rng(11);
    const fa = a.fork();
    const fb = b.fork();
    expect(fa.next()).toBe(fb.next());
  });
});
