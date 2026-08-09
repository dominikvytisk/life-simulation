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
 *   x, y      where it happened
 *   valence   how good (+) or bad (-) it was
 *   strength  confidence, decays every tick
 *
 * Capacity and decay rate are both genetic and both cost upkeep, so a large
 * persistent memory has to earn its keep. An organism with zero slots pays
 * nothing and remembers nothing — that is a legitimate strategy and many
 * lineages take it.
 */
import { MAX_MEMORY } from '../genome/phenotype';

/** How far away a memory still influences the recalled value, in world units. */
const RECALL_RADIUS = 140;
const RECALL_FALLOFF = 1 / (RECALL_RADIUS * RECALL_RADIUS);
/** Below this, an experience is too unremarkable to be worth a slot. */
export const ENCODE_THRESHOLD = 0.35;

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

/**
 * Write an experience at (x, y). If every slot is taken, the weakest memory is
 * displaced — but only if the new experience is actually stronger, so a vivid
 * memory is not overwritten by trivia.
 *
 * Nearby memories of the same sign are merged rather than duplicated, which
 * stops a single long feeding bout from consuming the whole memory.
 */
export function encodeMemory(
  memX: Float32Array,
  memY: Float32Array,
  memValence: Float32Array,
  memStrength: Float32Array,
  base: number,
  slots: number,
  x: number,
  y: number,
  valence: number,
): void {
  if (slots <= 0) return;
  const magnitude = Math.abs(valence);
  if (magnitude < ENCODE_THRESHOLD) return;

  let weakest = -1;
  let weakestStrength = Infinity;
  const mergeRadius2 = 45 * 45;

  for (let s = 0; s < slots; s++) {
    const i = base + s;
    const st = memStrength[i];
    if (st <= 0.001) {
      // Empty slot: take it.
      memX[i] = x;
      memY[i] = y;
      memValence[i] = valence;
      memStrength[i] = 1;
      return;
    }
    const dx = memX[i] - x;
    const dy = memY[i] - y;
    if (dx * dx + dy * dy < mergeRadius2 && memValence[i] * valence > 0) {
      // Same place, same sign — reinforce instead of spending another slot.
      memValence[i] = memValence[i] * 0.7 + valence * 0.3;
      memStrength[i] = Math.min(1, memStrength[i] + 0.35);
      memX[i] = memX[i] * 0.7 + x * 0.3;
      memY[i] = memY[i] * 0.7 + y * 0.3;
      return;
    }
    const priority = st * Math.abs(memValence[i]);
    if (priority < weakestStrength) {
      weakestStrength = priority;
      weakest = i;
    }
  }

  if (weakest >= 0 && magnitude > weakestStrength) {
    memX[weakest] = x;
    memY[weakest] = y;
    memValence[weakest] = valence;
    memStrength[weakest] = 1;
  }
}

/**
 * Read the memory field at (x, y) into `out`. Directions are returned in world
 * space; the caller rotates them into the organism's own frame.
 */
export function recallInto(
  memX: Float32Array,
  memY: Float32Array,
  memValence: Float32Array,
  memStrength: Float32Array,
  base: number,
  slots: number,
  x: number,
  y: number,
  decay: number,
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
    let st = memStrength[i];
    if (st <= 0.001) continue;
    // Forgetting happens here rather than in a separate pass: memory is only
    // ever read once per tick, so this costs nothing extra.
    st -= decay;
    if (st <= 0.001) {
      memStrength[i] = 0;
      continue;
    }
    memStrength[i] = st;

    const dx = memX[i] - x;
    const dy = memY[i] - y;
    const d2 = dx * dx + dy * dy;
    const weight = st / (1 + d2 * RECALL_FALLOFF);
    const v = memValence[i];

    out.valueHere += v * weight;
    out.load += st;

    const score = v * st;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    } else if (score < worstScore) {
      worstScore = score;
      worstIdx = i;
    }
  }

  if (bestIdx >= 0) {
    const dx = memX[bestIdx] - x;
    const dy = memY[bestIdx] - y;
    const d = Math.sqrt(dx * dx + dy * dy) + 1e-4;
    out.bestDX = dx / d;
    out.bestDY = dy / d;
  }
  if (worstIdx >= 0) {
    const dx = memX[worstIdx] - x;
    const dy = memY[worstIdx] - y;
    const d = Math.sqrt(dx * dx + dy * dy) + 1e-4;
    out.worstDX = dx / d;
    out.worstDY = dy / d;
  }
  out.load /= MAX_MEMORY;
}
