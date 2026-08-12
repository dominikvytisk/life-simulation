/**
 * The cognitive field notebook.
 *
 * Two jobs, both purely observational. Nothing in this file is read back into
 * the simulation, and deleting it would change no organism's behaviour.
 *
 * TRAJECTORIES — a thinned record, per species, of measurable cognitive
 * quantities against generation. Brain width. Memory slots. How accurately the
 * organisms of that species were predicting their own next state. How fast they
 * were fitting their models, how far ahead they were imagining. This is the
 * material for looking at a lineage and asking what changed, and it is reported
 * as measurements rather than as a story about them: "prediction accuracy 0.31
 * at generation 40, 0.62 at generation 900" is a fact, "the species got
 * smarter" is an interpretation, and only the first belongs here.
 *
 * ASSOCIATIONS — correlations between what the environment was doing and what
 * the population's cognition was doing, computed over the telemetry history.
 * A correlation is reported with its coefficient, its sample count and an
 * explicit statement that it is not evidence of cause. The one thing that
 * *would* be evidence — running the same world twice with one factor changed —
 * lives in the experiment runner, and the report says so rather than quietly
 * implying it has already been done.
 */
import type { SeriesKey } from '../../analytics/history';

/** One measurement of one species at one moment. */
export interface CognitiveSample {
  tick: number;
  generation: number;
  population: number;
  /** Hidden units plus recurrent units. */
  brain: number;
  memory: number;
  /** Fraction of its own next internal state the species predicted correctly. */
  predictionAccuracy: number;
  learningRate: number;
  curiosity: number;
  planHorizon: number;
  /** Mean unfamiliarity of the situations its members were acting in. */
  novelty: number;
}

export interface SpeciesCognition {
  id: number;
  name: string;
  hue: number;
  extinct: boolean;
  samples: CognitiveSample[];
}

/**
 * A pairing between something the environment did and something the population's
 * cognition did. Every field is a measurement; none of them is a claim.
 */
export interface CognitiveAssociation {
  driver: SeriesKey | 'foodVolatility';
  driverLabel: string;
  response: SeriesKey;
  responseLabel: string;
  /** Pearson correlation over the aligned samples, -1..1. */
  correlation: number;
  /** Percent change in the driver between the first and last fifth of the run. */
  driverChange: number;
  responseChange: number;
  samples: number;
}

export interface CognitionReport {
  associations: CognitiveAssociation[];
  /** What the numbers say, with no interpretation attached. */
  observations: string[];
  /** A reading of them, explicitly labelled as one. */
  hypothesis: string;
  /** What would have to be done to turn the hypothesis into a result. */
  nextStep: string;
  samples: number;
}

/** Longest run of samples kept per species before thinning. */
const MAX_SAMPLES = 40;
/** Correlations below this are not worth a line of anyone's attention. */
const MIN_CORRELATION = 0.35;
/** Below this many aligned samples, nothing is reported at all. */
const MIN_SAMPLES = 24;

const DRIVERS: { key: SeriesKey | 'foodVolatility'; label: string }[] = [
  { key: 'foodVolatility', label: 'Food unpredictability' },
  { key: 'vegetation', label: 'Food abundance' },
  { key: 'predationRate', label: 'Predation rate' },
  { key: 'population', label: 'Population density' },
  { key: 'temperature', label: 'Temperature' },
  { key: 'toxinLoad', label: 'Toxin burden' },
];

const RESPONSES: { key: SeriesKey; label: string }[] = [
  { key: 'predictionAccuracy', label: 'Prediction accuracy' },
  { key: 'predictionRate', label: 'Learning rate' },
  { key: 'curiosity', label: 'Curiosity' },
  { key: 'planning', label: 'Planning depth' },
  { key: 'avgBrainSize', label: 'Brain size' },
  { key: 'avgMemory', label: 'Memory capacity' },
];

export class CognitionLedger {
  private byspecies = new Map<number, SpeciesCognition>();

  /**
   * Record where one species stood. Called on the stats interval; older samples
   * are thinned by halving rather than dropped from the front, so a long-lived
   * lineage keeps coverage of its whole history instead of only its recent past.
   */
  record(
    id: number,
    name: string,
    hue: number,
    sample: CognitiveSample,
  ): void {
    let rec = this.byspecies.get(id);
    if (!rec) {
      rec = { id, name, hue, extinct: false, samples: [] };
      this.byspecies.set(id, rec);
    }
    rec.extinct = false;
    rec.samples.push(sample);
    if (rec.samples.length > MAX_SAMPLES) {
      const kept: CognitiveSample[] = [];
      for (let i = 0; i < rec.samples.length; i += 2) kept.push(rec.samples[i]);
      kept.push(rec.samples[rec.samples.length - 1]);
      rec.samples = kept;
    }
  }

  markExtinct(id: number): void {
    const rec = this.byspecies.get(id);
    if (rec) rec.extinct = true;
  }

