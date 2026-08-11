/**
 * Communication analysis — Phase 9.
 *
 * This module is a field biologist, not part of the animal. It watches sounds
 * happen, watches what was going on at the time, watches what listeners did
 * afterwards, and reports correlations. It has no privileged access to
 * anything: every number it uses is one an observer with good instruments
 * could have measured from outside.
 *
 * The critical property, and the one the whole design rests on:
 *
 *   NOTHING IN THIS FILE IS EVER READ BY THE SIMULATION.
 *
 * There is no path from a `CallCluster` back into an organism's senses, brain,
 * or fitness. The analyser can be deleted, reset mid-run, or fed garbage and
 * the world will unfold identically — which is asserted by a test, because a
 * claim like that is worthless unless it is checked.
 *
 * What is measured:
 *   - recurring shapes in acoustic space, by online clustering
 *   - what tended to be true of the world when each shape was used
 *   - what listeners tended to do in the seconds after hearing it
 *   - whether shapes follow each other in non-random order
 *   - whether calls answer calls
 *   - whether a reply resembles what it answered
 *   - whether different parts of the map use different shapes
 *   - whether a shape outlives the generation that started it
 *
 * Every one of those can come back "no", and usually does.
 */
import { CALL_DIM, CALL_NAMES, callDistance, normToDuration, pitchToHz } from '../acoustics/sound';
import {
  CALL_CONTEXT_DIM,
  CONTEXT_FEATURES,
  RESPONSE_DIM,
  RESPONSE_FEATURES,
} from '../acoustics/context';

/** Hard ceiling on how many distinct shapes will ever be tracked. */
export const MAX_CLUSTERS = 14;
/** Acoustic radius within which two calls are counted as the same shape. */
const CLUSTER_RADIUS = 0.085;
/** How fast a centroid follows its members. Slow, so a cluster is a claim. */
const CENTROID_RATE = 0.02;
/** Per-observation decay, so the picture tracks the living population. */
const DECAY = 0.99965;
/**
 * A cluster below this decayed weight is no longer a thing that happens.
 *
 * The scale comes from the decay: a shape used for a fraction p of all calls
 * settles at about p / (1 - DECAY) ≈ 2860p, so this threshold retires anything
 * below roughly one call in a thousand.
 */
const EXTINCTION_WEIGHT = 3;
/**
 * Observations a newly adopted shape gets before it can be retired. Without
 * this every new cluster starts at a weight of one, falls below the extinction
 * threshold immediately, and is deleted before it can ever accumulate — so no
 * shape is ever found and the whole analysis silently reports nothing.
 */
const ADOPTION_GRACE = 400;
/** Observations needed before anything at all is reported. */
const MIN_OBSERVATIONS = 300;
/** Standardised difference below which a context association is not worth reporting. */
export const ASSOCIATION_THRESHOLD = 0.25;
/**
 * Floor on the population standard deviation used as the denominator of a
 * standardised difference.
 *
 * Without it, a circumstance that is almost always true — every caller is
 * hungry, say — has a variance near zero, and dividing by it turns a
 * meaningless difference of a few percent into an effect size of several
 * hundred. A feature that never varies by more than this cannot distinguish
 * one call from another no matter what the arithmetic says.
 */
const MIN_POOLED_SD = 0.02;
/**
 * Minimum raw difference, on a 0..1 feature, before an association is reported
 * at all — regardless of how impressive the standardised version looks.
 *
 * The floor above stops the arithmetic exploding, but it does not stop a
 * genuinely trivial difference from *reading* as enormous once divided by a
 * near-zero spread. If every caller in the world is hungry, "this shape's
 * callers were four percent hungrier" is not a finding, and it should not be
 * dressed up as one just because the population barely varied.
 */
const MIN_RAW_DIFFERENCE = 0.05;
/** Effect sizes are clamped here; anything past it is off the scale anyway. */
const MAX_EFFECT = 6;
/** Uses of a shape needed before its associations are reported at all. */
const MIN_ASSOC_SAMPLES = 25;
/**
 * Share of all calls a shape needs before it can set the headline confidence
 * number. Without this, one organism in an extreme state making an unusual
 * noise a couple of dozen times drives the whole run's communication claim.
 */
const MIN_HEADLINE_SHARE = 0.02;

/** Regions the world is cut into when looking for geographic divergence. */
export const DIALECT_GRID = 4;
const DIALECT_REGIONS = DIALECT_GRID * DIALECT_GRID;
/** A region needs this many calls before its repertoire means anything. */
const MIN_REGION_CALLS = 40;

export interface Association {
  label: string;
  /** Standardised difference: how far this cluster's mean sits from the
   * population mean, in population standard deviations. */
  d: number;
}

export interface CallCluster {
  id: number;
  /** Mean acoustic shape, in the raw descriptor space. */
  centroid: number[];
  /** Human-readable rendering of the same thing. Physics, not meaning. */
  pitchHz: number;
  durationTicks: number;
  /** Decayed occurrence weight and its share of all calls. */
  weight: number;
  share: number;
  /** Mean acoustic distance of members from the centroid — how tight it is. */
  scatter: number;
  firstTick: number;
  lastTick: number;
  firstGeneration: number;
  lastGeneration: number;
  /** How much the centroid has moved recently. Low means a stable convention. */
  drift: number;
  emitterContext: Association[];
  listenerResponse: Association[];
  /** Largest absolute association found, on either side. */
  confidence: number;
  /** Fraction of uses contributed by each species, largest first. */
  species: { id: number; share: number }[];
  /** Listener observations backing the response column. */
  responseSamples: number;
}

