/**
 * Inheritance: crossover + mutation, for both the body genome and the brain.
 *
 * The mutation rate is itself a gene (Locus.MutationRate), so mutability
 * evolves. In a stable world low-mutation lineages win; after a mass extinction
 * the high-mutation lineages tend to be the ones that find the new optimum.
 */
import type { Rng } from '../core/rng';
import type { SimConfig } from '../core/config';
import {
  GENOME_LENGTH,
  LOCUS_CATEGORY,
  Locus,
  MutationCategory,
  type MutationTally,
} from '../genome/loci';
import { KIN_TAG_LENGTH } from '../organisms/population';
import {
  BRAIN_STRIDE,
  B1_OFFSET,
  B1_SIZE,
  B2_OFFSET,
  B2_SIZE,
  W1_OFFSET,
  W1_SIZE,
  W2_OFFSET,
  W2_SIZE,
  BRAIN_INPUT_WIDTH,
} from '../brain/brain';
import { MAX_HIDDEN } from '../genome/phenotype';

/**
 * Body genome. Uses per-locus uniform crossover (each gene independently from
 * either parent) plus occasional block inheritance, which keeps co-adapted
 * trait clusters — e.g. big + armored + slow — from being shuffled apart every
 * generation.
 */
export function crossoverGenome(
  out: Float32Array,
  outOff: number,
  a: Float32Array,
  aOff: number,
  b: Float32Array,
  bOff: number,
  rng: Rng,
): void {
  // A couple of crossover points: contiguous runs come from the same parent.
  let fromA = rng.chance(0.5);
  const switchProb = 0.18;
  for (let i = 0; i < GENOME_LENGTH; i++) {
    if (rng.chance(switchProb)) fromA = !fromA;
    out[outOff + i] = fromA ? a[aOff + i] : b[bOff + i];
  }
}

export function copyGenome(
  out: Float32Array,
  outOff: number,
  src: Float32Array,
  srcOff: number,
): void {
  for (let i = 0; i < GENOME_LENGTH; i++) out[outOff + i] = src[srcOff + i];
}

/**
 * Point mutations on the body genome. `rateScale` comes from the parent's
 * expressed mutation rate so the gene actually does something.
 */
export function mutateGenome(
  g: Float32Array,
  off: number,
  cfg: SimConfig,
  rng: Rng,
  rateScale: number,
  tally?: MutationTally,
): number {
  const p = cfg.baseMutationRate * rateScale;
  let count = 0;
  for (let i = 0; i < GENOME_LENGTH; i++) {
    if (rng.chance(p)) {
      count++;
      if (tally) tally[LOCUS_CATEGORY[i]]++;
      let v = g[off + i] + rng.normal(0, cfg.mutationSigma);
      // Rare large-effect mutation: most change is incremental, but occasionally
      // a lineage jumps. This is what lets a population escape a local optimum.
      if (rng.chance(0.05)) v = g[off + i] + rng.normal(0, cfg.mutationSigma * 6);
      g[off + i] = v < 0 ? -v % 1 : v > 1 ? 1 - ((v - 1) % 1) : v; // reflect at bounds
    }
  }
  // Occasionally reseed a locus entirely — full-range exploration.
  if (rng.chance(p * 0.4)) {
    const locus = rng.int(GENOME_LENGTH);
    g[off + locus] = rng.next();
    if (tally) tally[LOCUS_CATEGORY[locus]]++;
    count++;
  }
  return count;
}

/**
 * Kin markers, inherited one element at a time from either parent with rare
 * mutation — Mendelian, not blended. Blending would drag every marker toward
 * the population mean within a few generations and destroy the very signal the
 * markers exist to carry.
 */
export function inheritKinTags(
  out: Float32Array,
  outOff: number,
  a: Float32Array,
  aOff: number,
  b: Float32Array,
  bOff: number,
  rng: Rng,
  mutationChance: number,
): void {
  for (let i = 0; i < KIN_TAG_LENGTH; i++) {
    out[outOff + i] = rng.chance(0.5) ? a[aOff + i] : b[bOff + i];
    if (rng.chance(mutationChance)) out[outOff + i] = rng.next();
  }
}

export function randomKinTags(out: Float32Array, off: number, rng: Rng): void {
  for (let i = 0; i < KIN_TAG_LENGTH; i++) out[off + i] = rng.next();
}

/**
 * Brain inheritance. Crossover happens per *neuron* rather than per weight:
 * swapping individual weights between two different brains destroys learned
 * structure, while swapping whole incoming-weight vectors preserves the
 * function of a unit. This is the same reasoning behind NEAT's node alignment,
 * without the bookkeeping cost.
 */
export function crossoverBrain(
  out: Float32Array,
  outOff: number,
  a: Float32Array,
  aOff: number,
  b: Float32Array,
  bOff: number,
  rng: Rng,
): void {
  // Hidden units: take each unit's full input vector + bias from one parent.
  for (let h = 0; h < MAX_HIDDEN; h++) {
    const src = rng.chance(0.5) ? a : b;
    const so = src === a ? aOff : bOff;
    const row = W1_OFFSET + h * BRAIN_INPUT_WIDTH;
    for (let i = 0; i < BRAIN_INPUT_WIDTH; i++) out[outOff + row + i] = src[so + row + i];
    out[outOff + B1_OFFSET + h] = src[so + B1_OFFSET + h];
  }
  // Output units: same idea for the readout layer.
  const outUnits = W2_SIZE / MAX_HIDDEN;
  for (let o = 0; o < outUnits; o++) {
    const src = rng.chance(0.5) ? a : b;
    const so = src === a ? aOff : bOff;
    const row = W2_OFFSET + o * MAX_HIDDEN;
    for (let h = 0; h < MAX_HIDDEN; h++) out[outOff + row + h] = src[so + row + h];
    out[outOff + W2_OFFSET + W2_SIZE + o] = src[so + W2_OFFSET + W2_SIZE + o]; // B2
  }
}

