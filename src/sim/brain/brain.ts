/**
 * A tiny recurrent neural network, one per organism.
 *
 * Layout is a flat Float32Array so a whole population lives in one contiguous
 * buffer with a fixed stride — no per-organism objects, no allocation per tick.
 *
 *   inputs + context (<=6)  ->  hidden (<=14, tanh)  ->  outputs + next context
 *
 * The context vector is fed back on the next tick, which is what gives an
 * organism state that persists between decisions: it can be "alarmed", it can
 * keep fleeing after the predator leaves its field of view, it can maintain a
 * search pattern. We deliberately did not build a memory *feature* — we built a
 * recurrent loop and let evolution decide whether to use it (BrainContext can
 * evolve to zero).
 *
 * Germline / soma split:
 *   brainGenes   - inherited weights, mutated at reproduction, never changed in life
 *   plasticDelta - lifetime Hebbian modification of the output layer only
 *   effective W2 = genes + delta
 * This keeps Lamarckian inheritance out (learned changes are NOT passed on)
 * while still allowing an organism to learn within its lifetime.
 */
import { MAX_CONTEXT, MAX_HIDDEN } from '../genome/phenotype';
import { MAX_ECHOIC } from '../acoustics/sound';

export const Input = {
  Bias: 0,
  Energy: 1,
  Hunger: 2,
  Health: 3,
  AgeFraction: 4,
  Speed: 5,
  TempStress: 6,
  WaterDepth: 7,
  SlopeX: 8,
  SlopeY: 9,
  Light: 10,
  Vegetation: 11,
  VegGradX: 12,
  VegGradY: 13,
  Carrion: 14,
  PheromoneA: 15,
  PheromoneB: 16,
  PheromoneAGradX: 17,
  PheromoneAGradY: 18,
  NeighborDX: 19,
  NeighborDY: 20,
  NeighborProximity: 21,
  NeighborSizeRatio: 22,
  NeighborSimilarity: 23, // genome-wide similarity
  NeighborRelatedness: 24, // neutral kin markers — tracks pedigree, not adaptation
  NeighborSpeed: 25,
  SecondDX: 26,
  SecondDY: 27,
  Density: 28,
  AlignX: 29,
  AlignY: 30,
  CrowdRelatedness: 31, // mean relatedness of the whole neighbourhood
  Pain: 32,
  Reward: 33,
  // --- episodic memory ---
  MemoryValueHere: 34,
  MemoryBestDX: 35,
  MemoryBestDY: 36,
  MemoryWorstDX: 37,
  MemoryWorstDY: 38,
  MemoryLoad: 39,

  // --- hearing: physical properties of whatever is in the air right now ---
  // Not one of these is a message. They are the same quantities a microphone
  // would report, degraded by distance, terrain and the listener's own organ.
  EarLoudness: 40,
  EarPitch: 41,
  EarSpread: 42, // pitch spread across audible sources: one voice or a chorus
  EarNoisiness: 43,
  EarTimbre: 44,
  EarSweep: 45,
  EarTremolo: 46,
  EarDirX: 47,
  EarDirY: 48,
  EarProximity: 49,
  EarSources: 50,
  EarOnset: 51, // a new source took over attention on this tick
  EarDuration: 52, // how long the attended sound has been running
  NoiseFloor: 53, // ambient level the signal is competing against

  // --- efference copy and timing ---
  SelfVoicing: 54, // an organism can hear itself, which is what makes copying possible
  TimeSinceCall: 55,
  TimeSinceHeard: 56, // how long it has been quiet — the substrate for taking turns

  // --- what this organism's own experience says about the last sound heard ---
  // Learned in life, from its own reward stream. Not a label, not shared, and
  // frequently wrong.
  HeardValence: 57,
  HeardFamiliarity: 58,

  // --- echoic memory: the last few finished sounds, newest first ---
  // Three numbers each: pitch, loudness, and the silence that preceded it.
  // A pair of sounds with a gap between them is a different object from the
  // same pair reversed, and that is all the support sequence gets.
  Echo0: 59,
} as const;
export const ECHO_INPUTS = 3;
export const INPUT_COUNT = 59 + MAX_ECHOIC * ECHO_INPUTS; // 71

