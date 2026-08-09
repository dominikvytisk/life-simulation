/**
 * Every number that shapes the simulation lives here. The whole config is part
 * of the determinism contract: (seed + config) => identical run.
 *
 * Tuning philosophy: these knobs describe *physics and economics*, never
 * behaviour. There is no "predators should exist" switch. If the ecosystem is
 * boring, the fix is in this file (or the sensory model), not in an if-statement.
 */
export interface SimConfig {
  seed: number;

  // ---- World ----
  worldSize: number; // world units, square
  gridSize: number; // environment cells per axis
  waterLevel: number; // elevation below which terrain is water

  // ---- Time ----
  dt: number; // seconds of sim time per tick
  ticksPerDay: number;
  daysPerYear: number;

  // ---- Population ----
  initialPopulation: number;
  maxPopulation: number;

  // ---- Vegetation ----
  vegetationGrowthRate: number; // logistic rate toward capacity, per tick
  vegetationEnergyDensity: number; // energy per unit of biomass
  grazeRate: number; // biomass consumable per tick

  // ---- Carrion ----
  carrionDecayRate: number;
  carrionEnergyDensity: number;

  // ---- Signal fields (pheromone / stigmergy layer) ----
  signalDecay: number;
  signalDiffusion: number;
  signalDeposit: number;
  /** Energy burned per unit of signal emitted, on any channel. */
  signalCost: number;

  // ---- Social mechanisms ----
  /** Fraction of max energy transferable in one sharing action. */
  shareRate: number;
  /** How much of a transfer survives it. Below 1 so sharing is never free. */
  shareEfficiency: number;
  imitationRange: number;
  imitationCost: number;
  /** Per-marker chance a kin tag mutates on inheritance. */
  kinTagMutationRate: number;

  // ---- Metabolism ----
  basalMetabolicCost: number; // per tick, scaled by mass
  movementCostCoefficient: number;
  brainCostPerNeuron: number;
  sensorCostCoefficient: number;
  temperatureStressCost: number;
  drowningDamage: number;

  // ---- Combat ----
  attackCost: number;
  attackRange: number;
  attackCooldownTicks: number;
  damageScale: number;
  meatYield: number; // fraction of victim mass/energy becoming carrion

  // ---- Reproduction ----
  matingRange: number;
  gestationTicks: number;
  reproductionCostFraction: number;
  offspringEnergyFraction: number;
  asexualEnergyPenalty: number; // extra cost when self-replicating
  compatibilityThreshold: number; // max genetic distance for mating

  // ---- Mutation ----
  baseMutationRate: number;
  mutationSigma: number;
  brainMutationRate: number;
  brainMutationSigma: number;
  structuralMutationRate: number;

  // ---- Speciation ----
  speciationThreshold: number;
  minSpeciesPopulation: number;

  // ---- Environment forcing (driven by world events) ----
  globalTemperatureOffset: number;
  vegetationGrowthMultiplier: number;
  seasonAmplitude: number;
}

export const DEFAULT_CONFIG: SimConfig = {
  seed: 1337,

  worldSize: 4096,
  gridSize: 256,
  waterLevel: 0.38,

  dt: 0.1,
  ticksPerDay: 300,
  daysPerYear: 24,

  // Generation 0 has random brains and mostly starves. The founder count is
  // effectively the number of lottery tickets the world gets before selection
  // has anything to work with; too few and the run simply goes extinct.
  // Generation 0 has random brains and mostly starves. The founder count is
  // effectively the number of lottery tickets the world gets before selection
  // has anything to work with. It went up when the action space grew: with
  // nineteen outputs instead of ten there are simply more ways for a random
  // brain to waste energy, so more of generation 0 dies before doing anything.
  initialPopulation: 3000,
  maxPopulation: 8000,

  vegetationGrowthRate: 0.02,
  // Tuned so the equilibrium population is set by the vegetation flux, not by
  // maxPopulation. A world pinned against its own array cap has no ecology.
  vegetationEnergyDensity: 24,
  grazeRate: 0.09,

  carrionDecayRate: 0.0035,
  // Carrion is stored in energy units. This is a feeding *rate* multiplier:
  // how much corpse energy one bite converts. Higher makes scavenging a faster
  // way to eat than grazing, which is what gives a meat-adapted gut somewhere
  // to start before true predation is viable.
  carrionEnergyDensity: 110,

  signalDecay: 0.035,
  signalDiffusion: 0.09,
  signalDeposit: 0.35,
  // Per unit of signal, summed over all eight channels. Enough that constant
  // screaming is not free — which is what lets a channel carry information —
  // but small next to the cost of moving.
  signalCost: 0.012,

  // Fraction of max energy moved per tick of sustained sharing. This has to sit
  // in the same order of magnitude as upkeep: at 6% a random brain that happens
  // to hold the Share output open drains itself in under twenty ticks, and the
  // founder population wipes itself out before selection can act on anything.
  // At 0.4% a parent can still provision a juvenile over a hundred ticks.
  shareRate: 0.004,
  // A transfer loses 15%. Sharing therefore destroys energy at the population
  // level, so it can only be selected for when the receiver does something with
  // it that the giver's own lineage benefits from — which is exactly the
  // condition kin selection requires.
  shareEfficiency: 0.85,
  imitationRange: 34,
  imitationCost: 0.15,
  kinTagMutationRate: 0.02,

  // Global multiplier on the body-plan upkeep computed in phenotype.ts.
  basalMetabolicCost: 1,
  // cost = k * mass^0.75 * speed^1.5 * dt — sub-quadratic, so sprinting is
  // expensive but not instantly lethal.
  movementCostCoefficient: 0.012,
  brainCostPerNeuron: 0.0022,
  sensorCostCoefficient: 0.02,
  temperatureStressCost: 0.16,
  drowningDamage: 0.5,

  attackCost: 0.9,
  attackRange: 16,
  attackCooldownTicks: 6,
  damageScale: 13,
  meatYield: 0.72,

  matingRange: 22,
  gestationTicks: 60,
  reproductionCostFraction: 0.42,
  offspringEnergyFraction: 0.6,
  asexualEnergyPenalty: 1.35,
  // Genetic distance is a weighted mean absolute difference, so two unrelated
  // random genomes sit around 0.33 and siblings around 0.02-0.05. These
  // thresholds have to live in that lower band or nothing ever diverges.
  compatibilityThreshold: 0.22,

  baseMutationRate: 0.06,
  mutationSigma: 0.055,
  brainMutationRate: 0.035,
  brainMutationSigma: 0.14,
  structuralMutationRate: 0.012,

  speciationThreshold: 0.14,
  minSpeciesPopulation: 1,

  globalTemperatureOffset: 0,
  vegetationGrowthMultiplier: 1,
  seasonAmplitude: 0.12,
};

export function makeConfig(overrides: Partial<SimConfig> = {}): SimConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}
