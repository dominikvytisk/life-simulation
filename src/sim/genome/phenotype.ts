/**
 * Genotype -> phenotype. Genes are unitless [0,1]; this is the only place that
 * decides what they physically mean.
 *
 * The key design point: nearly every trait is *paid for*. Bigger eyes cost
 * energy, armor costs mass, a wide brain costs upkeep, a meat gut costs plant
 * digestion. Without a cost, evolution just maximises everything and the
 * ecosystem collapses into one strategy.
 */
import { Locus } from './loci';
import { MAX_ECHOIC, MAX_PROTOTYPES, bandFromGenes } from '../acoustics/sound';

export interface Phenotype {
  radius: number;
  mass: number;
  maxSpeed: number;
  turnRate: number;
  attackDamage: number;
  armor: number;
  spikes: number;
  visionRange: number;
  visionAcuity: number;
  smellRange: number;
  metabolicRate: number;
  maxEnergy: number;
  lifespan: number;
  maturationAge: number;
  reproThreshold: number;
  offspringEnergy: number;
  fecundity: number;
  plantEfficiency: number;
  meatEfficiency: number;
  tempPreference: number;
  tempTolerance: number;
  waterAffinity: number;
  camouflage: number;
  signalGain: number;
  signalSensitivity: number;
  hiddenSize: number;
  contextSize: number;
  plasticity: number;
  mutationRate: number;
  hue: number;
  pattern: number;
  memorySlots: number;
  memoryDecay: number;
  hearingRange: number;
  socialLearningRate: number;

  // ---- vocal organ: the reachable corner of acoustic space ----
  vocalLow: number;
  vocalHigh: number;
  vocalPower: number;
  vocalSlew: number;
  vocalAgility: number;
  timbreCenter: number;
  timbreSpan: number;
  noiseCenter: number;
  noiseSpan: number;

  // ---- auditory organ ----
  auditoryLow: number;
  auditoryHigh: number;
  auditoryResolution: number;
  echoicDepth: number;
  soundPrototypes: number;

  /** Total per-tick upkeep implied by the body plan. */
  upkeep: number;
}

