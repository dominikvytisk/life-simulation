/**
 * Auditory perception — Phases 3 and 8.
 *
 * Two pieces live here: the running integration of whatever is in the air
 * (`Percept`) and the short echoic buffer of finished sounds that gives the
 * brain a temporal window instead of an instant.
 *
 * The echoic buffer is what makes sequence possible. A single sound is one
 * point in acoustic space; two sounds with a measured gap between them is a
 * pair, and a pair can differ from the same pair reversed. Nothing here knows
 * or cares whether that difference is ever used — the buffer just holds the
 * last few things heard, with how long ago they were, and the network decides
 * whether any of it is worth wiring up.
 */
import { CALL_DIM, MAX_ECHOIC } from './sound';

/** One echoic entry: a full call descriptor plus the silence before it. */
export const ECHO_STRIDE = CALL_DIM + 1;
export const ECHO_GAP = CALL_DIM;
export const ECHOIC_STRIDE = MAX_ECHOIC * ECHO_STRIDE;

/** Gap in ticks that maps to a normalised gap of 1. */
const GAP_SCALE = 120;

export function gapToNorm(ticks: number): number {
  const t = Math.log1p(Math.max(0, ticks)) / Math.log1p(GAP_SCALE);
  return t > 1 ? 1 : t;
}

/**
 * Push a finished sound into the ring. `head` is the index the *next* entry
 * will occupy; entry `head - 1` is therefore the newest. Returns the new head.
 */
export function pushEcho(
  buf: Float32Array,
  off: number,
  head: number,
  desc: Float32Array,
  descOff: number,
  gapTicks: number,
): number {
  const o = off + head * ECHO_STRIDE;
  for (let i = 0; i < CALL_DIM; i++) buf[o + i] = desc[descOff + i];
  buf[o + ECHO_GAP] = gapToNorm(gapTicks);
  return (head + 1) % MAX_ECHOIC;
}

/**
 * Offset of the `back`-th most recent entry (0 = newest). Returns -1 when the
 * organism's genome does not pay for a buffer that deep — a shallow echoic
 * memory is a real limit, not a zeroed input.
 */
export function echoOffset(off: number, head: number, back: number, depth: number): number {
  if (back >= depth || back >= MAX_ECHOIC) return -1;
  const idx = (head - 1 - back + MAX_ECHOIC * 2) % MAX_ECHOIC;
  return off + idx * ECHO_STRIDE;
}

/**
 * What the ear is currently delivering. Rebuilt from scratch every tick for
 * every organism, so it is a single shared scratch object.
 */
export interface Percept {
  /** Summed perceived loudness from every audible source. */
  total: number;
  /** Perceived properties of the loudest source — the one being attended to. */
  loudest: number;
  pitch: number;
  noisiness: number;
  timbre: number;
  slope: number;
  tremolo: number;
  /** Egocentric unit vector toward it, and how close it sounds. */
  dirX: number;
  dirY: number;
  proximity: number;
  /** Spread of pitch across everything audible — one voice or a chorus. */
  spread: number;
  /** How many sources are above the detection floor. */
  sources: number;
  /**
   * Slot index of the attended source, or -1. Used only to notice when
   * attention moves from one source to another; the brain never sees it.
   */
  slot: number;
  /** Where the attended sound came from, for measuring approach afterwards. */
  srcX: number;
  srcY: number;
  /** Ambient level the signal had to compete with. */
  noiseFloor: number;
}

export function makePercept(): Percept {
  return {
    total: 0,
    loudest: 0,
    pitch: 0,
    noisiness: 0,
    timbre: 0,
    slope: 0,
    tremolo: 0,
    dirX: 0,
    dirY: 0,
    proximity: 0,
    spread: 0,
    sources: 0,
    slot: -1,
    srcX: 0,
    srcY: 0,
    noiseFloor: 0,
  };
}

export function resetPercept(p: Percept): void {
  p.total = 0;
  p.loudest = 0;
  p.pitch = 0;
  p.noisiness = 0;
  p.timbre = 0;
  p.slope = 0;
  p.tremolo = 0;
  p.dirX = 0;
  p.dirY = 0;
  p.proximity = 0;
  p.spread = 0;
  p.sources = 0;
  p.slot = -1;
  p.srcX = 0;
  p.srcY = 0;
  p.noiseFloor = 0;
}

/** Below this perceived amplitude a sound is not detected at all. */
export const DETECTION_FLOOR = 0.012;
