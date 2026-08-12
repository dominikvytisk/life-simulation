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
  /** Energy burned per unit of pheromone deposited. */
  signalCost: number;

  // ---- Acoustics ----
  /** Energy per tick of vocalising at full loudness, before the pitch term. */
  vocalCost: number;
  /** Distance at which geometric spreading has halved a sound. */
  soundReferenceDistance: number;
  /** Absorption per world unit, frequency-independent part. */
  soundAbsorption: number;
  /** Extra absorption per world unit at the very top of the audible band. */
  soundAbsorptionPitch: number;
  /** Acoustic noise present in a still world with no weather. */
  ambientNoiseFloor: number;
  /** How much an organism's own voice drowns out its hearing. */
  selfMaskingFactor: number;
  /** Perceptual scatter at a signal-to-noise ratio of one, with a perfect ear. */
  auditoryJitter: number;
  /** How fast the auditory associative memory follows what it hears. */
  auditoryLearningRate: number;
  /** How fast a heard sound stops being credited for what happens next. */
  auditoryTraceDecay: number;
  /** Per-tick fading of a sound pattern nobody keeps hearing. */
  auditoryForgetRate: number;
  /** Ticks after hearing a sound during which a listener's behaviour is
   * attributed to it by the analyser. Observation only. */
  responseWindowTicks: number;

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

  // ---- Perception ----
  /**
   * How badly a blunt sense misreports the world. Scaled by (1 - acuity), so a
   * sharp eye reads a gradient nearly correctly and a cheap one reads it
   * roughly. Nothing receives a perfect number; this is the difference between
   * the world and an organism's access to it.
   */
  perceptualNoise: number;

  // ---- Cognition ----
  /**
   * Brain ticks between two steps of the world model. Predicting one tick
   * ahead at dt=0.1 is almost free and almost useless — the state barely
   * changes. Predicting several ticks ahead is a real claim about the future,
   * costs proportionally less, and is what makes a delayed consequence
   * learnable at all.
   */
  modelInterval: number;
  /** Energy per fitted latent unit, charged when the model actually updates. */
  modelUpdateCost: number;
  /** Energy per imagined step. Deliberation is metabolically real. */
  planStepCost: number;
  /** Energy per replayed transition during rest. */
  replayCost: number;
  /** Smallest departure from the brain's proposal a deliberation considers. */
  planJitterBase: number;
  /** How much more widely a curious organism casts around. */
  planJitterCuriosity: number;
  /** Weight of the intrinsic signal where it enters lifetime learning. */
  intrinsicGain: number;
  /** Below this rest output, no consolidation happens. */
  restThreshold: number;

  // ---- Delayed consequences ----
  /** Toxin absorbed per unit of vegetation eaten, at full local toxicity. */
  toxinPotency: number;
  /** Load an organism carries with no effect at all. */
  toxinThreshold: number;
  /** Health lost per tick per unit of load above the threshold. */
  toxinDamage: number;
  /** Which visible flora value carries the poison. */
  floraToxicCenter: number;

  // ---- Experimental controls ----
  /**
   * Ablation switches, and nothing else. These exist so a control arm can be a
   * real control: run the same world with lifetime learning off and compare.
   * They are not a progression system and nothing in the simulation ever turns
   * one on — the only thing that changes a value here is a person setting up an
   * experiment.
   */
  learningEnabled: boolean;
  worldModelEnabled: boolean;
  intrinsicEnabled: boolean;
  planningEnabled: boolean;
  socialMemoryEnabled: boolean;

  // ---- Environment forcing (driven by world events) ----
  globalTemperatureOffset: number;
  vegetationGrowthMultiplier: number;
  seasonAmplitude: number;
  /** How far a chemical shift has moved the dangerous band. */
  toxicCenterOffset: number;
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
  // Per unit of pheromone. Enough that marking is not free, but small next to
  // the cost of moving.
  signalCost: 0.012,

  // Vocalising has to cost something real or everything screams constantly and
  // sound carries no information at all. At full loudness this is roughly a
  // third of a typical organism's basal upkeep, per tick of calling — a brief
  // call is cheap, a continuous one is a serious drain, and a loud low call
  // that carries across the map is the most expensive thing an organism can
  // say. Nothing here rewards calling; it is pure cost, and any benefit has to
  // come from what other organisms do about it.
  vocalCost: 0.055,
  soundReferenceDistance: 55,
  // Tuned against hearingRange (up to 320u): at the frequency-independent rate
  // alone a sound is down to ~30% at 200 units, and the pitch term roughly
  // triples that loss at the top of the band. Low calls therefore travel, high
  // calls stay local, and that trade-off is not something an organism can opt
  // out of.
  soundAbsorption: 0.006,
  soundAbsorptionPitch: 0.013,
  ambientNoiseFloor: 0.02,
  // An organism cannot hear well while shouting. This is the attention cost of
  // communication, and it is the reason a duet has to alternate rather than
  // overlap if either party is going to hear the other.
  selfMaskingFactor: 0.55,
  auditoryJitter: 0.09,
  auditoryLearningRate: 0.09,
  // Roughly a 70-tick half-life: long enough that "heard it, went over, found
  // food" is learnable, short enough that most coincidences average out.
  auditoryTraceDecay: 0.99,
  auditoryForgetRate: 0.00012,
  responseWindowTicks: 24,

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

  // A blunt eye misreads a gradient by roughly 15% of its range, a sharp one by
  // almost nothing. Small enough that existing behaviour still works, large
  // enough that acuity finally buys something beyond detection distance.
  perceptualNoise: 0.05,

  // Four brain ticks per model step. At dt=0.1 that is 0.4s of world time per
  // prediction, and a four-step rollout reaches 1.6s ahead — far enough to be a
  // guess about the future rather than a restatement of the present.
  modelInterval: 4,
  // Charged per latent unit fitted, so a wide brain costs more to model with
  // than a narrow one. Roughly a tenth of basal upkeep for a mid-sized brain.
  modelUpdateCost: 0.0016,
  // An imagined step is cheaper than a lived one but not free. At the maximum
  // horizon and budget this is about a fifth of basal upkeep every model tick,
  // which is what stops deep deliberation from being strictly better.
  planStepCost: 0.0022,
  replayCost: 0.0025,
  planJitterBase: 0.08,
  planJitterCuriosity: 0.75,
  // Intrinsic value enters learning at well under the weight of energy. An
  // organism that ran purely on curiosity would starve, which is the intended
  // relationship between the two.
  intrinsicGain: 0.45,
  restThreshold: 0.35,

  // Tuned so a lineage grazing indiscriminately in a bad patch accumulates a
  // damaging load over a few hundred ticks — long enough that the connection is
  // genuinely delayed, short enough to be learnable within one lifetime.
  toxinPotency: 0.5,
  toxinThreshold: 0.3,
  toxinDamage: 0.006,
  floraToxicCenter: 0.72,

  learningEnabled: true,
  worldModelEnabled: true,
  intrinsicEnabled: true,
  planningEnabled: true,
  socialMemoryEnabled: true,

  globalTemperatureOffset: 0,
  vegetationGrowthMultiplier: 1,
  seasonAmplitude: 0.12,
  toxicCenterOffset: 0,
};

export function makeConfig(overrides: Partial<SimConfig> = {}): SimConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}
