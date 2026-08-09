import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { Rng } from './core/rng';
import { encodeMemory, recallInto, makeRecall, ENCODE_THRESHOLD } from './memory/memory';
import { MAX_MEMORY, expressInto, makePhenotype } from './genome/phenotype';
import { SignalAnalyzer, CONTEXT_COUNT, RESPONSE_COUNT } from './analysis/signals';
import { Chronicle } from './analysis/chronicle';
import { EventLog } from './events/eventLog';
import { SIGNAL_CHANNELS, PLASTIC_STRIDE, imitate } from './brain/brain';
import { GENOME_LENGTH, LOCUS_CATEGORY, Locus, makeMutationTally } from './genome/loci';
import { mutateGenome, inheritKinTags, randomKinTags } from './evolution/reproduction';
import { KIN_TAG_LENGTH } from './organisms/population';
import { DEFAULT_CONFIG } from './core/config';

const small = { worldSize: 1024, gridSize: 64, initialPopulation: 250, maxPopulation: 3000 };

function makeMem() {
  return {
    x: new Float32Array(MAX_MEMORY),
    y: new Float32Array(MAX_MEMORY),
    v: new Float32Array(MAX_MEMORY),
    s: new Float32Array(MAX_MEMORY),
  };
}

describe('episodic memory', () => {
  it('ignores experiences too weak to be worth a slot', () => {
    const m = makeMem();
    encodeMemory(m.x, m.y, m.v, m.s, 0, 4, 100, 100, ENCODE_THRESHOLD * 0.5);
    expect(m.s[0]).toBe(0);
  });

  it('stores a strong experience and recalls it at that place', () => {
    const m = makeMem();
    encodeMemory(m.x, m.y, m.v, m.s, 0, 4, 100, 100, 1);
    const r = makeRecall();
    recallInto(m.x, m.y, m.v, m.s, 0, 4, 100, 100, 0, r);
    expect(r.valueHere).toBeGreaterThan(0.5);
    expect(r.load).toBeGreaterThan(0);
  });

  it('points toward good places and away from bad ones', () => {
    const m = makeMem();
    encodeMemory(m.x, m.y, m.v, m.s, 0, 4, 200, 100, 1); // good, to the east
    encodeMemory(m.x, m.y, m.v, m.s, 0, 4, 100, 200, -1); // bad, to the south
    const r = makeRecall();
    recallInto(m.x, m.y, m.v, m.s, 0, 4, 100, 100, 0, r);
    expect(r.bestDX).toBeGreaterThan(0.9);
    expect(r.worstDY).toBeGreaterThan(0.9);
  });

  it('merges repeated experiences at the same place instead of filling up', () => {
    const m = makeMem();
    for (let i = 0; i < 20; i++) encodeMemory(m.x, m.y, m.v, m.s, 0, 4, 100, 100, 1);
    let used = 0;
    for (let s = 0; s < 4; s++) if (m.s[s] > 0) used++;
    expect(used).toBe(1);
  });

  it('displaces the weakest memory only when the new one is stronger', () => {
    const m = makeMem();
    // Fill two slots with widely separated, strong memories.
    encodeMemory(m.x, m.y, m.v, m.s, 0, 2, 0, 0, 1.4);
    encodeMemory(m.x, m.y, m.v, m.s, 0, 2, 900, 900, 1.4);
    // A weak new experience elsewhere must not evict either of them.
    encodeMemory(m.x, m.y, m.v, m.s, 0, 2, 400, 400, 0.4);
    expect(m.v[0]).toBeCloseTo(1.4, 3);
    expect(m.v[1]).toBeCloseTo(1.4, 3);
  });

  it('forgets over time at the genetic decay rate', () => {
    const m = makeMem();
    encodeMemory(m.x, m.y, m.v, m.s, 0, 4, 100, 100, 1);
    const r = makeRecall();
    for (let t = 0; t < 60; t++) recallInto(m.x, m.y, m.v, m.s, 0, 4, 500, 500, 0.02, r);
    expect(m.s[0]).toBeLessThan(0.2);
    // A persistent lineage keeps the same memory far longer.
    const m2 = makeMem();
    encodeMemory(m2.x, m2.y, m2.v, m2.s, 0, 4, 100, 100, 1);
    for (let t = 0; t < 60; t++) recallInto(m2.x, m2.y, m2.v, m2.s, 0, 4, 500, 500, 0.0004, r);
    expect(m2.s[0]).toBeGreaterThan(0.9);
  });

  it('an organism with zero slots remembers nothing and pays nothing', () => {
    const m = makeMem();
    encodeMemory(m.x, m.y, m.v, m.s, 0, 0, 100, 100, 1);
    const r = makeRecall();
    recallInto(m.x, m.y, m.v, m.s, 0, 0, 100, 100, 0, r);
    expect(r.valueHere).toBe(0);
    expect(r.load).toBe(0);
  });

  it('costs upkeep, so memory is never free', () => {
    const base = new Float32Array(GENOME_LENGTH).fill(0.5);
    base[Locus.MemoryCapacity] = 0;
    const rich = Float32Array.from(base);
    rich[Locus.MemoryCapacity] = 1;
    const a = expressInto(makePhenotype(), base, 0).upkeep;
    const b = expressInto(makePhenotype(), rich, 0).upkeep;
    expect(b).toBeGreaterThan(a);
  });
});

