/**
 * The population. Strict structure-of-arrays: every field is one TypedArray
 * indexed by slot. There is no Organism object anywhere in the hot path.
 *
 * Slots are recycled through a free-list stack, so births and deaths never
 * allocate. The free-list is popped in a deterministic order, which matters:
 * slot assignment affects iteration order, which affects the RNG stream.
 */
import { GENOME_LENGTH } from '../genome/loci';
import { BRAIN_STRIDE, PLASTIC_STRIDE } from '../brain/brain';
import { MAX_CONTEXT, MAX_MEMORY, type Phenotype } from '../genome/phenotype';
import { MAX_PROTOTYPES, VOICE_DIM } from '../acoustics/sound';
import { ECHOIC_STRIDE } from '../acoustics/ear';
import { PROTO_STRIDE } from '../acoustics/association';
import { CALL_CONTEXT_DIM } from '../acoustics/context';

/**
 * Neutral kin markers. Inherited Mendelian (each element from one parent), so
 * they track identity-by-descent the way real recognition cues do, rather than
 * genome-wide similarity — which conflates being related with being adapted the
 * same way. Two unrelated organisms converging on the same body plan look
 * identical to a genetic-distance measure but share no kin markers.
 */
export const KIN_TAG_LENGTH = 6;

export class Population {
  readonly capacity: number;

  // ---- identity / lineage ----
  readonly alive: Uint8Array;
  readonly id: Uint32Array;
  readonly speciesId: Uint32Array;
  readonly generation: Uint32Array;
  readonly parentA: Uint32Array;
  readonly parentB: Uint32Array;
  readonly birthTick: Uint32Array;

  // ---- kinematics ----
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly heading: Float32Array;

  // ---- state ----
  readonly energy: Float32Array;
  readonly health: Float32Array;
  readonly age: Float32Array;
  readonly pain: Float32Array; // decaying recent-damage trace
  readonly reward: Float32Array; // decaying recent-gain trace
  readonly attackCooldown: Float32Array;
  readonly reproCooldown: Float32Array;

  // ---- voice: the sound physically in the air around this organism ----
  /** Instantaneous acoustic frame — what is in the air during this tick. */
  readonly voice: Float32Array; // capacity * VOICE_DIM
  /**
   * Where this tick's production is written. Listeners read `voice` and
   * emitters write `voiceNext`, and the two are swapped once the whole
   * population has stepped. Without the split, an organism in slot 900 would
   * hear slot 100's brand-new call while slot 100 heard slot 900's call from
   * last tick, and the tick would stop being a simultaneous update.
   */
  readonly voiceNext: Float32Array;
  /** Running accumulation of the vocalisation currently in progress. */
  readonly callSum: Float32Array; // capacity * VOICE_DIM
  readonly callTicks: Float32Array;
  readonly callStartPitch: Float32Array;
  readonly callStartTick: Float32Array;
  readonly lastCallTick: Float32Array;
  /** Situation the emitter was in when it opened its mouth. Telemetry only. */
  readonly callContext: Float32Array; // capacity * CALL_CONTEXT_DIM

  // ---- ear: the sound currently being attended to ----
  /** Slot of the source being attended to, plus one. Zero means nothing. */
  readonly attendSource: Uint32Array;
  readonly attendSum: Float32Array; // capacity * VOICE_DIM
  readonly attendTicks: Float32Array;
  readonly attendStartPitch: Float32Array;
  readonly attendSrcX: Float32Array;
  readonly attendSrcY: Float32Array;
  readonly lastHeardTick: Float32Array;
  /** What experience says about the most recently finished sound heard. */
  readonly heardValence: Float32Array;
  readonly heardFamiliarity: Float32Array;

  // ---- echoic memory: the last few finished sounds ----
  readonly echoic: Float32Array; // capacity * ECHOIC_STRIDE
  readonly echoHead: Uint8Array;

  // ---- auditory associative memory (learned in life, never inherited) ----
  readonly soundProto: Float32Array; // capacity * PROTO_STRIDE
  readonly soundValence: Float32Array; // capacity * MAX_PROTOTYPES
  readonly soundStrength: Float32Array;
  readonly soundTrace: Float32Array;

  /**
   * Observer bookkeeping. The simulation never reads these back into
   * behaviour; they exist so an outside analyst can attribute a listener's
   * actions to the sound that preceded them. They live here rather than in the
   * analyser so that a forked world carries them and stays reproducible.
   */
  readonly heardCluster: Int16Array;
  readonly heardClusterTicks: Uint8Array;
  readonly heardDistance: Float32Array;
  readonly heardSrcX: Float32Array;
  readonly heardSrcY: Float32Array;
  /** Whether the last sound heard came from outside the ecosystem. */
  readonly heardExternal: Uint8Array;
  readonly lastEmittedCluster: Int16Array;

