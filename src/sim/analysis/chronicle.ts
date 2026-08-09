/**
 * The chronicle: derived history and anomaly detection.
 *
 * Two jobs, both strictly data-driven.
 *
 * FIRSTS — the first time a measurable threshold is crossed and *stays*
 * crossed. Requiring persistence is what separates "a signal channel twitched
 * once" from "this population communicates". Every first records the numbers
 * that triggered it, so the claim can be checked.
 *
 * ANOMALIES — rolling mean and variance over each telemetry series; a reading
 * more than `Z_THRESHOLD` standard deviations from its own recent history, held
 * for several samples, is reported with its actual z-score.
 *
 * Nothing in here is allowed to invent an event. If the population never
 * develops communication, no communication milestone is ever emitted.
 */
import { EventKind, type EventLog } from '../events/eventLog';

const Z_THRESHOLD = 3.2;
/** Samples an anomaly must persist for before it is worth reporting. */
const PERSISTENCE = 3;
/** Do not test a series until its baseline is this well established. */
const MIN_HISTORY = 24;
/** Re-arm delay so one long excursion is not reported over and over. */
const COOLDOWN_SAMPLES = 40;

export interface Milestone {
  id: string;
  label: string;
  tick: number;
  generation: number;
  evidence: string;
}

interface SeriesState {
  mean: number;
  m2: number;
  n: number;
  streak: number;
  streakSign: number;
  cooldown: number;
}

export interface AnomalyReport {
  series: string;
  z: number;
  value: number;
  expected: number;
  tick: number;
  direction: 'above' | 'below';
}

export class Chronicle {
  private series = new Map<string, SeriesState>();
  private milestones: Milestone[] = [];
  private fired = new Set<string>();
  private pending = new Map<string, number>();
  private anomalies: AnomalyReport[] = [];

  /**
   * Test a candidate milestone. It only fires once its condition has held for
   * `holdSamples` consecutive checks — a threshold brushed for one sample is
   * noise, not a first.
   */
  private candidate(
    id: string,
    condition: boolean,
    holdSamples: number,
    build: () => Omit<Milestone, 'id' | 'tick'>,
    tick: number,
    log: EventLog,
  ): void {
    if (this.fired.has(id)) return;
    if (!condition) {
      this.pending.set(id, 0);
      return;
    }
    const held = (this.pending.get(id) ?? 0) + 1;
    this.pending.set(id, held);
    if (held < holdSamples) return;

    this.fired.add(id);
    const { label, generation, evidence } = build();
    const m: Milestone = { id, label, tick, generation, evidence };
    this.milestones.push(m);
    log.push({
      tick,
      kind: EventKind.Milestone,
      text: `${label} — ${evidence}`,
    });
  }

