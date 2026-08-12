/**
 * Episodic place memory.
 *
 * An organism records *where* something notably good or bad happened to it, and
 * can later sense the remembered valence of its current position and the
 * direction of the best and worst places it holds. That is all. There is no
 * "go to remembered food" rule — the recalled values are just six more sensory
 * inputs, and whether to act on them is the brain's problem.
 *
 * Storage is flat SoA, `MAX_MEMORY` slots per organism:
 *   x, y        where it happened
 *   valence     how good (+) or bad (-) it was
 *   strength    confidence, decays every tick
 *   importance  how much use this memory has actually been
 *   context     a short fingerprint of the internal state it was laid down in
 *   social      whether it was lived or inferred from something heard
 *
 * Capacity and decay rate are both genetic and both cost upkeep, so a large
 * persistent memory has to earn its keep. An organism with zero slots pays
 * nothing and remembers nothing — that is a legitimate strategy and many
 * lineages take it.
 *
 * THREE THINGS THE CONTEXT FINGERPRINT BUYS
 *
 * The fingerprint is the first few units of the organism's own hidden layer at
 * the moment of encoding. It is not a description of the situation; nobody
 * knows what those units encode, and two lineages will encode different things
 * in them.
 *
 * Recall is then weighted by how closely the *current* internal state resembles
 * the one a memory was laid down in. So a memory is not simply a fact about a
 * patch of ground: it is a fact about a patch of ground as encountered in a
 * particular kind of moment. An organism that meets two superficially different
 * things its brain happens to represent similarly will recall one when it meets
 * the other — which is generalisation, arrived at without anything in this file
 * knowing what either thing was. It is also how generalisation goes wrong, and
 * nothing here prevents that.
 *
 * Finally, a memory that keeps being recalled at moments that matter gains
 * importance and fades more slowly, while one that never proves useful is the
 * first to be displaced. Which memories survive is therefore decided by the
 * organism's own history rather than by how dramatic the original event was.
 */
import { MAX_MEMORY } from '../genome/phenotype';

/** How far away a memory still influences the recalled value, in world units. */
const RECALL_RADIUS = 140;
const RECALL_FALLOFF = 1 / (RECALL_RADIUS * RECALL_RADIUS);
/** Below this, an experience is too unremarkable to be worth a slot. */
export const ENCODE_THRESHOLD = 0.35;
/** Latent units kept as the encoding fingerprint. */
export const MEMORY_CONTEXT_DIM = 4;
/** Floor on how much a memory recalled in a foreign context still counts. */
const CONTEXT_FLOOR = 0.3;

/** The six arrays that make up one population's episodic memory. */
export interface MemoryArrays {
  x: Float32Array;
  y: Float32Array;
  valence: Float32Array;
  strength: Float32Array;
  importance: Float32Array;
  /** MAX_MEMORY * MEMORY_CONTEXT_DIM per organism. */
  context: Float32Array;
  /** 1 when the memory was inferred from a sound rather than lived. */
  social: Uint8Array;
}

export interface Recall {
  valueHere: number;
  bestDX: number;
  bestDY: number;
  worstDX: number;
  worstDY: number;
  load: number;
}

export function makeRecall(): Recall {
  return { valueHere: 0, bestDX: 0, bestDY: 0, worstDX: 0, worstDY: 0, load: 0 };
}

/** Mean similarity of two context fingerprints, in [0,1]. */
function contextMatch(
  ctx: Float32Array,
  off: number,
  latent: ArrayLike<number>,
  latentOff: number,
  dims: number,
): number {
  if (dims <= 0) return 1;
  let d = 0;
  for (let k = 0; k < dims; k++) {
    const diff = ctx[off + k] - latent[latentOff + k];
    d += diff < 0 ? -diff : diff;
  }
  // Both sides are tanh activations, so the largest possible mean gap is 2.
  const m = 1 - d / (dims * 2);
  return m < 0 ? 0 : m;
}

