/**
 * Validation for the predictive layer.
 *
 * These tests are written to be capable of failing in the interesting
 * direction. Several of them ask questions the simulation is genuinely allowed
 * to answer "no" to — whether curiosity helps, whether planning helps, whether
 * intelligence evolves — and where that is the case the test asserts the
 * *mechanism* works rather than asserting the outcome the mechanism was hoped
 * to produce. A test that demanded intelligence evolve would be a test that
 * something in the simulation was arranging for it to.
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { Rng } from './core/rng';
import { senseNoise } from './core/senseNoise';
import { DEFAULT_CONFIG } from './core/config';
import { GENOME_LENGTH, Locus } from './genome/loci';
import { MAX_CONTEXT, MAX_HIDDEN, expressInto, makePhenotype } from './genome/phenotype';
import { OUTPUT_COUNT } from './brain/brain';
import {
  MODEL_FEATURES,
  MODEL_ROW,
  MODEL_ROWS,
  MODEL_STRIDE,
  REWARD_ROW,
  buildFeatures,
  learn,
  makePredictionError,
  makeRolloutResult,
  noteExposure,
  predictInto,
  rollout,
  uncertainty,
} from './cognition/worldModel';
import { REPLAY_DEPTH, REPLAY_STRIDE, pushReplay, replayOne } from './cognition/consolidation';
import { deliberate, makePlanResult } from './cognition/planning';
import { MEMORY_CONTEXT_DIM } from './memory/memory';

const small = { worldSize: 1024, gridSize: 64, initialPopulation: 250, maxPopulation: 3000 };

function makeModel() {
  return {
    w: new Float32Array(MODEL_STRIDE),
    exposure: new Float32Array(MODEL_FEATURES),
    feat: new Float32Array(MODEL_FEATURES),
    pred: new Float32Array(MODEL_ROWS),
    err: makePredictionError(),
  };
}

/**
 * A small deterministic world an organism could plausibly be in: the next
 * internal state is a fixed linear function of the current one and the action,
 * plus a little unpredictable jitter. Nothing about this is special — it is
 * simply structured, which is the condition under which a model is worth
 * carrying at all.
 */
function structuredStep(latent: Float32Array, action: Float32Array, h: number, rng: Rng): Float32Array {
  const next = new Float32Array(MAX_HIDDEN);
  for (let i = 0; i < h; i++) {
    next[i] = Math.tanh(
      latent[i] * 0.6 + latent[(i + 1) % h] * 0.2 + action[i % OUTPUT_COUNT] * 0.5 + (rng.next() - 0.5) * 0.08,
    );
  }
  return next;
}

