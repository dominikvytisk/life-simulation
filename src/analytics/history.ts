/**
 * Fixed-size ring buffers of time series. Sampled every N ticks, never grows,
 * so a run that lasts all day costs the same memory as one that just started.
 */
export const SERIES_KEYS = [
  'population',
  'species',
  'births',
  'deaths',
  'avgEnergy',
  'avgAge',
  'avgLifespan',
  'avgBrainSize',
  'avgSpeed',
  'avgSize',
  'avgVision',
  'diversity',
  'carnivory',
  'vegetation',
  'carrion',
  'temperature',
  'predationRate',
  'avgGeneration',
  'avgPlasticity',
  'signalActivity',
  'avgMemory',
  'groupSize',
  'broadcast',
  'calls',
  'vocalDiversity',
  'dialects',
  'imitation',
  'transmission',
  'sharing',
] as const;

export type SeriesKey = (typeof SERIES_KEYS)[number];

export class History {
  readonly capacity: number;
  readonly series: Record<SeriesKey, Float32Array>;
  readonly ticks: Float64Array;
  length = 0;
  head = 0;

  constructor(capacity = 1024) {
    this.capacity = capacity;
    this.ticks = new Float64Array(capacity);
    this.series = {} as Record<SeriesKey, Float32Array>;
    for (const k of SERIES_KEYS) this.series[k] = new Float32Array(capacity);
  }

  push(tick: number, values: Record<SeriesKey, number>): void {
    const i = this.head;
    this.ticks[i] = tick;
    for (const k of SERIES_KEYS) this.series[k][i] = values[k];
    this.head = (this.head + 1) % this.capacity;
    if (this.length < this.capacity) this.length++;
  }

  /** Chronological copy, oldest first — what the charts consume. */
  toChrono(): { ticks: Float64Array; series: Record<SeriesKey, Float32Array> } {
    const n = this.length;
    const start = (this.head - n + this.capacity) % this.capacity;
    const ticks = new Float64Array(n);
    const series = {} as Record<SeriesKey, Float32Array>;
    for (const k of SERIES_KEYS) series[k] = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const j = (start + i) % this.capacity;
      ticks[i] = this.ticks[j];
      for (const k of SERIES_KEYS) series[k][i] = this.series[k][j];
    }
    return { ticks, series };
  }

  clear(): void {
    this.length = 0;
    this.head = 0;
  }
}