  // ---- episodic place memory ----
  readonly memX: Float32Array; // capacity * MAX_MEMORY
  readonly memY: Float32Array;
  readonly memValence: Float32Array;
  readonly memStrength: Float32Array;

  // ---- identity beyond the genome ----
  /** Neutral markers used for kin recognition. */
  readonly kinTag: Float32Array; // capacity * KIN_TAG_LENGTH
  /** Unbroken maternal line, inherited from parent A. Pure bookkeeping. */
  readonly matriline: Uint32Array;
  /**
   * Whose learned behaviour this organism is currently carrying. Inherited from
   * a parent at birth and overwritten by strong imitation, so a tag that
   * outlives the organism it is named after is, by construction, culture.
   */
  readonly memeTag: Uint32Array;
  readonly imitations: Uint16Array;
  readonly mutations: Uint16Array;
  readonly energyGiven: Float32Array;
  readonly energyReceived: Float32Array;

  // ---- life statistics (for the inspector and analytics) ----
  readonly children: Uint32Array;
  readonly kills: Uint32Array;
  readonly plantEaten: Float32Array;
  /** Energy taken from corpses. */
  readonly meatEaten: Float32Array;
  /** Energy torn from living organisms. Split from carrion so the niche
   * inference can tell a predator from a scavenger. */
  readonly preyEaten: Float32Array;
  readonly socialContacts: Uint32Array;
  readonly distanceTravelled: Float32Array;

  // ---- heritable material ----
  readonly genome: Float32Array; // capacity * GENOME_LENGTH
  readonly brain: Float32Array; // capacity * BRAIN_STRIDE  (germline)
  readonly plastic: Float32Array; // capacity * PLASTIC_STRIDE (soma, learned)
  readonly context: Float32Array; // capacity * MAX_CONTEXT (recurrent state)

  // ---- expressed phenotype, cached at birth ----
  readonly radius: Float32Array;
  readonly mass: Float32Array;
  readonly maxSpeed: Float32Array;
  readonly turnRate: Float32Array;
  readonly attackDamage: Float32Array;
  readonly armor: Float32Array;
  readonly spikes: Float32Array;
  readonly visionRange: Float32Array;
  readonly visionAcuity: Float32Array;
  readonly smellRange: Float32Array;
  readonly maxEnergy: Float32Array;
  readonly lifespan: Float32Array;
  readonly maturationAge: Float32Array;
  readonly reproThreshold: Float32Array;
  readonly offspringEnergy: Float32Array;
  readonly fecundity: Uint8Array;
  readonly plantEfficiency: Float32Array;
  readonly meatEfficiency: Float32Array;
  readonly tempPreference: Float32Array;
  readonly tempTolerance: Float32Array;
  readonly waterAffinity: Float32Array;
  readonly camouflage: Float32Array;
  readonly signalGain: Float32Array;
  readonly signalSensitivity: Float32Array;
  readonly hiddenSize: Uint8Array;
  readonly contextSize: Uint8Array;
  readonly plasticity: Float32Array;
  readonly mutationRate: Float32Array;
  readonly upkeep: Float32Array;
  readonly hue: Float32Array;
  readonly pattern: Float32Array;
  readonly memorySlots: Uint8Array;
  readonly memoryDecay: Float32Array;
  readonly hearingRange: Float32Array;
  readonly socialLearningRate: Float32Array;
  readonly vocalLow: Float32Array;
  readonly vocalHigh: Float32Array;
  readonly vocalPower: Float32Array;
  readonly vocalSlew: Float32Array;
  readonly vocalAgility: Float32Array;
  readonly timbreCenter: Float32Array;
  readonly timbreSpan: Float32Array;
  readonly noiseCenter: Float32Array;
  readonly noiseSpan: Float32Array;
  readonly auditoryLow: Float32Array;
  readonly auditoryHigh: Float32Array;
  readonly auditoryResolution: Float32Array;
  readonly echoicDepth: Uint8Array;
  readonly soundPrototypes: Uint8Array;

  // ---- slot management ----
  private freeList: Int32Array;
  private freeCount = 0;
  /** Highest slot index ever used + 1. Iteration only goes this far. */
  count = 0;
  livingCount = 0;
  nextId = 1;

