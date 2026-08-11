/**
 * The simulation core. Owns the world, the population and the RNG stream, and
 * advances everything by exactly one tick at a time.
 *
 * Determinism contract: the only source of randomness is `this.rng`, and it is
 * consumed in a fixed order (ascending slot index, then a fixed sub-order
 * within each organism). Given the same seed + config + initial population, two
 * runs produce byte-identical state. Nothing here may read wall-clock time,
 * iterate a Map/Set whose insertion order depends on timing, or use
 * Math.random().
 *
 * Structure of a tick:
 *   1. environment    (vegetation growth, decay, diffusion, day/night, seasons)
 *   2. spatial index  (counting-sort rebuild)
 *   3. per-organism   (sense -> think -> act -> learn -> metabolise), one pass
 *   4. deaths         (carrion deposition, slot recycling)
 *   5. bookkeeping    (species, niches, culture, chronicle, stats)
 *
 * Everything an organism can do is an output of its own network acting on its
 * own senses. There is no rule anywhere in this file of the form "if X then
 * behave like Y" — the closest thing is a threshold on an output the network
 * chose to produce.
 */
import { type SimConfig, DEFAULT_CONFIG } from './core/config';
import { Rng } from './core/rng';
import { SpatialHash } from './core/spatialHash';
import { World } from './world/world';
import { KIN_TAG_LENGTH, Population } from './organisms/population';
import {
  GENOME_LENGTH,
  Locus,
  geneticDistance,
  makeMutationTally,
  type MutationTally,
} from './genome/loci';
import {
  expressInto,
  makePhenotype,
  MAX_CONTEXT,
  MAX_HIDDEN,
  MAX_MEMORY,
  type Phenotype,
} from './genome/phenotype';
import {
  BRAIN_STRIDE,
  INPUT_COUNT,
  Input,
  OUTPUT_COUNT,
  Output,
  PLASTIC_STRIDE,
  ECHO_INPUTS,
  W1_OFFSET,
  W2_OFFSET,
  W1_SIZE,
  W2_SIZE,
  forward,
  hebbianUpdate,
  imitate,
  randomizeBrain,
} from './brain/brain';
import {
  copyBrain,
  copyGenome,
  crossoverBrain,
  crossoverGenome,
  inheritKinTags,
  mutateBrain,
  mutateGenome,
  randomGenome,
  randomKinTags,
} from './evolution/reproduction';
import { SpeciesRegistry } from './species/speciation';
import { EventKind, EventLog } from './events/eventLog';
import { WorldEventSystem, type WorldEventSpec } from './events/worldEvents';
import { History, type SeriesKey } from '../analytics/history';
import { encodeMemory, makeRecall, recallInto, type Recall } from './memory/memory';
import {
  accumulate as accumulateNiche,
  describe as describeNiche,
  makeNicheAccumulator,
  type NicheAccumulator,
  type NicheProfile,
} from './analysis/niches';
import { AcousticAnalyzer } from './analysis/acoustics';
import {
  CALL_DIM,
  Call,
  MAX_ECHOIC,
  MAX_PROTOTYPES,
  MIN_CALL_TICKS,
  VOICE_DIM,
  Voice,
  attenuation,
  bandResponse,
  callDistance,
  durationToNorm,
} from './acoustics/sound';
import {
  DETECTION_FLOOR,
  ECHOIC_STRIDE,
  ECHO_GAP,
  echoOffset,
  gapToNorm,
  makePercept,
  pushEcho,
  resetPercept,
  type Percept,
} from './acoustics/ear';
import { PROTO_STRIDE, creditTrace, recognise } from './acoustics/association';
import { CALL_CONTEXT_DIM, RESPONSE_DIM, Response } from './acoustics/context';
import { CultureAnalyzer, type CultureReport } from './analysis/culture';
import { Chronicle } from './analysis/chronicle';
import {
  SNAPSHOT_STRIDE,
  SnapshotFlag,
  type OrganismInspection,
  type SpeciesSummary,
  type Stats,
} from './core/types';

const SPATIAL_CELL = 48;
const STATS_INTERVAL = 20;
const HISTORY_INTERVAL = 60;
/**
 * Attention limit: the most neighbours one organism will consider in a tick.
 * In a dense herd the true count runs into the hundreds, and scanning all of
 * them is what dominates the tick cost. Capping it is also the more defensible
 * model — no animal tracks 500 others simultaneously. The spatial query returns
 * candidates nearest-first, so the ones dropped are the distant ones.
 */
const MAX_NEIGHBOR_CANDIDATES = 128;
const TWO_PI = Math.PI * 2;
/**
 * Only every Nth organism contributes a "was anything audible just now"
 * sample, rotating each tick. This is the denominator the turn-taking measure
 * is compared against, and it does not need to be exhaustive to be unbiased.
 */
const HEARING_SAMPLE_STRIDE = 17;
/**
 * How recently an organism must have heard something for its own call to be
 * counted, by the observer, as possibly a reply. Nothing enforces this window
 * on the organism — it is a measurement choice, stated so it can be argued with.
 */
const REPLY_WINDOW_TICKS = 40;
/** Brain output above which the vocal apparatus is producing sound. */
const VOICE_GATE = 0.15;
/**
 * Attention is stored as an unsigned key so it fits the population's typed
 * arrays: 0 is silence, an organism is its slot plus one, and a sound from
 * outside the ecosystem is its id offset past every possible slot.
 */
const EXTERNAL_KEY_BASE = 1 << 24;

/** A sound in the world that no organism made. */
export interface ExternalSound {
  id: number;
  x: number;
  y: number;
  /** VOICE_DIM acoustic frame — the same physics as any other sound. */
  frame: Float32Array;
  ticksLeft: number;
}
/** Soma drift beyond this counts as the organism having invented something. */
const INNOVATION_THRESHOLD = 12;
/**
 * Save format. Version 3 added the vocal and auditory apparatus, which changed
 * both the genome length and the brain layout — a version 2 world cannot be
 * resumed into this build, and `restore` refuses rather than corrupting one.
 */
export const SAVE_VERSION = 3;

export class Simulation {
  cfg: SimConfig;
  rng: Rng;
  world: World;
  pop: Population;
  spatial: SpatialHash;
  species: SpeciesRegistry;
  events: EventLog;
  worldEvents: WorldEventSystem;
  history: History;
  acoustics = new AcousticAnalyzer();
  culture = new CultureAnalyzer();
  chronicle = new Chronicle();
  mutationTally: MutationTally = makeMutationTally();

  tick = 0;

  // Per-tick counters, reset every tick.
  private birthsThisTick = 0;
  private deathsThisTick = 0;
  private killsThisTick = 0;
  private sharesThisTick = 0;
  private callsThisTick = 0;
  // Rolling accumulators over the stats window.
  private birthsWindow = 0;
  private deathsWindow = 0;
  private killsWindow = 0;
  private sharesWindow = 0;
  private windowTicks = 0;
  totalBirths = 0;
  totalDeaths = 0;
  totalImitations = 0;
  totalCalls = 0;
  private callsWindow = 0;

  /**
   * First-contact bookkeeping. Two running means of how hard listeners closed
   * on a sound source: one for sounds a human made, one for sounds an organism
   * made. Comparing them is the only claim this makes — it is a difference in
   * observed behaviour, not evidence that anything was understood.
   */
  private humanApproach = 0;
  private humanApproachN = 0;
  private nativeApproach = 0;
  private nativeApproachN = 0;
  private humanSoundCount = 0;

  // Scratch — allocated once, reused forever.
  private inputs = new Float32Array(INPUT_COUNT);
  private hidden = new Float32Array(MAX_HIDDEN);
  private outputs = new Float32Array(OUTPUT_COUNT);
  private percept: Percept = makePercept();
  private loudFrame = new Float32Array(VOICE_DIM);
  private callDesc = new Float32Array(CALL_DIM);
  private heardDesc = new Float32Array(CALL_DIM);
  private responseFeatures = new Float32Array(RESPONSE_DIM);
  /** Sounds injected from outside the ecosystem, e.g. by a human microphone. */
  externalSounds: ExternalSound[] = [];
  private nextExternalId = 1;
  private recall: Recall = makeRecall();
  private candidates = new Int32Array(MAX_NEIGHBOR_CANDIDATES);
  private liveIndex: Int32Array;
  private liveCount = 0;
  private pendingDeaths: Int32Array;
  private pendingDeathCount = 0;
  private mateUsed: Uint8Array;
  /** Heading unit vectors, recomputed once per tick. */
  private cosH: Float32Array;
  private sinH: Float32Array;
  /** Per-organism observations kept for the stats/niche pass. */
  private obsNeighbours: Float32Array;
  private obsMovement: Float32Array;
  private obsSignal: Float32Array;
  private somaDrift: Float32Array;
  private pheno: Phenotype = makePhenotype();
  private childPheno: Phenotype = makePhenotype();
  private grad = { x: 0, y: 0 };
  private speciesPop = new Map<number, number>();
  private niches = new Map<number, NicheAccumulator>();

  // Snapshot buffer handed to the renderer (ping-ponged with the main thread).
  private snapshot: Float32Array;

  // Inspection capture for the currently selected organism.
  selectedId = 0;
  private selectedSlot = -1;
  private capturedInputs = new Float32Array(INPUT_COUNT);
  private capturedHidden = new Float32Array(MAX_HIDDEN);
  private capturedOutputs = new Float32Array(OUTPUT_COUNT);

  private stats: Stats = emptyStats();
  private lastSpeciesCount = 0;