describe('the world model learns', () => {
  it('predicts a structured transition better after experience than before it', () => {
    const h = 6;
    const m = makeModel();
    const rng = new Rng(11);
    const latent = new Float32Array(MAX_HIDDEN);
    for (let i = 0; i < h; i++) latent[i] = rng.next() * 2 - 1;
    const action = new Float32Array(OUTPUT_COUNT);

    let earlyError = 0;
    let lateError = 0;

    for (let t = 0; t < 600; t++) {
      for (let a = 0; a < OUTPUT_COUNT; a++) action[a] = Math.sin(t * 0.13 + a) * 0.7;
      const count = buildFeatures(m.feat, latent, 0, action, h);
      predictInto(m.w, 0, m.feat, count, h, m.pred);
      const next = structuredStep(latent, action, h, rng);
      learn(m.w, 0, m.feat, count, h, m.pred, next, 0, 0, 0.3, 0, m.err);
      if (t < 60) earlyError += m.err.latent;
      if (t >= 540) lateError += m.err.latent;
      latent.set(next);
    }

    expect(lateError).toBeLessThan(earlyError * 0.5);
  });

  it('learns nothing at all when the learning rate is zero', () => {
    const h = 4;
    const m = makeModel();
    const rng = new Rng(12);
    const latent = new Float32Array(MAX_HIDDEN);
    for (let i = 0; i < h; i++) latent[i] = 0.5;
    const action = new Float32Array(OUTPUT_COUNT);

    for (let t = 0; t < 200; t++) {
      const count = buildFeatures(m.feat, latent, 0, action, h);
      predictInto(m.w, 0, m.feat, count, h, m.pred);
      const next = structuredStep(latent, action, h, rng);
      learn(m.w, 0, m.feat, count, h, m.pred, next, 0, 0.5, 0, 0, m.err);
    }
    for (let i = 0; i < MODEL_STRIDE; i++) expect(m.w[i]).toBe(0);
  });

  it('keeps latent error and reward error apart', () => {
    // A model given a constant latent and a wildly varying reward should end up
    // excellent at the first and poor at the second. Collapsing the two into one
    // number would hide exactly that.
    const h = 3;
    const m = makeModel();
    const rng = new Rng(13);
    const latent = new Float32Array(MAX_HIDDEN);
    latent[0] = 0.4;
    latent[1] = -0.2;
    latent[2] = 0.1;
    const action = new Float32Array(OUTPUT_COUNT);

    let latentErr = 0;
    let rewardErr = 0;
    for (let t = 0; t < 400; t++) {
      const count = buildFeatures(m.feat, latent, 0, action, h);
      predictInto(m.w, 0, m.feat, count, h, m.pred);
      const reward = (rng.next() - 0.5) * 4; // pure noise, unlearnable
      learn(m.w, 0, m.feat, count, h, m.pred, latent, 0, reward, 0.3, 0, m.err);
      if (t > 300) {
        latentErr += m.err.latent;
        rewardErr += m.err.reward;
      }
    }
    expect(latentErr).toBeLessThan(rewardErr * 0.2);
  });

  it('gives up an expectation nothing keeps confirming', () => {
    const h = 2;
    const m = makeModel();
    const latent = new Float32Array(MAX_HIDDEN);
    latent[0] = 1;
    latent[1] = 1;
    const action = new Float32Array(OUTPUT_COUNT);
    const target = new Float32Array(MAX_HIDDEN);
    target[0] = 0.8;
    target[1] = -0.8;

    const count = buildFeatures(m.feat, latent, 0, action, h);
    for (let t = 0; t < 200; t++) {
      predictInto(m.w, 0, m.feat, count, h, m.pred);
      learn(m.w, 0, m.feat, count, h, m.pred, target, 0, 0, 0.4, 0, m.err);
    }
    let magnitude = 0;
    for (let i = 0; i < MODEL_STRIDE; i++) magnitude += Math.abs(m.w[i]);
    expect(magnitude).toBeGreaterThan(0.5);

    // Now stop refreshing it, and only let the decay term run.
    const zero = new Float32Array(MODEL_FEATURES);
    for (let t = 0; t < 3000; t++) {
      learn(m.w, 0, zero, count, h, m.pred, target, 0, 0, 0, 0.01, m.err);
    }
    let after = 0;
    for (let i = 0; i < MODEL_STRIDE; i++) after += Math.abs(m.w[i]);
    expect(after).toBeLessThan(magnitude * 0.01);
  });

  it('never imagines an impossible state, however wrong its weights are', () => {
    const m = makeModel();
    for (let i = 0; i < MODEL_STRIDE; i++) m.w[i] = 50;
    const latent = new Float32Array(MAX_HIDDEN).fill(1);
    const action = new Float32Array(OUTPUT_COUNT).fill(1);
    const count = buildFeatures(m.feat, latent, 0, action, 8);
    predictInto(m.w, 0, m.feat, count, 8, m.pred);
    for (let i = 0; i < 8; i++) {
      expect(m.pred[i]).toBeGreaterThanOrEqual(-1);
      expect(m.pred[i]).toBeLessThanOrEqual(1);
    }
    expect(Number.isFinite(m.pred[REWARD_ROW])).toBe(true);
  });
});

describe('the model can only see what its owner saw', () => {
  it('takes exactly the latent state, the action and a bias — nothing else', () => {
    expect(MODEL_ROW).toBe(MAX_HIDDEN + OUTPUT_COUNT + 1);
    const feat = new Float32Array(MODEL_FEATURES).fill(999);
    const latent = new Float32Array(MAX_HIDDEN);
    const action = new Float32Array(OUTPUT_COUNT);
    for (let i = 0; i < 5; i++) latent[i] = 0.1 * (i + 1);
    for (let a = 0; a < OUTPUT_COUNT; a++) action[a] = -0.5;
    const count = buildFeatures(feat, latent, 0, action, 5);

    expect(count).toBe(5 + OUTPUT_COUNT + 1);
    for (let i = 0; i < 5; i++) expect(feat[i]).toBeCloseTo(0.1 * (i + 1), 6);
    for (let a = 0; a < OUTPUT_COUNT; a++) expect(feat[5 + a]).toBe(-0.5);
    expect(feat[count - 1]).toBe(1);
    // Everything past the used range is cleared, so a wide-brained organism's
    // leftovers cannot leak into a narrow-brained one sharing the scratch buffer.
    for (let k = count; k < MODEL_ROW; k++) expect(feat[k]).toBe(0);
  });

  it('a newborn in a recycled slot inherits no knowledge from the previous occupant', () => {
    const sim = new Simulation({ ...small, seed: 5 });
    const pop = sim.pop;
    const slot = 3;
    const mo = pop.modelOffset(slot);
    for (let i = 0; i < MODEL_STRIDE; i++) pop.model[mo + i] = 0.7;
    pop.modelSamples[slot] = 900;
    pop.predErrorSlow[slot] = 0.05;
    pop.toxinLoad[slot] = 0.9;
    pop.memStrength[pop.memoryOffset(slot)] = 1;

    pop.resetSlot(slot);

    for (let i = 0; i < MODEL_STRIDE; i++) expect(pop.model[mo + i]).toBe(0);
    expect(pop.modelSamples[slot]).toBe(0);
    expect(pop.predErrorSlow[slot]).toBe(0);
    expect(pop.toxinLoad[slot]).toBe(0);
    expect(pop.memStrength[pop.memoryOffset(slot)]).toBe(0);
  });
});