export const MAX_HIDDEN = 14;
export const MAX_CONTEXT = 6;
/** Episodic place-memories an organism can hold at maximum. */
export const MAX_MEMORY = 8;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Fill `out` from the genome at `off`. Reuses the object — no per-tick garbage. */
export function expressInto(out: Phenotype, g: Float32Array, off: number): Phenotype {
  const size = g[off + Locus.BodySize];
  const muscle = g[off + Locus.Muscle];
  const armorGene = g[off + Locus.Armor];

  out.radius = lerp(2.2, 11, size * size); // squared so most organisms stay small
  out.mass = out.radius * out.radius * (0.55 + armorGene * 0.9);

  // Speed comes from muscle but is dragged down by mass — big armored things
  // are slow, which is what makes an ambush/pursuit trade-off exist at all.
  out.maxSpeed = lerp(6, 46, muscle) * (18 / (18 + out.mass));
  out.turnRate = lerp(1.6, 6.5, 1 - size * 0.6) * lerp(0.6, 1.4, muscle);

  out.attackDamage = lerp(0.5, 9, g[off + Locus.Strength]) * (0.5 + size);
  out.armor = lerp(0, 6.5, armorGene * armorGene);
  out.spikes = lerp(0, 4.5, g[off + Locus.Spikes] * g[off + Locus.Spikes]);

  out.visionRange = lerp(18, 150, g[off + Locus.VisionRange] ** 1.5);
  out.visionAcuity = lerp(0.15, 1, g[off + Locus.VisionAcuity]);
  out.smellRange = lerp(10, 120, g[off + Locus.SmellRange] ** 1.4);

  out.metabolicRate = lerp(0.55, 1.9, g[off + Locus.Metabolism]);
  out.maxEnergy = lerp(45, 380, g[off + Locus.EnergyCapacity]) * (0.5 + size);
  out.lifespan = lerp(700, 9000, g[off + Locus.Lifespan] ** 1.3);
  // Maturation is capped in absolute ticks as well as a fraction of lifespan.
  // Tying it purely to lifespan punishes long-lived lineages twice over: they
  // would have to survive thousands of ticks before their first chance to
  // reproduce, which selects against longevity for the wrong reason.
  out.maturationAge = Math.min(
    out.lifespan * 0.35,
    lerp(40, 1100, g[off + Locus.Maturation] ** 1.5),
  );
  out.reproThreshold = lerp(0.35, 0.95, g[off + Locus.ReproThreshold]);
  // A minimum investment per offspring. Allowing arbitrarily cheap children
  // makes r-selection strictly dominant: a parent just sprays out dozens of
  // near-free copies and the population pins to the world cap within a few
  // hundred ticks, which erases every other dynamic.
  out.offspringEnergy = lerp(0.2, 0.6, g[off + Locus.OffspringInvestment]);
  out.fecundity = Math.max(1, Math.round(lerp(1, 6, g[off + Locus.Fecundity] ** 2)));

  // Gut specialisation. A generalist can eat both but is mediocre at each;
  // the exponent makes specialists strictly better at their own food.
  const d = g[off + Locus.Digestion];
  out.plantEfficiency = Math.pow(1 - d, 0.62);
  out.meatEfficiency = Math.pow(d, 0.62);

  out.tempPreference = lerp(0.08, 0.95, g[off + Locus.TempPreference]);
  out.tempTolerance = lerp(0.06, 0.5, g[off + Locus.TempTolerance]);
  out.waterAffinity = g[off + Locus.WaterAffinity];
  out.camouflage = g[off + Locus.Camouflage];
  out.signalGain = g[off + Locus.SignalGain];
  out.signalSensitivity = lerp(0.2, 3, g[off + Locus.SignalSensitivity]);

  out.hiddenSize = Math.max(2, Math.round(lerp(2, MAX_HIDDEN, g[off + Locus.BrainHidden])));
  out.contextSize = Math.round(lerp(0, MAX_CONTEXT, g[off + Locus.BrainContext]));
  out.plasticity = g[off + Locus.Plasticity] ** 2 * 0.06;
  out.mutationRate = lerp(0.15, 3.2, g[off + Locus.MutationRate] ** 1.6);

  out.hue = g[off + Locus.Hue];
  out.pattern = g[off + Locus.Pattern];

  // Memory is a capability, not a behaviour: how many places an organism can
  // hold and how slowly they fade. What it does with a remembered place is the
  // brain's problem. Squaring the gene keeps large memories rare, so a big
  // memory has to be actively selected for rather than being the default draw.
  out.memorySlots = Math.round(MAX_MEMORY * g[off + Locus.MemoryCapacity] ** 2);
  out.memoryDecay = lerp(0.02, 0.0004, g[off + Locus.MemoryPersistence] ** 0.6);
  out.hearingRange = lerp(0, 320, g[off + Locus.HearingRange] ** 1.4);
  out.socialLearningRate = g[off + Locus.SocialLearning] ** 2 * 0.35;

  // ---- vocal organ ----
  // Two unordered edges become a band, so one mutation can move one edge. A
  // narrow band is not a defect: it is a cheap organ with a small acoustic
  // space, and whether that is a handicap depends entirely on what the
  // neighbours can hear.
  const vb = bandFromGenes(g[off + Locus.VocalLowEdge], g[off + Locus.VocalHighEdge]);
  out.vocalLow = vb.low;
  out.vocalHigh = vb.high;
  out.vocalPower = lerp(0.12, 1, g[off + Locus.VocalPower] ** 1.3);
  const agility = g[off + Locus.VocalAgility];
  out.vocalAgility = agility;
  // Slew limits how far pitch can move in one tick. A sluggish tract can only
  // hold long flat notes; an agile one can chirp. Neither is better a priori.
  out.vocalSlew = lerp(0.015, 0.4, agility ** 1.4);
  const timbre = g[off + Locus.VocalTimbre];
  out.timbreCenter = timbre;
  out.timbreSpan = 0.08 + 0.45 * agility;
  // One anatomical axis with two consequences, as in a real tract: a bright
  // resonant shape is also a tonal one, a rough shape is also a turbulent one.
  out.noiseCenter = lerp(0.78, 0.16, timbre);
  out.noiseSpan = 0.1 + 0.6 * agility;

  // ---- auditory organ ----
  const ab = bandFromGenes(g[off + Locus.AuditoryLowEdge], g[off + Locus.AuditoryHighEdge]);
  out.auditoryLow = ab.low;
  out.auditoryHigh = ab.high;
  out.auditoryResolution = g[off + Locus.AuditoryResolution];
  // Sound memory buys both depth of the echoic window and how many recurring
  // patterns can be held. Squared, so a deep memory has to be selected for.
  const sm = g[off + Locus.SoundMemory] ** 2;
  out.echoicDepth = Math.round(MAX_ECHOIC * sm);
  out.soundPrototypes = Math.round(MAX_PROTOTYPES * sm);

  // Everything the body costs to simply exist, per tick.
  //
  // The constant term is the important one. Without a floor, every cost scales
  // with body size, so the cheapest possible organism is an arbitrarily tiny
  // one — and evolution finds that immediately, driving the whole population
  // toward near-zero upkeep and a carrying capacity limited only by the array
  // size. A fixed maintenance cost is both physically honest (an organism has
  // to run its cell chemistry regardless of how small it is) and what keeps the
  // ecosystem's carrying capacity set by food rather than by memory.
  out.upkeep =
    0.07 +
    out.mass * 0.011 * out.metabolicRate +
    (out.visionRange / 150) * 0.05 * out.visionAcuity +
    (out.smellRange / 120) * 0.018 +
    (out.hiddenSize + out.contextSize * 2) * 0.0022 +
    out.armor * 0.006 +
    out.plasticity * 0.8 +
    // Memory has to be paid for or every lineage takes the maximum for free.
    // The persistence term is separate from the capacity term because holding
    // a memory for a long time is a different cost from holding many.
    out.memorySlots * 0.004 +
    out.memorySlots * (0.02 - out.memoryDecay) * 0.2 +
    (out.hearingRange / 320) * 0.014 +
    out.socialLearningRate * 0.05 +
    // A vocal organ costs something to carry even when silent: a wide range and
    // a powerful, agile tract are tissue. Actually using it costs energy on top
    // of this, per tick of calling.
    (out.vocalHigh - out.vocalLow) * 0.012 +
    out.vocalPower * 0.016 +
    out.vocalAgility * 0.012 +
    // A sharp ear is expensive in every animal that has one. Without this an
    // organism would take perfect discrimination for free and there would be no
    // pressure toward signals that are easy to tell apart.
    (out.auditoryHigh - out.auditoryLow) * 0.01 +
    out.auditoryResolution * 0.02 +
    out.echoicDepth * 0.004 +
    out.soundPrototypes * 0.005;

  return out;
}

export function makePhenotype(): Phenotype {
  return expressInto({} as Phenotype, new Float32Array(64), 0);
}
