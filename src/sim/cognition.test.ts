import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { Rng } from './core/rng';
import { encodeMemory, recallInto, makeRecall, ENCODE_THRESHOLD } from './memory/memory';
import { MAX_MEMORY, expressInto, makePhenotype } from './genome/phenotype';
import { AcousticAnalyzer, ASSOCIATION_THRESHOLD } from './analysis/acoustics';
import { CALL_CONTEXT_DIM, RESPONSE_DIM, Response } from './acoustics/context';
import {
  CALL_DIM,
  Call,
  bandFromGenes,
  callDistance,
  hzToPitch,
  pitchToHz,
  attenuation,
  bandResponse,
  MAX_PROTOTYPES,
} from './acoustics/sound';
import { creditTrace, recognise } from './acoustics/association';
import { Chronicle } from './analysis/chronicle';
import { EventLog } from './events/eventLog';
import { PLASTIC_STRIDE, imitate } from './brain/brain';
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

describe('acoustic representation', () => {
  it('maps pitch to hertz logarithmically and back again', () => {
    for (const hz of [80, 220, 440, 1000, 4000]) {
      expect(pitchToHz(hzToPitch(hz))).toBeCloseTo(hz, 0);
    }
    // Equal ratios are equal distances, which is what makes the space a
    // perceptual one rather than a linear one.
    const octaveLow = hzToPitch(400) - hzToPitch(200);
    const octaveHigh = hzToPitch(3200) - hzToPitch(1600);
    expect(octaveLow).toBeCloseTo(octaveHigh, 5);
  });

  it('turns two unordered genes into a band with a floor on its width', () => {
    const a = bandFromGenes(0.7, 0.2);
    expect(a.low).toBeCloseTo(0.2, 6);
    expect(a.high).toBeCloseTo(0.7, 6);
    const narrow = bandFromGenes(0.5, 0.5);
    expect(narrow.high - narrow.low).toBeGreaterThan(0.05);
    const clipped = bandFromGenes(0, 0);
    expect(clipped.low).toBeGreaterThanOrEqual(0);
    expect(clipped.high).toBeLessThanOrEqual(1);
  });

  it('attenuates high sounds faster than low ones over the same distance', () => {
    const low = attenuation(200, 0.05, 55, 0.006, 0.013);
    const high = attenuation(200, 0.95, 55, 0.006, 0.013);
    expect(low).toBeGreaterThan(high * 2);
    // And both fall off with distance.
    expect(attenuation(400, 0.5, 55, 0.006, 0.013)).toBeLessThan(
      attenuation(100, 0.5, 55, 0.006, 0.013),
    );
  });

  it('rolls off sound outside the listener band', () => {
    expect(bandResponse(0.5, 0.3, 0.7)).toBe(1);
    expect(bandResponse(0.9, 0.3, 0.7)).toBeLessThan(0.15);
    expect(bandResponse(0.1, 0.3, 0.7)).toBeLessThan(0.15);
  });
});