/**
 * Write an experience at (x, y). If every slot is taken, the least valuable
 * memory is displaced — but only if the new experience is actually worth more,
 * so a memory that has repeatedly proven useful is not evicted by a passing
 * shock.
 *
 * Nearby memories laid down in a *similar internal context* are merged rather
 * than duplicated, which stops a single long feeding bout from consuming the
 * whole memory. Same place, different kind of moment, stays a separate memory.
 */
export function encodeMemory(
  mem: MemoryArrays,
  base: number,
  slots: number,
  x: number,
  y: number,
  valence: number,
  latent: ArrayLike<number>,
  latentOff: number,
  contextDims: number,
  social: boolean,
): void {
  if (slots <= 0) return;
  const magnitude = Math.abs(valence);
  if (magnitude < ENCODE_THRESHOLD) return;

  let weakest = -1;
  let weakestPriority = Infinity;
  const mergeRadius2 = 45 * 45;

  for (let s = 0; s < slots; s++) {
    const i = base + s;
    const co = i * MEMORY_CONTEXT_DIM;
    const st = mem.strength[i];
    if (st <= 0.001) {
      mem.x[i] = x;
      mem.y[i] = y;
      mem.valence[i] = valence;
      mem.strength[i] = 1;
      mem.importance[i] = 0;
      mem.social[i] = social ? 1 : 0;
      for (let k = 0; k < MEMORY_CONTEXT_DIM; k++) {
        mem.context[co + k] = k < contextDims ? latent[latentOff + k] : 0;
      }
      return;
    }
    const dx = mem.x[i] - x;
    const dy = mem.y[i] - y;
    if (
      dx * dx + dy * dy < mergeRadius2 &&
      mem.valence[i] * valence > 0 &&
      contextMatch(mem.context, co, latent, latentOff, contextDims) > 0.7
    ) {
      // Same place, same sign, same kind of moment — reinforce instead of
      // spending another slot. A memory confirmed twice is worth more than one
      // confirmed once, which is what the importance term records.
      mem.valence[i] = mem.valence[i] * 0.7 + valence * 0.3;
      mem.strength[i] = Math.min(1, mem.strength[i] + 0.35);
      mem.importance[i] = Math.min(4, mem.importance[i] + 0.5);
      mem.x[i] = mem.x[i] * 0.7 + x * 0.3;
      mem.y[i] = mem.y[i] * 0.7 + y * 0.3;
      for (let k = 0; k < contextDims; k++) {
        mem.context[co + k] = mem.context[co + k] * 0.7 + latent[latentOff + k] * 0.3;
      }
      // A lived confirmation of something merely overheard makes it first-hand.
      if (!social) mem.social[i] = 0;
      return;
    }
    const priority = st * Math.abs(mem.valence[i]) * (1 + mem.importance[i]);
    if (priority < weakestPriority) {
      weakestPriority = priority;
      weakest = i;
    }
  }

  if (weakest >= 0 && magnitude > weakestPriority) {
    const co = weakest * MEMORY_CONTEXT_DIM;
    mem.x[weakest] = x;
    mem.y[weakest] = y;
    mem.valence[weakest] = valence;
    mem.strength[weakest] = 1;
    mem.importance[weakest] = 0;
    mem.social[weakest] = social ? 1 : 0;
    for (let k = 0; k < MEMORY_CONTEXT_DIM; k++) {
      mem.context[co + k] = k < contextDims ? latent[latentOff + k] : 0;
    }
  }
}

/**
 * Read the memory field at (x, y) into `out`. Directions are returned in world
 * space; the caller rotates them into the organism's own frame.
 *
 * Forgetting happens here rather than in a separate pass — memory is only read
 * once per tick, so it costs nothing extra. A memory that has earned importance
 * decays proportionally more slowly, so what an organism keeps is shaped by
 * what has been useful and not only by how hard it was hit.
 */