describe('kin markers', () => {
  it('an organism is fully related to itself', () => {
    const sim = new Simulation({ ...small, seed: 60 });
    expect(sim.pop.relatedness(0, 0)).toBe(1);
  });

  it('offspring share markers with parents; strangers mostly do not', () => {
    const rng = new Rng(61);
    const a = new Float32Array(KIN_TAG_LENGTH);
    const b = new Float32Array(KIN_TAG_LENGTH);
    const child = new Float32Array(KIN_TAG_LENGTH);
    randomKinTags(a, 0, rng);
    randomKinTags(b, 0, rng);

    let kinShared = 0;
    let strangerShared = 0;
    const trials = 200;
    for (let t = 0; t < trials; t++) {
      inheritKinTags(child, 0, a, 0, b, 0, rng, 0);
      for (let i = 0; i < KIN_TAG_LENGTH; i++) {
        if (Math.abs(child[i] - a[i]) < 1e-4) kinShared++;
        const stranger = new Float32Array(KIN_TAG_LENGTH);
        randomKinTags(stranger, 0, rng);
        if (Math.abs(child[i] - stranger[i]) < 1e-4) strangerShared++;
      }
    }
    // Every marker comes from one parent or the other, so ~half match parent A.
    expect(kinShared / (trials * KIN_TAG_LENGTH)).toBeGreaterThan(0.35);
    expect(strangerShared / (trials * KIN_TAG_LENGTH)).toBeLessThan(0.01);
  });

  it('inherits Mendelian, not blended — markers keep discrete values', () => {
    const rng = new Rng(62);
    const a = new Float32Array(KIN_TAG_LENGTH).fill(0);
    const b = new Float32Array(KIN_TAG_LENGTH).fill(1);
    const child = new Float32Array(KIN_TAG_LENGTH);
    inheritKinTags(child, 0, a, 0, b, 0, rng, 0);
    for (let i = 0; i < KIN_TAG_LENGTH; i++) {
      // Blending would produce 0.5 here and destroy the kin signal in a few
      // generations. Every marker must still be one parent's exact value.
      expect(child[i] === 0 || child[i] === 1).toBe(true);
    }
  });
});

describe('mutation categories', () => {
  it('classifies every locus and tallies what was hit', () => {
    expect(LOCUS_CATEGORY.length).toBe(GENOME_LENGTH);
    const rng = new Rng(63);
    const g = new Float32Array(GENOME_LENGTH).fill(0.5);
    const tally = makeMutationTally();
    const cfg = { ...DEFAULT_CONFIG, baseMutationRate: 1 };
    for (let t = 0; t < 40; t++) mutateGenome(g, 0, cfg, rng, 1, tally);
    const total = tally.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
    // Every category the genome actually contains should get hit at this rate.
    expect(tally.filter((c) => c > 0).length).toBeGreaterThanOrEqual(4);
  });
});