export interface SequenceReport {
  /** Bits of information the previous call gives about the next one. */
  mutualInformation: number;
  /** Entropy over which cluster gets used at all, in bits. */
  repertoireEntropy: number;
  /** Fraction of calls that repeat the emitter's previous call. */
  repetition: number;
  topTransitions: { from: number; to: number; probability: number; count: number }[];
  samples: number;
}

export interface TurnTakingReport {
  /** Fraction of calls made shortly after the emitter heard something. */
  replyRate: number;
  /** Fraction of the time an organism has recently heard something at all —
   * the rate replies would occur at if calling ignored hearing entirely. */
  baseline: number;
  /** replyRate minus baseline. Positive means calls follow calls. */
  alternation: number;
  /** Mean acoustic distance from a reply to the call it answered. */
  replyDistance: number;
  /** The same distance between calls with no relationship. */
  chanceDistance: number;
  /** chanceDistance minus replyDistance. Positive means replies imitate. */
  convergence: number;
  samples: number;
}

export interface DialectReport {
  /** Mean Jensen-Shannon divergence between regional repertoires, in bits. */
  divergence: number;
  /** The same measure between species repertoires. */
  speciesDivergence: number;
  regions: { region: number; x: number; y: number; calls: number; top: number[] }[];
  pairs: { a: number; b: number; divergence: number }[];
}

export interface UnknownPattern {
  /** Acoustic shape that keeps recurring but fits no established cluster. */
  centroid: number[];
  pitchHz: number;
  count: number;
  firstTick: number;
  lastTick: number;
}

export interface AcousticReport {
  observations: number;
  /**
   * Tick of the most recent call recorded. The statistics below describe the
   * last few thousand vocalisations *whenever they happened* — in a world that
   * has fallen silent they are history, not a description of the present.
   */
  lastObservationTick: number;
  clusters: CallCluster[];
  /** Shannon entropy over cluster usage, in bits. Higher = more distinct calls. */
  diversity: number;
  /** Mean scatter across clusters — how precisely calls are reproduced. */
  precision: number;
  sequence: SequenceReport;
  turnTaking: TurnTakingReport;
  dialects: DialectReport;
  unknown: UnknownPattern[];
  /** Strongest association found on either side, for any common shape. */
  strongestAssociation: number;
  /**
   * The stronger claim: the best shape for which *both* sides hold at once —
   * used in distinctive circumstances and followed by distinctive behaviour.
   * A one-sided correlation only says calling tracks the caller's state, which
   * a groan would satisfy. Two-sided is what a signal would look like.
   */
  strongestCoupling: number;
  /** Largest number of generations a single cluster has persisted across. */
  generationSpan: number;
}

/** Calls between batched decays of the per-species repertoire histograms. */
const SPECIES_DECAY_INTERVAL = 64;

/** Reservoir of calls that fit nothing, waiting to see if they recur. */
const UNKNOWN_SLOTS = 8;
const UNKNOWN_RADIUS = 0.12;
/** Recurrences before an unclassified shape is worth reporting. */
const UNKNOWN_MIN_COUNT = 12;
/**
 * How much more common an unclassified shape has to become than the least-used
 * tracked one before it takes its slot. Without promotion the analyser would
 * track the first fourteen shapes it happened to see rather than the fourteen
 * that matter, and everything discovered later — however common it became —
 * would be filed permanently under "unknown".
 */
const PROMOTION_RATIO = 1.25;

export class AcousticAnalyzer {
  // ---- clusters ----
  private centroid = new Float32Array(MAX_CLUSTERS * CALL_DIM);
  private weight = new Float64Array(MAX_CLUSTERS);
  private scatter = new Float64Array(MAX_CLUSTERS);
  private drift = new Float64Array(MAX_CLUSTERS);
  private firstTick = new Float64Array(MAX_CLUSTERS);
  private lastTick = new Float64Array(MAX_CLUSTERS);
  private firstGen = new Float64Array(MAX_CLUSTERS);
  private lastGen = new Float64Array(MAX_CLUSTERS);
  private used = new Uint8Array(MAX_CLUSTERS);
  /** Observation index each shape was adopted at, for the grace period. */
  private adoptedAt = new Float64Array(MAX_CLUSTERS);

  // ---- emitter-side context sums, per cluster ----
  private ctxSum = new Float64Array(MAX_CLUSTERS * CALL_CONTEXT_DIM);
  private ctxAll = new Float64Array(CALL_CONTEXT_DIM);
  private ctxAll2 = new Float64Array(CALL_CONTEXT_DIM);
  private ctxN = 0;

  // ---- listener-side response sums, per cluster ----
  private respSum = new Float64Array(MAX_CLUSTERS * RESPONSE_DIM);
  private respCount = new Float64Array(MAX_CLUSTERS);
  private respAll = new Float64Array(RESPONSE_DIM);
  private respAll2 = new Float64Array(RESPONSE_DIM);
  private respN = 0;