export function copyBrain(
  out: Float32Array,
  outOff: number,
  src: Float32Array,
  srcOff: number,
): void {
  for (let i = 0; i < BRAIN_STRIDE; i++) out[outOff + i] = src[srcOff + i];
}

/**
 * Weight mutation. Three kinds, mirroring what actually matters in practice:
 *  - jitter:      small perturbation of many weights (fine tuning)
 *  - replacement: a weight is redrawn from scratch (escapes a dead end)
 *  - silencing:   a weight is zeroed (structural pruning of a connection)
 */
export function mutateBrain(
  brain: Float32Array,
  off: number,
  cfg: SimConfig,
  rng: Rng,
  rateScale: number,
  tally?: MutationTally,
): number {
  const p = cfg.brainMutationRate * rateScale;
  const sigma = cfg.brainMutationSigma;
  let count = 0;

  for (let i = 0; i < W1_SIZE; i++) {
    if (rng.chance(p)) {
      brain[off + W1_OFFSET + i] += rng.normal(0, sigma);
      count++;
    }
  }
  for (let i = 0; i < W2_SIZE; i++) {
    if (rng.chance(p)) {
      brain[off + W2_OFFSET + i] += rng.normal(0, sigma);
      count++;
    }
  }
  if (tally) tally[MutationCategory.Neural] += count;
  for (let i = 0; i < B1_SIZE; i++) {
    if (rng.chance(p * 0.5)) brain[off + B1_OFFSET + i] += rng.normal(0, sigma * 0.5);
  }

  // Structural-ish events on the weight matrix.
  const structural = cfg.structuralMutationRate * rateScale;
  const structuralBefore = count;
  if (rng.chance(structural)) {
    // Redraw one whole hidden unit: effectively "add a new neuron".
    const h = rng.int(MAX_HIDDEN);
    const row = off + W1_OFFSET + h * BRAIN_INPUT_WIDTH;
    const s = 1.6 / Math.sqrt(BRAIN_INPUT_WIDTH);
    for (let i = 0; i < BRAIN_INPUT_WIDTH; i++) brain[row + i] = (rng.next() * 2 - 1) * s;
    count += BRAIN_INPUT_WIDTH;
  }
  if (rng.chance(structural)) {
    // Silence a connection.
    brain[off + W1_OFFSET + rng.int(W1_SIZE)] = 0;
    count++;
  }
  if (rng.chance(structural)) {
    brain[off + W2_OFFSET + rng.int(W2_SIZE)] = 0;
    count++;
  }
  if (tally) tally[MutationCategory.Structural] += count - structuralBefore;

  // Keep weights in a sane range so a lineage cannot drift into permanent
  // saturation. Biases matter most here: an unbounded bias pins a neuron at
  // ±1 forever and silently removes it from the network.
  clampRange(brain, off + W1_OFFSET, W1_SIZE, 6);
  clampRange(brain, off + W2_OFFSET, W2_SIZE, 6);
  clampRange(brain, off + B1_OFFSET, B1_SIZE, 6);
  clampRange(brain, off + B2_OFFSET, B2_SIZE, 6);
  return count;
}

function clampRange(a: Float32Array, off: number, len: number, lim: number): void {
  for (let i = off; i < off + len; i++) {
    if (a[i] > lim) a[i] = lim;
    else if (a[i] < -lim) a[i] = -lim;
  }
}

/** Seed a founder genome. Broad but not uniform — extremes are rare. */
export function randomGenome(g: Float32Array, off: number, rng: Rng): void {
  for (let i = 0; i < GENOME_LENGTH; i++) {
    // Beta-ish: mean of two uniforms concentrates founders near the middle.
    g[off + i] = (rng.next() + rng.next()) * 0.5;
  }
  // Founders start with a plant-leaning gut and modest bodies purely so the
  // first generation can survive long enough for selection to act. Carnivory,
  // gigantism and everything else still has to evolve.
  g[off + Locus.Digestion] = rng.next() * 0.35;
  g[off + Locus.BodySize] = 0.15 + rng.next() * 0.3;
  g[off + Locus.MutationRate] = 0.3 + rng.next() * 0.4;
  // Wide thermal tolerance to start with. A founder whose narrow thermal niche
  // happens to miss its spawn location dies for a reason unrelated to anything
  // it does, which is noise rather than selection. Narrowing the niche is a
  // specialisation evolution can discover on its own.
  g[off + Locus.TempTolerance] = 0.55 + rng.next() * 0.45;
  g[off + Locus.Maturation] = rng.next() * 0.45;
  // Founders start cognitively and socially simple. Memory, hearing and social
  // learning all cost upkeep every tick whether or not the brain has any use
  // for them, so handing generation 0 large values just taxes organisms for
  // organs they cannot yet exploit. Every one of these can evolve upward — and
  // when it does, that is a result rather than the starting condition.
  g[off + Locus.MemoryCapacity] = rng.next() * 0.35;
  g[off + Locus.HearingRange] = rng.next() * 0.5;
  g[off + Locus.SocialLearning] = rng.next() * 0.4;
}
