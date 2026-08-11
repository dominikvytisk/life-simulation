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
      callsPerTick: number;
      vocalDiversity: number;
      sequenceStructure: number;
      turnTaking: number;
      vocalConvergence: number;
      dialectDivergence: number;
      callGenerationSpan: number;
      signalCoupling: number;
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

    // ---- acoustic firsts ----
    // Each of these is a threshold on something measured, and each can simply
    // never fire. A silent world produces none of them, which is a result.
    this.candidate(
      'first-vocalisation',
      m.callsPerTick > 0.02,
      6,
      () => ({
        label: 'Sound is being produced',
        generation: m.generation,
        evidence: `${m.callsPerTick.toFixed(3)} completed vocalisations per tick, paid for in energy`,
      }),
      tick,
      log,
    );

    this.candidate(
      'first-repeated-calls',
      m.vocalDiversity > 0.5,
      6,
      () => ({
        label: 'Repeated acoustic patterns',
        generation: m.generation,
        evidence: `calls fall into recurring shapes, ${m.vocalDiversity.toFixed(2)} bits of repertoire entropy`,
      }),
      tick,
      log,
    );

    // Two separate claims, deliberately. The first is cheap and says only that
    // calling tracks the caller's state — a groan would satisfy it. The second
    // needs the circumstance *and* the listeners' behaviour to line up at once
    // on the same shape, which is a great deal harder and is what would have to
    // be true for a sound to be doing any work.
    this.candidate(
      'first-distinctive-call',
      m.signalMeaningConfidence > 1 && m.callsPerTick > 0.02,
      8,
      () => ({
        label: 'A call shape stands out statistically',
        generation: m.generation,
        evidence: `standardised difference d=${m.signalMeaningConfidence.toFixed(2)} against the population on one side or the other — either the circumstances the shape is used in or what listeners do next, but not necessarily both`,
      }),
      tick,
      log,
    );

    this.candidate(
      'first-communication',
      m.signalCoupling > 0.6 && m.callsPerTick > 0.02,
      10,
      () => ({
        label: 'A call shape is used distinctively and answered distinctively',
        generation: m.generation,
        evidence: `both sides hold at once on the same shape, weaker side d=${m.signalCoupling.toFixed(2)}, sustained over 10 samples — still a correlation, and still not a demonstration that the sound caused the response`,
      }),
      tick,
      log,
    );

    this.candidate(
      'first-turn-taking',
      m.turnTaking > 0.12,
      8,
      () => ({
        label: 'Calls follow calls',
        generation: m.generation,
        evidence: `vocalising after hearing runs ${(m.turnTaking * 100).toFixed(0)} points above the rate of simply having heard something`,
      }),
      tick,
      log,
    );

    this.candidate(
      'first-vocal-imitation',
      m.vocalConvergence > 0.03,
      8,
      () => ({
        label: 'Replies resemble what they answer',
        generation: m.generation,
        evidence: `answering calls sit ${m.vocalConvergence.toFixed(3)} closer in acoustic space than unrelated calls do`,
      }),
      tick,
      log,
    );

    this.candidate(
      'first-sequence',
      m.sequenceStructure > 0.25,
      8,
      () => ({
        label: 'Calls come in non-random order',
        generation: m.generation,
        evidence: `${m.sequenceStructure.toFixed(2)} bits of mutual information between one call and the next`,
      }),
      tick,
      log,
    );

    this.candidate(
      'first-dialect',
      m.dialectDivergence > 0.25,
      10,
      () => ({
        label: 'Regional repertoires diverge',
        generation: m.generation,
        evidence: `mean Jensen-Shannon divergence ${m.dialectDivergence.toFixed(2)} bits between parts of the map`,
      }),
      tick,
      log,
    );

    this.candidate(
      'first-inherited-convention',
      m.callGenerationSpan > 6,
      6,
      () => ({
        label: 'A call outlives its generation',
        generation: m.generation,
        evidence: `one call shape has been in continuous use across ${m.callGenerationSpan.toFixed(0)} generations`,
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
    this.checkSeries('calls per tick', m.callsPerTick, tick, log);
    this.checkSeries('vocal diversity', m.vocalDiversity, tick, log);
    this.checkSeries('dialect divergence', m.dialectDivergence, tick, log);
    this.checkSeries('signal coupling', m.signalCoupling, tick, log);
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