  // ---- sequence ----
  private bigram = new Float64Array(MAX_CLUSTERS * MAX_CLUSTERS);
  private bigramN = 0;
  private repeats = 0;

  // ---- turn taking and convergence ----
  private replies = 0;
  private callsSeen = 0;
  private hearingOpportunities = 0;
  private hearingSamples = 0;
  private replyDistSum = 0;
  private replyDistN = 0;
  private chanceDistSum = 0;
  private chanceDistN = 0;
  /** A rotating pool of recent calls, used as the null model for imitation. */
  private pool = new Float32Array(32 * CALL_DIM);
  private poolCount = 0;
  private poolHead = 0;

  // ---- dialects ----
  private regionHist = new Float64Array(DIALECT_REGIONS * MAX_CLUSTERS);
  private regionTotal = new Float64Array(DIALECT_REGIONS);
  private speciesHist = new Map<number, Float64Array>();
  /** Per-cluster tally of which species produced it. Sparse: species ids grow
   * without bound over a long run, so this is an association list. */
  private speciesLists = new Map<number, Map<number, number>>();

  // ---- unclassified ----
  private unkCentroid = new Float32Array(UNKNOWN_SLOTS * CALL_DIM);
  private unkCount = new Float64Array(UNKNOWN_SLOTS);
  private unkFirst = new Float64Array(UNKNOWN_SLOTS);
  private unkLast = new Float64Array(UNKNOWN_SLOTS);

  private observations = 0;
  /** Undecayed count of calls seen, used only for ages and periodic upkeep. */
  private observationIndex = 0;
  private lastObservationTick = 0;
  private cached: AcousticReport | null = null;

