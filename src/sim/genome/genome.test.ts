import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { DEFAULT_CONFIG } from '../core/config';
import { GENOME_LENGTH, Locus, geneticDistance } from './loci';
import { expressInto, makePhenotype, MAX_CONTEXT, MAX_HIDDEN } from './phenotype';
import {
  crossoverBrain,
  crossoverGenome,
  mutateBrain,
  mutateGenome,
  randomGenome,
} from '../evolution/reproduction';
import { BRAIN_STRIDE, randomizeBrain } from '../brain/brain';

function makeGenome(rng: Rng): Float32Array {
  const g = new Float32Array(GENOME_LENGTH);
  randomGenome(g, 0, rng);
  return g;
}

describe('genome', () => {
  it('random genomes stay in gene space', () => {
    const rng = new Rng(1);
    for (let t = 0; t < 200; t++) {
      const g = makeGenome(rng);
      for (let i = 0; i < GENOME_LENGTH; i++) {
        expect(g[i]).toBeGreaterThanOrEqual(0);
        expect(g[i]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('mutation never escapes [0,1]', () => {
    const rng = new Rng(2);
    const g = makeGenome(rng);
    const cfg = { ...DEFAULT_CONFIG, baseMutationRate: 1, mutationSigma: 0.9 };
    for (let t = 0; t < 2000; t++) {
      mutateGenome(g, 0, cfg, rng, 3);
      for (let i = 0; i < GENOME_LENGTH; i++) {
        expect(g[i]).toBeGreaterThanOrEqual(0);
        expect(g[i]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('mutation actually changes genes, and rate scales the effect', () => {
    const rng = new Rng(3);
    const base = makeGenome(rng);

    const low = Float32Array.from(base);
    let lowCount = 0;
    for (let t = 0; t < 50; t++) lowCount += mutateGenome(low, 0, DEFAULT_CONFIG, rng, 0.1);

    const high = Float32Array.from(base);
    let highCount = 0;
    for (let t = 0; t < 50; t++) highCount += mutateGenome(high, 0, DEFAULT_CONFIG, rng, 3);

    expect(highCount).toBeGreaterThan(lowCount);
    expect(highCount).toBeGreaterThan(0);
  });

  it('crossover takes every gene from one of the two parents', () => {
    const rng = new Rng(4);
    const a = makeGenome(rng);
    const b = makeGenome(rng);
    const child = new Float32Array(GENOME_LENGTH);
    for (let t = 0; t < 100; t++) {
      crossoverGenome(child, 0, a, 0, b, 0, rng);
      for (let i = 0; i < GENOME_LENGTH; i++) {
        expect(child[i] === a[i] || child[i] === b[i]).toBe(true);
      }
    }
  });

  it('crossover mixes: children are not always one parent', () => {
    const rng = new Rng(5);
    const a = new Float32Array(GENOME_LENGTH).fill(0);
    const b = new Float32Array(GENOME_LENGTH).fill(1);
    const child = new Float32Array(GENOME_LENGTH);
    let mixed = 0;
    for (let t = 0; t < 100; t++) {
      crossoverGenome(child, 0, a, 0, b, 0, rng);
      let fromA = 0;
      for (let i = 0; i < GENOME_LENGTH; i++) if (child[i] === 0) fromA++;
      if (fromA > 0 && fromA < GENOME_LENGTH) mixed++;
    }
    expect(mixed).toBeGreaterThan(80);
  });
});

describe('genetic distance', () => {
  it('is zero for identical genomes and symmetric', () => {
    const rng = new Rng(6);
    const a = makeGenome(rng);
    const b = makeGenome(rng);
    expect(geneticDistance(a, 0, a, 0)).toBe(0);
    expect(geneticDistance(a, 0, b, 0)).toBeCloseTo(geneticDistance(b, 0, a, 0), 10);
  });

  it('is bounded by 1 and grows with divergence', () => {
    const zeros = new Float32Array(GENOME_LENGTH).fill(0);
    const ones = new Float32Array(GENOME_LENGTH).fill(1);
    const half = new Float32Array(GENOME_LENGTH).fill(0.5);
    expect(geneticDistance(zeros, 0, ones, 0)).toBeCloseTo(1, 6);
    expect(geneticDistance(zeros, 0, half, 0)).toBeLessThan(
      geneticDistance(zeros, 0, ones, 0),
    );
  });

  it('weights ecologically meaningful loci above neutral markers', () => {
    const base = new Float32Array(GENOME_LENGTH).fill(0.5);
    const dietShift = Float32Array.from(base);
    dietShift[Locus.Digestion] = 1;
    const hueShift = Float32Array.from(base);
    hueShift[Locus.Hue] = 1;
    expect(geneticDistance(base, 0, dietShift, 0)).toBeGreaterThan(
      geneticDistance(base, 0, hueShift, 0),
    );
  });
});

describe('phenotype expression', () => {
  it('is a pure function of the genome', () => {
    const rng = new Rng(7);
    const g = makeGenome(rng);
    const a = expressInto(makePhenotype(), g, 0);
    const b = expressInto(makePhenotype(), g, 0);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('keeps every derived quantity finite and positive', () => {
    const rng = new Rng(8);
    const p = makePhenotype();
    for (let t = 0; t < 500; t++) {
      const g = new Float32Array(GENOME_LENGTH);
      for (let i = 0; i < GENOME_LENGTH; i++) g[i] = rng.next();
      expressInto(p, g, 0);
      for (const [key, v] of Object.entries(p)) {
        expect(Number.isFinite(v), `${key} finite`).toBe(true);
        expect(v, `${key} non-negative`).toBeGreaterThanOrEqual(0);
      }
      expect(p.hiddenSize).toBeGreaterThanOrEqual(2);
      expect(p.hiddenSize).toBeLessThanOrEqual(MAX_HIDDEN);
      expect(p.contextSize).toBeLessThanOrEqual(MAX_CONTEXT);
    }
  });

  it('charges for what it grants: bigger bodies cost more upkeep', () => {
    const small = new Float32Array(GENOME_LENGTH).fill(0.5);
    small[Locus.BodySize] = 0.1;
    const large = Float32Array.from(small);
    large[Locus.BodySize] = 0.95;
    const a = expressInto(makePhenotype(), small, 0);
    const upkeepSmall = a.upkeep;
    const b = expressInto(makePhenotype(), large, 0);
    expect(b.upkeep).toBeGreaterThan(upkeepSmall);
    expect(b.radius).toBeGreaterThan(a.radius);
  });

  it('makes gut specialisation a real trade-off', () => {
    const g = new Float32Array(GENOME_LENGTH).fill(0.5);
    const p = makePhenotype();

    g[Locus.Digestion] = 0;
    expressInto(p, g, 0);
    expect(p.plantEfficiency).toBeCloseTo(1, 5);
    expect(p.meatEfficiency).toBeCloseTo(0, 5);

    g[Locus.Digestion] = 1;
    expressInto(p, g, 0);
    expect(p.meatEfficiency).toBeCloseTo(1, 5);
    expect(p.plantEfficiency).toBeCloseTo(0, 5);

    // A generalist must be worse at both than either specialist is at its own.
    g[Locus.Digestion] = 0.5;
    expressInto(p, g, 0);
    expect(p.plantEfficiency).toBeLessThan(1);
    expect(p.meatEfficiency).toBeLessThan(1);
    expect(p.plantEfficiency + p.meatEfficiency).toBeLessThan(2);
  });
});

describe('brain genome', () => {
  it('randomised weights are finite and modest', () => {
    const rng = new Rng(9);
    const brain = new Float32Array(BRAIN_STRIDE);
    randomizeBrain(brain, 0, () => rng.next());
    for (let i = 0; i < BRAIN_STRIDE; i++) {
      expect(Number.isFinite(brain[i])).toBe(true);
      expect(Math.abs(brain[i])).toBeLessThan(2);
    }
  });

  it('brain mutation keeps weights bounded', () => {
    const rng = new Rng(10);
    const brain = new Float32Array(BRAIN_STRIDE);
    randomizeBrain(brain, 0, () => rng.next());
    const cfg = { ...DEFAULT_CONFIG, brainMutationRate: 1, brainMutationSigma: 2 };
    for (let t = 0; t < 300; t++) mutateBrain(brain, 0, cfg, rng, 3);
    for (let i = 0; i < BRAIN_STRIDE; i++) {
      expect(Number.isFinite(brain[i])).toBe(true);
      expect(Math.abs(brain[i])).toBeLessThanOrEqual(6.5);
    }
  });

  it('brain crossover inherits whole units, never blends weights', () => {
    const rng = new Rng(11);
    const a = new Float32Array(BRAIN_STRIDE).fill(1);
    const b = new Float32Array(BRAIN_STRIDE).fill(-1);
    const child = new Float32Array(BRAIN_STRIDE);
    crossoverBrain(child, 0, a, 0, b, 0, rng);
    for (let i = 0; i < BRAIN_STRIDE; i++) {
      expect(child[i] === 1 || child[i] === -1).toBe(true);
    }
  });
});