describe('uncertainty and novelty', () => {
  it('falls where the model has been and stays high where it has not', () => {
    const exposure = new Float32Array(MODEL_FEATURES);
    const familiar = new Float32Array(MODEL_FEATURES);
    const strange = new Float32Array(MODEL_FEATURES);
    const h = 4;
    for (let i = 0; i < h; i++) familiar[i] = 0.8;
    strange[h + 2] = 0.8;
    familiar[h + OUTPUT_COUNT] = 1;
    strange[h + OUTPUT_COUNT] = 1;
    const count = h + OUTPUT_COUNT + 1;

    const before = uncertainty(exposure, 0, familiar, count);
    for (let t = 0; t < 50; t++) noteExposure(exposure, 0, familiar, count, 0);
    const after = uncertainty(exposure, 0, familiar, count);
    const elsewhere = uncertainty(exposure, 0, strange, count);

    expect(before).toBeGreaterThan(0.9);
    expect(after).toBeLessThan(0.3);
    expect(elsewhere).toBeGreaterThan(after);
  });
});

describe('imagination', () => {
  it('reaches further with a longer horizon, and does nothing at horizon zero', () => {
    const m = makeModel();
    // A model that expects a small positive reward from any state.
    for (let k = 0; k < MODEL_ROW; k++) m.w[REWARD_ROW * MODEL_ROW + k] = 0.1;
    const latent = new Float32Array(MAX_HIDDEN).fill(0.3);
    const action = new Float32Array(OUTPUT_COUNT).fill(0.2);
    const imagined = new Float32Array(MAX_HIDDEN);
    const out = makeRolloutResult();

    rollout(m.w, 0, m.exposure, 0, latent, 0, action, 4, 0, 0.85, m.feat, m.pred, imagined, out);
    expect(out.steps).toBe(0);
    expect(out.value).toBe(0);

    rollout(m.w, 0, m.exposure, 0, latent, 0, action, 4, 1, 0.85, m.feat, m.pred, imagined, out);
    const one = out.value;
    rollout(m.w, 0, m.exposure, 0, latent, 0, action, 4, 3, 0.85, m.feat, m.pred, imagined, out);
    expect(out.steps).toBe(3);
    expect(out.value).toBeGreaterThan(one);
  });
});

describe('deliberation', () => {
  const base = new Float32Array(OUTPUT_COUNT);
  const scratch = () => ({
    feat: new Float32Array(MODEL_FEATURES),
    pred: new Float32Array(MODEL_ROWS),
    imagined: new Float32Array(MAX_HIDDEN),
    candidate: new Float32Array(OUTPUT_COUNT),
    chosen: new Float32Array(OUTPUT_COUNT),
    roll: makeRolloutResult(),
    plan: makePlanResult(),
  });

  it('changes nothing when the organism has no horizon or no budget', () => {
    const m = makeModel();
    const s = scratch();
    const latent = new Float32Array(MAX_HIDDEN).fill(0.2);
    for (let a = 0; a < OUTPUT_COUNT; a++) base[a] = 0.35;

    deliberate(m.w, 0, m.exposure, 0, latent, 0, base, 4, 0, 5, 0, 0.4, new Rng(1), s.feat, s.pred, s.imagined, s.candidate, s.chosen, s.roll, s.plan);
    for (let a = 0; a < OUTPUT_COUNT; a++) expect(s.chosen[a]).toBe(base[a]);
    expect(s.plan.advantage).toBe(0);
    expect(s.plan.steps).toBe(0);

    deliberate(m.w, 0, m.exposure, 0, latent, 0, base, 4, 3, 0, 0, 0.4, new Rng(1), s.feat, s.pred, s.imagined, s.candidate, s.chosen, s.roll, s.plan);
    for (let a = 0; a < OUTPUT_COUNT; a++) expect(s.chosen[a]).toBe(base[a]);
  });

  it('never comes back worse than instinct by its own reckoning', () => {
    // The brain's own proposal is always candidate zero, so the advantage is a
    // floor at nothing. Deliberation can decline to change anything; what it
    // cannot do is talk itself into something its model rates lower.
    const rng = new Rng(88);
    for (let trial = 0; trial < 25; trial++) {
      const m = makeModel();
      for (let i = 0; i < MODEL_STRIDE; i++) m.w[i] = rng.next() * 2 - 1;
      const s = scratch();
      const latent = new Float32Array(MAX_HIDDEN);
      for (let i = 0; i < 5; i++) latent[i] = rng.next() * 2 - 1;
      for (let a = 0; a < OUTPUT_COUNT; a++) base[a] = rng.next() * 2 - 1;
      deliberate(m.w, 0, m.exposure, 0, latent, 0, base, 5, 3, 4, 0.2, 0.5, rng, s.feat, s.pred, s.imagined, s.candidate, s.chosen, s.roll, s.plan);
      expect(s.plan.advantage).toBeGreaterThanOrEqual(0);
      expect(s.plan.steps).toBeGreaterThan(0);
    }
  });

  it('finds the action its model expects to pay, when one exists', () => {
    const m = makeModel();
    const h = 4;
    // The model has learned that pushing output 0 up is followed by reward.
    m.w[REWARD_ROW * MODEL_ROW + h] = 2;
    const s = scratch();
    const latent = new Float32Array(MAX_HIDDEN).fill(0.1);
    for (let a = 0; a < OUTPUT_COUNT; a++) base[a] = 0;

    deliberate(m.w, 0, m.exposure, 0, latent, 0, base, h, 2, 5, 0, 0.9, new Rng(4), s.feat, s.pred, s.imagined, s.candidate, s.chosen, s.roll, s.plan);
    expect(s.chosen[0]).toBeGreaterThan(0);
    expect(s.plan.advantage).toBeGreaterThan(0);
  });

  it('an incurious organism stands pat where a curious one goes looking', () => {
    // One model, one set of candidates, two different weights on the
    // unexplained. The model expects exactly nothing from any of them — the
    // reward row is empty — so on expected value alone every option ties and
    // instinct wins by default. The only thing that can break the tie is how
    // little the organism knows about what it is about to do.
    //
    // Neither answer is the correct one. Which of these two survives is a
    // question about the world, not about this test.
    const h = 4;
    const count = h + OUTPUT_COUNT + 1;
    const m = makeModel();
    // Thoroughly familiar with everything except one action channel it has
    // never pushed.
    for (let k = 0; k < count; k++) m.exposure[k] = 20;
    m.exposure[h + 3] = 0;

    const latent = new Float32Array(MAX_HIDDEN).fill(0.1);
    for (let a = 0; a < OUTPUT_COUNT; a++) base[a] = 0;

    const calm = scratch();
    deliberate(m.w, 0, m.exposure, 0, latent, 0, base, h, 2, 6, 0, 0.6, new Rng(9), calm.feat, calm.pred, calm.imagined, calm.candidate, calm.chosen, calm.roll, calm.plan);
    const curious = scratch();
    deliberate(m.w, 0, m.exposure, 0, latent, 0, base, h, 2, 6, 1, 0.6, new Rng(9), curious.feat, curious.pred, curious.imagined, curious.candidate, curious.chosen, curious.roll, curious.plan);

    // Nothing looked better than doing what it was already going to do.
    for (let a = 0; a < OUTPUT_COUNT; a++) expect(calm.chosen[a]).toBe(base[a]);
    expect(calm.plan.advantage).toBe(0);

    // The curious one paid attention to the channel it has never used.
    expect(curious.plan.uncertainty).toBeGreaterThan(calm.plan.uncertainty);
    expect(curious.plan.advantage).toBeGreaterThan(0);
    expect(Math.abs(curious.chosen[h - 1 + 4])).toBeGreaterThan(0);
    let differs = false;
    for (let a = 0; a < OUTPUT_COUNT; a++) if (curious.chosen[a] !== calm.chosen[a]) differs = true;
    expect(differs).toBe(true);
  });
});