  /** Feed the current telemetry snapshot. Called on the stats interval. */
  update(
    tick: number,
    log: EventLog,
    m: {
      population: number;
      species: number;
      generation: number;
      killsPerTick: number;
      carnivory: number;
      signalActivity: number;
      signalMeaningConfidence: number;
      transmissionIndex: number;
      imitationsPerTick: number;
      posthumousMemes: number;
      meanMemory: number;
      meanGroupSize: number;
      sharingPerTick: number;
      brainSize: number;
      diversity: number;
      extinctionsInWindow: number;
      speciesLostFraction: number;
    },
  ): void {
    // ---- firsts ----
    this.candidate(
      'first-speciation',
      m.species > 1,
      1,
      () => ({
        label: 'First speciation',
        generation: m.generation,
        evidence: `${m.species} distinct species now coexist`,
      }),
      tick,
      log,
    );

    this.candidate(
      'first-predation',
      m.killsPerTick > 0.05 && m.carnivory > 0.25,
      4,
      () => ({
        label: 'Predation established',
        generation: m.generation,
        evidence: `${m.killsPerTick.toFixed(3)} kills/tick sustained, mean gut ${m.carnivory.toFixed(2)} toward meat`,
      }),
      tick,
      log,
    );

    this.candidate(
      'first-communication',
      m.signalMeaningConfidence > 0.25 && m.signalActivity > 0.05,
      6,
      () => ({
        label: 'Signals carry information',
        generation: m.generation,
        evidence: `strongest channel correlation r=${m.signalMeaningConfidence.toFixed(2)} sustained over 6 samples`,
      }),
      tick,
      log,
    );

    this.candidate(
      'first-memory',
      m.meanMemory > 2.5,
      6,
      () => ({
        label: 'Memory becomes standard',
        generation: m.generation,
        evidence: `mean ${m.meanMemory.toFixed(1)} episodic slots per organism, paid for in upkeep`,
      }),
      tick,
      log,
    );

    this.candidate(
      'first-social-learning',
      m.imitationsPerTick > 0.02,
      4,
      () => ({
        label: 'Imitation appears',
        generation: m.generation,
        evidence: `${m.imitationsPerTick.toFixed(3)} imitation events per tick`,
      }),
      tick,
      log,
    );

    this.candidate(
      'first-culture',
      m.transmissionIndex > 0.05 && m.posthumousMemes > 0,
      5,
      () => ({
        label: 'Behaviour outlives its originator',
        generation: m.generation,
        evidence: `${m.posthumousMemes} learned patterns still carried after their originator died; neighbour soma excess ${m.transmissionIndex.toFixed(3)} beyond what relatedness explains`,
      }),
      tick,
      log,
    );

    this.candidate(
      'first-grouping',
      m.meanGroupSize > 5,
      6,
      () => ({
        label: 'Persistent grouping',
        generation: m.generation,
        evidence: `mean ${m.meanGroupSize.toFixed(1)} neighbours within perception, sustained`,
      }),
      tick,
      log,
    );

    this.candidate(
      'first-sharing',
      m.sharingPerTick > 0.01,
      4,
      () => ({
        label: 'Energy transfer between organisms',
        generation: m.generation,
        evidence: `${m.sharingPerTick.toFixed(3)} transfers per tick`,
      }),
      tick,
      log,
    );

    if (m.speciesLostFraction > 0.4 && m.species > 0) {
      const id = `mass-extinction-${Math.floor(tick / 5000)}`;
      this.candidate(
        id,
        true,
        1,
        () => ({
          label: 'Mass extinction',
          generation: m.generation,
          evidence: `${(m.speciesLostFraction * 100).toFixed(0)}% of living species lost in one window`,
        }),
        tick,
        log,
      );
    }

    // ---- anomalies ----
    this.checkSeries('population', m.population, tick, log);
    this.checkSeries('brain size', m.brainSize, tick, log);
    this.checkSeries('genetic diversity', m.diversity, tick, log);
    this.checkSeries('predation rate', m.killsPerTick, tick, log);
    this.checkSeries('carnivory', m.carnivory, tick, log);
    this.checkSeries('group size', m.meanGroupSize, tick, log);
    this.checkSeries('signal activity', m.signalActivity, tick, log);
  }

  /** Welford running statistics plus a persistence-gated z-test. */
  private checkSeries(name: string, value: number, tick: number, log: EventLog): void {
    let s = this.series.get(name);
    if (!s) {
      s = { mean: value, m2: 0, n: 1, streak: 0, streakSign: 0, cooldown: 0 };
      this.series.set(name, s);
      return;
    }
    if (!Number.isFinite(value)) return;

    const sd = s.n > 1 ? Math.sqrt(s.m2 / (s.n - 1)) : 0;
    const z = sd > 1e-6 ? (value - s.mean) / sd : 0;

    if (s.cooldown > 0) s.cooldown--;

    if (s.n >= MIN_HISTORY && Math.abs(z) > Z_THRESHOLD && s.cooldown === 0) {
      const sign = Math.sign(z);
      s.streak = sign === s.streakSign ? s.streak + 1 : 1;
      s.streakSign = sign;
      if (s.streak >= PERSISTENCE) {
        const report: AnomalyReport = {
          series: name,
          z,
          value,
          expected: s.mean,
          tick,
          direction: z > 0 ? 'above' : 'below',
        };
        this.anomalies.push(report);
        if (this.anomalies.length > 200) this.anomalies.shift();
        log.push({
          tick,
          kind: EventKind.Anomaly,
          text: `${name} ${report.direction} its own baseline: ${fmt(value)} vs expected ${fmt(s.mean)} (z=${z.toFixed(1)})`,
        });
        s.streak = 0;
        s.cooldown = COOLDOWN_SAMPLES;
      }
    } else {
      s.streak = 0;
      s.streakSign = 0;
    }

    // Update the baseline after testing, so a reading is compared against the
    // history that preceded it rather than one it has already contaminated.
    s.n++;
    const delta = value - s.mean;
    s.mean += delta / s.n;
    s.m2 += delta * (value - s.mean);
    // Bound the window so the baseline can drift with a changing world.
    if (s.n > 400) {
      s.n = 400;
      s.m2 *= 0.995;
    }
  }

  getMilestones(): Milestone[] {
    return this.milestones;
  }

  getAnomalies(limit = 40): AnomalyReport[] {
    return this.anomalies.slice(-limit).reverse();
  }

  reset(): void {
    this.series.clear();
    this.milestones = [];
    this.fired.clear();
    this.pending.clear();
    this.anomalies = [];
  }
}

function fmt(v: number): string {
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 1) return v.toFixed(2);
  return v.toFixed(4);
}
