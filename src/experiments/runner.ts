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