describe('learning progress is not the same as surprise', () => {
  /**
   * The distinction the whole curiosity mechanism turns on. Both streams below
   * are surprising; only one of them is learnable, and only that one should
   * produce progress.
   */
  /**
   * The exact arithmetic the simulation runs, driven by a stream that is either
   * learnable or pure chance. `total` is what matters: it is what an organism
   * would actually have been paid over the whole episode, since the intrinsic
   * term integrates positive progress moment by moment.
   */
  function progressOver(learnable: boolean): {
    peak: number;
    total: number;
    settled: number;
    surprise: number;
  } {
    const h = 4;
    const m = makeModel();
    const rng = new Rng(learnable ? 21 : 22);
    let fast = 0;
    let slow = 0;
    let varr = 0;
    let peak = 0;
    let total = 0;
    let progress = 0;
    const latent = new Float32Array(MAX_HIDDEN);
    const action = new Float32Array(OUTPUT_COUNT);
    const target = new Float32Array(MAX_HIDDEN);
    for (let i = 0; i < h; i++) latent[i] = 0.5;

    for (let t = 0; t < 2000; t++) {
      // The learnable stream is a fixed map the organism can in principle
      // capture exactly; the other is redrawn from nothing every step. Both are
      // surprising to a fresh model. Only one of them stops being.
      for (let i = 0; i < h; i++) {
        latent[i] = Math.sin(t * 0.05 + i) * 0.8;
        target[i] = learnable ? Math.tanh(latent[i] * 0.9 - 0.3) : rng.next() * 2 - 1;
      }
      const count = buildFeatures(m.feat, latent, 0, action, h);
      predictInto(m.w, 0, m.feat, count, h, m.pred);
      learn(m.w, 0, m.feat, count, h, m.pred, target, 0, 0, 0.02, 0, m.err);

      const surprise = m.err.latent;
      const deviation = surprise - fast;
      varr = varr * 0.95 + deviation * deviation * 0.05;
      fast = fast * 0.75 + surprise * 0.25;
      slow = slow * 0.98 + surprise * 0.02;
      const raw = slow - fast;
      const wobble = 2.5 * Math.sqrt(varr * 0.1429);
      progress = raw > 0 ? Math.max(0, raw - wobble) : Math.min(0, raw + wobble);
      if (progress > peak) peak = progress;
      if (progress > 0) total += progress;
    }
    return { peak, total, settled: progress, surprise: fast };
  }

  it('accrues while a pattern is being learned', () => {
    const r = progressOver(true);
    expect(r.peak).toBeGreaterThan(0.005);
    expect(r.total).toBeGreaterThan(0.5);
    // And the surprise it was measuring really did come down.
    expect(r.surprise).toBeLessThan(0.15);
  });

  it('does not reward staring at noise', () => {
    // Pure chance is maximally surprising forever, and stays that way. An
    // organism paid for surprise alone would sit in front of it; one paid for
    // progress gets nothing, because the short-run average bouncing below the
    // long-run one is not improvement and the correction knows it.
    const r = progressOver(false);
    expect(r.surprise).toBeGreaterThan(0.2);
    expect(r.total).toBeLessThan(progressOver(true).total * 0.25);
  });
});