describe('auditory associative memory', () => {
  const makeMemory = () => ({
    proto: new Float32Array(MAX_PROTOTYPES * CALL_DIM),
    valence: new Float32Array(MAX_PROTOTYPES),
    strength: new Float32Array(MAX_PROTOTYPES),
    trace: new Float32Array(MAX_PROTOTYPES),
  });

  const call = (pitch: number) => {
    const d = new Float32Array(CALL_DIM);
    d[Call.Pitch] = pitch;
    d[Call.Loudness] = 0.5;
    d[Call.Duration] = 0.3;
    return d;
  };

  it('an organism with no auditory memory learns nothing and reports nothing', () => {
    const m = makeMemory();
    const r = recognise(m.proto, 0, m.valence, m.strength, m.trace, 0, 0, call(0.5), 0, 1, 0.1);
    expect(r.index).toBe(-1);
    expect(r.valence).toBe(0);
  });

  // recognise() returns a shared scratch object, so every assertion here reads
  // the fields out immediately rather than holding onto the result.
  const hear = (
    m: ReturnType<typeof makeMemory>,
    pitch: number,
    resolution = 1,
    slots = 4,
  ) => {
    const r = recognise(
      m.proto, 0, m.valence, m.strength, m.trace, 0, slots, call(pitch), 0, resolution, 0.2,
    );
    return { index: r.index, novel: r.novel, valence: r.valence, familiarity: r.familiarity };
  };

  it('recognises a sound it has heard before and treats a new one as novel', () => {
    const m = makeMemory();
    const first = hear(m, 0.5);
    expect(first.novel).toBe(true);
    const again = hear(m, 0.5);
    expect(again.novel).toBe(false);
    expect(again.index).toBe(first.index);
    const other = hear(m, 0.05);
    expect(other.index).not.toBe(first.index);
  });

  it('a blunt ear lumps together sounds a sharp ear tells apart', () => {
    // Two calls a third of the frequency range apart: far enough that a sharp
    // ear files them separately, close enough that a blunt one cannot.
    const sharp = makeMemory();
    hear(sharp, 0.5, 1);
    expect(hear(sharp, 0.85, 1).novel).toBe(true);

    const blunt = makeMemory();
    hear(blunt, 0.5, 0);
    expect(hear(blunt, 0.85, 0).novel).toBe(false);
  });

  it('credits a heard sound with a reward that arrives later, and forgets slowly', () => {
    const m = makeMemory();
    recognise(m.proto, 0, m.valence, m.strength, m.trace, 0, 4, call(0.5), 0, 1, 0.3);
    // Reward twenty ticks after the sound.
    for (let t = 0; t < 20; t++) {
      creditTrace(m.valence, m.trace, m.strength, 0, 4, 0, 0.2, 0.99, 0);
    }
    creditTrace(m.valence, m.trace, m.strength, 0, 4, 1, 0.2, 0.99, 0);
    expect(m.valence[0]).toBeGreaterThan(0.05);

    // A reward five hundred ticks later gets essentially no credit.
    const cold = makeMemory();
    recognise(cold.proto, 0, cold.valence, cold.strength, cold.trace, 0, 4, call(0.5), 0, 1, 0.3);
    for (let t = 0; t < 500; t++) {
      creditTrace(cold.valence, cold.trace, cold.strength, 0, 4, 0, 0.2, 0.99, 0);
    }
    creditTrace(cold.valence, cold.trace, cold.strength, 0, 4, 1, 0.2, 0.99, 0);
    expect(Math.abs(cold.valence[0])).toBeLessThan(0.01);
  });

  it('two organisms with different histories end up disagreeing about the same sound', () => {
    const lucky = makeMemory();
    const unlucky = makeMemory();
    for (let rep = 0; rep < 10; rep++) {
      recognise(lucky.proto, 0, lucky.valence, lucky.strength, lucky.trace, 0, 4, call(0.5), 0, 1, 0.3);
      creditTrace(lucky.valence, lucky.trace, lucky.strength, 0, 4, 1, 0.2, 0.99, 0);
      recognise(unlucky.proto, 0, unlucky.valence, unlucky.strength, unlucky.trace, 0, 4, call(0.5), 0, 1, 0.3);
      creditTrace(unlucky.valence, unlucky.trace, unlucky.strength, 0, 4, -1, 0.2, 0.99, 0);
    }
    expect(lucky.valence[0]).toBeGreaterThan(0.2);
    expect(unlucky.valence[0]).toBeLessThan(-0.2);
  });
});