  constructor(capacity: number) {
    this.capacity = capacity;
    const f = () => new Float32Array(capacity);
    const u32 = () => new Uint32Array(capacity);

    this.alive = new Uint8Array(capacity);
    this.id = u32();
    this.speciesId = u32();
    this.generation = u32();
    this.parentA = u32();
    this.parentB = u32();
    this.birthTick = u32();

    this.x = f();
    this.y = f();
    this.vx = f();
    this.vy = f();
    this.heading = f();

    this.energy = f();
    this.health = f();
    this.age = f();
    this.pain = f();
    this.reward = f();
    this.attackCooldown = f();
    this.reproCooldown = f();
    this.voice = new Float32Array(capacity * VOICE_DIM);
    this.voiceNext = new Float32Array(capacity * VOICE_DIM);
    this.callSum = new Float32Array(capacity * VOICE_DIM);
    this.callTicks = f();
    this.callStartPitch = f();
    this.callStartTick = f();
    this.lastCallTick = f();
    this.callContext = new Float32Array(capacity * CALL_CONTEXT_DIM);

    this.attendSource = u32();
    this.attendSum = new Float32Array(capacity * VOICE_DIM);
    this.attendTicks = f();
    this.attendStartPitch = f();
    this.attendSrcX = f();
    this.attendSrcY = f();
    this.lastHeardTick = f();
    this.heardValence = f();
    this.heardFamiliarity = f();

    this.echoic = new Float32Array(capacity * ECHOIC_STRIDE);
    this.echoHead = new Uint8Array(capacity);

    this.soundProto = new Float32Array(capacity * PROTO_STRIDE);
    this.soundValence = new Float32Array(capacity * MAX_PROTOTYPES);
    this.soundStrength = new Float32Array(capacity * MAX_PROTOTYPES);
    this.soundTrace = new Float32Array(capacity * MAX_PROTOTYPES);

    this.heardCluster = new Int16Array(capacity);
    this.heardClusterTicks = new Uint8Array(capacity);
    this.heardDistance = f();
    this.heardSrcX = f();
    this.heardSrcY = f();
    this.heardExternal = new Uint8Array(capacity);
    this.lastEmittedCluster = new Int16Array(capacity);

    this.memX = new Float32Array(capacity * MAX_MEMORY);
    this.memY = new Float32Array(capacity * MAX_MEMORY);
    this.memValence = new Float32Array(capacity * MAX_MEMORY);
    this.memStrength = new Float32Array(capacity * MAX_MEMORY);

    this.kinTag = new Float32Array(capacity * KIN_TAG_LENGTH);
    this.matriline = u32();
    this.memeTag = u32();
    this.imitations = new Uint16Array(capacity);
    this.mutations = new Uint16Array(capacity);
    this.energyGiven = f();
    this.energyReceived = f();

    this.children = u32();
    this.kills = u32();
    this.plantEaten = f();
    this.meatEaten = f();
    this.preyEaten = f();
    this.socialContacts = u32();
    this.distanceTravelled = f();

    this.genome = new Float32Array(capacity * GENOME_LENGTH);
    this.brain = new Float32Array(capacity * BRAIN_STRIDE);
    this.plastic = new Float32Array(capacity * PLASTIC_STRIDE);
    this.context = new Float32Array(capacity * MAX_CONTEXT);

    this.radius = f();
    this.mass = f();
    this.maxSpeed = f();
    this.turnRate = f();
    this.attackDamage = f();
    this.armor = f();
    this.spikes = f();
    this.visionRange = f();
    this.visionAcuity = f();
    this.smellRange = f();
    this.maxEnergy = f();
    this.lifespan = f();
    this.maturationAge = f();
    this.reproThreshold = f();
    this.offspringEnergy = f();
    this.fecundity = new Uint8Array(capacity);
    this.plantEfficiency = f();
    this.meatEfficiency = f();
    this.tempPreference = f();
    this.tempTolerance = f();
    this.waterAffinity = f();
    this.camouflage = f();
    this.signalGain = f();
    this.signalSensitivity = f();
    this.hiddenSize = new Uint8Array(capacity);
    this.contextSize = new Uint8Array(capacity);
    this.plasticity = f();
    this.mutationRate = f();
    this.upkeep = f();
    this.hue = f();
    this.pattern = f();
    this.memorySlots = new Uint8Array(capacity);
    this.memoryDecay = f();
    this.hearingRange = f();
    this.socialLearningRate = f();
    this.vocalLow = f();
    this.vocalHigh = f();
    this.vocalPower = f();
    this.vocalSlew = f();
    this.vocalAgility = f();
    this.timbreCenter = f();
    this.timbreSpan = f();
    this.noiseCenter = f();
    this.noiseSpan = f();
    this.auditoryLow = f();
    this.auditoryHigh = f();
    this.auditoryResolution = f();
    this.echoicDepth = new Uint8Array(capacity);
    this.soundPrototypes = new Uint8Array(capacity);

    this.freeList = new Int32Array(capacity);
  }