  /**
   * Classify a call without changing anything. Used to attribute a listener's
   * later behaviour to what it heard, and by the UI. Returns -1 for a sound
   * that matches no established shape.
   */
  classify(desc: Float32Array, off: number): number {
    let best = -1;
    let bestD = CLUSTER_RADIUS;
    for (let k = 0; k < MAX_CLUSTERS; k++) {
      if (!this.used[k]) continue;
      const d = callDistance(this.centroid, k * CALL_DIM, desc, off);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    return best;
  }

  /**
   * Record one completed vocalisation.
   *
   * `previous` is the cluster this emitter last produced (-1 if none), which is
   * what makes a transition matrix possible. `heardDistance` is how acoustically
   * close the emitter's last heard sound was, or -1 if it had not heard
   * anything recently — the raw material for turn-taking and imitation.
   */
  observeCall(
    desc: Float32Array,
    off: number,
    context: Float32Array,
    ctxOff: number,
    tick: number,
    generation: number,
    speciesId: number,
    x: number,
    y: number,
    worldSize: number,
    previous: number,
    heardRecently: boolean,
    heardDistance: number,
  ): number {
    this.observations = this.observations * DECAY + 1;
    this.observationIndex++;
    this.lastObservationTick = tick;
    this.cached = null;
    // The reservoir fades on the same clock as the tracked shapes, so the two
    // counts are directly comparable when deciding whether to promote one.
    for (let k = 0; k < UNKNOWN_SLOTS; k++) this.unkCount[k] *= DECAY;

    // ---- assign to a shape ----
    let best = -1;
    let bestD = Infinity;
    let free = -1;
    let weakest = -1;
    let weakestW = Infinity;
    for (let k = 0; k < MAX_CLUSTERS; k++) {
      this.weight[k] *= DECAY;
      if (!this.used[k]) {
        if (free < 0) free = k;
        continue;
      }
      if (
        this.weight[k] < EXTINCTION_WEIGHT &&
        this.observationIndex - this.adoptedAt[k] > ADOPTION_GRACE
      ) {
        // Nobody makes this sound any more. Retire it so the slot can be
        // reused; any milestone it already triggered stands, because it did
        // happen. A shape still inside its grace period is left alone — it may
        // simply be new.
        this.retire(k);
        if (free < 0) free = k;
        continue;
      }
      const d = callDistance(this.centroid, k * CALL_DIM, desc, off);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
      if (this.weight[k] < weakestW) {
        weakestW = this.weight[k];
        weakest = k;
      }
    }

    let cluster = -1;
    if (best >= 0 && bestD <= CLUSTER_RADIUS) {
      cluster = best;
      const o = best * CALL_DIM;
      let moved = 0;
      for (let i = 0; i < CALL_DIM; i++) {
        const step = (desc[off + i] - this.centroid[o + i]) * CENTROID_RATE;
        this.centroid[o + i] += step;
        moved += step < 0 ? -step : step;
      }
      this.weight[best] += 1;
      this.scatter[best] = this.scatter[best] * 0.995 + bestD * 0.005;
      this.drift[best] = this.drift[best] * 0.995 + moved * 0.005;
      this.lastTick[best] = tick;
      if (generation > this.lastGen[best]) this.lastGen[best] = generation;
      if (generation < this.firstGen[best]) this.firstGen[best] = generation;
    } else if (free >= 0) {
      cluster = this.adopt(free, desc, off, tick, generation);
    } else if (
      weakest >= 0 &&
      weakestW < EXTINCTION_WEIGHT * 2 &&
      this.observationIndex - this.adoptedAt[weakest] > ADOPTION_GRACE
    ) {
      this.retire(weakest);
      cluster = this.adopt(weakest, desc, off, tick, generation);
    } else {
      // Every shape slot is occupied by something better established, so this
      // sound goes into the unclassified reservoir instead of being forced
      // into a category it does not belong to. If it keeps happening and
      // overtakes the least-used tracked shape, it takes that slot.
      cluster = this.noteUnknown(desc, off, tick, generation, weakest, weakestW);
    }

    // ---- emitter context, always accumulated, cluster or not ----
    // Every per-cluster context sum fades on the same clock as the cluster
    // weight it will be divided by. Fading it only when its own cluster is used
    // would leave the numerator decayed n times and the denominator decayed
    // once per call in the whole world, which inflates the mean of every shape
    // in inverse proportion to how rare it is — and rare shapes would come out
    // looking like the most strongly associated things in the run.
    for (let i = 0; i < this.ctxSum.length; i++) this.ctxSum[i] *= DECAY;
    this.ctxN = this.ctxN * DECAY + 1;
    for (let i = 0; i < CALL_CONTEXT_DIM; i++) {
      const v = context[ctxOff + i];
      this.ctxAll[i] = this.ctxAll[i] * DECAY + v;
      this.ctxAll2[i] = this.ctxAll2[i] * DECAY + v * v;
    }
    if (cluster >= 0) {
      const co = cluster * CALL_CONTEXT_DIM;
      for (let i = 0; i < CALL_CONTEXT_DIM; i++) this.ctxSum[co + i] += context[ctxOff + i];

      // ---- who uses it ----
      this.bumpSpecies(cluster, speciesId);

      // ---- where it is used ----
      const gx = Math.min(DIALECT_GRID - 1, Math.floor((x / worldSize) * DIALECT_GRID));
      const gy = Math.min(DIALECT_GRID - 1, Math.floor((y / worldSize) * DIALECT_GRID));
      const region = gy * DIALECT_GRID + gx;
      for (let r = 0; r < DIALECT_REGIONS; r++) this.regionTotal[r] *= DECAY;
      for (let i = 0; i < this.regionHist.length; i++) this.regionHist[i] *= DECAY;
      this.regionHist[region * MAX_CLUSTERS + cluster] += 1;
      this.regionTotal[region] += 1;

      let sh = this.speciesHist.get(speciesId);
      if (!sh) {
        sh = new Float64Array(MAX_CLUSTERS);
        this.speciesHist.set(speciesId, sh);
      }
      sh[cluster] += 1;
      // Fading every species histogram on every call would cost O(species) per
      // call for no extra fidelity, so the same decay is applied in batches.
      if (this.observationIndex % SPECIES_DECAY_INTERVAL === 0) this.decaySpeciesHistograms();

      // ---- sequence ----
      if (previous >= 0) {
        this.bigramN = this.bigramN * DECAY + 1;
        for (let i = 0; i < this.bigram.length; i++) this.bigram[i] *= DECAY;
        this.bigram[previous * MAX_CLUSTERS + cluster] += 1;
        if (previous === cluster) this.repeats = this.repeats * DECAY + 1;
        else this.repeats *= DECAY;
      }
    }

    // ---- turn taking ----
    this.callsSeen = this.callsSeen * DECAY + 1;
    if (heardRecently) {
      this.replies = this.replies * DECAY + 1;
      if (heardDistance >= 0) {
        this.replyDistSum = this.replyDistSum * DECAY + heardDistance;
        this.replyDistN = this.replyDistN * DECAY + 1;
      }
    } else {
      this.replies *= DECAY;
    }

    // ---- the null model for imitation: distance to an unrelated recent call ----
    if (this.poolCount > 0) {
      const other = (this.poolHead + 7) % this.poolCount;
      this.chanceDistSum =
        this.chanceDistSum * DECAY + callDistance(this.pool, other * CALL_DIM, desc, off);
      this.chanceDistN = this.chanceDistN * DECAY + 1;
    }
    const po = this.poolHead * CALL_DIM;
    for (let i = 0; i < CALL_DIM; i++) this.pool[po + i] = desc[off + i];
    this.poolHead = (this.poolHead + 1) % 32;
    if (this.poolCount < 32) this.poolCount++;

    return cluster;
  }

  /**
   * Record what an organism was hearing at a moment when it was not calling —
   * the denominator for the turn-taking baseline. Without this, "calls follow
   * calls" would just be measuring how noisy the world is.
   */
  observeHearingOpportunity(heardRecently: boolean): void {
    this.hearingSamples = this.hearingSamples * DECAY + 1;
    if (heardRecently) this.hearingOpportunities = this.hearingOpportunities * DECAY + 1;
    else this.hearingOpportunities *= DECAY;
  }

  /** Record what a listener did in the window after hearing cluster `c`. */
  observeResponse(cluster: number, response: Float32Array): void {
    this.respN = this.respN * DECAY + 1;
    for (let i = 0; i < RESPONSE_DIM; i++) {
      const v = response[i];
      this.respAll[i] = this.respAll[i] * DECAY + v;
      this.respAll2[i] = this.respAll2[i] * DECAY + v * v;
    }
    if (cluster < 0 || cluster >= MAX_CLUSTERS || !this.used[cluster]) return;
    const o = cluster * RESPONSE_DIM;
    for (let i = 0; i < RESPONSE_DIM; i++) this.respSum[o + i] = this.respSum[o + i] * DECAY + response[i];
    this.respCount[cluster] = this.respCount[cluster] * DECAY + 1;
    this.cached = null;
  }

  // ------------------------------------------------------------- internals

  private adopt(
    k: number,
    desc: Float32Array,
    off: number,
    tick: number,
    generation: number,
  ): number {
    const o = k * CALL_DIM;
    for (let i = 0; i < CALL_DIM; i++) this.centroid[o + i] = desc[off + i];
    this.used[k] = 1;
    this.weight[k] = 1;
    this.adoptedAt[k] = this.observationIndex;
    this.scatter[k] = 0;
    this.drift[k] = 0;
    this.firstTick[k] = tick;
    this.lastTick[k] = tick;
    this.firstGen[k] = generation;
    this.lastGen[k] = generation;
    const co = k * CALL_CONTEXT_DIM;
    for (let i = 0; i < CALL_CONTEXT_DIM; i++) this.ctxSum[co + i] = 0;
    const ro = k * RESPONSE_DIM;
    for (let i = 0; i < RESPONSE_DIM; i++) this.respSum[ro + i] = 0;
    this.respCount[k] = 0;
    this.speciesLists.delete(k);
    for (let r = 0; r < DIALECT_REGIONS; r++) this.regionHist[r * MAX_CLUSTERS + k] = 0;
    for (const h of this.speciesHist.values()) h[k] = 0;
    for (let i = 0; i < MAX_CLUSTERS; i++) {
      this.bigram[k * MAX_CLUSTERS + i] = 0;
      this.bigram[i * MAX_CLUSTERS + k] = 0;
    }
    return k;
  }

  private decaySpeciesHistograms(): void {
    const factor = Math.pow(DECAY, SPECIES_DECAY_INTERVAL);
    for (const [id, h] of this.speciesHist) {
      let total = 0;
      for (let k = 0; k < MAX_CLUSTERS; k++) {
        h[k] *= factor;
        total += h[k];
      }
      // A species nobody has heard from in a very long time is dropped, so the
      // map does not grow for the whole run.
      if (total < 0.5) this.speciesHist.delete(id);
    }
  }

  private retire(k: number): void {
    this.used[k] = 0;
    this.weight[k] = 0;
    this.speciesLists.delete(k);
  }

  private bumpSpecies(cluster: number, speciesId: number): void {
    const list = this.speciesLists.get(cluster) ?? new Map<number, number>();
    list.set(speciesId, (list.get(speciesId) ?? 0) * DECAY + 1);
    if (list.size > 24) {
      let worstKey = -1;
      let worst = Infinity;
      for (const [id, v] of list) {
        if (v < worst) {
          worst = v;
          worstKey = id;
        }
      }
      if (worstKey >= 0) list.delete(worstKey);
    }
    this.speciesLists.set(cluster, list);
  }

  /**
   * File a sound that matched nothing. Returns the cluster id if the shape has
   * become common enough to earn a tracked slot, otherwise -1.
   */
  private noteUnknown(
    desc: Float32Array,
    off: number,
    tick: number,
    generation: number,
    weakestCluster: number,
    weakestWeight: number,
  ): number {
    let best = -1;
    let bestD = UNKNOWN_RADIUS;
    let weakest = 0;
    let weakestC = Infinity;
    for (let k = 0; k < UNKNOWN_SLOTS; k++) {
      if (this.unkCount[k] < 0.01) {
        if (weakestC > 0) {
          weakest = k;
          weakestC = 0;
        }
        continue;
      }
      const d = callDistance(this.unkCentroid, k * CALL_DIM, desc, off);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
      if (this.unkCount[k] < weakestC) {
        weakestC = this.unkCount[k];
        weakest = k;
      }
    }
    const k = best >= 0 ? best : weakest;
    const o = k * CALL_DIM;
    if (best >= 0) {
      for (let i = 0; i < CALL_DIM; i++) this.unkCentroid[o + i] += (desc[off + i] - this.unkCentroid[o + i]) * 0.05;
      this.unkCount[k] += 1;
    } else {
      for (let i = 0; i < CALL_DIM; i++) this.unkCentroid[o + i] = desc[off + i];
      this.unkCount[k] = 1;
      this.unkFirst[k] = tick;
    }
    this.unkLast[k] = tick;

    if (
      weakestCluster >= 0 &&
      this.unkCount[k] > weakestWeight * PROMOTION_RATIO &&
      this.observationIndex - this.adoptedAt[weakestCluster] > ADOPTION_GRACE
    ) {
      this.retire(weakestCluster);
      const promoted = this.adopt(weakestCluster, this.unkCentroid, o, tick, generation);
      this.weight[promoted] = this.unkCount[k];
      this.unkCount[k] = 0;
      return promoted;
    }
    return -1;
  }

  // ---------------------------------------------------------------- report

  report(): AcousticReport {
    if (this.cached) return this.cached;
    const empty: AcousticReport = {
      observations: this.observations,
      lastObservationTick: this.lastObservationTick,
      clusters: [],
      diversity: 0,
      precision: 0,
      sequence: { mutualInformation: 0, repertoireEntropy: 0, repetition: 0, topTransitions: [], samples: 0 },
      turnTaking: {
        replyRate: 0,
        baseline: 0,
        alternation: 0,
        replyDistance: 0,
        chanceDistance: 0,
        convergence: 0,
        samples: 0,
      },
      dialects: { divergence: 0, speciesDivergence: 0, regions: [], pairs: [] },
      unknown: [],
      strongestAssociation: 0,
      strongestCoupling: 0,
      generationSpan: 0,
    };
    if (this.observations < MIN_OBSERVATIONS) return empty;

    let totalWeight = 0;
    for (let k = 0; k < MAX_CLUSTERS; k++) if (this.used[k]) totalWeight += this.weight[k];
    if (totalWeight <= 0) return empty;

    const clusters: CallCluster[] = [];
    let strongest = 0;
    let strongestCoupling = 0;
    let entropy = 0;
    let precision = 0;
    let genSpan = 0;

    for (let k = 0; k < MAX_CLUSTERS; k++) {
      if (!this.used[k]) continue;
      const share = this.weight[k] / totalWeight;
      if (share > 0) entropy -= share * Math.log2(share);
      precision += this.scatter[k] * share;

      const emitterContext = this.contextAssociations(k);
      const listenerResponse = this.responseAssociations(k);
      const confidence = Math.max(
        emitterContext.length ? Math.abs(emitterContext[0].d) : 0,
        listenerResponse.length ? Math.abs(listenerResponse[0].d) : 0,
      );
      if (share >= MIN_HEADLINE_SHARE) {
        if (confidence > strongest) strongest = confidence;
        // Both sides have to hold, so the weaker of the two is the claim.
        const coupling = Math.min(
          emitterContext.length ? Math.abs(emitterContext[0].d) : 0,
          listenerResponse.length ? Math.abs(listenerResponse[0].d) : 0,
        );
        if (coupling > strongestCoupling) strongestCoupling = coupling;
      }
      const span = this.lastGen[k] - this.firstGen[k];
      if (span > genSpan) genSpan = span;

      const o = k * CALL_DIM;
      const centroid: number[] = [];
      for (let i = 0; i < CALL_DIM; i++) centroid.push(this.centroid[o + i]);

      const list = this.speciesLists.get(k);
      const species: { id: number; share: number }[] = [];
      if (list) {
        let sum = 0;
        for (const v of list.values()) sum += v;
        if (sum > 0) {
          for (const [id, v] of list) species.push({ id, share: v / sum });
          species.sort((a, b) => b.share - a.share);
        }
      }

      clusters.push({
        id: k,
        centroid,
        pitchHz: pitchToHz(centroid[0]),
        durationTicks: normToDuration(centroid[6]),
        weight: this.weight[k],
        share,
        scatter: this.scatter[k],
        firstTick: this.firstTick[k],
        lastTick: this.lastTick[k],
        firstGeneration: this.firstGen[k],
        lastGeneration: this.lastGen[k],
        drift: this.drift[k],
        emitterContext,
        listenerResponse,
        confidence,
        species: species.slice(0, 4),
        responseSamples: this.respCount[k],
      });
    }
    clusters.sort((a, b) => b.share - a.share);

    const out: AcousticReport = {
      observations: this.observations,
      lastObservationTick: this.lastObservationTick,
      clusters,
      diversity: entropy,
      precision,
      sequence: this.sequenceReport(),
      turnTaking: this.turnTakingReport(),
      dialects: this.dialectReport(),
      unknown: this.unknownReport(),
      strongestAssociation: strongest,
      strongestCoupling,
      generationSpan: genSpan,
    };
    this.cached = out;
    return out;
  }

  /**
   * Cohen's d against the population: how far this cluster's mean context sits
   * from the mean context of every call, in population standard deviations.
   * Chosen over a correlation because the question is "is this shape used in
   * unusual circumstances", which is a difference of means, not a slope.
   */
  private contextAssociations(k: number): Association[] {
    const n = this.weight[k];
    if (n < MIN_ASSOC_SAMPLES || this.ctxN < 1) return [];
    const out: Association[] = [];
    const co = k * CALL_CONTEXT_DIM;
    for (let i = 0; i < CALL_CONTEXT_DIM; i++) {
      const mine = this.ctxSum[co + i] / n;
      const all = this.ctxAll[i] / this.ctxN;
      const varAll = this.ctxAll2[i] / this.ctxN - all * all;
      const raw = mine - all;
      if (Math.abs(raw) < MIN_RAW_DIFFERENCE) continue;
      const sd = Math.max(Math.sqrt(Math.max(0, varAll)), MIN_POOLED_SD);
      const d = clampEffect(raw / sd);
      if (Math.abs(d) >= ASSOCIATION_THRESHOLD) out.push({ label: CONTEXT_FEATURES[i], d });
    }
    out.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    return out.slice(0, 3);
  }

  private responseAssociations(k: number): Association[] {
    const n = this.respCount[k];
    if (n < MIN_ASSOC_SAMPLES || this.respN < 1) return [];
    const out: Association[] = [];
    const ro = k * RESPONSE_DIM;
    for (let i = 0; i < RESPONSE_DIM; i++) {
      const mine = this.respSum[ro + i] / n;
      const all = this.respAll[i] / this.respN;
      const varAll = this.respAll2[i] / this.respN - all * all;
      const raw = mine - all;
      if (Math.abs(raw) < MIN_RAW_DIFFERENCE) continue;
      const sd = Math.max(Math.sqrt(Math.max(0, varAll)), MIN_POOLED_SD);
      const d = clampEffect(raw / sd);
      if (Math.abs(d) >= ASSOCIATION_THRESHOLD) out.push({ label: RESPONSE_FEATURES[i], d });
    }
    out.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    return out.slice(0, 3);
  }

  /**
   * Mutual information between consecutive calls. Zero means knowing what an
   * organism just said tells you nothing about what it will say next, which is
   * what a repertoire with no sequential structure looks like.
   */
  private sequenceReport(): SequenceReport {
    const total = this.bigramN;
    if (total < 60) {
      return { mutualInformation: 0, repertoireEntropy: 0, repetition: 0, topTransitions: [], samples: total };
    }
    const from = new Float64Array(MAX_CLUSTERS);
    const to = new Float64Array(MAX_CLUSTERS);
    let sum = 0;
    for (let a = 0; a < MAX_CLUSTERS; a++) {
      for (let b = 0; b < MAX_CLUSTERS; b++) {
        const v = this.bigram[a * MAX_CLUSTERS + b];
        if (v <= 0) continue;
        from[a] += v;
        to[b] += v;
        sum += v;
      }
    }
    if (sum <= 0) {
      return { mutualInformation: 0, repertoireEntropy: 0, repetition: 0, topTransitions: [], samples: total };
    }

    let mi = 0;
    let hTo = 0;
    for (let b = 0; b < MAX_CLUSTERS; b++) {
      const p = to[b] / sum;
      if (p > 0) hTo -= p * Math.log2(p);
    }
    const transitions: { from: number; to: number; probability: number; count: number }[] = [];
    for (let a = 0; a < MAX_CLUSTERS; a++) {
      if (from[a] <= 0) continue;
      for (let b = 0; b < MAX_CLUSTERS; b++) {
        const v = this.bigram[a * MAX_CLUSTERS + b];
        if (v <= 0) continue;
        const pab = v / sum;
        const pa = from[a] / sum;
        const pb = to[b] / sum;
        mi += pab * Math.log2(pab / (pa * pb));
        transitions.push({ from: a, to: b, probability: v / from[a], count: v });
      }
    }
    transitions.sort((x, y) => y.count - x.count);

    return {
      mutualInformation: Math.max(0, mi),
      repertoireEntropy: hTo,
      repetition: this.repeats / total,
      topTransitions: transitions.slice(0, 6),
      samples: total,
    };
  }

  private turnTakingReport(): TurnTakingReport {
    const calls = this.callsSeen;
    if (calls < 40 || this.hearingSamples < 40) {
      return {
        replyRate: 0,
        baseline: 0,
        alternation: 0,
        replyDistance: 0,
        chanceDistance: 0,
        convergence: 0,
        samples: calls,
      };
    }
    const replyRate = this.replies / calls;
    const baseline = this.hearingOpportunities / this.hearingSamples;
    const replyDistance = this.replyDistN > 4 ? this.replyDistSum / this.replyDistN : 0;
    const chanceDistance = this.chanceDistN > 4 ? this.chanceDistSum / this.chanceDistN : 0;
    return {
      replyRate,
      baseline,
      alternation: replyRate - baseline,
      replyDistance,
      chanceDistance,
      convergence: replyDistance > 0 && chanceDistance > 0 ? chanceDistance - replyDistance : 0,
      samples: calls,
    };
  }

  /**
   * Geographic and taxonomic divergence in repertoire, as Jensen-Shannon
   * divergence between usage histograms. Nothing here creates dialects — it
   * only asks whether separated populations happen to have ended up using
   * different sounds, which they usually have not.
   */
  private dialectReport(): DialectReport {
    const regions: { region: number; x: number; y: number; calls: number; top: number[] }[] = [];
    const active: number[] = [];
    for (let r = 0; r < DIALECT_REGIONS; r++) {
      if (this.regionTotal[r] < MIN_REGION_CALLS) continue;
      active.push(r);
      const base = r * MAX_CLUSTERS;
      const top: number[] = [];
      for (let k = 0; k < MAX_CLUSTERS; k++) top.push(this.regionHist[base + k] / this.regionTotal[r]);
      regions.push({
        region: r,
        x: r % DIALECT_GRID,
        y: Math.floor(r / DIALECT_GRID),
        calls: this.regionTotal[r],
        top,
      });
    }

    const pairs: { a: number; b: number; divergence: number }[] = [];
    let sum = 0;
    let n = 0;
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const d = jensenShannon(
          this.regionHist,
          active[i] * MAX_CLUSTERS,
          this.regionTotal[active[i]],
          this.regionHist,
          active[j] * MAX_CLUSTERS,
          this.regionTotal[active[j]],
        );
        pairs.push({ a: active[i], b: active[j], divergence: d });
        sum += d;
        n++;
      }
    }
    pairs.sort((a, b) => b.divergence - a.divergence);