describe('social learning', () => {
  it('moves the learner toward the model without touching the model', () => {
    const plastic = new Float32Array(PLASTIC_STRIDE * 2);
    plastic.fill(1, PLASTIC_STRIDE, PLASTIC_STRIDE * 2);
    const moved = imitate(plastic, 0, PLASTIC_STRIDE, 0.5);
    expect(moved).toBeGreaterThan(0);
    expect(plastic[0]).toBeCloseTo(0.5, 5);
    // The model is unchanged — teaching costs the teacher nothing directly.
    expect(plastic[PLASTIC_STRIDE]).toBe(1);
  });

  it('copies only the soma, never the germline', () => {
    const sim = new Simulation({ ...small, seed: 64 });
    const brainBefore = sim.pop.brain.slice(0, 200);
    for (let t = 0; t < 200; t++) sim.step();
    // Inherited weights change only through reproduction, so the founders'
    // brains must be untouched by whatever imitation happened around them.
    let founderUnchanged = true;
    for (let i = 0; i < 200; i++) {
      if (sim.pop.alive[0] && sim.pop.birthTick[0] === 0 && brainBefore[i] !== sim.pop.brain[i]) {
        founderUnchanged = false;
        break;
      }
    }
    expect(founderUnchanged).toBe(true);
  });
});

describe('signal analyzer', () => {
  it('reports nothing until it has enough observations', () => {
    const a = new SignalAnalyzer();
    const emit = new Float32Array(SIGNAL_CHANNELS);
    const ctx = new Float32Array(CONTEXT_COUNT);
    const heard = new Float32Array(SIGNAL_CHANNELS);
    const resp = new Float32Array(RESPONSE_COUNT);
    for (let i = 0; i < 50; i++) a.observe(emit, 0, ctx, heard, resp);
    expect(a.meanings()).toHaveLength(0);
  });

  it('finds a correlation that is really there and not one that is not', () => {
    const a = new SignalAnalyzer();
    const emit = new Float32Array(SIGNAL_CHANNELS);
    const ctx = new Float32Array(CONTEXT_COUNT);
    const heard = new Float32Array(SIGNAL_CHANNELS);
    const resp = new Float32Array(RESPONSE_COUNT);
    const rng = new Rng(65);

    for (let i = 0; i < 3000; i++) {
      const danger = rng.next();
      ctx.fill(0);
      ctx[2] = danger; // "predator near"
      emit.fill(0);
      emit[3] = danger * 0.9 + rng.next() * 0.1; // channel 3 tracks danger
      emit[5] = rng.next(); // channel 5 is pure noise
      heard.fill(0);
      heard[3] = danger;
      resp.fill(0);
      resp[0] = danger * 0.8 + rng.next() * 0.2; // listeners move when they hear it
      a.observe(emit, 0, ctx, heard, resp);
    }

    const meanings = a.meanings();
    const ch3 = meanings.find((m) => m.channel === 3)!;
    const ch5 = meanings.find((m) => m.channel === 5)!;
    expect(ch3.emitterContext[0].label).toBe('predator near');
    expect(ch3.emitterContext[0].r).toBeGreaterThan(0.7);
    expect(ch3.listenerResponse[0].label).toBe('move');
    // The noise channel must not be credited with meaning.
    expect(ch5.confidence).toBeLessThan(0.2);
  });
});