  /** Returns a slot index, or -1 when the world is full. */
  allocate(): number {
    if (this.freeCount > 0) {
      const slot = this.freeList[--this.freeCount];
      this.alive[slot] = 1;
      this.livingCount++;
      return slot;
    }
    if (this.count < this.capacity) {
      const slot = this.count++;
      this.alive[slot] = 1;
      this.livingCount++;
      return slot;
    }
    return -1;
  }

  /**
   * The free list is part of the simulation state, not an implementation
   * detail: slot reuse order determines iteration order, which determines the
   * order the RNG is consumed in. A fork that rebuilt this list by scanning for
   * dead slots would diverge from its parent within a few ticks, which would
   * make control-vs-experiment comparisons meaningless.
   */
  exportFreeList(): Int32Array {
    return this.freeList.slice(0, this.freeCount);
  }

  importFreeList(list: ArrayLike<number>): void {
    this.freeCount = Math.min(list.length, this.capacity);
    for (let i = 0; i < this.freeCount; i++) this.freeList[i] = list[i];
  }

  free(slot: number): void {
    if (!this.alive[slot]) return;
    this.alive[slot] = 0;
    this.livingCount--;
    if (this.freeCount < this.capacity) this.freeList[this.freeCount++] = slot;
  }

  /** Zero everything a recycled slot could leak from its previous occupant. */
  resetSlot(slot: number): void {
    this.vx[slot] = 0;
    this.vy[slot] = 0;
    this.pain[slot] = 0;
    this.reward[slot] = 0;
    this.attackCooldown[slot] = 0;
    this.reproCooldown[slot] = 0;
    const vo = slot * VOICE_DIM;
    this.voice.fill(0, vo, vo + VOICE_DIM);
    this.voiceNext.fill(0, vo, vo + VOICE_DIM);
    this.callSum.fill(0, vo, vo + VOICE_DIM);
    this.attendSum.fill(0, vo, vo + VOICE_DIM);
    this.callTicks[slot] = 0;
    this.callStartPitch[slot] = 0;
    this.callStartTick[slot] = 0;
    this.lastCallTick[slot] = 0;
    this.callContext.fill(0, slot * CALL_CONTEXT_DIM, (slot + 1) * CALL_CONTEXT_DIM);
    this.attendSource[slot] = 0;
    this.attendTicks[slot] = 0;
    this.attendStartPitch[slot] = 0;
    this.attendSrcX[slot] = 0;
    this.attendSrcY[slot] = 0;
    this.lastHeardTick[slot] = 0;
    this.heardValence[slot] = 0;
    this.heardFamiliarity[slot] = 0;
    // Echoic and associative memory are soma. A newborn starts out knowing
    // nothing about what any sound has ever preceded, and has to find out.
    this.echoic.fill(0, slot * ECHOIC_STRIDE, (slot + 1) * ECHOIC_STRIDE);
    this.echoHead[slot] = 0;
    this.soundProto.fill(0, slot * PROTO_STRIDE, (slot + 1) * PROTO_STRIDE);
    const so = slot * MAX_PROTOTYPES;
    this.soundValence.fill(0, so, so + MAX_PROTOTYPES);
    this.soundStrength.fill(0, so, so + MAX_PROTOTYPES);
    this.soundTrace.fill(0, so, so + MAX_PROTOTYPES);
    this.heardCluster[slot] = -1;
    this.heardClusterTicks[slot] = 0;
    this.heardDistance[slot] = 0;
    this.heardSrcX[slot] = 0;
    this.heardSrcY[slot] = 0;
    this.heardExternal[slot] = 0;
    this.lastEmittedCluster[slot] = -1;
    const mo = slot * MAX_MEMORY;
    this.memStrength.fill(0, mo, mo + MAX_MEMORY);
    this.imitations[slot] = 0;
    this.mutations[slot] = 0;
    this.energyGiven[slot] = 0;
    this.energyReceived[slot] = 0;
    this.children[slot] = 0;
    this.kills[slot] = 0;
    this.plantEaten[slot] = 0;
    this.meatEaten[slot] = 0;
    this.preyEaten[slot] = 0;
    this.socialContacts[slot] = 0;
    this.distanceTravelled[slot] = 0;
    this.age[slot] = 0;
    const co = slot * MAX_CONTEXT;
    for (let i = 0; i < MAX_CONTEXT; i++) this.context[co + i] = 0;
    const po = slot * PLASTIC_STRIDE;
    this.plastic.fill(0, po, po + PLASTIC_STRIDE);
  }