    // Same measure between species repertoires.
    const sp: { hist: Float64Array; total: number }[] = [];
    for (const h of this.speciesHist.values()) {
      let t = 0;
      for (let k = 0; k < MAX_CLUSTERS; k++) t += h[k];
      if (t >= MIN_REGION_CALLS) sp.push({ hist: h, total: t });
    }
    let spSum = 0;
    let spN = 0;
    for (let i = 0; i < sp.length; i++) {
      for (let j = i + 1; j < sp.length; j++) {
        spSum += jensenShannon(sp[i].hist, 0, sp[i].total, sp[j].hist, 0, sp[j].total);
        spN++;
      }
    }

    return {
      divergence: n > 0 ? sum / n : 0,
      speciesDivergence: spN > 0 ? spSum / spN : 0,
      regions,
      pairs: pairs.slice(0, 4),
    };
  }

  private unknownReport(): UnknownPattern[] {
    const out: UnknownPattern[] = [];
    for (let k = 0; k < UNKNOWN_SLOTS; k++) {
      if (this.unkCount[k] < UNKNOWN_MIN_COUNT) continue;
      const o = k * CALL_DIM;
      const centroid: number[] = [];
      for (let i = 0; i < CALL_DIM; i++) centroid.push(this.unkCentroid[o + i]);
      out.push({
        centroid,
        pitchHz: pitchToHz(centroid[0]),
        count: this.unkCount[k],
        firstTick: this.unkFirst[k],
        lastTick: this.unkLast[k],
      });
    }
    out.sort((a, b) => b.count - a.count);
    return out;
  }

  get sampleCount(): number {
    return this.observations;
  }

  reset(): void {
    this.centroid.fill(0);
    this.weight.fill(0);
    this.scatter.fill(0);
    this.drift.fill(0);
    this.firstTick.fill(0);
    this.lastTick.fill(0);
    this.firstGen.fill(0);
    this.lastGen.fill(0);
    this.used.fill(0);
    this.adoptedAt.fill(0);
    this.ctxSum.fill(0);
    this.ctxAll.fill(0);
    this.ctxAll2.fill(0);
    this.ctxN = 0;
    this.respSum.fill(0);
    this.respCount.fill(0);
    this.respAll.fill(0);
    this.respAll2.fill(0);
    this.respN = 0;
    this.bigram.fill(0);
    this.bigramN = 0;
    this.repeats = 0;
    this.replies = 0;
    this.callsSeen = 0;
    this.hearingOpportunities = 0;
    this.hearingSamples = 0;
    this.replyDistSum = 0;
    this.replyDistN = 0;
    this.chanceDistSum = 0;
    this.chanceDistN = 0;
    this.pool.fill(0);
    this.poolCount = 0;
    this.poolHead = 0;
    this.regionHist.fill(0);
    this.regionTotal.fill(0);
    this.speciesHist.clear();
    this.speciesLists.clear();
    this.unkCentroid.fill(0);
    this.unkCount.fill(0);
    this.unkFirst.fill(0);
    this.unkLast.fill(0);
    this.observations = 0;
    this.observationIndex = 0;
    this.lastObservationTick = 0;
    this.cached = null;
  }
}