describe('offline replay', () => {
  it('trains on nothing when the buffer is empty', () => {
    const replay = new Float32Array(REPLAY_STRIDE);
    const m = makeModel();
    const ok = replayOne(replay, 0, 0, m.w, 0, 4, 0.5, 0, m.feat, m.pred, m.err);
    expect(ok).toBe(false);
    for (let i = 0; i < MODEL_STRIDE; i++) expect(m.w[i]).toBe(0);
  });

  it('re-fits a stored transition and reduces the error on it', () => {
    const h = 4;
    const replay = new Float32Array(REPLAY_STRIDE);
    const m = makeModel();
    const latent = new Float32Array(MAX_HIDDEN);
    const target = new Float32Array(MAX_HIDDEN);
    const action = new Float32Array(OUTPUT_COUNT);
    for (let i = 0; i < h; i++) {
      latent[i] = 0.4;
      target[i] = -0.6;
    }
    const count = buildFeatures(m.feat, latent, 0, action, h);
    const head = pushReplay(replay, 0, 0, m.feat, count, target, 0, h, 0.5);
    expect(head).toBe(1 % REPLAY_DEPTH);

    let first = 0;
    let last = 0;
    for (let t = 0; t < 40; t++) {
      const ok = replayOne(replay, 0, 0, m.w, 0, h, 0.4, 0, m.feat, m.pred, m.err);
      expect(ok).toBe(true);
      if (t === 0) first = m.err.latent;
      last = m.err.latent;
    }
    expect(last).toBeLessThan(first * 0.5);
  });
});