  /** Copy an expressed phenotype into the cached SoA columns. */
  applyPhenotype(slot: number, p: Phenotype): void {
    this.radius[slot] = p.radius;
    this.mass[slot] = p.mass;
    this.maxSpeed[slot] = p.maxSpeed;
    this.turnRate[slot] = p.turnRate;
    this.attackDamage[slot] = p.attackDamage;
    this.armor[slot] = p.armor;
    this.spikes[slot] = p.spikes;
    this.visionRange[slot] = p.visionRange;
    this.visionAcuity[slot] = p.visionAcuity;
    this.smellRange[slot] = p.smellRange;
    this.maxEnergy[slot] = p.maxEnergy;
    this.lifespan[slot] = p.lifespan;
    this.maturationAge[slot] = p.maturationAge;
    this.reproThreshold[slot] = p.reproThreshold;
    this.offspringEnergy[slot] = p.offspringEnergy;
    this.fecundity[slot] = p.fecundity;
    this.plantEfficiency[slot] = p.plantEfficiency;
    this.meatEfficiency[slot] = p.meatEfficiency;
    this.tempPreference[slot] = p.tempPreference;
    this.tempTolerance[slot] = p.tempTolerance;
    this.waterAffinity[slot] = p.waterAffinity;
    this.camouflage[slot] = p.camouflage;
    this.signalGain[slot] = p.signalGain;
    this.signalSensitivity[slot] = p.signalSensitivity;
    this.hiddenSize[slot] = p.hiddenSize;
    this.contextSize[slot] = p.contextSize;
    this.plasticity[slot] = p.plasticity;
    this.mutationRate[slot] = p.mutationRate;
    this.upkeep[slot] = p.upkeep;
    this.hue[slot] = p.hue;
    this.pattern[slot] = p.pattern;
    this.memorySlots[slot] = p.memorySlots;
    this.memoryDecay[slot] = p.memoryDecay;
    this.hearingRange[slot] = p.hearingRange;
    this.socialLearningRate[slot] = p.socialLearningRate;
    this.vocalLow[slot] = p.vocalLow;
    this.vocalHigh[slot] = p.vocalHigh;
    this.vocalPower[slot] = p.vocalPower;
    this.vocalSlew[slot] = p.vocalSlew;
    this.vocalAgility[slot] = p.vocalAgility;
    this.timbreCenter[slot] = p.timbreCenter;
    this.timbreSpan[slot] = p.timbreSpan;
    this.noiseCenter[slot] = p.noiseCenter;
    this.noiseSpan[slot] = p.noiseSpan;
    this.auditoryLow[slot] = p.auditoryLow;
    this.auditoryHigh[slot] = p.auditoryHigh;
    this.auditoryResolution[slot] = p.auditoryResolution;
    this.echoicDepth[slot] = p.echoicDepth;
    this.soundPrototypes[slot] = p.soundPrototypes;
  }

  memoryOffset(slot: number): number {
    return slot * MAX_MEMORY;
  }
  voiceOffset(slot: number): number {
    return slot * VOICE_DIM;
  }
  echoicOffset(slot: number): number {
    return slot * ECHOIC_STRIDE;
  }
  protoOffset(slot: number): number {
    return slot * PROTO_STRIDE;
  }
  soundSlotOffset(slot: number): number {
    return slot * MAX_PROTOTYPES;
  }
  callContextOffset(slot: number): number {
    return slot * CALL_CONTEXT_DIM;
  }
  kinTagOffset(slot: number): number {
    return slot * KIN_TAG_LENGTH;
  }

  /**
   * Fraction of kin markers shared with another organism. 1 means every marker
   * matches; unrelated organisms sit near the population's background rate.
   */
  relatedness(a: number, b: number): number {
    const ao = a * KIN_TAG_LENGTH;
    const bo = b * KIN_TAG_LENGTH;
    let same = 0;
    for (let i = 0; i < KIN_TAG_LENGTH; i++) {
      if (Math.abs(this.kinTag[ao + i] - this.kinTag[bo + i]) < 1e-4) same++;
    }
    return same / KIN_TAG_LENGTH;
  }

  genomeOffset(slot: number): number {
    return slot * GENOME_LENGTH;
  }
  brainOffset(slot: number): number {
    return slot * BRAIN_STRIDE;
  }
  plasticOffset(slot: number): number {
    return slot * PLASTIC_STRIDE;
  }
  contextOffset(slot: number): number {
    return slot * MAX_CONTEXT;
  }
}