function clampEffect(d: number): number {
  if (!Number.isFinite(d)) return 0;
  return d > MAX_EFFECT ? MAX_EFFECT : d < -MAX_EFFECT ? -MAX_EFFECT : d;
}

/** Jensen-Shannon divergence in bits between two usage histograms. */
function jensenShannon(
  a: Float64Array,
  ao: number,
  aTotal: number,
  b: Float64Array,
  bo: number,
  bTotal: number,
): number {
  if (aTotal <= 0 || bTotal <= 0) return 0;
  let d = 0;
  for (let k = 0; k < MAX_CLUSTERS; k++) {
    const p = a[ao + k] / aTotal;
    const q = b[bo + k] / bTotal;
    const m = (p + q) * 0.5;
    if (m <= 0) continue;
    if (p > 0) d += 0.5 * p * Math.log2(p / m);
    if (q > 0) d += 0.5 * q * Math.log2(q / m);
  }
  return d;
}

/** Plain-language rendering of a cluster centroid. Physics only, no meaning. */
export function describeCall(centroid: number[]): string {
  const hz = pitchToHz(centroid[0]);
  const ticks = normToDuration(centroid[6]);
  const sweep = centroid[1];
  const parts = [`${hz.toFixed(0)} Hz`, `${ticks.toFixed(0)} ticks`];
  if (Math.abs(sweep) > 0.06) parts.push(sweep > 0 ? 'rising' : 'falling');
  if (centroid[3] > 0.65) parts.push('noisy');
  else if (centroid[3] < 0.25) parts.push('tonal');
  if (centroid[5] > 0.45) parts.push('pulsed');
  return parts.join(' · ');
}

export { CALL_NAMES };