export const Output = {
  Thrust: 0,
  Turn: 1,
  Eat: 2,
  Attack: 3,
  Mate: 4,
  Rest: 5,
  Sprint: 6,
  /** Attempt to copy a nearby organism's learned weights. */
  Imitate: 7,
  /** Transfer energy to the attended neighbour. */
  Share: 8,
  /** Deposit into the two persistent pheromone fields. */
  PheromoneA: 9,
  PheromoneB: 10,

  // --- the vocal apparatus ---
  // Seven knobs on an organ. Hold the gate open and a sound comes out; the
  // other six shape it, within whatever the anatomy physically allows. How
  // long the gate stays open is the duration, and opening and closing it in a
  // pattern is a sequence. No output means anything.
  Voice: 11,
  VoicePitch: 12,
  VoiceLoudness: 13,
  VoiceNoise: 14,
  VoiceTimbre: 15,
  VoiceSweep: 16,
  VoiceTremolo: 17,
} as const;
export const OUTPUT_COUNT = 18;

export const INPUT_NAMES: string[] = (() => {
  const a = new Array<string>(INPUT_COUNT);
  for (const [k, v] of Object.entries(Input)) a[v] = k;
  const fields = ['Pitch', 'Loud', 'Gap'];
  for (let e = 0; e < MAX_ECHOIC; e++) {
    for (let f = 0; f < ECHO_INPUTS; f++) {
      a[Input.Echo0 + e * ECHO_INPUTS + f] = `Echo${e}${fields[f]}`;
    }
  }
  return a;
})();

export const OUTPUT_NAMES: string[] = (() => {
  const a = new Array<string>(OUTPUT_COUNT);
  for (const [k, v] of Object.entries(Output)) a[v] = k;
  return a;
})();

// ---- Flat weight layout ----
const IN_W = INPUT_COUNT + MAX_CONTEXT; // fan-in of the hidden layer
const OUT_H = OUTPUT_COUNT + MAX_CONTEXT; // hidden layer fans out to outputs + next context

export const W1_OFFSET = 0;
export const W1_SIZE = IN_W * MAX_HIDDEN;
export const B1_OFFSET = W1_OFFSET + W1_SIZE;
export const B1_SIZE = MAX_HIDDEN;
export const W2_OFFSET = B1_OFFSET + B1_SIZE;
export const W2_SIZE = OUT_H * MAX_HIDDEN;
export const B2_OFFSET = W2_OFFSET + W2_SIZE;
export const B2_SIZE = OUT_H;
export const BRAIN_STRIDE = B2_OFFSET + B2_SIZE;

/** Size of the per-organism lifetime-learning buffer (output layer only). */
export const PLASTIC_STRIDE = W2_SIZE;

export const BRAIN_INPUT_WIDTH = IN_W;
export const BRAIN_OUTPUT_WIDTH = OUT_H;

