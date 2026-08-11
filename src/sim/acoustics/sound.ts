/**
 * Acoustic representation — Phase 1.
 *
 * A sound in this world is a small vector of *physical* quantities and nothing
 * else. There is no identifier, no channel number, no type tag: two organisms
 * that happen to produce similar numbers have produced similar sounds, and that
 * is the only sense in which any two sounds are "the same".
 *
 * Two granularities exist, for two different reasons:
 *
 *   VOICE frame (VOICE_DIM)  what is in the air on this tick, per organism.
 *                            This is what propagates and what a listener's ear
 *                            integrates. It is overwritten every tick.
 *
 *   CALL descriptor (CALL_DIM)  a whole vocalisation summarised after it ends:
 *                            its mean pitch, how far it swept, how long it
 *                            lasted. This is what memory and the analyser work
 *                            on, because a 40 ms slice of a sound is not a
 *                            thing an animal can learn about — an utterance is.
 *
 * Frequency is stored as a normalised position in log-frequency space, because
 * that is how hearing works: the distance from 200 Hz to 400 Hz is the same
 * perceptual distance as 2 kHz to 4 kHz. `pitchToHz` is only ever used for
 * display and for the audio synthesiser; the simulation never needs Hz.
 */

/** Instantaneous acoustic frame: what an organism is radiating right now. */
export const Voice = {
  Pitch: 0, // normalised log-frequency, 0..1
  Loudness: 1, // source amplitude, 0..1 (already scaled by vocal power)
  Noisiness: 2, // 0 = pure tone, 1 = broadband hiss
  Timbre: 3, // spectral tilt: 0 = dark/hollow, 1 = bright/harmonic-rich
  Slope: 4, // within-frame frequency modulation, -1..1
  Tremolo: 5, // amplitude modulation depth, 0..1
} as const;
export const VOICE_DIM = 6;

export const VOICE_NAMES = ['pitch', 'loudness', 'noisiness', 'timbre', 'sweep', 'tremolo'];

/** A finished vocalisation, summarised. This is the unit of analysis. */
export const Call = {
  Pitch: 0, // mean pitch over the utterance
  Sweep: 1, // end pitch minus start pitch, -1..1 — rising vs falling
  Loudness: 2,
  Noisiness: 3,
  Timbre: 4,
  Tremolo: 5,
  Duration: 6, // log-compressed tick count, 0..1
} as const;
export const CALL_DIM = 7;

export const CALL_NAMES = [
  'pitch',
  'sweep',
  'loudness',
  'noisiness',
  'timbre',
  'tremolo',
  'duration',
];

/**
 * Relative weight of each descriptor when asking "how similar are these two
 * sounds?". Pitch and sweep dominate because they are what a narrow-band ear
 * discriminates best; loudness counts for little because it is mostly a
 * function of how far away the source was.
 */
export const CALL_WEIGHTS = new Float32Array([1.5, 1.1, 0.35, 0.8, 0.7, 0.6, 0.9]);
const CALL_WEIGHT_SUM = CALL_WEIGHTS.reduce((a, b) => a + b, 0);

/** The audible band, in Hz. Only the synthesiser and the UI care about these. */
export const MIN_HZ = 70;
export const MAX_HZ = 7600;
const LOG_SPAN = Math.log(MAX_HZ / MIN_HZ);

export function pitchToHz(p: number): number {
  return MIN_HZ * Math.exp(clamp01(p) * LOG_SPAN);
}

export function hzToPitch(hz: number): number {
  if (hz <= MIN_HZ) return 0;
  return clamp01(Math.log(hz / MIN_HZ) / LOG_SPAN);
}

/** How long a call has to run before it is treated as an utterance at all. */
export const MIN_CALL_TICKS = 2;
/** Duration in ticks that maps to a normalised duration of 1. */
const DURATION_SCALE = 60;

export function durationToNorm(ticks: number): number {
  return clamp01(Math.log1p(ticks) / Math.log1p(DURATION_SCALE));
}