  constructor(cfg: Partial<SimConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };
    this.rng = new Rng(this.cfg.seed);
    this.world = new World(this.cfg, this.rng);
    this.pop = new Population(this.cfg.maxPopulation);
    this.spatial = new SpatialHash(this.cfg.worldSize, SPATIAL_CELL, this.cfg.maxPopulation);
    this.species = new SpeciesRegistry();
    this.events = new EventLog();
    this.worldEvents = new WorldEventSystem();
    this.history = new History(1024);
    this.pendingDeaths = new Int32Array(this.cfg.maxPopulation);
    this.mateUsed = new Uint8Array(this.cfg.maxPopulation);
    this.cosH = new Float32Array(this.cfg.maxPopulation);
    this.sinH = new Float32Array(this.cfg.maxPopulation);
    this.obsNeighbours = new Float32Array(this.cfg.maxPopulation);
    this.obsMovement = new Float32Array(this.cfg.maxPopulation);
    this.obsSignal = new Float32Array(this.cfg.maxPopulation);
    this.somaDrift = new Float32Array(this.cfg.maxPopulation);
    this.liveIndex = new Int32Array(this.cfg.maxPopulation);
    this.snapshot = new Float32Array(this.cfg.maxPopulation * SNAPSHOT_STRIDE);
    this.seedPopulation();
  }

  // ---------------------------------------------------------------- seeding

  /**
   * Founders get random genomes and random brains. No pre-trained behaviour,
   * no starter strategy — generation 0 mostly wanders and starves, and the few
   * that happen to move toward food are the ones that leave descendants.
   */
  private seedPopulation(): void {
    const founder = this.species.create(
      new Float32Array(GENOME_LENGTH).fill(0.5),
      0,
      0,
      0,
      0,
      this.rng.next(),
    );

    // Founders are seeded as colonies rather than scattered uniformly. Spread
    // evenly across a 4096-unit world, the nearest neighbour would be hundreds
    // of units away and sexual reproduction would be geometrically impossible —
    // the population would go extinct before selection had anything to act on.
    const colonyCount = Math.max(1, Math.round(this.cfg.initialPopulation / 60));
    const colonies: { x: number; y: number }[] = [];
    for (let c = 0; c < colonyCount; c++) colonies.push(this.findLandSpawn());
    const colonyRadius = this.world.size * 0.035;

    for (let i = 0; i < this.cfg.initialPopulation; i++) {
      const slot = this.pop.allocate();
      if (slot < 0) break;
      const go = this.pop.genomeOffset(slot);
      randomGenome(this.pop.genome, go, this.rng);
      randomizeBrain(this.pop.brain, this.pop.brainOffset(slot), () => this.rng.next());
      randomKinTags(this.pop.kinTag, this.pop.kinTagOffset(slot), this.rng);
      this.pop.resetSlot(slot);

      const home = colonies[i % colonyCount];
      const a = this.rng.next() * TWO_PI;
      const r = Math.sqrt(this.rng.next()) * colonyRadius;
      const x = Math.min(this.world.size - 1, Math.max(1, home.x + Math.cos(a) * r));
      const y = Math.min(this.world.size - 1, Math.max(1, home.y + Math.sin(a) * r));
      this.pop.x[slot] = x;
      this.pop.y[slot] = y;
      this.pop.heading[slot] = this.rng.next() * TWO_PI;
      this.pop.id[slot] = this.pop.nextId++;
      this.pop.speciesId[slot] = founder.id;
      this.pop.generation[slot] = 0;
      this.pop.parentA[slot] = 0;
      this.pop.parentB[slot] = 0;
      this.pop.birthTick[slot] = 0;
      this.pop.matriline[slot] = this.pop.id[slot];
      this.pop.memeTag[slot] = this.pop.id[slot];
      this.culture.noteMemeBirth(this.pop.id[slot], 0, this.pop.id[slot]);

      expressInto(this.pheno, this.pop.genome, go);
      this.pop.applyPhenotype(slot, this.pheno);
      this.pop.energy[slot] = this.pheno.maxEnergy * 0.95;
      this.pop.health[slot] = 1;

      founder.population++;
      founder.totalBorn++;
    }
    founder.peakPopulation = founder.population;
    this.speciesPop.set(founder.id, founder.population);
    this.events.push({
      tick: 0,
      kind: EventKind.Milestone,
      text: `World seeded with ${this.pop.livingCount} founders (seed ${this.cfg.seed})`,
    });
  }

  /**
   * Rejection-sample a productive land cell. The fertility bar is deliberately
   * high: a colony seeded on marginal ground starves before any of its random
   * brains has a chance to be selected, which is noise rather than selection.
   * The bar relaxes if the world has little good land, so an ocean world still
   * places its founders somewhere.
   */
  private findLandSpawn(): { x: number; y: number } {
    let best = { x: this.world.size * 0.5, y: this.world.size * 0.5 };
    let bestFertility = -1;
    for (let attempt = 0; attempt < 96; attempt++) {
      const x = this.rng.range(0, this.world.size);
      const y = this.rng.range(0, this.world.size);
      const i = this.world.index(x, y);
      if (this.world.elevation[i] <= this.cfg.waterLevel + 0.02) continue;
      const f = this.world.fertility[i];
      if (f > 0.35) return { x, y };
      if (f > bestFertility) {
        bestFertility = f;
        best = { x, y };
      }
    }
    return best;
  }

  // ------------------------------------------------------------------- tick

  step(): void {
    const cfg = this.cfg;
    this.birthsThisTick = 0;
    this.deathsThisTick = 0;
    this.killsThisTick = 0;
    this.sharesThisTick = 0;
    this.callsThisTick = 0;
    this.pendingDeathCount = 0;

    this.worldEvents.update(cfg);
    this.world.step(cfg, this.tick);

    const pop = this.pop;
    const n = pop.count;
    this.spatial.build(pop.alive, pop.x, pop.y, n);
    this.mateUsed.fill(0, 0, n);

    // Heading unit vectors for the whole population, once. Neighbour alignment
    // sensing needs cos/sin of every nearby organism's heading; computing them
    // inside the neighbour loop meant millions of trig calls per tick. Doing it
    // here also means every organism senses the *same* pre-action headings,
    // which makes the tick a proper simultaneous update rather than one where
    // later slots see earlier slots' new state.
    for (let i = 0; i < n; i++) {
      if (!pop.alive[i]) continue;
      this.cosH[i] = Math.cos(pop.heading[i]);
      this.sinH[i] = Math.sin(pop.heading[i]);
    }

    const waterLevel = cfg.waterLevel + this.worldEvents.floodOffset;

    for (let i = 0; i < n; i++) {
      if (!pop.alive[i]) continue;
      // Skip organisms born during this very tick — they act from the next one.
      if (pop.birthTick[i] === this.tick && this.tick > 0) continue;
      this.stepOrganism(i, waterLevel);
    }

    // Sound produced this tick becomes audible to everyone on the next one, so
    // the whole population hears the same world rather than a half-updated one.
    pop.voice.set(pop.voiceNext);

    for (let e = this.externalSounds.length - 1; e >= 0; e--) {
      if (--this.externalSounds[e].ticksLeft <= 0) this.externalSounds.splice(e, 1);
    }

    this.processDeaths();

    this.tick++;
    this.callsWindow += this.callsThisTick;
    this.birthsWindow += this.birthsThisTick;
    this.deathsWindow += this.deathsThisTick;
    this.killsWindow += this.killsThisTick;
    this.sharesWindow += this.sharesThisTick;
    this.windowTicks++;

    if (this.tick % STATS_INTERVAL === 0) this.computeStats();
    if (this.tick % HISTORY_INTERVAL === 0) this.recordHistory();
  }

  // --------------------------------------------------- one organism, one tick

  private stepOrganism(i: number, waterLevel: number): void {
    const pop = this.pop;
    const cfg = this.cfg;
    const world = this.world;
    const dt = cfg.dt;

    const px = pop.x[i];
    const py = pop.y[i];
    const ci = world.index(px, py);
    const heading = pop.heading[i];
    const cosH = this.cosH[i];
    const sinH = this.sinH[i];

    const inputs = this.inputs;
    inputs.fill(0);
    inputs[Input.Bias] = 1;

    const maxE = pop.maxEnergy[i];
    const energyFrac = maxE > 0 ? pop.energy[i] / maxE : 0;
    inputs[Input.Energy] = energyFrac * 2 - 1;
    inputs[Input.Hunger] = 1 - energyFrac * 2;
    inputs[Input.Health] = pop.health[i] * 2 - 1;
    const ageFrac = pop.age[i] / pop.lifespan[i];
    inputs[Input.AgeFraction] = ageFrac * 2 - 1;

    const speed = Math.hypot(pop.vx[i], pop.vy[i]);
    inputs[Input.Speed] = Math.min(1, speed / (pop.maxSpeed[i] + 1e-3));

    // ---- environment ----
    const temp = world.temperatureAt(ci, cfg);
    const tempStress = (temp - pop.tempPreference[i]) / (pop.tempTolerance[i] + 1e-3);
    inputs[Input.TempStress] = clamp(tempStress, -3, 3) / 3;

    const elev = world.elevation[ci];
    const depth = Math.max(0, waterLevel - elev);
    const inWater = depth > 0;
    inputs[Input.WaterDepth] = Math.min(1, depth * 6);

    world.gradient(world.elevation, px, py, this.grad);
    inputs[Input.SlopeX] = clamp((this.grad.x * cosH + this.grad.y * sinH) * 40, -1, 1);
    inputs[Input.SlopeY] = clamp((-this.grad.x * sinH + this.grad.y * cosH) * 40, -1, 1);
    inputs[Input.Light] = world.light * 2 - 1;

    const veg = world.vegetation[ci];
    inputs[Input.Vegetation] = Math.min(1, veg * 2.5);
    world.gradient(world.vegetation, px, py, this.grad);
    const gvx = this.grad.x * 30;
    const gvy = this.grad.y * 30;
    inputs[Input.VegGradX] = clamp(gvx * cosH + gvy * sinH, -1, 1);
    inputs[Input.VegGradY] = clamp(-gvx * sinH + gvy * cosH, -1, 1);
    inputs[Input.Carrion] = Math.min(1, world.carrion[ci] * 0.05);

    const sens = pop.signalSensitivity[i];
    const s0 = world.sample(world.signal0, px, py);
    const s1 = world.sample(world.signal1, px, py);
    inputs[Input.PheromoneA] = Math.min(1, s0 * sens);
    inputs[Input.PheromoneB] = Math.min(1, s1 * sens);
    world.gradient(world.signal0, px, py, this.grad);
    const gsx = this.grad.x * 60 * sens;
    const gsy = this.grad.y * 60 * sens;
    inputs[Input.PheromoneAGradX] = clamp(gsx * cosH + gsy * sinH, -1, 1);
    inputs[Input.PheromoneAGradY] = clamp(-gsx * sinH + gsy * cosH, -1, 1);

    // ---- episodic memory ----
    const memSlots = pop.memorySlots[i];
    recallInto(
      pop.memX,
      pop.memY,
      pop.memValence,
      pop.memStrength,
      pop.memoryOffset(i),
      memSlots,
      px,
      py,
      pop.memoryDecay[i],
      this.recall,
    );
    inputs[Input.MemoryValueHere] = clamp(this.recall.valueHere, -1, 1);
    inputs[Input.MemoryBestDX] = this.recall.bestDX * cosH + this.recall.bestDY * sinH;
    inputs[Input.MemoryBestDY] = -this.recall.bestDX * sinH + this.recall.bestDY * cosH;
    inputs[Input.MemoryWorstDX] = this.recall.worstDX * cosH + this.recall.worstDY * sinH;
    inputs[Input.MemoryWorstDY] = -this.recall.worstDX * sinH + this.recall.worstDY * cosH;
    inputs[Input.MemoryLoad] = Math.min(1, this.recall.load);

    // ---- neighbours ----
    const vision = pop.visionRange[i];
    const hearing = pop.hearingRange[i];
    const scanRadius = Math.max(
      vision,
      hearing,
      cfg.matingRange,
      cfg.attackRange + pop.radius[i],
    );
    const cnt = this.spatial.queryInto(px, py, scanRadius, this.candidates);

    // ---- what the ear is set up to receive ----
    // Terrain absorbs sound: undergrowth and water both eat the high end
    // faster than the low, which is the same reason a forest sounds muffled.
    const audLow = pop.auditoryLow[i];
    const audHigh = pop.auditoryHigh[i];
    const refDist = cfg.soundReferenceDistance;
    const absorb = cfg.soundAbsorption * (1 + veg * 1.6 + depth * 1.2);
    const absorbPitch = cfg.soundAbsorptionPitch * (1 + veg * 1.6);
    const vo = pop.voiceOffset(i);
    let heardTotal = 0;
    let heardPitchSum = 0;
    let heardPitchSqSum = 0;
    let loudest = 0;
    let loudestSlot = -1;
    let loudestExternal = -1;
    let loudestExternalId = 0;
    let loudestD = 0;
    let loudestDX = 0;
    let loudestDY = 0;
    let audibleSources = 0;

    let nearest = -1;
    let nearestScore = Infinity;
    let nearestD2 = 0;
    let second = -1;
    let secondScore = Infinity;
    let density = 0;
    let alignX = 0;
    let alignY = 0;
    let relatednessSum = 0;
    const acuity = pop.visionAcuity[i];
    const vision2 = vision * vision;
    const hearing2 = hearing * hearing;

    for (let k = 0; k < cnt; k++) {
      const j = this.candidates[k];
      if (j === i || !pop.alive[j]) continue;
      const dx = pop.x[j] - px;
      const dy = pop.y[j] - py;
      const d2 = dx * dx + dy * dy;

      // Hearing is a separate sense from sight with its own range, so a thing
      // can be heard without being seen — which is the whole reason a sound is
      // worth anything different from just looking.
      if (d2 <= hearing2) {
        const jvo = j * VOICE_DIM;
        const lj = pop.voice[jvo + Voice.Loudness];
        if (lj > 0.002) {
          const d = Math.sqrt(d2);
          const pj = pop.voice[jvo + Voice.Pitch];
          const amp =
            lj *
            attenuation(d, pj, refDist, absorb, absorbPitch) *
            bandResponse(pj, audLow, audHigh);
          if (amp > DETECTION_FLOOR) {
            heardTotal += amp;
            heardPitchSum += amp * pj;
            heardPitchSqSum += amp * pj * pj;
            audibleSources++;
            if (amp > loudest) {
              loudest = amp;
              loudestSlot = j;
              loudestExternal = -1;
              loudestD = d;
              loudestDX = dx;
              loudestDY = dy;
            }
          }
        }
      }

      if (d2 > vision2) continue;
      density++;
      alignX += this.cosH[j];
      alignY += this.sinH[j];
      relatednessSum += pop.relatedness(i, j);
      // Camouflage inflates the *apparent* distance, so a hiding organism is
      // less likely to become the focus of attention. Big things are easier to
      // spot. Low acuity blurs the ranking, making poor eyes genuinely worse.
      const apparent =
        d2 * (1 + pop.camouflage[j] * 1.8) * (1 / (0.4 + pop.radius[j] * 0.12)) *
        (1 + (1 - acuity) * 0.9);
      if (apparent < nearestScore) {
        second = nearest;
        secondScore = nearestScore;
        nearest = j;
        nearestScore = apparent;
        nearestD2 = d2;
      } else if (apparent < secondScore) {
        second = j;
        secondScore = apparent;
      }
    }

    // Sounds from outside the ecosystem obey exactly the same physics. There
    // is no separate path for them, and nothing marks them as special.
    for (let e = 0; e < this.externalSounds.length; e++) {
      const src = this.externalSounds[e];
      const lj = src.frame[Voice.Loudness];
      if (lj <= 0.002) continue;
      const dx = src.x - px;
      const dy = src.y - py;
      const d2e = dx * dx + dy * dy;
      if (d2e > hearing2) continue;
      const d = Math.sqrt(d2e);
      const pj = src.frame[Voice.Pitch];
      const amp =
        lj * attenuation(d, pj, refDist, absorb, absorbPitch) * bandResponse(pj, audLow, audHigh);
      if (amp <= DETECTION_FLOOR) continue;
      heardTotal += amp;
      heardPitchSum += amp * pj;
      heardPitchSqSum += amp * pj * pj;
      audibleSources++;
      if (amp > loudest) {
        loudest = amp;
        loudestSlot = -1;
        loudestExternal = e;
        // Attention is tracked by the source's stable id, not its position in
        // the array: the array shuffles as sources expire, and keying off the
        // index would make a single held sound look like a stream of new ones.
        loudestExternalId = src.id;
        loudestD = d;
        loudestDX = dx;
        loudestDY = dy;
      }
    }

    // ---- turn the acoustic mix into a percept ----
    const percept = this.percept;
    resetPercept(percept);
    const selfLoud = pop.voice[vo + Voice.Loudness];
    // An organism cannot hear well while it is shouting, and a rainy world is
    // a loud one. Both raise the level a signal has to beat to be made out.
    const noiseFloor =
      cfg.ambientNoiseFloor +
      this.worldEvents.acousticNoise +
      veg * 0.05 +
      depth * 0.08 +
      selfLoud * cfg.selfMaskingFactor;
    percept.noiseFloor = noiseFloor;
    percept.total = heardTotal;
    percept.sources = audibleSources;

    let attendKey = 0;
    if (loudest > DETECTION_FLOOR) {
      // Masking is frequency-selective, as it is in any real ear: a chorus
      // sitting well away in pitch from the sound being listened to interferes
      // far less than one sitting on top of it. This is the single piece of
      // physics that makes it worth calling in a register nobody else uses —
      // and it is offered as physics, not as an instruction to differentiate.
      const rest = heardTotal - loudest;
      let competing = noiseFloor;
      if (rest > 1e-6) {
        const attendedPitch = loudest > 0 ? (loudestExternal >= 0
          ? this.externalSounds[loudestExternal].frame[Voice.Pitch]
          : pop.voice[loudestSlot * VOICE_DIM + Voice.Pitch]) : 0;
        const restMeanPitch = (heardPitchSum - loudest * attendedPitch) / rest;
        const gap = (attendedPitch - restMeanPitch) / 0.22;
        const overlap = Math.exp(-gap * gap);
        competing += rest * (0.18 + 0.82 * overlap);
      }
      const snr = loudest / (competing + 1e-5);
      if (snr > 0.55) {
        const frame = this.loudFrame;
        if (loudestExternal >= 0) frame.set(this.externalSounds[loudestExternal].frame);
        else frame.set(pop.voice.subarray(loudestSlot * VOICE_DIM, loudestSlot * VOICE_DIM + VOICE_DIM));

        // Two identical sounds are not perceived identically. How badly they
        // blur depends on how far above the racket they are and on how good
        // this particular ear is, both of which are physical facts about the
        // situation rather than a fudge factor.
        const res = pop.auditoryResolution[i];
        const sigma = cfg.auditoryJitter / ((1 + snr) * (0.25 + res * 0.75));
        percept.pitch = clamp(frame[Voice.Pitch] + this.rng.normal(0, sigma), 0, 1);
        percept.noisiness = clamp(frame[Voice.Noisiness] + (this.rng.next() * 2 - 1) * sigma, 0, 1);
        percept.timbre = clamp(frame[Voice.Timbre] + (this.rng.next() * 2 - 1) * sigma, 0, 1);
        percept.slope = clamp(frame[Voice.Slope] + (this.rng.next() * 2 - 1) * sigma, -1, 1);
        percept.tremolo = clamp(frame[Voice.Tremolo] + (this.rng.next() * 2 - 1) * sigma, 0, 1);
        percept.loudest = loudest;
        percept.proximity = Math.min(1, loudest * 8);

        // Directional hearing degrades with the same blur.
        const bearing = Math.atan2(loudestDY, loudestDX) + (this.rng.next() * 2 - 1) * sigma * 2;
        const bx = Math.cos(bearing);
        const by = Math.sin(bearing);
        percept.dirX = bx * cosH + by * sinH;
        percept.dirY = -bx * sinH + by * cosH;
        percept.srcX = px + bx * loudestD;
        percept.srcY = py + by * loudestD;
        percept.slot = loudestSlot;
        attendKey =
          loudestExternal >= 0 ? EXTERNAL_KEY_BASE + loudestExternalId : loudestSlot + 1;
      }
    }
    if (heardTotal > 1e-6 && audibleSources > 1) {
      const mean = heardPitchSum / heardTotal;
      const variance = Math.max(0, heardPitchSqSum / heardTotal - mean * mean);
      percept.spread = Math.sqrt(variance);
    }

    // ---- attention, and the end of a heard sound ----
    // A sound ends, from the listener's point of view, when it stops being the
    // thing being listened to. That is when it becomes an object that can be
    // remembered, compared with earlier ones, and associated with what happens
    // next; while it is still going it is just a level on a meter.
    const prevAttend = pop.attendSource[i];
    let onset = 0;
    if (attendKey !== prevAttend) {
      if (prevAttend !== 0) this.finalizeHeard(i);
      pop.attendSource[i] = attendKey;
      if (attendKey !== 0) {
        onset = 1;
        pop.attendStartPitch[i] = percept.pitch;
        pop.attendTicks[i] = 0;
        pop.attendSum.fill(0, vo, vo + VOICE_DIM);
        pop.heardExternal[i] = attendKey >= EXTERNAL_KEY_BASE ? 1 : 0;
      }
    }
    if (attendKey !== 0) {
      pop.attendSum[vo + Voice.Pitch] += percept.pitch;
      pop.attendSum[vo + Voice.Loudness] += percept.loudest;
      pop.attendSum[vo + Voice.Noisiness] += percept.noisiness;
      pop.attendSum[vo + Voice.Timbre] += percept.timbre;
      pop.attendSum[vo + Voice.Slope] += percept.slope;
      pop.attendSum[vo + Voice.Tremolo] += percept.tremolo;
      pop.attendTicks[i]++;
      pop.attendSrcX[i] = percept.srcX;
      pop.attendSrcY[i] = percept.srcY;
    }

    // ---- auditory inputs ----
    inputs[Input.EarLoudness] = Math.min(1, heardTotal * 4);
    inputs[Input.EarPitch] = attendKey !== 0 ? percept.pitch * 2 - 1 : 0;
    inputs[Input.EarSpread] = Math.min(1, percept.spread * 4);
    inputs[Input.EarNoisiness] = attendKey !== 0 ? percept.noisiness : 0;
    inputs[Input.EarTimbre] = attendKey !== 0 ? percept.timbre : 0;
    inputs[Input.EarSweep] = percept.slope;
    inputs[Input.EarTremolo] = percept.tremolo;
    inputs[Input.EarDirX] = percept.dirX;
    inputs[Input.EarDirY] = percept.dirY;
    inputs[Input.EarProximity] = percept.proximity * 2 - 1;
    inputs[Input.EarSources] = Math.min(1, audibleSources / 6);
    inputs[Input.EarOnset] = onset;
    inputs[Input.EarDuration] = durationToNorm(pop.attendTicks[i]);
    inputs[Input.NoiseFloor] = Math.min(1, noiseFloor * 3);
    inputs[Input.SelfVoicing] = Math.min(1, selfLoud);
    inputs[Input.TimeSinceCall] = gapToNorm(this.tick - pop.lastCallTick[i]);
    inputs[Input.TimeSinceHeard] = gapToNorm(this.tick - pop.lastHeardTick[i]);
    inputs[Input.HeardValence] = pop.heardValence[i];
    inputs[Input.HeardFamiliarity] = pop.heardFamiliarity[i];

    // Echoic memory. An organism whose genome does not pay for depth simply
    // gets zeros here: the sounds still arrived, it just cannot hold them.
    const echoDepth = pop.echoicDepth[i];
    if (echoDepth > 0) {
      const eBase = pop.echoicOffset(i);
      const eHead = pop.echoHead[i];
      for (let e = 0; e < MAX_ECHOIC; e++) {
        const eo = echoOffset(eBase, eHead, e, echoDepth);
        if (eo < 0) break;
        const b = Input.Echo0 + e * ECHO_INPUTS;
        inputs[b] = pop.echoic[eo + Call.Pitch] * 2 - 1;
        inputs[b + 1] = pop.echoic[eo + Call.Loudness];
        inputs[b + 2] = pop.echoic[eo + ECHO_GAP];
      }
    }

    let nearestRelatedness = 0;
    if (nearest >= 0) {
      const dx = pop.x[nearest] - px;
      const dy = pop.y[nearest] - py;
      const d = Math.sqrt(nearestD2) + 1e-4;
      const ex = (dx * cosH + dy * sinH) / d;
      const ey = (-dx * sinH + dy * cosH) / d;
      const prox = Math.max(0, 1 - d / vision);
      inputs[Input.NeighborDX] = ex;
      inputs[Input.NeighborDY] = ey;
      inputs[Input.NeighborProximity] = prox * 2 - 1;
      inputs[Input.NeighborSizeRatio] = clamp(pop.radius[nearest] / pop.radius[i] - 1, -1, 1);
      const gd = geneticDistance(
        pop.genome,
        pop.genomeOffset(i),
        pop.genome,
        pop.genomeOffset(nearest),
      );
      inputs[Input.NeighborSimilarity] = 1 - Math.min(1, gd * 3);
      nearestRelatedness = pop.relatedness(i, nearest);
      inputs[Input.NeighborRelatedness] = nearestRelatedness * 2 - 1;
      inputs[Input.NeighborSpeed] = Math.min(
        1,
        Math.hypot(pop.vx[nearest], pop.vy[nearest]) / (pop.maxSpeed[i] + 1e-3),
      );
      pop.socialContacts[i]++;
    }
    if (second >= 0) {
      const dx = pop.x[second] - px;
      const dy = pop.y[second] - py;
      const d = Math.hypot(dx, dy) + 1e-4;
      inputs[Input.SecondDX] = (dx * cosH + dy * sinH) / d;
      inputs[Input.SecondDY] = (-dx * sinH + dy * cosH) / d;
    }

    inputs[Input.Density] = Math.min(1, density / 12) * 2 - 1;
    if (density > 0) {
      const inv = 1 / density;
      const ax = alignX * inv;
      const ay = alignY * inv;
      // Egocentric mean heading of the neighbourhood: the raw ingredient a
      // flocking rule would need, offered without any flocking rule attached.
      inputs[Input.AlignX] = ax * cosH + ay * sinH;
      inputs[Input.AlignY] = -ax * sinH + ay * cosH;
      inputs[Input.CrowdRelatedness] = (relatednessSum * inv) * 2 - 1;
    }

    inputs[Input.Pain] = Math.min(1, pop.pain[i]) * 2 - 1;
    inputs[Input.Reward] = clamp(pop.reward[i], -1, 1);

    // ---- think ----
    const hiddenSize = pop.hiddenSize[i];
    const contextSize = pop.contextSize[i];
    forward(
      pop.brain,
      pop.brainOffset(i),
      pop.plastic,
      pop.plasticOffset(i),
      inputs,
      pop.context,
      pop.contextOffset(i),
      this.hidden,
      this.outputs,
      hiddenSize,
      contextSize,
    );
    const out = this.outputs;

    if (pop.id[i] === this.selectedId) {
      this.selectedSlot = i;
      this.capturedInputs.set(inputs);
      this.capturedHidden.set(this.hidden);
      this.capturedOutputs.set(out);
    }

    // ---- act ----
    let flags = 0;
    let energyDelta = 0;
    let plantGain = 0;
    let carrionGain = 0;
    let preyGain = 0;
    let attacked = 0;

    const rest = Math.max(0, out[Output.Rest]);
    const effort = 1 - rest * 0.85;

    // Locomotion. Terrain modulates achievable speed: an organism with a high
    // water affinity swims well and walks badly, and vice versa.
    const terrainFactor = inWater
      ? 0.2 + pop.waterAffinity[i] * 0.95
      : 0.35 + (1 - pop.waterAffinity[i]) * 0.85;

    pop.heading[i] = heading + out[Output.Turn] * pop.turnRate[i] * dt * effort;
    if (pop.heading[i] > TWO_PI) pop.heading[i] -= TWO_PI;
    else if (pop.heading[i] < 0) pop.heading[i] += TWO_PI;

    const sprint = 1 + Math.max(0, out[Output.Sprint]) * 0.8;
    const desired = out[Output.Thrust] * pop.maxSpeed[i] * terrainFactor * effort * sprint;
    const nh = pop.heading[i];
    const tvx = Math.cos(nh) * desired;
    const tvy = Math.sin(nh) * desired;
    // First-order lag toward the desired velocity: gives inertia without a
    // full physics integrator, and keeps big organisms feeling heavy.
    const agility = 0.35 / (1 + pop.mass[i] * 0.02);
    pop.vx[i] += (tvx - pop.vx[i]) * agility;
    pop.vy[i] += (tvy - pop.vy[i]) * agility;

    let nx = px + pop.vx[i] * dt;
    let ny = py + pop.vy[i] * dt;
    const bound = this.world.size - 1;
    if (nx < 1) {
      nx = 1;
      pop.vx[i] *= -0.4;
    } else if (nx > bound) {
      nx = bound;
      pop.vx[i] *= -0.4;
    }
    if (ny < 1) {
      ny = 1;
      pop.vy[i] *= -0.4;
    } else if (ny > bound) {
      ny = bound;
      pop.vy[i] *= -0.4;
    }
    const moved = Math.hypot(nx - px, ny - py);
    pop.x[i] = nx;
    pop.y[i] = ny;
    pop.distanceTravelled[i] += moved;
    this.obsMovement[i] = moved;

    const actualSpeed = moved / dt;
    energyDelta -=
      cfg.movementCostCoefficient *
      Math.pow(pop.mass[i], 0.75) *
      Math.pow(actualSpeed, 1.5) *
      dt;

    // ---- feeding ----
    if (out[Output.Eat] > 0.05) {
      const bite = cfg.grazeRate * (pop.radius[i] / 4) * effort;
      const plantEff = pop.plantEfficiency[i];
      const meatEff = pop.meatEfficiency[i];
      if (world.vegetation[ci] > 0 && plantEff > 0.01) {
        const take = Math.min(bite, world.vegetation[ci]);
        world.vegetation[ci] -= take;
        plantGain = take * cfg.vegetationEnergyDensity * plantEff;
        energyDelta += plantGain;
        pop.plantEaten[i] += take;
        flags |= SnapshotFlag.Eating;
      }
      if (world.carrion[ci] > 0 && meatEff > 0.01) {
        // Carrion is stored in energy units, so carrionEnergyDensity is a
        // feeding *rate*: how much of a corpse one bite can process. Storing it
        // as biomass instead made the constant cancel out of the model
        // entirely — corpses were deposited divided by it and eaten multiplied
        // by it, so turning the dial changed nothing.
        const take = Math.min(bite * cfg.carrionEnergyDensity, world.carrion[ci]);
        world.carrion[ci] -= take;
        carrionGain = take * meatEff;
        energyDelta += carrionGain;
        pop.meatEaten[i] += take;
        flags |= SnapshotFlag.Eating;
      }
    }

    // ---- attacking ----
    if (pop.attackCooldown[i] > 0) pop.attackCooldown[i]--;
    if (out[Output.Attack] > 0.3 && pop.attackCooldown[i] <= 0 && nearest >= 0) {
      const reach = cfg.attackRange + pop.radius[i] + pop.radius[nearest];
      if (nearestD2 <= reach * reach) {
        energyDelta -= cfg.attackCost * pop.mass[i] * 0.05;
        pop.attackCooldown[i] = cfg.attackCooldownTicks;
        flags |= SnapshotFlag.Attacking;
        attacked = 1;
        const t = nearest;
        const raw = Math.max(0, pop.attackDamage[i] - pop.armor[t]);
        const dmg = raw / (8 + pop.mass[t] * 0.35);
        if (dmg > 0) {
          pop.health[t] -= dmg;
          pop.pain[t] = Math.min(2, pop.pain[t] + dmg * 2);
          // Flesh torn off in the strike. This is what makes predation pay —
          // and only for a gut that can process meat.
          const flesh = dmg * pop.maxEnergy[t] * 0.35;
          const stolen = Math.min(flesh, pop.energy[t]);
          pop.energy[t] -= stolen;
          preyGain = stolen * pop.meatEfficiency[i];
          energyDelta += preyGain;
          pop.preyEaten[i] += stolen;
        }
        // Retaliation: spikes hurt the attacker regardless of intent.
        if (pop.spikes[t] > 0) {
          const back = pop.spikes[t] / (8 + pop.mass[i] * 0.35);
          pop.health[i] -= back;
          pop.pain[i] = Math.min(2, pop.pain[i] + back * 2);
        }
        if (pop.health[t] <= 0) {
          pop.kills[i]++;
          this.killsThisTick++;
          this.markDead(t);
        }
      }
    }

    // ---- vocalising ----
    // Seven outputs drive an organ. Nothing about this block knows or cares
    // what comes out; it only enforces what the anatomy can physically do and
    // charges for the energy it takes.
    const sg = pop.signalGain[i];
    const vnext = pop.voiceNext;
    let voiceLoud = 0;
    if (out[Output.Voice] > VOICE_GATE) {
      const bandLow = pop.vocalLow[i];
      const bandHigh = pop.vocalHigh[i];
      const wanted = bandLow + (out[Output.VoicePitch] * 0.5 + 0.5) * (bandHigh - bandLow);
      // Pitch cannot jump: a tract has inertia, and how fast it can move is
      // what separates a lineage that can chirp from one that can only drone.
      const slew = pop.vocalSlew[i];
      const previous = pop.callTicks[i] > 0 ? pop.voice[vo + Voice.Pitch] : wanted;
      let pitch = wanted;
      if (wanted > previous + slew) pitch = previous + slew;
      else if (wanted < previous - slew) pitch = previous - slew;

      voiceLoud = pop.vocalPower[i] * (0.15 + 0.85 * Math.max(0, out[Output.VoiceLoudness]));
      const agility = pop.vocalAgility[i];
      const noisiness = clamp(
        pop.noiseCenter[i] + out[Output.VoiceNoise] * pop.noiseSpan[i],
        0,
        1,
      );
      const timbre = clamp(
        pop.timbreCenter[i] + out[Output.VoiceTimbre] * pop.timbreSpan[i],
        0,
        1,
      );
      const sweep = out[Output.VoiceSweep] * (0.08 + 0.92 * agility);
      const tremolo = Math.max(0, out[Output.VoiceTremolo]) * agility;

      vnext[vo + Voice.Pitch] = pitch;
      vnext[vo + Voice.Loudness] = voiceLoud;
      vnext[vo + Voice.Noisiness] = noisiness;
      vnext[vo + Voice.Timbre] = timbre;
      vnext[vo + Voice.Slope] = sweep;
      vnext[vo + Voice.Tremolo] = tremolo;

      if (pop.callTicks[i] === 0) {
        pop.callStartPitch[i] = pitch;
        pop.callStartTick[i] = this.tick;
      }
      pop.callSum[vo + Voice.Pitch] += pitch;
      pop.callSum[vo + Voice.Loudness] += voiceLoud;
      pop.callSum[vo + Voice.Noisiness] += noisiness;
      pop.callSum[vo + Voice.Timbre] += timbre;
      pop.callSum[vo + Voice.Slope] += sweep;
      pop.callSum[vo + Voice.Tremolo] += tremolo;
      pop.callTicks[i]++;

      // Loud is expensive and high is expensive, so the call that carries
      // furthest is also the one that costs most and gives away the most about
      // where its maker is. Every benefit has to be paid for out of this.
      energyDelta -= cfg.vocalCost * voiceLoud * voiceLoud * (0.55 + 0.9 * pitch);
      flags |= SnapshotFlag.Signalling;
    } else {
      vnext.fill(0, vo, vo + VOICE_DIM);
      if (pop.callTicks[i] > 0) this.finalizeCall(i);
    }
    this.obsSignal[i] = voiceLoud;

    // Persistent pheromone fields are a separate modality from broadcasting:
    // they stay behind after the organism leaves, which is what makes trails
    // and territory marks possible at all.
    const pa = Math.max(0, out[Output.PheromoneA]);
    const pb = Math.max(0, out[Output.PheromoneB]);
    if (pa > 0.05 || pb > 0.05) {
      const dep = cfg.signalDeposit * sg;
      world.signal0[ci] += pa * dep;
      world.signal1[ci] += pb * dep;
      energyDelta -= (pa + pb) * sg * cfg.signalCost;
    }

    // ---- energy sharing ----
    // A general transfer mechanism, not a "feed your young" rule. Whether it
    // ever gets used on kin, on mates, on strangers, or never, is decided by
    // selection acting on whatever the network does with the Share output.
    if (out[Output.Share] > 0.4 && nearest >= 0 && pop.energy[i] > 0) {
      const reach = cfg.matingRange + pop.radius[i];
      if (nearestD2 <= reach * reach) {
        const amount = Math.min(pop.energy[i] + energyDelta, maxE * cfg.shareRate);
        if (amount > 0) {
          energyDelta -= amount;
          const received = amount * cfg.shareEfficiency;
          const t = nearest;
          pop.energy[t] = Math.min(pop.maxEnergy[t], pop.energy[t] + received);
          pop.energyGiven[i] += amount;
          pop.energyReceived[t] += received;
          this.sharesThisTick++;
        }
      }
    }

    // ---- social learning ----
    const socialRate = pop.socialLearningRate[i];
    if (out[Output.Imitate] > 0.35 && socialRate > 0.01 && nearest >= 0) {
      const reach = cfg.imitationRange + pop.radius[i];
      if (nearestD2 <= reach * reach) {
        const rate = socialRate * Math.min(1, out[Output.Imitate]);
        imitate(pop.plastic, pop.plasticOffset(i), pop.plasticOffset(nearest), rate);
        energyDelta -= cfg.imitationCost * rate;
        pop.imitations[i]++;
        this.totalImitations++;
        this.culture.noteImitation();
        // A strong enough copy means this organism is now running somebody
        // else's learned behaviour, so it carries that lineage's tag. This is
        // the only place a meme changes hands horizontally.
        if (rate > 0.12) pop.memeTag[i] = pop.memeTag[nearest];
      }
    }

    // ---- reproduction ----
    const mature = pop.age[i] >= pop.maturationAge[i];
    if (!mature) flags |= SnapshotFlag.Juvenile;
    if (pop.reproCooldown[i] > 0) pop.reproCooldown[i]--;
    let readyToMate = 0;
    if (
      out[Output.Mate] > 0.2 &&
      mature &&
      pop.reproCooldown[i] <= 0 &&
      energyFrac >= pop.reproThreshold[i] &&
      !this.mateUsed[i]
    ) {
      readyToMate = 1;
      // Everything spent so far this tick is already committed, so the budget
      // for reproduction is what would actually remain. Without this the parent
      // can overdraw, get clamped back to zero, and the deficit turns into free
      // energy inside its offspring.
      const budget = Math.max(0, pop.energy[i] + energyDelta);
      const partner = this.findMate(i, cnt);
      if (partner >= 0) {
        flags |= SnapshotFlag.Mating;
        energyDelta -= this.reproduce(i, partner, budget);
      } else {
        // No compatible partner nearby: self-replicate at a premium. Sexual
        // reproduction splits the cost between two parents and skips the
        // penalty, so it is ~2.7x cheaper per offspring — but only when
        // somebody compatible is actually within range. The two strategies
        // compete on energy, not on a designer's preference.
        flags |= SnapshotFlag.Mating;
        energyDelta -= this.reproduce(i, -1, budget);
      }
    }

    // ---- metabolism, environment stress, ageing ----
    let cost = pop.upkeep[i] * cfg.basalMetabolicCost * (1 - rest * 0.45);
    const stress = Math.abs(tempStress);
    if (stress > 1) cost += (stress - 1) * (stress - 1) * cfg.temperatureStressCost * pop.mass[i] * 0.02;
    energyDelta -= cost;

    if (inWater && pop.waterAffinity[i] < 0.5) {
      pop.health[i] -= cfg.drowningDamage * (0.5 - pop.waterAffinity[i]) * 2 * dt;
    }

    pop.energy[i] += energyDelta;
    if (pop.energy[i] > maxE) pop.energy[i] = maxE;
    if (pop.energy[i] <= 0) {
      pop.energy[i] = 0;
      pop.health[i] -= 0.02; // starvation is gradual, so recovery is possible
    } else if (pop.energy[i] > maxE * 0.5 && pop.health[i] < 1) {
      pop.health[i] = Math.min(1, pop.health[i] + 0.0025);
    }

    pop.age[i]++;
    // Senescence: the last fifth of the lifespan degrades health.
    if (pop.age[i] > pop.lifespan[i] * 0.8) {
      pop.health[i] -= 0.0012 * (pop.age[i] / pop.lifespan[i]);
    }

    // ---- learning ----
    const netGain = energyDelta / (maxE * 0.02 + 1);
    pop.reward[i] = pop.reward[i] * 0.9 + netGain * 0.1;
    pop.pain[i] *= 0.92;
    // Reward is the change in wellbeing, not a designer-supplied score: energy
    // gained minus pain felt. What it means to "do well" is left to the energy
    // economy, and it is the same signal for every kind of learning here.
    const learnSignal = clamp(pop.reward[i] * 3 - pop.pain[i], -1, 1);
    const plasticity = pop.plasticity[i];
    if (plasticity > 0) {
      const drift = hebbianUpdate(
        pop.plastic,
        pop.plasticOffset(i),
        this.hidden,
        out,
        hiddenSize,
        learnSignal,
        plasticity,
      );
      // An organism that has substantially reshaped its own behaviour through
      // experience is running something it worked out itself, so it becomes the
      // origin of a new meme rather than continuing to carry its parent's.
      this.somaDrift[i] += drift;
      if (this.somaDrift[i] > INNOVATION_THRESHOLD) {
        this.somaDrift[i] = 0;
        pop.memeTag[i] = pop.id[i];
        this.culture.noteMemeBirth(pop.id[i], this.tick, pop.id[i]);
      }
    }

    // Whatever this organism has been hearing gets credited with whatever has
    // just happened to it, in proportion to how recently it heard it. This is
    // the only place a sound acquires any value at all, and the value is
    // private to this one animal: two organisms that heard the same call after
    // different outcomes will disagree about it permanently.
    const protoSlots = pop.soundPrototypes[i];
    if (protoSlots > 0) {
      creditTrace(
        pop.soundValence,
        pop.soundTrace,
        pop.soundStrength,
        pop.soundSlotOffset(i),
        protoSlots,
        learnSignal,
        cfg.auditoryLearningRate,
        cfg.auditoryTraceDecay,
        cfg.auditoryForgetRate,
      );
    }

    // ---- memory encoding ----
    // A place is worth remembering when something notable happened there. The
    // valence is the organism's own reward signal, so what counts as notable is
    // set by the energy economy rather than by a list of interesting events.
    if (memSlots > 0) {
      const valence = clamp(netGain * 2 - pop.pain[i] * 1.5, -1.5, 1.5);
      encodeMemory(
        pop.memX,
        pop.memY,
        pop.memValence,
        pop.memStrength,
        pop.memoryOffset(i),
        memSlots,
        px,
        py,
        valence,
      );
    }

    this.obsNeighbours[i] = density;

    // ---- observation ----
    // Everything below this point is the field notebook. It records what was
    // going on and what organisms did; it never feeds anything back.

    // The circumstances of a call in progress, refreshed each tick so the
    // finished utterance carries the situation it was made in.
    if (pop.callTicks[i] > 0) {
      const c = pop.callContext;
      const co = pop.callContextOffset(i);
      c[co] = 1 - energyFrac;
      c[co + 1] = 1 - pop.health[i];
      c[co + 2] =
        nearest >= 0
          ? Math.max(0, pop.radius[nearest] / pop.radius[i] - 1) *
            pop.meatEfficiency[nearest] *
            Math.max(0, 1 - Math.sqrt(nearestD2) / (vision + 1e-3))
          : 0;
      c[co + 3] = Math.min(1, veg * 2.5 + world.carrion[ci] * 0.05);
      c[co + 4] = Math.min(1, density / 12);
      c[co + 5] = nearestRelatedness;
      c[co + 6] = readyToMate;
      c[co + 7] = attacked;
    }

    // What a listener did in the window after a sound finished. `approach` is
    // measured from where the organism actually went, not from any output —
    // there is no "approach the sound" action to read.
    if (pop.heardClusterTicks[i] > 0) {
      pop.heardClusterTicks[i]--;
      const hdx = pop.x[i] - pop.heardSrcX[i];
      const hdy = pop.y[i] - pop.heardSrcY[i];
      const hd = Math.sqrt(hdx * hdx + hdy * hdy);
      const closing = clamp(
        (pop.heardDistance[i] - hd) / (pop.maxSpeed[i] * dt + 1e-3),
        -1,
        1,
      );
      pop.heardDistance[i] = hd;

      const r = this.responseFeatures;
      r[Response.Approach] = closing;
      r[Response.Speed] = Math.min(1, actualSpeed / (pop.maxSpeed[i] + 1e-3));
      r[Response.Turn] = Math.abs(out[Output.Turn]);
      r[Response.Eat] = Math.max(0, out[Output.Eat]);
      r[Response.Attack] = attacked;
      r[Response.Mate] = readyToMate;
      r[Response.Answer] = voiceLoud > 0 ? 1 : 0;
      r[Response.FallSilent] = voiceLoud > 0 ? 0 : 1;
      this.acoustics.observeResponse(pop.heardCluster[i], r);

      if (pop.heardExternal[i]) {
        this.humanApproach += closing;
        this.humanApproachN++;
      } else {
        this.nativeApproach += closing;
        this.nativeApproachN++;
      }
    }

    // How often an organism has recently heard anything at all. This is the
    // denominator the turn-taking measure is compared against: without it,
    // "calls follow calls" would just be measuring how noisy the world is.
    if ((i + this.tick) % HEARING_SAMPLE_STRIDE === 0) {
      this.acoustics.observeHearingOpportunity(
        pop.lastHeardTick[i] > 0 && this.tick - pop.lastHeardTick[i] < REPLY_WINDOW_TICKS,
      );
    }

    // ---- death ----
    if (pop.health[i] <= 0 || pop.age[i] >= pop.lifespan[i]) {
      this.markDead(i);
      return;
    }

    this.writeSnapshotEntry(i, flags);
  }

  // ------------------------------------------------------- acoustic events

  /**
   * A vocalisation has ended. Summarise it and hand it to the observer.
   *
   * The descriptor built here is the *source* one — real loudness, real
   * duration — because that is what an observer with a microphone at the
   * animal's mouth would record. What listeners perceived is a separate and
   * usually different thing, which is the point.
   */
  private finalizeCall(i: number): void {
    const pop = this.pop;
    const ticks = pop.callTicks[i];
    const co = pop.voiceOffset(i);
    pop.callTicks[i] = 0;
    if (ticks < MIN_CALL_TICKS) {
      pop.callSum.fill(0, co, co + VOICE_DIM);
      return;
    }

    const inv = 1 / ticks;
    const desc = this.callDesc;
    const meanPitch = pop.callSum[co + Voice.Pitch] * inv;
    desc[Call.Pitch] = meanPitch;
    // For a roughly linear glide, mean = (start + end) / 2, so this recovers
    // the total excursion without keeping a second running value for it.
    desc[Call.Sweep] = clamp(2 * (meanPitch - pop.callStartPitch[i]), -1, 1);
    desc[Call.Loudness] = pop.callSum[co + Voice.Loudness] * inv;
    desc[Call.Noisiness] = pop.callSum[co + Voice.Noisiness] * inv;
    desc[Call.Timbre] = pop.callSum[co + Voice.Timbre] * inv;
    desc[Call.Tremolo] = pop.callSum[co + Voice.Tremolo] * inv;
    desc[Call.Duration] = durationToNorm(ticks);
    pop.callSum.fill(0, co, co + VOICE_DIM);
    pop.lastCallTick[i] = this.tick;
    this.callsThisTick++;
    this.totalCalls++;

    // Was this call made shortly after hearing one, and if so how much does it
    // resemble what it followed? Both are questions about timing and acoustics
    // that an outside observer can answer; neither implies a reply.
    const heardRecently =
      pop.lastHeardTick[i] > 0 && this.tick - pop.lastHeardTick[i] < REPLY_WINDOW_TICKS;
    let heardDist = -1;
    if (heardRecently) {
      const eo = echoOffset(pop.echoicOffset(i), pop.echoHead[i], 0, MAX_ECHOIC);
      if (eo >= 0) heardDist = callDistance(pop.echoic, eo, desc, 0);
    }

    pop.lastEmittedCluster[i] = this.acoustics.observeCall(
      desc,
      0,
      pop.callContext,
      pop.callContextOffset(i),
      this.tick,
      pop.generation[i],
      pop.speciesId[i],
      pop.x[i],
      pop.y[i],
      this.world.size,
      pop.lastEmittedCluster[i],
      heardRecently,
      heardDist,
    );
  }

  /**
   * The sound this organism was listening to has ended. Turn it into an object
   * it can hold: push it into the echoic buffer, look it up in whatever it has
   * learned about sounds, and start the window in which the observer will
   * attribute its behaviour to having heard it.
   */
  private finalizeHeard(i: number): void {
    const pop = this.pop;
    const cfg = this.cfg;
    const ticks = pop.attendTicks[i];
    const ao = pop.voiceOffset(i);
    pop.attendTicks[i] = 0;
    if (ticks < MIN_CALL_TICKS) {
      pop.attendSum.fill(0, ao, ao + VOICE_DIM);
      return;
    }

    const inv = 1 / ticks;
    const desc = this.heardDesc;
    const meanPitch = pop.attendSum[ao + Voice.Pitch] * inv;
    desc[Call.Pitch] = meanPitch;
    desc[Call.Sweep] = clamp(2 * (meanPitch - pop.attendStartPitch[i]), -1, 1);
    // Loudness here is loudness *at the ear*, which is mostly a fact about
    // distance rather than about the sound. It is kept because that is what the
    // animal experienced; the observer discounts it when matching shapes.
    desc[Call.Loudness] = Math.min(1, pop.attendSum[ao + Voice.Loudness] * inv * 5);
    desc[Call.Noisiness] = pop.attendSum[ao + Voice.Noisiness] * inv;
    desc[Call.Timbre] = pop.attendSum[ao + Voice.Timbre] * inv;
    desc[Call.Tremolo] = pop.attendSum[ao + Voice.Tremolo] * inv;
    desc[Call.Duration] = durationToNorm(ticks);
    pop.attendSum.fill(0, ao, ao + VOICE_DIM);

    const gap = pop.lastHeardTick[i] > 0 ? this.tick - pop.lastHeardTick[i] : 999;
    pop.echoHead[i] = pushEcho(pop.echoic, pop.echoicOffset(i), pop.echoHead[i], desc, 0, gap);
    pop.lastHeardTick[i] = this.tick;

    const match = recognise(
      pop.soundProto,
      pop.protoOffset(i),
      pop.soundValence,
      pop.soundStrength,
      pop.soundTrace,
      pop.soundSlotOffset(i),
      pop.soundPrototypes[i],
      desc,
      0,
      pop.auditoryResolution[i],
      cfg.auditoryLearningRate,
    );
    pop.heardValence[i] = match.valence;
    pop.heardFamiliarity[i] = match.familiarity;

    // --- observer bookkeeping from here down ---
    pop.heardCluster[i] = this.acoustics.classify(desc, 0);
    pop.heardClusterTicks[i] = Math.min(255, cfg.responseWindowTicks);
    pop.heardSrcX[i] = pop.attendSrcX[i];
    pop.heardSrcY[i] = pop.attendSrcY[i];
    const dx = pop.x[i] - pop.heardSrcX[i];
    const dy = pop.y[i] - pop.heardSrcY[i];
    pop.heardDistance[i] = Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Put a sound into the world that no organism made. It propagates and is
   * perceived by exactly the same code as any other sound, and carries no mark
   * of where it came from.
   */
  emitExternalSound(x: number, y: number, frame: ArrayLike<number>, ticks = 3): void {
    const f = new Float32Array(VOICE_DIM);
    for (let i = 0; i < VOICE_DIM && i < frame.length; i++) f[i] = frame[i];
    // A source already in flight at the same place is continued rather than
    // duplicated, so a held human note is one sound and not a stack of them.
    for (const src of this.externalSounds) {
      if (Math.abs(src.x - x) < 1 && Math.abs(src.y - y) < 1) {
        src.frame.set(f);
        src.ticksLeft = ticks;
        return;
      }
    }
    if (this.externalSounds.length >= 4) this.externalSounds.shift();
    this.externalSounds.push({ id: this.nextExternalId++, x, y, frame: f, ticksLeft: ticks });
    this.humanSoundCount++;
  }

  /**
   * How differently listeners have moved after a sound from outside the
   * ecosystem, compared with a sound from inside it. A difference here is a
   * difference in behaviour and nothing more: it does not show that anything
   * was understood, only that the two kinds of sound are being treated
   * differently.
   */
  firstContact(): {
    sounds: number;
    humanApproach: number;
    nativeApproach: number;
    difference: number;
    samples: number;
  } {
    const h = this.humanApproachN > 0 ? this.humanApproach / this.humanApproachN : 0;
    const n = this.nativeApproachN > 0 ? this.nativeApproach / this.nativeApproachN : 0;
    return {
      sounds: this.humanSoundCount,
      humanApproach: h,
      nativeApproach: n,
      difference: this.humanApproachN > 20 && this.nativeApproachN > 20 ? h - n : 0,
      samples: this.humanApproachN,
    };
  }

  /**
   * The loudest voices near a point, for the audio synthesiser and the
   * spectrogram. Only a handful are ever rendered: the simulation carries
   * thousands of sounds as feature vectors and turns almost none of them into
   * actual audio.
   */
  audibleVoices(
    x: number,
    y: number,
    radius: number,
    limit = 12,
  ): {
    id: number;
    speciesId: number;
    hue: number;
    x: number;
    y: number;
    distance: number;
    pitch: number;
    loudness: number;
    noisiness: number;
    timbre: number;
    slope: number;
    tremolo: number;
    external: boolean;
  }[] {
    const pop = this.pop;
    const out: ReturnType<Simulation['audibleVoices']> = [];
    const r2 = radius * radius;
    for (let i = 0; i < pop.count; i++) {
      if (!pop.alive[i]) continue;
      const vo = i * VOICE_DIM;
      const loud = pop.voice[vo + Voice.Loudness];
      if (loud <= 0.01) continue;
      const dx = pop.x[i] - x;
      const dy = pop.y[i] - y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      out.push({
        id: pop.id[i],
        speciesId: pop.speciesId[i],
        hue: pop.hue[i],
        x: pop.x[i],
        y: pop.y[i],
        distance: Math.sqrt(d2),
        pitch: pop.voice[vo + Voice.Pitch],
        loudness: loud,
        noisiness: pop.voice[vo + Voice.Noisiness],
        timbre: pop.voice[vo + Voice.Timbre],
        slope: pop.voice[vo + Voice.Slope],
        tremolo: pop.voice[vo + Voice.Tremolo],
        external: false,
      });
    }
    for (const src of this.externalSounds) {
      const dx = src.x - x;
      const dy = src.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2 || src.frame[Voice.Loudness] <= 0.01) continue;
      out.push({
        id: -src.id,
        speciesId: 0,
        hue: 0,
        x: src.x,
        y: src.y,
        distance: Math.sqrt(d2),
        pitch: src.frame[Voice.Pitch],
        loudness: src.frame[Voice.Loudness],
        noisiness: src.frame[Voice.Noisiness],
        timbre: src.frame[Voice.Timbre],
        slope: src.frame[Voice.Slope],
        tremolo: src.frame[Voice.Tremolo],
        external: true,
      });
    }
    out.sort((a, b) => b.loudness / (1 + b.distance) - a.loudness / (1 + a.distance));
    return out.slice(0, limit);
  }

  // ---------------------------------------------------------- reproduction

  private findMate(i: number, candidateCount: number): number {
    const pop = this.pop;
    const cfg = this.cfg;
    const px = pop.x[i];
    const py = pop.y[i];
    const r = cfg.matingRange + pop.radius[i];
    const r2 = r * r;
    const gi = pop.genomeOffset(i);

    for (let k = 0; k < candidateCount; k++) {
      const j = this.candidates[k];
      if (j === i || !pop.alive[j] || this.mateUsed[j]) continue;
      if (pop.age[j] < pop.maturationAge[j] || pop.reproCooldown[j] > 0) continue;
      const ej = pop.maxEnergy[j] > 0 ? pop.energy[j] / pop.maxEnergy[j] : 0;
      if (ej < pop.reproThreshold[j]) continue;
      const dx = pop.x[j] - px;
      const dy = pop.y[j] - py;
      if (dx * dx + dy * dy > r2) continue;
      // Reproductive isolation: too much genetic distance and the pairing simply
      // does not produce viable offspring. This is what lets a diverging
      // population actually *split* instead of blending back together.
      if (geneticDistance(pop.genome, gi, pop.genome, pop.genomeOffset(j)) > cfg.compatibilityThreshold)
        continue;
      return j;
    }
    return -1;
  }

  /**
   * Produce a clutch. Returns the energy cost paid by organism `i`, which is
   * never more than `budget`.
   *
   * Offspring are produced one at a time and each one is only born if both
   * parents can actually afford their share. Energy is strictly conserved
   * across the transfer: what the parents pay is what the children receive
   * (plus the asexual penalty, which is burned, not created).
   */
  private reproduce(i: number, partner: number, budget: number): number {
    const pop = this.pop;
    const cfg = this.cfg;
    const sexual = partner >= 0;
    const clutch = pop.fecundity[i];
    let totalCost = 0;
    let remaining = budget;
    let partnerRemaining = sexual ? Math.max(0, pop.energy[partner]) : 0;
    let born = 0;

    this.mateUsed[i] = 1;
    if (sexual) this.mateUsed[partner] = 1;

    for (let c = 0; c < clutch; c++) {
      const slot = pop.allocate();
      if (slot < 0) break;

      const go = pop.genomeOffset(slot);
      const bo = pop.brainOffset(slot);
      const ko = pop.kinTagOffset(slot);
      if (sexual) {
        crossoverGenome(pop.genome, go, pop.genome, pop.genomeOffset(i), pop.genome, pop.genomeOffset(partner), this.rng);
        crossoverBrain(pop.brain, bo, pop.brain, pop.brainOffset(i), pop.brain, pop.brainOffset(partner), this.rng);
        inheritKinTags(
          pop.kinTag,
          ko,
          pop.kinTag,
          pop.kinTagOffset(i),
          pop.kinTag,
          pop.kinTagOffset(partner),
          this.rng,
          cfg.kinTagMutationRate,
        );
      } else {
        copyGenome(pop.genome, go, pop.genome, pop.genomeOffset(i));
        copyBrain(pop.brain, bo, pop.brain, pop.brainOffset(i));
        inheritKinTags(
          pop.kinTag,
          ko,
          pop.kinTag,
          pop.kinTagOffset(i),
          pop.kinTag,
          pop.kinTagOffset(i),
          this.rng,
          cfg.kinTagMutationRate,
        );
      }

      const rate = pop.mutationRate[i];
      const genomeMutations = mutateGenome(pop.genome, go, cfg, this.rng, rate, this.mutationTally);
      const brainMutations = mutateBrain(pop.brain, bo, cfg, this.rng, rate, this.mutationTally);

      pop.resetSlot(slot);
      expressInto(this.childPheno, pop.genome, go);
      pop.applyPhenotype(slot, this.childPheno);
      pop.mutations[slot] = Math.min(65535, genomeMutations + brainMutations);
      this.somaDrift[slot] = 0;

      const invest = this.childPheno.maxEnergy * this.childPheno.offspringEnergy;
      const cost = invest * (sexual ? 1 : cfg.asexualEnergyPenalty);
      // Each parent pays half of a sexual clutch.
      const share = sexual ? cost * 0.5 : cost;
      if (share > remaining || (sexual && share > partnerRemaining)) {
        // Cannot afford this offspring. Hand the slot straight back — a clutch
        // is limited by what the parents can actually provision.
        pop.free(slot);
        break;
      }
      remaining -= share;
      if (sexual) {
        partnerRemaining -= share;
        pop.energy[partner] -= share;
      }
      totalCost += share;
      born++;

      pop.energy[slot] = invest;
      pop.health[slot] = 1;
      const angle = this.rng.next() * TWO_PI;
      const dist = pop.radius[i] + this.childPheno.radius + this.rng.next() * 6;
      pop.x[slot] = clamp(pop.x[i] + Math.cos(angle) * dist, 1, this.world.size - 1);
      pop.y[slot] = clamp(pop.y[i] + Math.sin(angle) * dist, 1, this.world.size - 1);
      pop.heading[slot] = this.rng.next() * TWO_PI;
      pop.id[slot] = pop.nextId++;
      pop.parentA[slot] = pop.id[i];
      pop.parentB[slot] = sexual ? pop.id[partner] : 0;
      pop.generation[slot] =
        (sexual ? Math.max(pop.generation[i], pop.generation[partner]) : pop.generation[i]) + 1;
      pop.birthTick[slot] = this.tick;
      pop.matriline[slot] = pop.matriline[i];
      // Culture passes down the generations as well as sideways: a newborn
      // starts out carrying whatever behaviour its parent was running.
      pop.memeTag[slot] = pop.memeTag[i];

      const parentSpecies = pop.speciesId[i];
      const sid = this.species.classify(
        parentSpecies,
        pop.genome,
        go,
        cfg.speciationThreshold,
        this.tick,
        pop.generation[slot],
        this.childPheno.hue,
      );
      pop.speciesId[slot] = sid;
      if (sid !== parentSpecies) {
        const rec = this.species.species.get(sid);
        this.events.push({
          tick: this.tick,
          kind: EventKind.Speciation,
          text: `${rec?.name ?? sid} diverged from ${this.speciesNameOf(parentSpecies)} at generation ${pop.generation[slot]}`,
          speciesId: sid,
          x: pop.x[slot],
          y: pop.y[slot],
        });
      }
      this.addToSpecies(sid);
      this.birthsThisTick++;
      this.totalBirths++;
      pop.children[i]++;
      if (sexual) pop.children[partner]++;
    }

    // A failed attempt still costs the cooldown, so an organism that keeps
    // trying to breed while too poor to provision anything pays for it.
    const cooldown = born > 0 ? cfg.gestationTicks : Math.round(cfg.gestationTicks * 0.5);
    pop.reproCooldown[i] = cooldown;
    if (sexual) pop.reproCooldown[partner] = cooldown;
    return totalCost;
  }

  private addToSpecies(sid: number): void {
    const rec = this.species.species.get(sid);
    if (!rec) return;
    rec.population++;
    rec.totalBorn++;
    if (rec.population > rec.peakPopulation) rec.peakPopulation = rec.population;
    this.speciesPop.set(sid, rec.population);
  }

  // ------------------------------------------------------------------ death

  private markDead(slot: number): void {
    if (!this.pop.alive[slot]) return;
    if (this.pop.health[slot] > 0) this.pop.health[slot] = 0;
    if (this.pendingDeathCount < this.pendingDeaths.length) {
      this.pendingDeaths[this.pendingDeathCount++] = slot;
    }
  }

  private processDeaths(): void {
    const pop = this.pop;
    const world = this.world;
    const cfg = this.cfg;
    for (let k = 0; k < this.pendingDeathCount; k++) {
      const slot = this.pendingDeaths[k];
      if (!pop.alive[slot]) continue;
      const ci = world.index(pop.x[slot], pop.y[slot]);
      // A corpse is not deleted matter — it returns to the world as carrion,
      // which is exactly the resource that makes scavenging a viable niche.
      // Most of the value is the energy the organism was carrying; the body
      // tissue term is the modest extra that makes a large carcass worth more
      // than a starved one.
      world.carrion[ci] +=
        (pop.energy[slot] * 0.7 + pop.mass[slot] * 1.4) * cfg.meatYield;

      this.culture.noteOrganismDeath(pop.id[slot], this.tick);

      const sid = pop.speciesId[slot];
      const rec = this.species.species.get(sid);
      if (rec) {
        rec.population--;
        rec.totalDied++;
        this.speciesPop.set(sid, rec.population);
        if (rec.population <= 0 && rec.extinctTick < 0) {
          this.species.markExtinct(sid, this.tick);
          this.niches.delete(sid);
          this.events.push({
            tick: this.tick,
            kind: EventKind.Extinction,
            text: `${rec.name} is extinct after ${this.tick - rec.originTick} ticks (peak ${rec.peakPopulation})`,
            speciesId: sid,
          });
        }
      }
      if (pop.id[slot] === this.selectedId) this.selectedSlot = -1;
      pop.free(slot);
      this.deathsThisTick++;
      this.totalDeaths++;
    }
    this.pendingDeathCount = 0;
  }

  private speciesNameOf(id: number): string {
    return this.species.species.get(id)?.name ?? `#${id}`;
  }

  // ------------------------------------------------------------- rendering

  private writeSnapshotEntry(i: number, flags: number): void {
    const s = this.snapshot;
    const o = i * SNAPSHOT_STRIDE;
    const pop = this.pop;
    s[o] = pop.x[i];
    s[o + 1] = pop.y[i];
    s[o + 2] = pop.heading[i];
    s[o + 3] = pop.radius[i];
    s[o + 4] = pop.hue[i];
    s[o + 5] = pop.maxEnergy[i] > 0 ? pop.energy[i] / pop.maxEnergy[i] : 0;
    s[o + 6] = pop.genome[pop.genomeOffset(i) + Locus.Muscle];
    s[o + 7] = pop.genome[pop.genomeOffset(i) + Locus.Digestion];
    s[o + 8] = Math.min(1, pop.armor[i] / 6.5);
    s[o + 9] = flags | (pop.id[i] === this.selectedId ? SnapshotFlag.Selected : 0);
  }

  /**
   * Compact the live organisms into the front of `target` and return the count.
   * The renderer only ever sees a dense array.
   */
  fillSnapshot(target: Float32Array): number {
    const pop = this.pop;
    const src = this.snapshot;
    let w = 0;
    for (let i = 0; i < pop.count; i++) {
      if (!pop.alive[i]) continue;
      const o = i * SNAPSHOT_STRIDE;
      // Organisms born this tick have no snapshot entry yet; synthesise one.
      if (src[o + 3] === 0 || pop.birthTick[i] === this.tick) this.writeSnapshotEntry(i, 0);
      for (let f = 0; f < SNAPSHOT_STRIDE; f++) target[w + f] = src[o + f];
      w += SNAPSHOT_STRIDE;
    }
    return w / SNAPSHOT_STRIDE;
  }

  // ------------------------------------------------------------- statistics

  private computeStats(): void {
    const pop = this.pop;
    const n = pop.count;
    let count = 0;
    let energy = 0;
    let age = 0;
    let lifespan = 0;
    let brain = 0;
    let size = 0;
    let speed = 0;
    let vision = 0;
    let generation = 0;
    let maxGen = 0;
    let plasticity = 0;
    let mutation = 0;
    let carn = 0;
    let carnCount = 0;
    let aquatic = 0;
    let memory = 0;
    let hearing = 0;
    let social = 0;
    let groupSize = 0;

    this.liveCount = 0;

    for (let i = 0; i < n; i++) {
      if (!pop.alive[i]) continue;
      this.liveIndex[this.liveCount++] = i;
      count++;
      energy += pop.maxEnergy[i] > 0 ? pop.energy[i] / pop.maxEnergy[i] : 0;
      age += pop.age[i];
      lifespan += pop.lifespan[i];
      brain += pop.hiddenSize[i] + pop.contextSize[i];
      size += pop.radius[i];
      speed += pop.maxSpeed[i];
      vision += pop.visionRange[i];
      generation += pop.generation[i];
      if (pop.generation[i] > maxGen) maxGen = pop.generation[i];
      plasticity += pop.plasticity[i];
      mutation += pop.mutationRate[i];
      memory += pop.memorySlots[i];
      hearing += pop.hearingRange[i];
      social += pop.socialLearningRate[i];
      groupSize += this.obsNeighbours[i];
      const d = pop.genome[pop.genomeOffset(i) + Locus.Digestion];
      carn += d;
      if (d > 0.5) carnCount++;
      if (pop.waterAffinity[i] > 0.5) aquatic++;

      this.updateNiche(i);
    }

    const inv = count > 0 ? 1 / count : 0;
    let vegTotal = 0;
    let carrionTotal = 0;
    let signalTotal = 0;
    const cells = this.world.grid * this.world.grid;
    for (let i = 0; i < cells; i++) {
      vegTotal += this.world.vegetation[i];
      carrionTotal += this.world.carrion[i];
      signalTotal += this.world.signal0[i] + this.world.signal1[i];
    }
    let broadcast = 0;
    for (let k = 0; k < this.liveCount; k++) broadcast += this.obsSignal[this.liveIndex[k]];
    broadcast *= inv;

    const wt = this.windowTicks > 0 ? this.windowTicks : 1;
    const cfg = this.cfg;
    const dayLen = cfg.ticksPerDay;

    this.culture.update(pop, this.spatial, this.rng, this.tick, wt, this.liveIndex, this.liveCount);
    const cultureReport = this.culture.current();
    const acoustic = this.acoustics.report();
    const bestMeaning = acoustic.strongestAssociation;

    const livingSpecies = this.countLivingSpecies();
    const lost = this.lastSpeciesCount > 0 ? Math.max(0, this.lastSpeciesCount - livingSpecies) / this.lastSpeciesCount : 0;
    this.lastSpeciesCount = livingSpecies;

    this.stats = {
      tick: this.tick,
      population: count,
      livingSpecies,
      totalSpeciesEverCreated: this.species.species.size,
      extinctSpecies: this.species.species.size - livingSpecies,
      births: this.totalBirths,
      deaths: this.totalDeaths,
      birthsPerTick: this.birthsWindow / wt,
      deathsPerTick: this.deathsWindow / wt,
      killsPerTick: this.killsWindow / wt,
      sharesPerTick: this.sharesWindow / wt,
      imitationsPerTick: cultureReport.imitationsPerTick,
      avgEnergy: energy * inv,
      avgAge: age * inv,
      avgLifespan: lifespan * inv,
      avgBrainSize: brain * inv,
      avgSize: size * inv,
      avgSpeed: speed * inv,
      avgVision: vision * inv,
      avgGeneration: generation * inv,
      maxGeneration: maxGen,
      avgPlasticity: plasticity * inv,
      avgMutationRate: mutation * inv,
      avgMemorySlots: memory * inv,
      avgHearingRange: hearing * inv,
      avgSocialLearning: social * inv,
      avgGroupSize: groupSize * inv,
      broadcastActivity: broadcast,
      callsPerTick: this.callsWindow / wt,
      vocalDiversity: acoustic.diversity,
      vocalPrecision: acoustic.precision,
      signalClusters: acoustic.clusters.length,
      sequenceStructure: acoustic.sequence.mutualInformation,
      turnTaking: acoustic.turnTaking.alternation,
      vocalConvergence: acoustic.turnTaking.convergence,
      dialectDivergence: acoustic.dialects.divergence,
      callGenerationSpan: acoustic.generationSpan,
      signalCoupling: acoustic.strongestCoupling,
      transmissionIndex: cultureReport.transmissionIndex,
      distinctMemes: cultureReport.distinctMemes,
      posthumousMemes: cultureReport.posthumousMemes,
      signalMeaningConfidence: bestMeaning,
      diversity: this.sampleDiversity(),
      carnivory: carn * inv,
      carnivoreFraction: count > 0 ? carnCount / count : 0,
      aquaticFraction: count > 0 ? aquatic / count : 0,
      totalVegetation: vegTotal,
      totalCarrion: carrionTotal,
      signalActivity: signalTotal,
      temperature: 0.5 + cfg.globalTemperatureOffset + this.world.seasonalTemperature,
      light: this.world.light,
      day: Math.floor(this.tick / dayLen),
      year: Math.floor(this.tick / (dayLen * cfg.daysPerYear)),
      ticksPerSecond: this.stats.ticksPerSecond,
      msPerTick: this.stats.msPerTick,
    };

    this.chronicle.update(this.tick, this.events, {
      population: count,
      species: livingSpecies,
      generation: Math.round(generation * inv),
      killsPerTick: this.stats.killsPerTick,
      carnivory: this.stats.carnivory,
      signalActivity: broadcast,
      signalMeaningConfidence: bestMeaning,
      callsPerTick: this.stats.callsPerTick,
      vocalDiversity: acoustic.diversity,
      sequenceStructure: acoustic.sequence.mutualInformation,
      turnTaking: acoustic.turnTaking.alternation,
      vocalConvergence: acoustic.turnTaking.convergence,
      dialectDivergence: acoustic.dialects.divergence,
      callGenerationSpan: acoustic.generationSpan,
      signalCoupling: acoustic.strongestCoupling,
      transmissionIndex: cultureReport.transmissionIndex,
      imitationsPerTick: cultureReport.imitationsPerTick,
      posthumousMemes: cultureReport.posthumousMemes,
      meanMemory: this.stats.avgMemorySlots,
      meanGroupSize: this.stats.avgGroupSize,
      sharingPerTick: this.stats.sharesPerTick,
      brainSize: this.stats.avgBrainSize,
      diversity: this.stats.diversity,
      extinctionsInWindow: 0,
      speciesLostFraction: lost,
    });

    this.birthsWindow = 0;
    this.deathsWindow = 0;
    this.killsWindow = 0;
    this.sharesWindow = 0;
    this.callsWindow = 0;
    this.windowTicks = 0;
  }

  /** Fold one organism's situation into its species' niche profile. */
  private updateNiche(i: number): void {
    const pop = this.pop;
    const sid = pop.speciesId[i];
    let acc = this.niches.get(sid);
    if (!acc) {
      acc = makeNicheAccumulator();
      this.niches.set(sid, acc);
    }
    const ci = this.world.index(pop.x[i], pop.y[i]);
    const waterLevel = this.cfg.waterLevel + this.worldEvents.floodOffset;
    accumulateNiche(
      acc,
      this.world.temperatureAt(ci, this.cfg),
      this.world.elevation[ci],
      this.world.moisture[ci],
      Math.max(0, waterLevel - this.world.elevation[ci]),
      this.world.light,
      this.obsMovement[i],
      this.world.biome[ci],
      pop.plantEaten[i],
      pop.meatEaten[i],
      pop.preyEaten[i],
      pop.radius[i],
      pop.maxSpeed[i],
      pop.visionRange[i],
      pop.memorySlots[i],
      this.obsSignal[i],
      this.obsNeighbours[i],
    );
  }

  private countLivingSpecies(): number {
    let c = 0;
    for (const s of this.species.species.values()) if (s.extinctTick < 0 && s.population > 0) c++;
    return c;
  }

  /**
   * Mean pairwise genetic distance over a random sample. Exact diversity is
   * O(N^2); 256 sampled pairs tracks the real value closely enough for a chart
   * and costs nothing. The sample is drawn from the deterministic stream, so it
   * stays reproducible.
   */
  private sampleDiversity(): number {
    const pop = this.pop;
    if (this.liveCount < 2) return 0;
    const samples = Math.min(256, this.liveCount * 2);
    let sum = 0;
    for (let s = 0; s < samples; s++) {
      const a = this.liveIndex[this.rng.int(this.liveCount)];
      const b = this.liveIndex[this.rng.int(this.liveCount)];
      if (a === b) continue;
      sum += geneticDistance(pop.genome, pop.genomeOffset(a), pop.genome, pop.genomeOffset(b));
    }
    return sum / samples;
  }

  private lastPopulationSample = 0;
  private recordHistory(): void {
    const s = this.stats;
    const values = {
      population: s.population,
      species: s.livingSpecies,
      births: s.birthsPerTick,
      deaths: s.deathsPerTick,
      avgEnergy: s.avgEnergy,
      avgAge: s.avgAge,
      avgLifespan: s.avgLifespan,
      avgBrainSize: s.avgBrainSize,
      avgSpeed: s.avgSpeed,
      avgSize: s.avgSize,
      avgVision: s.avgVision,
      diversity: s.diversity,
      carnivory: s.carnivory,
      vegetation: s.totalVegetation,
      carrion: s.totalCarrion,
      temperature: s.temperature,
      predationRate: s.killsPerTick,
      avgGeneration: s.avgGeneration,
      avgPlasticity: s.avgPlasticity,
      signalActivity: s.signalActivity,
      avgMemory: s.avgMemorySlots,
      groupSize: s.avgGroupSize,
      broadcast: s.broadcastActivity,
      calls: s.callsPerTick,
      vocalDiversity: s.vocalDiversity,
      dialects: s.dialectDivergence,
      imitation: s.imitationsPerTick,
      transmission: s.transmissionIndex,
      sharing: s.sharesPerTick,
    } as Record<SeriesKey, number>;
    this.history.push(this.tick, values);

    // Notice population shocks so the event log tells the story of the run.
    const prev = this.lastPopulationSample;
    if (prev > 60) {
      if (s.population < prev * 0.55) {
        this.events.push({
          tick: this.tick,
          kind: EventKind.PopulationCrash,
          text: `Population crash: ${prev} → ${s.population}`,
        });
      } else if (s.population > prev * 1.9) {
        this.events.push({
          tick: this.tick,
          kind: EventKind.PopulationBoom,
          text: `Population boom: ${prev} → ${s.population}`,
        });
      }
    }
    this.lastPopulationSample = s.population;
  }

  getStats(): Stats {
    return this.stats;
  }

  setPerformance(ticksPerSecond: number, msPerTick: number): void {
    this.stats.ticksPerSecond = ticksPerSecond;
    this.stats.msPerTick = msPerTick;
  }

  getCulture(): CultureReport {
    return this.culture.current();
  }

  nicheOf(speciesId: number): NicheProfile | null {
    const acc = this.niches.get(speciesId);
    return acc && acc.samples > 12 ? describeNiche(acc) : null;
  }

  // ------------------------------------------------------------- inspection

  speciesSummaries(limit = 40): SpeciesSummary[] {
    const pop = this.pop;
    const acc = new Map<
      number,
      { n: number; size: number; speed: number; brain: number; carn: number; memory: number; social: number; traits: Float32Array }
    >();
    for (let i = 0; i < pop.count; i++) {
      if (!pop.alive[i]) continue;
      const sid = pop.speciesId[i];
      let a = acc.get(sid);
      if (!a) {
        a = {
          n: 0,
          size: 0,
          speed: 0,
          brain: 0,
          carn: 0,
          memory: 0,
          social: 0,
          traits: new Float32Array(GENOME_LENGTH),
        };
        acc.set(sid, a);
      }
      a.n++;
      a.size += pop.radius[i];
      a.speed += pop.maxSpeed[i];
      a.brain += pop.hiddenSize[i] + pop.contextSize[i];
      a.memory += pop.memorySlots[i];
      a.social += pop.socialLearningRate[i];
      const go = pop.genomeOffset(i);
      a.carn += pop.genome[go + Locus.Digestion];
      for (let g = 0; g < GENOME_LENGTH; g++) a.traits[g] += pop.genome[go + g];
    }

    const out: SpeciesSummary[] = [];
    for (const [sid, a] of acc) {
      const rec = this.species.species.get(sid);
      if (!rec) continue;
      const inv = 1 / a.n;
      out.push({
        id: sid,
        name: rec.name,
        ancestorId: rec.ancestorId,
        population: a.n,
        peakPopulation: rec.peakPopulation,
        originTick: rec.originTick,
        extinctTick: rec.extinctTick,
        generationOrigin: rec.generationOrigin,
        totalBorn: rec.totalBorn,
        hue: rec.hue,
        traits: Array.from(a.traits, (v) => v * inv),
        avgSize: a.size * inv,
        avgSpeed: a.speed * inv,
        avgBrain: a.brain * inv,
        avgMemory: a.memory * inv,
        avgSocialLearning: a.social * inv,
        carnivory: a.carn * inv,
        niche: this.nicheOf(sid),
      });
    }
    out.sort((x, y) => y.population - x.population);
    return out.slice(0, limit);
  }

  extinctSummaries(limit = 200): SpeciesSummary[] {
    const out: SpeciesSummary[] = [];
    for (const rec of this.species.species.values()) {
      if (rec.extinctTick < 0) continue;
      out.push({
        id: rec.id,
        name: rec.name,
        ancestorId: rec.ancestorId,
        population: 0,
        peakPopulation: rec.peakPopulation,
        originTick: rec.originTick,
        extinctTick: rec.extinctTick,
        generationOrigin: rec.generationOrigin,
        totalBorn: rec.totalBorn,
        hue: rec.hue,
        traits: Array.from(
          this.species.representativeBuffer.subarray(
            this.species.representativeOffset(rec.id),
            this.species.representativeOffset(rec.id) + GENOME_LENGTH,
          ),
        ),
        avgSize: 0,
        avgSpeed: 0,
        avgBrain: 0,
        avgMemory: 0,
        avgSocialLearning: 0,
        carnivory: 0,
        niche: null,
      });
    }
    out.sort((a, b) => b.extinctTick - a.extinctTick);
    return out.slice(0, limit);
  }

  /** Find the organism nearest to a world point, within `radius`. */
  pick(x: number, y: number, radius: number): number {
    const pop = this.pop;
    let best = -1;
    let bestD2 = radius * radius;
    this.spatial.forEachInRadius(x, y, radius, (i) => {
      if (!pop.alive[i]) return;
      const dx = pop.x[i] - x;
      const dy = pop.y[i] - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    });
    return best >= 0 ? pop.id[best] : 0;
  }

  select(id: number): void {
    this.selectedId = id;
    this.selectedSlot = -1;
    if (id === 0) return;
    for (let i = 0; i < this.pop.count; i++) {
      if (this.pop.alive[i] && this.pop.id[i] === id) {
        this.selectedSlot = i;
        return;
      }
    }
  }

  inspect(): OrganismInspection | null {
    const slot = this.selectedSlot;
    const pop = this.pop;
    if (slot < 0 || !pop.alive[slot] || pop.id[slot] !== this.selectedId) return null;

    const go = pop.genomeOffset(slot);
    const bo = pop.brainOffset(slot);
    const po = pop.plasticOffset(slot);
    const mo = pop.memoryOffset(slot);

    // Effective output weights = inherited + learned, so the brain view shows
    // what the organism is actually computing right now.
    const w2 = new Array<number>(W2_SIZE);
    for (let i = 0; i < W2_SIZE; i++) w2[i] = pop.brain[bo + W2_OFFSET + i] + pop.plastic[po + i];

    const memories = [];
    for (let s = 0; s < pop.memorySlots[slot]; s++) {
      if (pop.memStrength[mo + s] <= 0.001) continue;
      memories.push({
        x: pop.memX[mo + s],
        y: pop.memY[mo + s],
        valence: pop.memValence[mo + s],
        strength: pop.memStrength[mo + s],
      });
    }

    return {
      slot,
      id: pop.id[slot],
      speciesId: pop.speciesId[slot],
      speciesName: this.speciesNameOf(pop.speciesId[slot]),
      generation: pop.generation[slot],
      parentA: pop.parentA[slot],
      parentB: pop.parentB[slot],
      matriline: pop.matriline[slot],
      memeTag: pop.memeTag[slot],
      age: pop.age[slot],
      lifespan: pop.lifespan[slot],
      maturationAge: pop.maturationAge[slot],
      energy: pop.energy[slot],
      maxEnergy: pop.maxEnergy[slot],
      health: pop.health[slot],
      x: pop.x[slot],
      y: pop.y[slot],
      heading: pop.heading[slot],
      speed: Math.hypot(pop.vx[slot], pop.vy[slot]),
      children: pop.children[slot],
      kills: pop.kills[slot],
      plantEaten: pop.plantEaten[slot],
      meatEaten: pop.meatEaten[slot],
      preyEaten: pop.preyEaten[slot],
      socialContacts: pop.socialContacts[slot],
      distanceTravelled: pop.distanceTravelled[slot],
      imitations: pop.imitations[slot],
      mutations: pop.mutations[slot],
      energyGiven: pop.energyGiven[slot],
      energyReceived: pop.energyReceived[slot],
      genome: Array.from(pop.genome.subarray(go, go + GENOME_LENGTH)),
      kinTag: Array.from(
        pop.kinTag.subarray(pop.kinTagOffset(slot), pop.kinTagOffset(slot) + KIN_TAG_LENGTH),
      ),
      memories,
      voice: Array.from(pop.voice.subarray(pop.voiceOffset(slot), pop.voiceOffset(slot) + VOICE_DIM)),
      calling: pop.callTicks[slot] > 0,
      callTicks: pop.callTicks[slot],
      ticksSinceCall: this.tick - pop.lastCallTick[slot],
      ticksSinceHeard: pop.lastHeardTick[slot] > 0 ? this.tick - pop.lastHeardTick[slot] : -1,
      heardValence: pop.heardValence[slot],
      heardFamiliarity: pop.heardFamiliarity[slot],
      echoic: echoicSnapshot(pop, slot),
      soundMemory: soundMemorySnapshot(pop, slot),
      phenotype: {
        radius: pop.radius[slot],
        mass: pop.mass[slot],
        maxSpeed: pop.maxSpeed[slot],
        turnRate: pop.turnRate[slot],
        attackDamage: pop.attackDamage[slot],
        armor: pop.armor[slot],
        spikes: pop.spikes[slot],
        visionRange: pop.visionRange[slot],
        visionAcuity: pop.visionAcuity[slot],
        smellRange: pop.smellRange[slot],
        hearingRange: pop.hearingRange[slot],
        vocalLow: pop.vocalLow[slot],
        vocalHigh: pop.vocalHigh[slot],
        vocalPower: pop.vocalPower[slot],
        vocalAgility: pop.vocalAgility[slot],
        vocalSlew: pop.vocalSlew[slot],
        auditoryLow: pop.auditoryLow[slot],
        auditoryHigh: pop.auditoryHigh[slot],
        auditoryResolution: pop.auditoryResolution[slot],
        echoicDepth: pop.echoicDepth[slot],
        soundPrototypes: pop.soundPrototypes[slot],
        memorySlots: pop.memorySlots[slot],
        memoryDecay: pop.memoryDecay[slot],
        socialLearningRate: pop.socialLearningRate[slot],
        plantEfficiency: pop.plantEfficiency[slot],
        meatEfficiency: pop.meatEfficiency[slot],
        tempPreference: pop.tempPreference[slot],
        tempTolerance: pop.tempTolerance[slot],
        waterAffinity: pop.waterAffinity[slot],
        camouflage: pop.camouflage[slot],
        fecundity: pop.fecundity[slot],
        upkeep: pop.upkeep[slot],
        plasticity: pop.plasticity[slot],
        mutationRate: pop.mutationRate[slot],
      },
      brainInputs: Array.from(this.capturedInputs),
      brainHidden: Array.from(this.capturedHidden),
      brainOutputs: Array.from(this.capturedOutputs),
      brainContext: Array.from(
        pop.context.subarray(pop.contextOffset(slot), pop.contextOffset(slot) + MAX_CONTEXT),
      ),
      hiddenSize: pop.hiddenSize[slot],
      contextSize: pop.contextSize[slot],
      w1: Array.from(pop.brain.subarray(bo + W1_OFFSET, bo + W1_OFFSET + W1_SIZE)),
      w2,
    };
  }

  // ------------------------------------------------------------ world events

  triggerWorldEvent(spec: WorldEventSpec): void {
    const text = this.worldEvents.trigger(spec, this.world, this.cfg, this.rng);
    this.events.push({ tick: this.tick, kind: EventKind.WorldEvent, text, x: spec.x, y: spec.y });
  }

  /** Drop `n` fresh random organisms into the world (a "reseed" tool). */
  inject(n: number): void {
    const founder = this.species.create(
      new Float32Array(GENOME_LENGTH).fill(0.5),
      0,
      0,
      this.tick,
      0,
      this.rng.next(),
    );
    for (let k = 0; k < n; k++) {
      const slot = this.pop.allocate();
      if (slot < 0) break;
      const go = this.pop.genomeOffset(slot);
      randomGenome(this.pop.genome, go, this.rng);
      randomizeBrain(this.pop.brain, this.pop.brainOffset(slot), () => this.rng.next());
      randomKinTags(this.pop.kinTag, this.pop.kinTagOffset(slot), this.rng);
      this.pop.resetSlot(slot);
      const { x, y } = this.findLandSpawn();
      this.pop.x[slot] = x;
      this.pop.y[slot] = y;
      this.pop.heading[slot] = this.rng.next() * TWO_PI;
      this.pop.id[slot] = this.pop.nextId++;
      this.pop.speciesId[slot] = founder.id;
      this.pop.generation[slot] = 0;
      this.pop.birthTick[slot] = this.tick;
      this.pop.matriline[slot] = this.pop.id[slot];
      this.pop.memeTag[slot] = this.pop.id[slot];
      expressInto(this.pheno, this.pop.genome, go);
      this.pop.applyPhenotype(slot, this.pheno);
      this.pop.energy[slot] = this.pheno.maxEnergy * 0.8;
      this.pop.health[slot] = 1;
      this.addToSpecies(founder.id);
    }
    this.events.push({
      tick: this.tick,
      kind: EventKind.Milestone,
      text: `${n} new founders injected into the world`,
    });
  }

  // ------------------------------------------------------------- persistence

  /** Everything needed to resume the run exactly where it left off. */
  serialize(): Record<string, unknown> {
    const pop = this.pop;
    const n = pop.count;
    return {
      version: SAVE_VERSION,
      tick: this.tick,
      cfg: this.cfg,
      rngState: this.rng.saveState(),
      totalBirths: this.totalBirths,
      totalDeaths: this.totalDeaths,
      totalImitations: this.totalImitations,
      totalCalls: this.totalCalls,
      nextId: pop.nextId,
      externalSounds: this.externalSounds.map((e) => ({
        id: e.id,
        x: e.x,
        y: e.y,
        frame: Array.from(e.frame),
        ticksLeft: e.ticksLeft,
      })),
      count: n,
      // The free list is state, not scratch: slot reuse order feeds back into
      // iteration order and therefore into the RNG stream. A fork that rebuilt
      // it heuristically would drift away from its parent immediately.
      freeList: pop.exportFreeList(),
      pop: {
        alive: pop.alive.slice(0, n),
        id: pop.id.slice(0, n),
        speciesId: pop.speciesId.slice(0, n),
        generation: pop.generation.slice(0, n),
        parentA: pop.parentA.slice(0, n),
        parentB: pop.parentB.slice(0, n),
        birthTick: pop.birthTick.slice(0, n),
        matriline: pop.matriline.slice(0, n),
        memeTag: pop.memeTag.slice(0, n),
        x: pop.x.slice(0, n),
        y: pop.y.slice(0, n),
        vx: pop.vx.slice(0, n),
        vy: pop.vy.slice(0, n),
        heading: pop.heading.slice(0, n),
        energy: pop.energy.slice(0, n),
        health: pop.health.slice(0, n),
        age: pop.age.slice(0, n),
        pain: pop.pain.slice(0, n),
        reward: pop.reward.slice(0, n),
        attackCooldown: pop.attackCooldown.slice(0, n),
        reproCooldown: pop.reproCooldown.slice(0, n),
        children: pop.children.slice(0, n),
        kills: pop.kills.slice(0, n),
        plantEaten: pop.plantEaten.slice(0, n),
        meatEaten: pop.meatEaten.slice(0, n),
        preyEaten: pop.preyEaten.slice(0, n),
        socialContacts: pop.socialContacts.slice(0, n),
        distanceTravelled: pop.distanceTravelled.slice(0, n),
        imitations: pop.imitations.slice(0, n),
        mutations: pop.mutations.slice(0, n),
        energyGiven: pop.energyGiven.slice(0, n),
        energyReceived: pop.energyReceived.slice(0, n),
        genome: pop.genome.slice(0, n * GENOME_LENGTH),
        brain: pop.brain.slice(0, n * BRAIN_STRIDE),
        plastic: pop.plastic.slice(0, n * PLASTIC_STRIDE),
        context: pop.context.slice(0, n * MAX_CONTEXT),
        voice: pop.voice.slice(0, n * VOICE_DIM),
        voiceNext: pop.voiceNext.slice(0, n * VOICE_DIM),
        callSum: pop.callSum.slice(0, n * VOICE_DIM),
        callTicks: pop.callTicks.slice(0, n),
        callStartPitch: pop.callStartPitch.slice(0, n),
        callStartTick: pop.callStartTick.slice(0, n),
        lastCallTick: pop.lastCallTick.slice(0, n),
        callContext: pop.callContext.slice(0, n * CALL_CONTEXT_DIM),
        attendSource: pop.attendSource.slice(0, n),
        attendSum: pop.attendSum.slice(0, n * VOICE_DIM),
        attendTicks: pop.attendTicks.slice(0, n),
        attendStartPitch: pop.attendStartPitch.slice(0, n),
        attendSrcX: pop.attendSrcX.slice(0, n),
        attendSrcY: pop.attendSrcY.slice(0, n),
        lastHeardTick: pop.lastHeardTick.slice(0, n),
        heardValence: pop.heardValence.slice(0, n),
        heardFamiliarity: pop.heardFamiliarity.slice(0, n),
        echoic: pop.echoic.slice(0, n * ECHOIC_STRIDE),
        echoHead: pop.echoHead.slice(0, n),
        soundProto: pop.soundProto.slice(0, n * PROTO_STRIDE),
        soundValence: pop.soundValence.slice(0, n * MAX_PROTOTYPES),
        soundStrength: pop.soundStrength.slice(0, n * MAX_PROTOTYPES),
        soundTrace: pop.soundTrace.slice(0, n * MAX_PROTOTYPES),
        heardCluster: pop.heardCluster.slice(0, n),
        heardClusterTicks: pop.heardClusterTicks.slice(0, n),
        heardDistance: pop.heardDistance.slice(0, n),
        heardSrcX: pop.heardSrcX.slice(0, n),
        heardSrcY: pop.heardSrcY.slice(0, n),
        heardExternal: pop.heardExternal.slice(0, n),
        lastEmittedCluster: pop.lastEmittedCluster.slice(0, n),
        kinTag: pop.kinTag.slice(0, n * KIN_TAG_LENGTH),
        memX: pop.memX.slice(0, n * MAX_MEMORY),
        memY: pop.memY.slice(0, n * MAX_MEMORY),
        memValence: pop.memValence.slice(0, n * MAX_MEMORY),
        memStrength: pop.memStrength.slice(0, n * MAX_MEMORY),
      },
      world: {
        vegetation: this.world.vegetation.slice(),
        carrion: this.world.carrion.slice(),
        signal0: this.world.signal0.slice(),
        signal1: this.world.signal1.slice(),
        scorch: this.world.scorch.slice(),
        fertility: this.world.fertility.slice(),
      },
      species: Array.from(this.species.species.values()).map((s) => ({
        ...s,
        traits: Array.from(s.traits),
      })),
      representatives: this.species.representativeBuffer.slice(),
      events: this.events.all(),
      milestones: this.chronicle.getMilestones(),
    };
  }

  /**
   * Rebuild from a saved payload. The instance must have been constructed with
   * the same config, so the *static* world layers (elevation, moisture,
   * temperature) regenerate identically from the seed and only the mutable
   * state has to be stored.
   */
  restore(data: Record<string, any>): void {
    // The acoustic upgrade changed the genome length and the brain layout, so
    // an older payload does not describe this world at all. Loading it anyway
    // would write a 32-locus genome into a 41-locus stride and silently
    // scramble every organism, which is far worse than refusing.
    const version = (data.version as number) ?? 1;
    if (version !== SAVE_VERSION) {
      throw new Error(
        `This world was saved by an incompatible version (save v${version}, this build reads v${SAVE_VERSION}). ` +
          'The genome and brain layouts changed when the vocal apparatus was added, so the save cannot be resumed.',
      );
    }

    const pop = this.pop;
    const n = data.count as number;

    this.tick = data.tick;
    this.rng.loadState(data.rngState as ArrayLike<number>);
    this.totalBirths = data.totalBirths ?? 0;
    this.totalDeaths = data.totalDeaths ?? 0;
    this.totalImitations = data.totalImitations ?? 0;
    this.totalCalls = data.totalCalls ?? 0;
    this.externalSounds = ((data.externalSounds as any[]) ?? []).map((e) => ({
      id: e.id,
      x: e.x,
      y: e.y,
      frame: Float32Array.from(e.frame),
      ticksLeft: e.ticksLeft,
    }));

    const p = data.pop;
    const copy = (dst: { set(a: ArrayLike<number>, o?: number): void }, src?: ArrayLike<number>) => {
      if (src) dst.set(src, 0);
    };
    pop.alive.fill(0);
    copy(pop.alive, p.alive);
    copy(pop.id, p.id);
    copy(pop.speciesId, p.speciesId);
    copy(pop.generation, p.generation);
    copy(pop.parentA, p.parentA);
    copy(pop.parentB, p.parentB);
    copy(pop.birthTick, p.birthTick);
    copy(pop.matriline, p.matriline);
    copy(pop.memeTag, p.memeTag);
    copy(pop.x, p.x);
    copy(pop.y, p.y);
    copy(pop.vx, p.vx);
    copy(pop.vy, p.vy);
    copy(pop.heading, p.heading);
    copy(pop.energy, p.energy);
    copy(pop.health, p.health);
    copy(pop.age, p.age);
    copy(pop.pain, p.pain);
    copy(pop.reward, p.reward);
    copy(pop.attackCooldown, p.attackCooldown);
    copy(pop.reproCooldown, p.reproCooldown);
    copy(pop.children, p.children);
    copy(pop.kills, p.kills);
    copy(pop.plantEaten, p.plantEaten);
    copy(pop.meatEaten, p.meatEaten);
    copy(pop.preyEaten, p.preyEaten);
    copy(pop.socialContacts, p.socialContacts);
    copy(pop.distanceTravelled, p.distanceTravelled);
    copy(pop.imitations, p.imitations);
    copy(pop.mutations, p.mutations);
    copy(pop.energyGiven, p.energyGiven);
    copy(pop.energyReceived, p.energyReceived);
    copy(pop.genome, p.genome);
    copy(pop.brain, p.brain);
    copy(pop.plastic, p.plastic);
    copy(pop.context, p.context);
    copy(pop.voice, p.voice);
    copy(pop.voiceNext, p.voiceNext);
    copy(pop.callSum, p.callSum);
    copy(pop.callTicks, p.callTicks);
    copy(pop.callStartPitch, p.callStartPitch);
    copy(pop.callStartTick, p.callStartTick);
    copy(pop.lastCallTick, p.lastCallTick);
    copy(pop.callContext, p.callContext);
    copy(pop.attendSource, p.attendSource);
    copy(pop.attendSum, p.attendSum);
    copy(pop.attendTicks, p.attendTicks);
    copy(pop.attendStartPitch, p.attendStartPitch);
    copy(pop.attendSrcX, p.attendSrcX);
    copy(pop.attendSrcY, p.attendSrcY);
    copy(pop.lastHeardTick, p.lastHeardTick);
    copy(pop.heardValence, p.heardValence);
    copy(pop.heardFamiliarity, p.heardFamiliarity);
    copy(pop.echoic, p.echoic);
    copy(pop.echoHead, p.echoHead);
    copy(pop.soundProto, p.soundProto);
    copy(pop.soundValence, p.soundValence);
    copy(pop.soundStrength, p.soundStrength);
    copy(pop.soundTrace, p.soundTrace);
    copy(pop.heardCluster, p.heardCluster);
    copy(pop.heardClusterTicks, p.heardClusterTicks);
    copy(pop.heardDistance, p.heardDistance);
    copy(pop.heardSrcX, p.heardSrcX);
    copy(pop.heardSrcY, p.heardSrcY);
    copy(pop.heardExternal, p.heardExternal);
    copy(pop.lastEmittedCluster, p.lastEmittedCluster);
    copy(pop.kinTag, p.kinTag);
    copy(pop.memX, p.memX);
    copy(pop.memY, p.memY);
    copy(pop.memValence, p.memValence);
    copy(pop.memStrength, p.memStrength);

    pop.count = n;
    pop.nextId = data.nextId;
    pop.livingCount = 0;
    for (let i = 0; i < n; i++) if (pop.alive[i]) pop.livingCount++;

    // Phenotypes are derived, not stored — re-express them.
    for (let i = 0; i < n; i++) {
      if (!pop.alive[i]) continue;
      expressInto(this.pheno, pop.genome, pop.genomeOffset(i));
      pop.applyPhenotype(i, this.pheno);
    }
    if (data.freeList) {
      pop.importFreeList(data.freeList as ArrayLike<number>);
    } else {
      // Older saves predate free-list persistence; rebuild it so they still
      // load, accepting that such a save cannot continue bit-identically.
      pop.importFreeList([]);
      for (let i = n - 1; i >= 0; i--) {
        if (!pop.alive[i]) {
          pop.alive[i] = 1;
          pop.livingCount++;
          pop.free(i);
        }
      }
    }

    const w = data.world;
    this.world.vegetation.set(w.vegetation);
    this.world.carrion.set(w.carrion);
    this.world.signal0.set(w.signal0);
    this.world.signal1.set(w.signal1);
    this.world.scorch.set(w.scorch);
    this.world.fertility.set(w.fertility);

    this.speciesPop.clear();
    this.niches.clear();
    const records = (data.species as any[]).map((s) => ({
      ...s,
      traits: Float32Array.from(s.traits),
    }));
    this.species.rehydrate(records, data.representatives as ArrayLike<number>);
    for (const s of records) this.speciesPop.set(s.id, s.population);

    this.events.clear();
    for (const e of data.events as any[]) this.events.push(e);
    this.acoustics.reset();
    this.culture.reset();
    this.chronicle.reset();

    // computeStats() draws from the RNG (diversity sampling, culture pair
    // sampling). Restoring must leave the stream exactly where the save left
    // it, or a fork silently diverges from its parent within a few ticks and
    // every controlled experiment built on forking becomes meaningless.
    const streamPosition = this.rng.saveState();
    this.computeStats();
    this.rng.loadState(streamPosition);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** The sounds an organism has most recently heard, newest first. */
function echoicSnapshot(
  pop: Population,
  slot: number,
): { pitch: number; loudness: number; noisiness: number; duration: number; gap: number }[] {
  const out: { pitch: number; loudness: number; noisiness: number; duration: number; gap: number }[] =
    [];
  const base = pop.echoicOffset(slot);
  const head = pop.echoHead[slot];
  for (let e = 0; e < MAX_ECHOIC; e++) {
    const o = echoOffset(base, head, e, MAX_ECHOIC);
    if (o < 0) break;
    if (pop.echoic[o + Call.Duration] <= 0 && pop.echoic[o + Call.Pitch] <= 0) continue;
    out.push({
      pitch: pop.echoic[o + Call.Pitch],
      loudness: pop.echoic[o + Call.Loudness],
      noisiness: pop.echoic[o + Call.Noisiness],
      duration: pop.echoic[o + Call.Duration],
      gap: pop.echoic[o + ECHO_GAP],
    });
  }
  return out;
}

/**
 * What this organism has personally worked out about sounds. Each entry is a
 * shape it keeps hearing plus what tended to happen next, learned from its own
 * reward stream and shared with nobody.
 */
function soundMemorySnapshot(
  pop: Population,
  slot: number,
): { pitch: number; duration: number; noisiness: number; valence: number; strength: number }[] {
  const out: {
    pitch: number;
    duration: number;
    noisiness: number;
    valence: number;
    strength: number;
  }[] = [];
  const po = pop.protoOffset(slot);
  const so = pop.soundSlotOffset(slot);
  for (let k = 0; k < pop.soundPrototypes[slot]; k++) {
    if (pop.soundStrength[so + k] <= 0.001) continue;
    const o = po + k * CALL_DIM;
    out.push({
      pitch: pop.soundProto[o + Call.Pitch],
      duration: pop.soundProto[o + Call.Duration],
      noisiness: pop.soundProto[o + Call.Noisiness],
      valence: pop.soundValence[so + k],
      strength: pop.soundStrength[so + k],
    });
  }
  out.sort((a, b) => b.strength - a.strength);
  return out;
}

function emptyStats(): Stats {
  return {
    tick: 0,
    population: 0,
    livingSpecies: 0,
    totalSpeciesEverCreated: 0,
    extinctSpecies: 0,
    births: 0,
    deaths: 0,
    birthsPerTick: 0,
    deathsPerTick: 0,
    killsPerTick: 0,
    sharesPerTick: 0,
    imitationsPerTick: 0,
    avgEnergy: 0,
    avgAge: 0,
    avgLifespan: 0,
    avgBrainSize: 0,
    avgSize: 0,
    avgSpeed: 0,
    avgVision: 0,
    avgGeneration: 0,
    maxGeneration: 0,
    avgPlasticity: 0,
    avgMutationRate: 0,
    avgMemorySlots: 0,
    avgHearingRange: 0,
    avgSocialLearning: 0,
    avgGroupSize: 0,
    broadcastActivity: 0,
    callsPerTick: 0,
    vocalDiversity: 0,
    vocalPrecision: 0,
    signalClusters: 0,
    sequenceStructure: 0,
    turnTaking: 0,
    vocalConvergence: 0,
    dialectDivergence: 0,
    callGenerationSpan: 0,
    signalCoupling: 0,
    transmissionIndex: 0,
    distinctMemes: 0,
    posthumousMemes: 0,
    signalMeaningConfidence: 0,
    diversity: 0,
    carnivory: 0,
    carnivoreFraction: 0,
    aquaticFraction: 0,
    totalVegetation: 0,
    totalCarrion: 0,
    signalActivity: 0,
    temperature: 0.5,
    light: 1,
    day: 0,
    year: 0,
    ticksPerSecond: 0,
    msPerTick: 0,
  };
}
