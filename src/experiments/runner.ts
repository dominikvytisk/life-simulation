/**
 * Forked experiments.
 *
 * A fork is a byte-exact copy of a running world. From one saved state we spawn
 * several branches, apply a different config patch to each, and run them all
 * forward for the same number of ticks. Because the RNG state, the population
 * and the free list are all restored exactly, a branch with an *empty* patch
 * reproduces its parent tick for tick — which is what makes the control arm a
 * real control rather than an independent run that happens to start similarly.
 *
 * Replicates use derived seeds. One run of an evolutionary simulation tells you
 * almost nothing: the founder bottleneck alone can swing the outcome by an
 * order of magnitude. Every reported number therefore comes with the spread
 * across replicates, and a difference smaller than that spread is reported as
 * inconclusive rather than as a result.
 */
import type { SimConfig } from '../sim/core/config';

export interface ExperimentArm {
  id: string;
  label: string;
  patch: Partial<SimConfig>;
}

export const COMPARED_METRICS = [
  'population',
  'livingSpecies',
  'avgBrainSize',
  'avgMemorySlots',
  'avgGroupSize',
  'broadcastActivity',
  'imitationsPerTick',
  'transmissionIndex',
  'carnivory',
  'diversity',
  'avgLifespan',
  'maxGeneration',
  'sharesPerTick',
  // ---- cognition ----
  'avgPredictionAccuracy',
  'avgPredictionRate',
  'avgCuriosity',
  'avgPlanHorizon',
  'modellingFraction',
  'planningFraction',
  'avgToxinLoad',
  'socialMemoryFraction',
] as const;
export type ComparedMetric = (typeof COMPARED_METRICS)[number];

export interface ArmResult {
  id: string;
  label: string;
  replicates: number;
  /** Mean across replicates for each metric. */
  mean: Record<ComparedMetric, number>;
  /** Sample standard deviation across replicates. */
  sd: Record<ComparedMetric, number>;
  extinctions: number;
}

export interface Comparison {
  metric: ComparedMetric;
  controlMean: number;
  armMean: number;
  deltaPercent: number;
  /**
   * Difference in units of pooled spread. Below ~1 the arms are not
   * distinguishable given how much replicates vary on their own.
   */
  effectSize: number;
  verdict: 'higher' | 'lower' | 'inconclusive';
}

export interface ExperimentReport {
  ticks: number;
  replicates: number;
  arms: ArmResult[];
  /** Every non-control arm compared against the control arm. */
  comparisons: Record<string, Comparison[]>;
  startedFromTick: number;
}

/** Aggregate raw per-replicate metric samples into mean and spread. */
export function summarise(
  id: string,
  label: string,
  samples: Record<ComparedMetric, number>[],
  extinctions: number,
): ArmResult {
  const mean = {} as Record<ComparedMetric, number>;
  const sd = {} as Record<ComparedMetric, number>;
  for (const m of COMPARED_METRICS) {
    const values = samples.map((s) => s[m]).filter((v) => Number.isFinite(v));
    if (values.length === 0) {
      mean[m] = 0;
      sd[m] = 0;
      continue;
    }
    const mu = values.reduce((a, b) => a + b, 0) / values.length;
    mean[m] = mu;
    sd[m] =
      values.length > 1
        ? Math.sqrt(values.reduce((a, b) => a + (b - mu) ** 2, 0) / (values.length - 1))
        : 0;
  }
  return { id, label, replicates: samples.length, mean, sd, extinctions };
}

export function compare(control: ArmResult, arm: ArmResult): Comparison[] {
  const out: Comparison[] = [];
  for (const m of COMPARED_METRICS) {
    const c = control.mean[m];
    const a = arm.mean[m];
    // Pooled spread. When both arms are perfectly consistent the effect size is
    // undefined rather than infinite, so fall back to declaring it inconclusive
    // unless the means genuinely differ.
    const pooled = Math.sqrt((control.sd[m] ** 2 + arm.sd[m] ** 2) / 2);
    const effectSize = pooled > 1e-9 ? (a - c) / pooled : 0;
    const deltaPercent = Math.abs(c) > 1e-9 ? ((a - c) / Math.abs(c)) * 100 : 0;
    let verdict: Comparison['verdict'] = 'inconclusive';
    if (Math.abs(effectSize) >= 1) verdict = effectSize > 0 ? 'higher' : 'lower';
    out.push({ metric: m, controlMean: c, armMean: a, deltaPercent, effectSize, verdict });
  }
  out.sort((x, y) => Math.abs(y.effectSize) - Math.abs(x.effectSize));
  return out;
}