export function normToDuration(d: number): number {
  return Math.expm1(clamp01(d) * Math.log1p(DURATION_SCALE));
}

/**
 * Weighted distance between two call descriptors, normalised to roughly 0..1.
 * This is the only notion of "these two sounds are alike" anywhere in the
 * codebase, and it is purely acoustic.
 */
export function callDistance(a: Float32Array, ao: number, b: Float32Array, bo: number): number {
  let sum = 0;
  for (let i = 0; i < CALL_DIM; i++) {
    const d = a[ao + i] - b[bo + i];
    sum += (d < 0 ? -d : d) * CALL_WEIGHTS[i];
  }
  return sum / CALL_WEIGHT_SUM;
}

// ---------------------------------------------------------------- apparatus

/**
 * Everything the body physically permits, derived from the genome. Note what
 * is *not* here: no list of sounds, no repertoire, no preferred call. This
 * describes an organ, and an organ has limits, not intentions.
 */
export interface VocalApparatus {
  /** Producible frequency band, in normalised pitch. */
  pitchLow: number;
  pitchHigh: number;
  /** Peak loudness the apparatus can drive. */
  power: number;
  /** How fast pitch may change between ticks, and the FM/AM ceiling. */
  slew: number;
  agility: number;
  /** Resting spectral character, and how far the brain can push it. */
  timbreCenter: number;
  timbreSpan: number;
  noiseCenter: number;
  noiseSpan: number;
}

export interface AuditoryApparatus {
  /** Passband, in normalised pitch. Outside it, sound rolls off fast. */
  bandLow: number;
  bandHigh: number;
  /** Frequency discrimination, 0..1. Low resolution blurs everything heard. */
  resolution: number;
  /** How many finished sounds the echoic buffer holds. */
  echoicDepth: number;
  /** How many recurring sound patterns the associative memory can hold. */
  prototypes: number;
}

/** Ceiling on both, so the per-organism buffers have a fixed stride. */
export const MAX_ECHOIC = 4;
export const MAX_PROTOTYPES = 6;

/** Narrowest band an organ can have — a zero-width band is not an organ. */
const MIN_BAND = 0.08;

/**
 * Two unordered edge genes become an ordered band. Using a pair rather than
 * "centre + width" means a single point mutation can move one edge without
 * dragging the other, which is what lets a lineage extend its range upward
 * while keeping its low register.
 */
export function bandFromGenes(a: number, b: number): { low: number; high: number } {
  let low = a < b ? a : b;
  let high = a < b ? b : a;
  if (high - low < MIN_BAND) {
    const mid = (low + high) * 0.5;
    low = mid - MIN_BAND * 0.5;
    high = mid + MIN_BAND * 0.5;
    if (low < 0) {
      high -= low;
      low = 0;
    }
    if (high > 1) {
      low -= high - 1;
      high = 1;
    }
  }
  return { low, high };
}

// -------------------------------------------------------------- propagation

/**
 * How much of a sound survives the trip from source to listener.
 *
 * Three effects, all real:
 *  - geometric spreading, which is the dominant term up close
 *  - absorption, which is exponential in distance and *worse at high
 *    frequencies*. This is the single most consequential piece of physics in
 *    the whole system: a low call carries across the map and a high one stays
 *    local, so range and privacy are opposed and neither is free.
 *  - the listener's passband, outside which sensitivity falls off sharply
 */
export function attenuation(
  distance: number,
  pitch: number,
  refDistance: number,
  absorption: number,
  pitchAbsorption: number,
): number {
  const spread = 1 / (1 + distance / refDistance);
  const absorbed = Math.exp(-distance * (absorption + pitch * pitchAbsorption));
  return spread * absorbed;
}

/** Listener sensitivity at a given pitch: flat in band, gaussian roll-off out. */
export function bandResponse(pitch: number, low: number, high: number): number {
  const outside = pitch < low ? low - pitch : pitch > high ? pitch - high : 0;
  if (outside === 0) return 1;
  const t = outside / 0.11;
  return Math.exp(-t * t);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