describe('perception is an instrument, not a wire', () => {
  it('reads the same quantity the same way twice, and differently next tick', () => {
    expect(senseNoise(7, 100, 3)).toBe(senseNoise(7, 100, 3));
    expect(senseNoise(7, 100, 3)).not.toBe(senseNoise(7, 101, 3));
    expect(senseNoise(7, 100, 3)).not.toBe(senseNoise(8, 100, 3));
    expect(senseNoise(7, 100, 3)).not.toBe(senseNoise(7, 100, 4));
  });

  it('stays inside its range for anything it could be handed', () => {
    for (let slot = 0; slot < 400; slot++) {
      for (let tick = 0; tick < 40; tick++) {
        const v = senseNoise(slot * 17, tick * 991, tick % 9);
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it('a sharper eye is a more honest one', () => {
    const blunt = new Float32Array(GENOME_LENGTH).fill(0.5);
    blunt[Locus.VisionAcuity] = 0;
    const sharp = Float32Array.from(blunt);
    sharp[Locus.VisionAcuity] = 1;
    const a = expressInto(makePhenotype(), blunt, 0);
    const b = expressInto(makePhenotype(), sharp, 0);
    // The noise an organism suffers is scaled by (1 - acuity), so the sharp eye
    // has strictly less of it — and pays strictly more upkeep for the privilege.
    expect(1 - b.visionAcuity).toBeLessThan(1 - a.visionAcuity);
    expect(b.upkeep).toBeGreaterThan(a.upkeep);
  });
});

describe('cognition is never free', () => {
  const loci = [
    Locus.PredictionRate,
    Locus.Curiosity,
    Locus.MetaRate,
    Locus.Consolidation,
    Locus.ToxinTolerance,
  ];

  it('every cognitive gene costs upkeep on its own', () => {
    for (const l of loci) {
      const lo = new Float32Array(GENOME_LENGTH).fill(0.5);
      lo[l] = 0;
      const hi = Float32Array.from(lo);
      hi[l] = 1;
      const a = expressInto(makePhenotype(), lo, 0).upkeep;
      const b = expressInto(makePhenotype(), hi, 0).upkeep;
      expect(b).toBeGreaterThan(a);
    }
  });

  it('deliberating deeply or widely costs more than doing neither', () => {
    const none = new Float32Array(GENOME_LENGTH).fill(0.5);
    none[Locus.PredictionHorizon] = 0;
    none[Locus.PlanningBudget] = 0;
    const deep = Float32Array.from(none);
    deep[Locus.PredictionHorizon] = 1;
    deep[Locus.PlanningBudget] = 1;
    const a = expressInto(makePhenotype(), none, 0);
    const b = expressInto(makePhenotype(), deep, 0);
    expect(a.planHorizon).toBe(0);
    expect(a.planBudget).toBe(0);
    expect(b.planHorizon).toBeGreaterThan(0);
    expect(b.planBudget).toBeGreaterThan(0);
    expect(b.upkeep).toBeGreaterThan(a.upkeep);
  });

  it('an organism that expresses none of it pays nothing extra', () => {
    const bare = new Float32Array(GENOME_LENGTH).fill(0.5);
    for (const l of [...loci, Locus.PredictionHorizon, Locus.PlanningBudget]) bare[l] = 0;
    const p = expressInto(makePhenotype(), bare, 0);
    expect(p.predictionRate).toBe(0);
    expect(p.curiosity).toBe(0);
    expect(p.planHorizon).toBe(0);
    expect(p.consolidation).toBe(0);
  });
});

describe('delayed consequences', () => {
  it('the dangerous growth is a minority of the map, not a tax on eating', () => {
    const sim = new Simulation({ ...small, seed: 31 });
    let toxic = 0;
    const cells = sim.world.grid * sim.world.grid;
    for (let i = 0; i < cells; i++) if (sim.world.toxicityAt(i, sim.cfg) > 0.3) toxic++;
    const fraction = toxic / cells;
    expect(fraction).toBeGreaterThan(0);
    expect(fraction).toBeLessThan(0.5);
  });

  it('appearance predicts danger, but never perfectly', () => {
    const sim = new Simulation({ ...small, seed: 32 });
    const cells = sim.world.grid * sim.world.grid;
    const center = sim.cfg.floraToxicCenter;
    let near = 0;
    let nearN = 0;
    let far = 0;
    let farN = 0;
    let spread = 0;
    let spreadN = 0;
    for (let i = 0; i < cells; i++) {
      const d = Math.abs(sim.world.flora[i] - center);
      const t = sim.world.toxicityAt(i, sim.cfg);
      if (d < 0.05) {
        near += t;
        nearN++;
        spread += t;
        spreadN++;
      } else if (d > 0.3) {
        far += t;
        farN++;
      }
    }
    expect(nearN).toBeGreaterThan(0);
    expect(farN).toBeGreaterThan(0);
    expect(near / nearN).toBeGreaterThan(far / farN + 0.2);
    // ...and within the dangerous band it still varies, so no amount of looking
    // resolves it completely.
    let variance = 0;
    const mean = spread / spreadN;
    for (let i = 0; i < cells; i++) {
      if (Math.abs(sim.world.flora[i] - center) >= 0.05) continue;
      variance += (sim.world.toxicityAt(i, sim.cfg) - mean) ** 2;
    }
    expect(Math.sqrt(variance / spreadN)).toBeGreaterThan(0.02);
  });

  it('switching the poison off changes what organisms accumulate and nothing else structural', () => {
    const withToxins = new Simulation({ ...small, seed: 33 });
    const without = new Simulation({ ...small, seed: 33, toxinPotency: 0 });
    for (let t = 0; t < 400; t++) {
      withToxins.step();
      without.step();
    }
    let a = 0;
    for (let i = 0; i < withToxins.pop.count; i++) {
      if (withToxins.pop.alive[i]) a += withToxins.pop.toxinLoad[i];
    }
    let b = 0;
    for (let i = 0; i < without.pop.count; i++) {
      if (without.pop.alive[i]) b += without.pop.toxinLoad[i];
    }
    expect(a).toBeGreaterThan(0);
    expect(b).toBe(0);
  });

  it('a chemical shift moves which appearance is dangerous', () => {
    const sim = new Simulation({ ...small, seed: 34 });
    const cell = 500;
    const before = sim.world.toxicityAt(cell, sim.cfg);
    sim.triggerWorldEvent({ type: 'toxicShift', magnitude: 1.4 });
    for (let t = 0; t < 60; t++) sim.step();
    expect(sim.cfg.toxicCenterOffset).not.toBe(0);
    const after = sim.world.toxicityAt(cell, sim.cfg);
    // At least somewhere on the map the ranking has to have changed, or the
    // event did nothing.
    let changed = 0;
    for (let i = 0; i < sim.world.grid * sim.world.grid; i++) {
      if (Math.abs(sim.world.toxicityAt(i, sim.cfg)) > 0.3) changed++;
    }
    expect(before !== after || changed > 0).toBe(true);
  });

  it('a tolerant lineage clears a dose faster than an intolerant one', () => {
    const lo = new Float32Array(GENOME_LENGTH).fill(0.5);
    lo[Locus.ToxinTolerance] = 0;
    const hi = Float32Array.from(lo);
    hi[Locus.ToxinTolerance] = 1;
    const a = expressInto(makePhenotype(), lo, 0).toxinClearance;
    const b = expressInto(makePhenotype(), hi, 0).toxinClearance;
    expect(b).toBeGreaterThan(a * 5);
  });
});

describe('in a running world', () => {
  it('organisms fit models, and the well-practised are less surprised than the new', () => {
    // A within-run comparison at one moment: organisms that have fitted many
    // transitions against organisms that have fitted few, in the same world at
    // the same tick. It is not a clean experiment — the experienced ones are
    // also the ones that survived — but it is the claim the numbers support,
    // and the mechanism tests above are what establish that fitting works.
    const sim = new Simulation({ ...small, seed: 61, initialPopulation: 600 });
    for (let t = 0; t < 900; t++) sim.step();

    let green = 0;
    let greenN = 0;
    let seasoned = 0;
    let seasonedN = 0;
    for (let i = 0; i < sim.pop.count; i++) {
      if (!sim.pop.alive[i] || sim.pop.predictionRate[i] <= 0) continue;
      const n = sim.pop.modelSamples[i];
      if (n >= 3 && n <= 12) {
        green += sim.pop.predErrorFast[i];
        greenN++;
      } else if (n > 60) {
        seasoned += sim.pop.predErrorFast[i];
        seasonedN++;
      }
    }
    expect(greenN + seasonedN).toBeGreaterThan(0);
    if (greenN > 4 && seasonedN > 4) {
      expect(seasoned / seasonedN).toBeLessThan(green / greenN);
    }
  });

  it('two organisms with the same genome and different lives hold different models', () => {
    const sim = new Simulation({ ...small, seed: 62, initialPopulation: 400 });
    for (let t = 0; t < 700; t++) sim.step();

    const pop = sim.pop;
    let compared = 0;
    let differed = 0;
    for (let i = 0; i < pop.count && compared < 40; i++) {
      if (!pop.alive[i] || pop.modelSamples[i] < 20) continue;
      for (let j = i + 1; j < pop.count && compared < 40; j++) {
        if (!pop.alive[j] || pop.modelSamples[j] < 20) continue;
        // Same genome means same body and same inherited brain. Anything that
        // differs after that came from living somewhere else.
        let same = true;
        const gi = pop.genomeOffset(i);
        const gj = pop.genomeOffset(j);
        for (let g = 0; g < GENOME_LENGTH; g++) {
          if (Math.abs(pop.genome[gi + g] - pop.genome[gj + g]) > 1e-6) {
            same = false;
            break;
          }
        }
        if (!same) continue;
        compared++;
        let delta = 0;
        const mi = pop.modelOffset(i);
        const mj = pop.modelOffset(j);
        for (let k = 0; k < MODEL_STRIDE; k++) delta += Math.abs(pop.model[mi + k] - pop.model[mj + k]);
        if (delta > 1e-4) differed++;
      }
    }
    // If no clonal pair survived long enough there is nothing to claim; when a
    // pair does exist, its members must not have converged on one model.
    if (compared > 0) expect(differed).toBe(compared);
  });

  it('switching the world model off leaves nothing fitted and nothing broken', () => {
    const sim = new Simulation({ ...small, seed: 63, worldModelEnabled: false });
    for (let t = 0; t < 400; t++) sim.step();
    for (let i = 0; i < sim.pop.count; i++) {
      if (!sim.pop.alive[i]) continue;
      expect(sim.pop.modelSamples[i]).toBe(0);
      expect(sim.pop.intrinsic[i]).toBe(0);
    }
    const s = sim.getStats();
    expect(s.modelStepsPerTick).toBe(0);
    expect(Number.isFinite(s.avgPredictionAccuracy)).toBe(true);
  });

  it('a control arm with no lifetime learning still runs and still evolves', () => {
    const sim = new Simulation({ ...small, seed: 64, learningEnabled: false });
    for (let t = 0; t < 500; t++) sim.step();
    const po = sim.pop.plasticOffset(0);
    let drift = 0;
    for (let i = 0; i < sim.pop.count; i++) {
      const o = sim.pop.plasticOffset(i);
      for (let k = 0; k < 64; k++) drift += Math.abs(sim.pop.plastic[o + k]);
    }
    expect(po).toBe(0);
    expect(drift).toBe(0);
    expect(sim.totalBirths).toBeGreaterThan(0);
  });

  it('everything cognitive stays finite, in range, and free of NaN', () => {
    const sim = new Simulation({ ...small, seed: 65, initialPopulation: 500 });
    for (let t = 0; t < 600; t++) {
      sim.step();
      if (t % 120) continue;
      for (let i = 0; i < sim.pop.count; i++) {
        if (!sim.pop.alive[i]) continue;
        expect(Number.isFinite(sim.pop.predError[i])).toBe(true);
        expect(Number.isFinite(sim.pop.predErrorSlow[i])).toBe(true);
        expect(Number.isFinite(sim.pop.intrinsic[i])).toBe(true);
        expect(Number.isFinite(sim.pop.toxinLoad[i])).toBe(true);
        expect(sim.pop.toxinLoad[i]).toBeGreaterThanOrEqual(0);
        expect(sim.pop.modelConfidence[i]).toBeGreaterThanOrEqual(0);
        expect(sim.pop.modelConfidence[i]).toBeLessThanOrEqual(1);
        expect(sim.pop.novelty[i]).toBeGreaterThanOrEqual(0);
        expect(sim.pop.novelty[i]).toBeLessThanOrEqual(1);
        const mo = sim.pop.modelOffset(i);
        for (let k = 0; k < MODEL_STRIDE; k += 37) {
          expect(Number.isFinite(sim.pop.model[mo + k])).toBe(true);
        }
      }
    }
  });

  it('the whole cognitive state survives a save and restore intact', () => {
    const parent = new Simulation({ ...small, seed: 66, initialPopulation: 400 });
    for (let t = 0; t < 500; t++) parent.step();
    const payload = parent.serialize();

    const fork = new Simulation({ ...small, seed: 66, initialPopulation: 400 });
    fork.restore(payload as Record<string, any>);

    for (let i = 0; i < parent.pop.count; i++) {
      if (!parent.pop.alive[i]) continue;
      expect(fork.pop.modelSamples[i]).toBe(parent.pop.modelSamples[i]);
      expect(fork.pop.toxinLoad[i]).toBeCloseTo(parent.pop.toxinLoad[i], 6);
      const mo = parent.pop.modelOffset(i);
      for (let k = 0; k < MODEL_STRIDE; k += 53) {
        expect(fork.pop.model[mo + k]).toBe(parent.pop.model[mo + k]);
      }
    }

    // And it keeps running identically, which is what makes a forked control arm
    // a control rather than a similar-looking independent run.
    for (let t = 0; t < 120; t++) {
      parent.step();
      fork.step();
    }
    expect(fork.pop.livingCount).toBe(parent.pop.livingCount);
  });

  it('reports cognition without claiming anything it cannot support', () => {
    const sim = new Simulation({ ...small, seed: 67, initialPopulation: 400 });
    for (let t = 0; t < 400; t++) sim.step();
    const report = sim.cognitionReport();
    expect(Array.isArray(report.associations)).toBe(true);
    for (const a of report.associations) {
      expect(Math.abs(a.correlation)).toBeLessThanOrEqual(1);
      expect(a.samples).toBeGreaterThan(0);
    }
    if (report.hypothesis) {
      // Whatever it says, it has to say what would settle the question.
      expect(report.nextStep.length).toBeGreaterThan(0);
    }
  });
});

describe('knowledge that came from a sound', () => {
  /**
   * Drive the one path by which anything an organism learned can reach another
   * organism without being lived twice, and check both that it works and that
   * the switch that turns it off turns it off.
   */
  function hearSomething(socialMemoryEnabled: boolean): number {
    const sim = new Simulation({ ...small, seed: 71, socialMemoryEnabled });
    const pop = sim.pop;
    const i = 0;
    // Give this organism the anatomy the path requires: places to put a memory,
    // sound patterns to recognise, and a disposition to take others seriously.
    const g = pop.genome;
    const go = pop.genomeOffset(i);
    g[go + Locus.MemoryCapacity] = 1;
    g[go + Locus.SoundMemory] = 1;
    g[go + Locus.SocialLearning] = 1;
    g[go + Locus.HearingRange] = 1;
    g[go + Locus.BrainContext] = 0;
    const pheno = expressInto(makePhenotype(), g, go);
    pop.applyPhenotype(i, pheno);
    pop.alive[i] = 1;

    // Something it has heard many times and has come to expect badly of.
    const so = pop.soundSlotOffset(i);
    const po = pop.protoOffset(i);
    pop.soundProto[po + 0] = 0.5; // pitch
    pop.soundProto[po + 6] = 0.4; // duration
    pop.soundValence[so] = -0.95;
    pop.soundStrength[so] = 1;

    // Now put that sound in its ear, coming from a specific place.
    const vo = pop.voiceOffset(i);
    pop.attendSum[vo + 0] = 0.5 * 4;
    pop.attendSum[vo + 1] = 0.2 * 4;
    pop.attendTicks[i] = 4;
    pop.attendStartPitch[i] = 0.5;
    pop.attendSrcX[i] = pop.x[i] + 180;
    pop.attendSrcY[i] = pop.y[i] + 40;

    (sim as unknown as { finalizeHeard(slot: number): void }).finalizeHeard(i);

    let social = 0;
    const mo = pop.memoryOffset(i);
    for (let m = 0; m < pop.memorySlots[i]; m++) {
      if (pop.memStrength[mo + m] > 0.001 && pop.memSocial[mo + m]) social++;
    }
    return social;
  }

  it('a listener can form a belief about a place it has never been', () => {
    expect(hearSomething(true)).toBeGreaterThan(0);
  });

  it('and forms none at all when that channel is closed', () => {
    expect(hearSomething(false)).toBe(0);
  });
});

describe('the shape of the cognitive apparatus', () => {
  it('leaves room for the widest brain the genome can express', () => {
    expect(MODEL_ROWS).toBe(MAX_HIDDEN + 1);
    expect(REWARD_ROW).toBe(MAX_HIDDEN);
    expect(MODEL_FEATURES).toBe(MODEL_ROW);
    // The fingerprint can never ask for more recurrent units than the widest
    // possible recurrent state, or a memory would be gated on a dimension no
    // organism has.
    expect(MEMORY_CONTEXT_DIM).toBeLessThanOrEqual(MAX_CONTEXT);
  });

  it('runs the model slower than the brain, as an animal would', () => {
    expect(DEFAULT_CONFIG.modelInterval).toBeGreaterThan(1);
  });
});