/** Preset hypotheses. Each is a config patch plus the claim it is testing. */
export interface Hypothesis {
  id: string;
  claim: string;
  reasoning: string;
  arms: ExperimentArm[];
  /** Metrics the claim actually predicts something about. */
  watch: ComparedMetric[];
}

export const HYPOTHESES: Hypothesis[] = [
  {
    id: 'predation-sociality',
    claim: 'Higher predation pressure increases group living.',
    reasoning:
      'If being alone is more dangerous, any lineage whose network keeps it near others survives more often — without a grouping rule existing anywhere.',
    arms: [
      { id: 'control', label: 'Control', patch: {} },
      {
        id: 'predation',
        label: 'Deadlier attacks',
        patch: { damageScale: 30, attackCost: 0.3, attackCooldownTicks: 3 },
      },
    ],
    watch: ['avgGroupSize', 'broadcastActivity', 'population', 'avgLifespan'],
  },
  {
    id: 'scarcity-memory',
    claim: 'Patchier food selects for larger memory.',
    reasoning:
      'Remembering where food was only pays when food is somewhere specific. Memory costs upkeep every tick, so in an evenly fed world it should be selected away.',
    arms: [
      { id: 'control', label: 'Control', patch: {} },
      { id: 'scarce', label: 'Scarce, patchy food', patch: { vegetationGrowthRate: 0.012 } },
      { id: 'abundant', label: 'Food everywhere', patch: { vegetationGrowthRate: 0.06 } },
    ],
    watch: ['avgMemorySlots', 'avgBrainSize', 'population', 'diversity'],
  },
  {
    id: 'signal-cost',
    claim: 'Cheap signalling produces noise; costly signalling produces meaning.',
    reasoning:
      'If broadcasting is free, everything broadcasts constantly and no channel can correlate with anything. A real cost should reduce volume but raise the measured correlation.',
    arms: [
      { id: 'control', label: 'Control', patch: {} },
      { id: 'free', label: 'Free signalling', patch: { signalCost: 0 } },
      { id: 'costly', label: 'Expensive signalling', patch: { signalCost: 0.12 } },
    ],
    watch: ['broadcastActivity', 'avgGroupSize', 'population'],
  },
  {
    id: 'culture-payoff',
    claim: 'Cheap imitation lets learned behaviour spread and persist.',
    reasoning:
      'Copying is only worth its energy when somebody nearby knows something useful. Lowering the cost should raise both imitation rate and the transmission index.',
    arms: [
      { id: 'control', label: 'Control', patch: {} },
      { id: 'cheap', label: 'Cheap imitation', patch: { imitationCost: 0.02, imitationRange: 60 } },
      { id: 'blocked', label: 'Imitation impossible', patch: { imitationRange: 0 } },
    ],
    watch: ['imitationsPerTick', 'transmissionIndex', 'avgBrainSize', 'population'],
  },
  // ---------------------------------------------------------------------
  // The ablation ladder. These are the experiments that decide whether any of
  // the cognitive machinery is doing anything, and they are the only honest way
  // to ask: run the same world twice, with one faculty switched off.
  //
  // Every one of them can come back inconclusive, and several probably will.
  // An inconclusive result here is not a failure of the experiment — it is the
  // finding that the faculty did not pay for itself in this world, which is a
  // perfectly ordinary thing for a faculty to fail to do.
  // ---------------------------------------------------------------------
  {
    id: 'does-learning-matter',
    claim: 'Lifetime learning changes evolutionary outcomes at all.',
    reasoning:
      'The most basic control there is. If a population with plasticity and auditory association switched off does just as well, then nothing any organism learns in its life is affecting who reproduces, and every result downstream of that is decoration.',
    arms: [
      { id: 'control', label: 'Learning on', patch: {} },
      { id: 'no-learning', label: 'No lifetime learning', patch: { learningEnabled: false } },
    ],
    watch: ['population', 'avgLifespan', 'maxGeneration', 'avgBrainSize', 'diversity'],
  },
  {
    id: 'does-the-model-matter',
    claim: 'Carrying a predictive model of the world pays for its upkeep.',
    reasoning:
      'The model costs energy to fit and to carry, and predicts nothing useful until the brain has found a representation worth predicting. If the arm without it does as well or better, prediction is a tax rather than an adaptation in this world.',
    arms: [
      { id: 'control', label: 'World model on', patch: {} },
      { id: 'no-model', label: 'No world model', patch: { worldModelEnabled: false } },
    ],
    watch: ['population', 'avgPredictionAccuracy', 'avgLifespan', 'maxGeneration'],
  },
  {
    id: 'does-planning-matter',
    claim: 'Imagining a few actions before choosing beats acting on instinct.',
    reasoning:
      'Deliberation is charged per imagined step and runs on a model that is wrong early in every life. It should only pay where the world is structured enough that a one-second-ahead guess is better than a reflex.',
    arms: [
      { id: 'control', label: 'Planning available', patch: {} },
      { id: 'no-planning', label: 'No deliberation', patch: { planningEnabled: false } },
    ],
    watch: ['population', 'avgPlanHorizon', 'planningFraction', 'avgLifespan', 'maxGeneration'],
  },
  {
    id: 'does-curiosity-matter',
    claim: 'Taking value from learning itself improves survival.',
    reasoning:
      'Intrinsic value competes directly with energy for the same learning signal and the same time. An organism that finds things interesting eats less while it does so. Whether that ever repays depends on whether there is anything worth finding out.',
    arms: [
      { id: 'control', label: 'Intrinsic value on', patch: {} },
      { id: 'no-intrinsic', label: 'Extrinsic reward only', patch: { intrinsicEnabled: false } },
    ],
    watch: ['population', 'avgCuriosity', 'avgPredictionAccuracy', 'diversity', 'avgLifespan'],
  },
  {
    id: 'volatility-and-learning',
    claim: 'A world that keeps changing favours faster learning than a stable one.',
    reasoning:
      'The rate an organism fits its model at is genetic, and a gene for adapting the rate to recent surprise exists. In a stable world a slow, stable model should win on cost; in a shifting one it should be left holding beliefs that stopped being true.',
    arms: [
      { id: 'control', label: 'Default seasons', patch: {} },
      {
        id: 'stable',
        label: 'Almost unchanging',
        patch: { seasonAmplitude: 0.02, vegetationGrowthRate: 0.022, daysPerYear: 40 },
      },
      {
        id: 'volatile',
        label: 'Hard, fast seasons',
        patch: { seasonAmplitude: 0.34, ticksPerDay: 120, daysPerYear: 10 },
      },
    ],
    watch: [
      'avgPredictionRate',
      'avgPredictionAccuracy',
      'avgCuriosity',
      'population',
      'avgMemorySlots',
    ],
  },
  {
    id: 'delayed-consequences',
    claim: 'A consequence that arrives late selects for memory and prediction.',
    reasoning:
      'Toxic growth pays energy now and costs health hundreds of ticks later, and the only cue is a visible property of the plant. A reflex cannot connect the two. If the machinery does anything, removing the delayed cost should relax the pressure on it.',
    arms: [
      { id: 'control', label: 'Toxic patches present', patch: {} },
      { id: 'harmless', label: 'Nothing is poisonous', patch: { toxinPotency: 0 } },
      { id: 'severe', label: 'Strongly poisonous', patch: { toxinPotency: 1.1, toxinDamage: 0.011 } },
    ],
    watch: [
      'avgMemorySlots',
      'avgPredictionAccuracy',
      'avgToxinLoad',
      'population',
      'avgPredictionRate',
    ],
  },
  {
    id: 'knowledge-through-sound',
    claim: 'Hearing can carry a belief about a place nobody in earshot has visited.',
    reasoning:
      'A listener that recognises a sound writes a place-memory at its source from its own learned association. Switching that channel off should cost nothing unless sounds in this world had actually become worth acting on.',
    arms: [
      { id: 'control', label: 'Sound can inform', patch: {} },
      { id: 'no-social', label: 'Sound informs nothing', patch: { socialMemoryEnabled: false } },
    ],
    watch: [
      'socialMemoryFraction',
      'population',
      'transmissionIndex',
      'avgMemorySlots',
    ],
  },
  {
    id: 'kin-sharing',
    claim: 'Efficient energy transfer allows altruism toward kin to persist.',
    reasoning:
      'Sharing destroys energy, so it can only be favoured when the receiver carries the giver\'s markers. Raising transfer efficiency should raise sharing if kin selection is operating.',
    arms: [
      { id: 'control', label: 'Control', patch: {} },
      { id: 'efficient', label: 'Efficient transfer', patch: { shareEfficiency: 0.98 } },
      { id: 'lossy', label: 'Lossy transfer', patch: { shareEfficiency: 0.5 } },
    ],
    watch: ['sharesPerTick', 'population', 'avgGroupSize'],
  },
];