  /** Trajectories, longest history first. */
  trajectories(limit = 12): SpeciesCognition[] {
    const out = Array.from(this.byspecies.values()).filter((r) => r.samples.length > 1);
    out.sort((a, b) => {
      const ga = a.samples[a.samples.length - 1].generation - a.samples[0].generation;
      const gb = b.samples[b.samples.length - 1].generation - b.samples[0].generation;
      return gb - ga;
    });
    return out.slice(0, limit);
  }

  reset(): void {
    this.byspecies.clear();
  }
}

function pearson(a: Float32Array, b: Float32Array, n: number): number {
  if (n < 3) return 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den > 1e-9 ? num / den : 0;
}

/** Percent change between the mean of the first fifth and the mean of the last. */
function endpointChange(v: Float32Array, n: number): number {
  const w = Math.max(1, Math.floor(n / 5));
  let first = 0;
  let last = 0;
  for (let i = 0; i < w; i++) first += v[i];
  for (let i = n - w; i < n; i++) last += v[i];
  first /= w;
  last /= w;
  if (Math.abs(first) < 1e-6) return last > 1e-6 ? 100 : 0;
  return ((last - first) / Math.abs(first)) * 100;
}

/**
 * Rolling relative variability of a series — how unpredictable it has been
 * lately, rather than how much of it there is. This is the quantity a
 * predictive organism would actually be up against, and it is not otherwise
 * anywhere in the telemetry.
 */
function volatility(v: Float32Array, n: number, out: Float32Array, window = 8): void {
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - window + 1);
    let mean = 0;
    let count = 0;
    for (let j = lo; j <= i; j++) {
      mean += v[j];
      count++;
    }
    mean /= count;
    let varr = 0;
    for (let j = lo; j <= i; j++) varr += (v[j] - mean) * (v[j] - mean);
    varr /= count;
    out[i] = mean > 1e-6 ? Math.sqrt(varr) / mean : 0;
  }
}

/**
 * Look for associations between the environment and the population's cognition.
 *
 * Nothing here decides that anything evolved, or why. It reports which pairs of
 * measured series moved together, how strongly, and over how many samples —
 * and then says in plain terms that this is a correlation over one run of one
 * world, which is not a result.
 */
export function analyseCognition(
  series: Record<SeriesKey, Float32Array>,
  length: number,
): CognitionReport {
  const empty: CognitionReport = {
    associations: [],
    observations: [],
    hypothesis: '',
    nextStep: '',
    samples: length,
  };
  if (length < MIN_SAMPLES) {
    empty.observations = [
      `Only ${length} telemetry samples so far. Nothing is reported below ${MIN_SAMPLES} — a correlation over a handful of points is noise with a number attached.`,
    ];
    return empty;
  }

  const vol = new Float32Array(length);
  volatility(series.vegetation, length, vol);

  const associations: CognitiveAssociation[] = [];
  for (const d of DRIVERS) {
    const dv = d.key === 'foodVolatility' ? vol : series[d.key];
    if (!dv) continue;
    const dChange = endpointChange(dv, length);
    for (const r of RESPONSES) {
      const rv = series[r.key];
      if (!rv) continue;
      const c = pearson(dv, rv, length);
      if (Math.abs(c) < MIN_CORRELATION) continue;
      associations.push({
        driver: d.key,
        driverLabel: d.label,
        response: r.key,
        responseLabel: r.label,
        correlation: c,
        driverChange: dChange,
        responseChange: endpointChange(rv, length),
        samples: length,
      });
    }
  }
  associations.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

  const observations: string[] = [];
  for (const a of associations.slice(0, 6)) {
    observations.push(
      `${a.driverLabel} ${fmtChange(a.driverChange)} while ${a.responseLabel.toLowerCase()} ${fmtChange(a.responseChange)} (r = ${a.correlation.toFixed(2)}, n = ${a.samples}).`,
    );
  }

  let hypothesis =
    'No association passed the reporting threshold. On this run, nothing the environment did moved together with anything cognitive strongly enough to be worth a second look.';
  let nextStep =
    'Run longer, or fork the world and change one environmental factor deliberately — a correlation that does not exist yet cannot be tested.';

  const top = associations[0];
  if (top) {
    hypothesis =
      `${top.driverLabel} and ${top.responseLabel.toLowerCase()} moved together over this run (r = ${top.correlation.toFixed(2)} across ${top.samples} samples). ` +
      `One reading is that ${top.correlation > 0 ? 'more' : 'less'} of the first made the second worth its cost. ` +
      'That is a reading and not a finding: these two series were measured in the same world at the same time, which is exactly the situation in which two unrelated quantities drift together.';
    nextStep =
      `Fork this world and run arms that differ only in ${top.driverLabel.toLowerCase()}, with replicates. ` +
      `If ${top.responseLabel.toLowerCase()} diverges between arms by more than the spread across replicates, that is evidence. This panel is not.`;
  }

  return { associations, observations, hypothesis, nextStep, samples: length };
}

function fmtChange(pct: number): string {
  if (Math.abs(pct) < 2) return 'held roughly steady';
  return `${pct > 0 ? 'rose' : 'fell'} ${Math.abs(pct).toFixed(0)}%`;
}