export function recallInto(
  mem: MemoryArrays,
  base: number,
  slots: number,
  x: number,
  y: number,
  decay: number,
  latent: ArrayLike<number>,
  latentOff: number,
  contextDims: number,
  out: Recall,
): void {
  out.valueHere = 0;
  out.bestDX = 0;
  out.bestDY = 0;
  out.worstDX = 0;
  out.worstDY = 0;
  out.load = 0;
  if (slots <= 0) return;

  let bestScore = 0;
  let worstScore = 0;
  let bestIdx = -1;
  let worstIdx = -1;

  for (let s = 0; s < slots; s++) {
    const i = base + s;
    let st = mem.strength[i];
    if (st <= 0.001) continue;
    st -= decay / (1 + mem.importance[i]);
    if (st <= 0.001) {
      mem.strength[i] = 0;
      mem.importance[i] = 0;
      continue;
    }
    mem.strength[i] = st;

    const dx = mem.x[i] - x;
    const dy = mem.y[i] - y;
    const d2 = dx * dx + dy * dy;
    const match = contextMatch(mem.context, i * MEMORY_CONTEXT_DIM, latent, latentOff, contextDims);
    const gate = CONTEXT_FLOOR + (1 - CONTEXT_FLOOR) * match;
    const weight = (st / (1 + d2 * RECALL_FALLOFF)) * gate;
    const v = mem.valence[i];

    out.valueHere += v * weight;
    out.load += st;

    const score = v * st * gate;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    } else if (score < worstScore) {
      worstScore = score;
      worstIdx = i;
    }
  }

  if (bestIdx >= 0) {
    const dx = mem.x[bestIdx] - x;
    const dy = mem.y[bestIdx] - y;
    const d = Math.sqrt(dx * dx + dy * dy) + 1e-4;
    out.bestDX = dx / d;
    out.bestDY = dy / d;
  }
  if (worstIdx >= 0) {
    const dx = mem.x[worstIdx] - x;
    const dy = mem.y[worstIdx] - y;
    const d = Math.sqrt(dx * dx + dy * dy) + 1e-4;
    out.worstDX = dx / d;
    out.worstDY = dy / d;
  }
  out.load /= MAX_MEMORY;
}

/**
 * Credit whatever the organism currently recalls with what just happened to it.
 *
 * Only memories near enough to have contributed are credited, and only when the
 * moment was notable in the first place. A memory that keeps being present when
 * something significant occurs becomes important; one that is merely old does
 * not. Nothing here checks whether the memory was *right* — being reliably
 * present at bad moments makes a memory important too, which is the correct
 * outcome for a warning.
 */
export function reinforceRecall(
  mem: MemoryArrays,
  base: number,
  slots: number,
  x: number,
  y: number,
  magnitude: number,
): void {
  if (slots <= 0 || magnitude <= 0) return;
  for (let s = 0; s < slots; s++) {
    const i = base + s;
    if (mem.strength[i] <= 0.001) continue;
    const dx = mem.x[i] - x;
    const dy = mem.y[i] - y;
    const near = 1 / (1 + (dx * dx + dy * dy) * RECALL_FALLOFF);
    if (near < 0.25) continue;
    const gain = magnitude * near * 0.05;
    mem.importance[i] = Math.min(4, mem.importance[i] + gain);
  }
}

/**
 * One pass of rest-time housekeeping over the memory store.
 *
 * Important memories are strengthened back toward full confidence; unimportant
 * ones are pushed down and eventually released. This is a redistribution, not a
 * gift: total held confidence does not go up, so consolidating is a choice
 * about *which* memories to keep rather than a way to keep more of them.
 *
 * Returns how many slots were released, purely so the caller can report it.
 */
export function consolidateMemory(
  mem: MemoryArrays,
  base: number,
  slots: number,
  strength: number,
): number {
  if (slots <= 0 || strength <= 0) return 0;
  let released = 0;
  for (let s = 0; s < slots; s++) {
    const i = base + s;
    const st = mem.strength[i];
    if (st <= 0.001) continue;
    // Importance of 1 is the break-even point: below it a memory loses ground
    // during rest, above it gains.
    const pull = (mem.importance[i] - 1) * strength * 0.05;
    let next = st + pull;
    if (next > 1) next = 1;
    if (next <= 0.001) {
      mem.strength[i] = 0;
      mem.importance[i] = 0;
      released++;
    } else {
      mem.strength[i] = next;
    }
  }
  return released;
}