describe('acoustic analyzer', () => {
  const makeCall = (pitch: number, duration = 0.3) => {
    const d = new Float32Array(CALL_DIM);
    d[Call.Pitch] = pitch;
    d[Call.Loudness] = 0.6;
    d[Call.Duration] = duration;
    return d;
  };

  it('reports nothing until it has seen enough sounds', () => {
    const a = new AcousticAnalyzer();
    const ctx = new Float32Array(CALL_CONTEXT_DIM);
    for (let i = 0; i < 50; i++) {
      a.observeCall(makeCall(0.5), 0, ctx, 0, i, 1, 1, 100, 100, 4096, -1, false, -1);
    }
    expect(a.report().clusters).toHaveLength(0);
  });

  it('finds two distinct call shapes and does not invent a third', () => {
    const a = new AcousticAnalyzer();
    const ctx = new Float32Array(CALL_CONTEXT_DIM);
    const rng = new Rng(71);
    for (let i = 0; i < 800; i++) {
      const pitch = i % 2 === 0 ? 0.2 + rng.normal(0, 0.005) : 0.8 + rng.normal(0, 0.005);
      a.observeCall(makeCall(pitch), 0, ctx, 0, i, 1, 1, 100, 100, 4096, -1, false, -1);
    }
    const clusters = a.report().clusters;
    expect(clusters.length).toBe(2);
    const pitches = clusters.map((c) => c.centroid[0]).sort((x, y) => x - y);
    expect(pitches[0]).toBeCloseTo(0.2, 1);
    expect(pitches[1]).toBeCloseTo(0.8, 1);
  });

  it('finds a context association that is really there and not one that is not', () => {
    const a = new AcousticAnalyzer();
    const ctx = new Float32Array(CALL_CONTEXT_DIM);
    const rng = new Rng(72);
    for (let i = 0; i < 1200; i++) {
      const hungry = i % 2 === 0;
      ctx.fill(0);
      // Feature 0 is "low energy"; feature 4 is unrelated noise.
      ctx[0] = hungry ? 0.9 : 0.1;
      ctx[4] = rng.next();
      const pitch = hungry ? 0.2 + rng.normal(0, 0.005) : 0.8 + rng.normal(0, 0.005);
      a.observeCall(makeCall(pitch), 0, ctx, 0, i, 1, 1, 100, 100, 4096, -1, false, -1);
    }
    const clusters = a.report().clusters;
    const lowCall = clusters.find((c) => c.centroid[0] < 0.5)!;
    expect(lowCall.emitterContext[0].label).toBe('low energy');
    expect(lowCall.emitterContext[0].d).toBeGreaterThan(1);
    // The unrelated feature must not be credited.
    expect(lowCall.emitterContext.some((x) => x.label === 'crowded')).toBe(false);
  });

  it('reports no association when calls are made regardless of circumstance', () => {
    const a = new AcousticAnalyzer();
    const ctx = new Float32Array(CALL_CONTEXT_DIM);
    const rng = new Rng(73);
    for (let i = 0; i < 1200; i++) {
      for (let k = 0; k < CALL_CONTEXT_DIM; k++) ctx[k] = rng.next();
      const pitch = i % 2 === 0 ? 0.2 : 0.8;
      a.observeCall(makeCall(pitch), 0, ctx, 0, i, 1, 1, 100, 100, 4096, -1, false, -1);
    }
    for (const c of a.report().clusters) {
      expect(c.confidence).toBeLessThan(ASSOCIATION_THRESHOLD * 2);
    }
  });

  it('detects order between calls, and reports none when there is none', () => {
    const ordered = new AcousticAnalyzer();
    const random = new AcousticAnalyzer();
    const ctx = new Float32Array(CALL_CONTEXT_DIM);
    const rng = new Rng(74);
    let prevOrdered = -1;
    let prevRandom = -1;
    for (let i = 0; i < 1500; i++) {
      // Strict alternation: knowing the previous call fixes the next one.
      const pitchA = i % 2 === 0 ? 0.2 : 0.8;
      prevOrdered = ordered.observeCall(
        makeCall(pitchA), 0, ctx, 0, i, 1, 1, 100, 100, 4096, prevOrdered, false, -1,
      );
      const pitchB = rng.next() < 0.5 ? 0.2 : 0.8;
      prevRandom = random.observeCall(
        makeCall(pitchB), 0, ctx, 0, i, 1, 1, 100, 100, 4096, prevRandom, false, -1,
      );
    }
    expect(ordered.report().sequence.mutualInformation).toBeGreaterThan(0.8);
    expect(random.report().sequence.mutualInformation).toBeLessThan(0.1);
  });

  it('measures geographic divergence only when the regions really differ', () => {
    const split = new AcousticAnalyzer();
    const mixed = new AcousticAnalyzer();
    const ctx = new Float32Array(CALL_CONTEXT_DIM);
    const rng = new Rng(75);
    for (let i = 0; i < 2000; i++) {
      const west = i % 2 === 0;
      const x = west ? 200 : 3800;
      // In the split world each half uses its own call.
      split.observeCall(
        makeCall(west ? 0.2 : 0.8), 0, ctx, 0, i, 1, 1, x, 200, 4096, -1, false, -1,
      );
      // In the mixed world both halves use both.
      mixed.observeCall(
        makeCall(rng.next() < 0.5 ? 0.2 : 0.8), 0, ctx, 0, i, 1, 1, x, 200, 4096, -1, false, -1,
      );
    }
    expect(split.report().dialects.divergence).toBeGreaterThan(0.8);
    expect(mixed.report().dialects.divergence).toBeLessThan(0.15);
  });

  it('keeps a recurring shape that fits nothing instead of forcing it into a category', () => {
    const a = new AcousticAnalyzer();
    const ctx = new Float32Array(CALL_CONTEXT_DIM);
    // Fourteen well-separated shapes, one per available slot. They vary in
    // pitch, sweep, noisiness and timbre but all share a short duration and no
    // tremolo, which leaves those two axes free for the intruder below.
    const fillers: Float32Array[] = [];
    for (const pitch of [0.05, 0.5, 0.95]) {
      for (const sweep of [-0.9, 0.9]) {
        for (const noisiness of [0, 1]) {
          for (const timbre of [0, 1]) {
            const d = makeCall(pitch, 0.2);
            d[Call.Sweep] = sweep;
            d[Call.Noisiness] = noisiness;
            d[Call.Timbre] = timbre;
            fillers.push(d);
          }
        }
      }
    }
    for (let i = 0; i < 4200; i++) {
      a.observeCall(fillers[i % 14], 0, ctx, 0, i, 1, 1, 100, 100, 4096, -1, false, -1);
    }
    expect(a.report().clusters.length).toBe(14);

    // Now something that fits none of them: long and heavily pulsed, on the two
    // axes every established shape holds constant.
    const odd = makeCall(0.5, 0.98);
    odd[Call.Tremolo] = 1;
    for (let i = 0; i < 60; i++) {
      a.observeCall(odd, 0, ctx, 0, 4200 + i, 1, 1, 100, 100, 4096, -1, false, -1);
    }
    const unknown = a.report().unknown;
    expect(unknown.length).toBeGreaterThan(0);
    expect(unknown[0].count).toBeGreaterThanOrEqual(12);
    // It must not have displaced any of the established shapes.
    expect(a.report().clusters.length).toBe(14);
  });

  it('measures a response only for the shape that actually preceded it', () => {
    const a = new AcousticAnalyzer();
    const ctx = new Float32Array(CALL_CONTEXT_DIM);
    const resp = new Float32Array(RESPONSE_DIM);
    for (let i = 0; i < 900; i++) {
      a.observeCall(makeCall(i % 2 === 0 ? 0.2 : 0.8), 0, ctx, 0, i, 1, 1, 100, 100, 4096, -1, false, -1);
    }
    const clusters = a.report().clusters;
    const low = clusters.find((c) => c.centroid[0] < 0.5)!;
    const high = clusters.find((c) => c.centroid[0] > 0.5)!;
    for (let i = 0; i < 600; i++) {
      resp.fill(0);
      resp[Response.Approach] = 0.9;
      a.observeResponse(low.id, resp);
      resp.fill(0);
      resp[Response.Approach] = -0.9;
      a.observeResponse(high.id, resp);
    }
    const after = a.report().clusters;
    const lowAfter = after.find((c) => c.id === low.id)!;
    const highAfter = after.find((c) => c.id === high.id)!;
    expect(lowAfter.listenerResponse[0].label).toBe('approach');
    expect(lowAfter.listenerResponse[0].d).toBeGreaterThan(0);
    expect(highAfter.listenerResponse[0].d).toBeLessThan(0);
  });

  it('distance between calls is symmetric and zero for identical sounds', () => {
    const a = makeCall(0.4);
    const b = makeCall(0.7);
    expect(callDistance(a, 0, a, 0)).toBe(0);
    expect(callDistance(a, 0, b, 0)).toBeCloseTo(callDistance(b, 0, a, 0), 10);
    expect(callDistance(a, 0, b, 0)).toBeGreaterThan(0);
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
    callsPerTick: 0,
    vocalDiversity: 0,
    sequenceStructure: 0,
    turnTaking: 0,
    vocalConvergence: 0,
    dialectDivergence: 0,
    callGenerationSpan: 0,
    signalCoupling: 0,
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
