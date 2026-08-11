/**
 * Auditory associative memory — Phase 6.
 *
 * The problem this solves: an organism hears a sound, does something, and the
 * consequence arrives several ticks later. Nothing in a feed-forward pass can
 * connect the two. So each organism carries a small memory of *what sounds it
 * has been hearing*, and a decaying trace of which of them were recent, and
 * when reward or damage arrives it is credited backwards along that trace.
 *
 * The mechanism is a vector quantiser with reward-modulated values:
 *
 *   prototype[k]   a point in call space that this organism keeps hearing
 *   valence[k]     what tended to happen afterwards, learned, in [-1,1]
 *   strength[k]    how well established the prototype is
 *   trace[k]       eligibility: how recently it was heard
 *
 * Crucially, `valence` is not a meaning and not a label. It is one number the
 * organism worked out for itself from its own reward stream, and the brain is
 * free to ignore it — it arrives as an ordinary sensory input alongside pitch
 * and loudness, competing for the same synapses. Two organisms hearing the
 * same sound will hold different valences for it if their histories differed,
 * which is exactly the property a designed lookup table could not have.
 *
 * Nothing here is inherited. A newborn's prototypes are empty and it has to
 * find out what sounds are worth reacting to on its own, or copy someone whose
 * soma already encodes a reaction.
 */
import { CALL_DIM, MAX_PROTOTYPES, callDistance } from './sound';

export const PROTO_STRIDE = MAX_PROTOTYPES * CALL_DIM;

/**
 * Widest acoustic gap that still counts as "the same sound again", for an ear
 * with perfect frequency resolution. A blunt ear gets a wider one and so
 * generalises more — it cannot tell two nearby calls apart, and its memory
 * inherits that confusion rather than being told to be sloppy.
 */
const BASE_MATCH_RADIUS = 0.07;
const MAX_MATCH_RADIUS = 0.26;

export function matchRadius(resolution: number): number {
  return MAX_MATCH_RADIUS - (MAX_MATCH_RADIUS - BASE_MATCH_RADIUS) * resolution;
}

export interface Match {
  /** Prototype index, or -1 if the organism has no auditory memory at all. */
  index: number;
  /** How well the sound matched what was already known, 0..1. */
  familiarity: number;
  /** The learned expectation attached to it, [-1,1]. Zero for a novel sound. */
  valence: number;
  /** True when this sound did not fit anything already held. */
  novel: boolean;
}

const result: Match = { index: -1, familiarity: 0, valence: 0, novel: false };

/**
 * Find the prototype this call belongs to, creating or displacing one if it
 * fits nothing. Returns a shared object — read it before calling again.
 *
 * `slots` is the number of prototypes this organism's genome pays for, which
 * may be zero: an organism with no auditory memory hears perfectly well and
 * simply never accumulates anything about what it heard.
 */
export function recognise(
  proto: Float32Array,
  protoOff: number,
  valence: Float32Array,
  strength: Float32Array,
  trace: Float32Array,
  slotOff: number,
  slots: number,
  desc: Float32Array,
  descOff: number,
  resolution: number,
  learnRate: number,
): Match {
  result.index = -1;
  result.familiarity = 0;
  result.valence = 0;
  result.novel = false;
  if (slots <= 0) return result;

  const radius = matchRadius(resolution);
  let best = -1;
  let bestD = Infinity;
  let weakest = 0;
  let weakestS = Infinity;

  for (let k = 0; k < slots; k++) {
    const s = strength[slotOff + k];
    if (s <= 0) {
      // An unused slot is the cheapest home for a novel sound.
      if (weakestS > 0) {
        weakest = k;
        weakestS = 0;
      }
      continue;
    }
    const d = callDistance(proto, protoOff + k * CALL_DIM, desc, descOff);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
    if (s < weakestS) {
      weakestS = s;
      weakest = k;
    }
  }

  if (best >= 0 && bestD <= radius) {
    // Known sound. The prototype drifts toward what was actually heard, so a
    // convention that gradually changes shape is followed rather than lost —
    // this is the individual-level half of cultural drift.
    const o = protoOff + best * CALL_DIM;
    for (let i = 0; i < CALL_DIM; i++) proto[o + i] += (desc[descOff + i] - proto[o + i]) * learnRate;
    const s = strength[slotOff + best];
    strength[slotOff + best] = s + (1 - s) * learnRate;
    trace[slotOff + best] = 1;
    result.index = best;
    result.familiarity = strength[slotOff + best] * (1 - bestD / radius);
    result.valence = valence[slotOff + best];
    return result;
  }

  // Novel sound: take the weakest slot. A well established prototype is only
  // displaced once it has faded, so a strong convention is not knocked out by
  // one odd noise.
  const k = weakest;
  if (weakestS > 0.55) {
    // Everything held is strongly established — the sound is heard, noted as
    // unfamiliar, and forgotten. Memory is finite; that is the point.
    result.novel = true;
    return result;
  }
  const o = protoOff + k * CALL_DIM;
  for (let i = 0; i < CALL_DIM; i++) proto[o + i] = desc[descOff + i];
  strength[slotOff + k] = Math.max(0.05, weakestS * 0.5);
  valence[slotOff + k] = 0;
  trace[slotOff + k] = 1;
  result.index = k;
  result.familiarity = 0;
  result.valence = 0;
  result.novel = true;
  return result;
}

/**
 * Credit whatever the organism has been hearing with whatever just happened to
 * it. `reward` is the organism's own wellbeing signal — the same one that
 * drives Hebbian plasticity — so what counts as a good outcome is set by the
 * energy economy, not by a table of interesting events.
 *
 * The trace decays geometrically, so a sound heard twenty ticks ago gets a
 * small share of the credit and one heard two hundred ticks ago gets none.
 * This is what makes "heard it, approached, found food" learnable while
 * leaving genuinely unrelated coincidences to average out to zero.
 */
export function creditTrace(
  valence: Float32Array,
  trace: Float32Array,
  strength: Float32Array,
  slotOff: number,
  slots: number,
  reward: number,
  rate: number,
  traceDecay: number,
  forget: number,
): void {
  for (let k = 0; k < slots; k++) {
    const t = trace[slotOff + k];
    if (t > 1e-4) {
      let v = valence[slotOff + k] + reward * t * rate;
      if (v > 1) v = 1;
      else if (v < -1) v = -1;
      valence[slotOff + k] = v;
      trace[slotOff + k] = t * traceDecay;
    } else if (t !== 0) {
      trace[slotOff + k] = 0;
    }
    // A prototype nobody keeps hearing fades and eventually frees its slot.
    const s = strength[slotOff + k];
    if (s > 0) strength[slotOff + k] = s > forget ? s - forget : 0;
  }
}