/** tanh via a rational approximation — ~4x faster than Math.tanh, plenty accurate. */
export function fastTanh(x: number): number {
  if (x < -3) return -1;
  if (x > 3) return 1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

/**
 * Randomise a brain in-place. Scaled by fan-in so a freshly seeded organism
 * produces varied but not saturated outputs.
 */
export function randomizeBrain(
  brain: Float32Array,
  off: number,
  rand: () => number,
): void {
  const s1 = 1.6 / Math.sqrt(IN_W);
  for (let i = 0; i < W1_SIZE; i++) brain[off + W1_OFFSET + i] = (rand() * 2 - 1) * s1;
  for (let i = 0; i < B1_SIZE; i++) brain[off + B1_OFFSET + i] = (rand() * 2 - 1) * 0.3;
  const s2 = 1.6 / Math.sqrt(MAX_HIDDEN);
  for (let i = 0; i < W2_SIZE; i++) brain[off + W2_OFFSET + i] = (rand() * 2 - 1) * s2;
  for (let i = 0; i < B2_SIZE; i++) brain[off + B2_OFFSET + i] = (rand() * 2 - 1) * 0.3;
}

/**
 * Forward pass. Hot path — called once per organism per tick.
 *
 * `inputs`   length INPUT_COUNT
 * `context`  length MAX_CONTEXT, read then overwritten with the new state
 * `hidden`   scratch, length MAX_HIDDEN (kept for visualisation)
 * `outputs`  length OUTPUT_COUNT
 *
 * Only the first `hiddenSize`/`contextSize` units are evaluated; the remaining
 * weights are inert "junk DNA" that a structural mutation can switch back on.
 */
export function forward(
  brain: Float32Array,
  brainOff: number,
  plastic: Float32Array,
  plasticOff: number,
  inputs: Float32Array,
  context: Float32Array,
  ctxOff: number,
  hidden: Float32Array,
  outputs: Float32Array,
  hiddenSize: number,
  contextSize: number,
): void {
  const w1 = brainOff + W1_OFFSET;
  const b1 = brainOff + B1_OFFSET;
  const w2 = brainOff + W2_OFFSET;
  const b2 = brainOff + B2_OFFSET;

  // ---- hidden layer ----
  for (let h = 0; h < hiddenSize; h++) {
    const row = w1 + h * IN_W;
    let sum = brain[b1 + h];
    for (let i = 0; i < INPUT_COUNT; i++) sum += brain[row + i] * inputs[i];
    for (let c = 0; c < contextSize; c++) sum += brain[row + INPUT_COUNT + c] * context[ctxOff + c];
    hidden[h] = fastTanh(sum);
  }
  for (let h = hiddenSize; h < MAX_HIDDEN; h++) hidden[h] = 0;

  // ---- output layer (+ next context) ----
  for (let o = 0; o < OUTPUT_COUNT; o++) {
    const row = w2 + o * MAX_HIDDEN;
    const prow = plasticOff + o * MAX_HIDDEN;
    let sum = brain[b2 + o];
    for (let h = 0; h < hiddenSize; h++) sum += (brain[row + h] + plastic[prow + h]) * hidden[h];
    outputs[o] = fastTanh(sum);
  }
  for (let c = 0; c < contextSize; c++) {
    const o = OUTPUT_COUNT + c;
    const row = w2 + o * MAX_HIDDEN;
    let sum = brain[b2 + o];
    for (let h = 0; h < hiddenSize; h++) sum += brain[row + h] * hidden[h];
    context[ctxOff + c] = fastTanh(sum);
  }
  for (let c = contextSize; c < MAX_CONTEXT; c++) context[ctxOff + c] = 0;
}

/**
 * Reward-modulated Hebbian plasticity on the output layer.
 *
 * dW = rate * reward * hidden_activation * output_activation, with slow decay
 * back toward the inherited weights. When something good happens the pairing
 * that produced it is reinforced; when something bad happens it is weakened.
 * The organism is *not* told which action was correct — only whether the last
 * moment went well.
 */
export function hebbianUpdate(
  plastic: Float32Array,
  plasticOff: number,
  hidden: Float32Array,
  outputs: Float32Array,
  hiddenSize: number,
  reward: number,
  rate: number,
): number {
  if (rate <= 0) return 0;
  const decay = 1 - rate * 0.08;
  const lr = rate * reward;
  let drift = 0;
  for (let o = 0; o < OUTPUT_COUNT; o++) {
    const prow = plasticOff + o * MAX_HIDDEN;
    const act = outputs[o];
    for (let h = 0; h < hiddenSize; h++) {
      const before = plastic[prow + h];
      let v = before * decay + lr * hidden[h] * act;
      // Hard clamp keeps a runaway feedback loop from destroying the brain.
      if (v > 1.5) v = 1.5;
      else if (v < -1.5) v = -1.5;
      plastic[prow + h] = v;
      drift += v > before ? v - before : before - v;
    }
  }
  // Returned so the caller can notice when an organism has genuinely reshaped
  // its own behaviour — the basis for calling something an innovation.
  return drift;
}

/**
 * Social learning: pull `learner`'s soma toward `model`'s. Only the learned
 * layer moves; inherited weights are untouched, so nothing acquired this way
 * can reach the germline. Returns how far the learner actually moved.
 */
export function imitate(
  plastic: Float32Array,
  learnerOff: number,
  modelOff: number,
  rate: number,
): number {
  let moved = 0;
  for (let i = 0; i < PLASTIC_STRIDE; i++) {
    const before = plastic[learnerOff + i];
    const delta = (plastic[modelOff + i] - before) * rate;
    plastic[learnerOff + i] = before + delta;
    moved += delta > 0 ? delta : -delta;
  }
  return moved;
}