describe('chronicle', () => {
  it('does not fire a milestone from a single sample', () => {
    const c = new Chronicle();
    const log = new EventLog();
    c.update(0, log, baseMetrics({ imitationsPerTick: 5 }));
    expect(c.getMilestones()).toHaveLength(0);
  });

  it('fires once the condition persists, and only once', () => {
    const c = new Chronicle();
    const log = new EventLog();
    for (let i = 0; i < 20; i++) c.update(i * 20, log, baseMetrics({ imitationsPerTick: 5 }));
    const imitation = c.getMilestones().filter((m) => m.id === 'first-social-learning');
    expect(imitation).toHaveLength(1);
    expect(imitation[0].evidence).toContain('5.000');
  });

  it('never invents a milestone for something that did not happen', () => {
    const c = new Chronicle();
    const log = new EventLog();
    for (let i = 0; i < 50; i++) c.update(i * 20, log, baseMetrics({}));
    const ids = c.getMilestones().map((m) => m.id);
    expect(ids).not.toContain('first-communication');
    expect(ids).not.toContain('first-culture');
    expect(ids).not.toContain('first-social-learning');
  });

  it('flags a sustained departure from a series baseline', () => {
    const c = new Chronicle();
    const log = new EventLog();
    // Establish a stable baseline with a little natural variation.
    const rng = new Rng(66);
    for (let i = 0; i < 60; i++) {
      c.update(i * 20, log, baseMetrics({ population: 1000 + rng.normal(0, 10) }));
    }
    expect(c.getAnomalies()).toHaveLength(0);
    for (let i = 0; i < 6; i++) {
      c.update((60 + i) * 20, log, baseMetrics({ population: 3000 }));
    }
    const anomalies = c.getAnomalies();
    expect(anomalies.length).toBeGreaterThan(0);
    expect(anomalies[0].series).toBe('population');
    expect(anomalies[0].direction).toBe('above');
  });
});

function baseMetrics(over: Partial<Parameters<Chronicle['update']>[2]>) {
  return {
    population: 1000,
    species: 1,
    generation: 5,
    killsPerTick: 0,
    carnivory: 0.1,
    signalActivity: 0,
    signalMeaningConfidence: 0,
    transmissionIndex: 0,
    imitationsPerTick: 0,
    posthumousMemes: 0,
    meanMemory: 0,
    meanGroupSize: 0,
    sharingPerTick: 0,
    brainSize: 8,
    diversity: 0.2,
    extinctionsInWindow: 0,
    speciesLostFraction: 0,
    ...over,
  };
}

describe('forking', () => {
  it('a fork with no changes continues identically to its parent', () => {
    const parent = new Simulation({ ...small, seed: 70 });
    for (let t = 0; t < 300; t++) parent.step();
    const payload = parent.serialize();

    const fork = new Simulation({ ...small, seed: 70 });
    fork.restore(payload as Record<string, any>);

    // This is what makes an experiment's control arm a real control: the fork
    // must not merely start similar, it must stay bit-identical while nothing
    // is changed. Free-list order is part of that — it drives slot reuse, which
    // drives iteration order, which drives the RNG stream.
    for (let t = 0; t < 200; t++) {
      parent.step();
      fork.step();
    }
    expect(fork.pop.livingCount).toBe(parent.pop.livingCount);
    expect(fork.totalBirths).toBe(parent.totalBirths);
    expect(fork.totalDeaths).toBe(parent.totalDeaths);
    let checked = 0;
    for (let i = 0; i < parent.pop.count; i++) {
      if (!parent.pop.alive[i]) continue;
      expect(fork.pop.alive[i]).toBe(1);
      expect(fork.pop.x[i]).toBe(parent.pop.x[i]);
      expect(fork.pop.energy[i]).toBe(parent.pop.energy[i]);
      expect(fork.pop.id[i]).toBe(parent.pop.id[i]);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('a fork with a changed parameter diverges from its parent', () => {
    const parent = new Simulation({ ...small, seed: 71 });
    for (let t = 0; t < 300; t++) parent.step();
    const payload = parent.serialize();

    const fork = new Simulation({ ...small, seed: 71 });
    fork.restore(payload as Record<string, any>);
    fork.cfg.vegetationGrowthRate = 0.001;

    for (let t = 0; t < 200; t++) {
      parent.step();
      fork.step();
    }
    // Compare state rather than headcount: two collapsing worlds can pass
    // through the same population number while being nothing alike.
    const print = (s: Simulation) => {
      let h = 0;
      for (let i = 0; i < s.pop.count; i++) {
        if (s.pop.alive[i]) h += s.pop.x[i] * (i + 1) + s.pop.energy[i];
      }
      return h.toFixed(3);
    };
    expect(print(fork)).not.toBe(print(parent));
  });
});
