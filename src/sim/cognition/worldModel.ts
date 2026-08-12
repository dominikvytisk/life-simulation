/**
 * A private, individual model of what tends to happen next.
 *
 * Every organism carries its own. Nothing is shared, nothing is trained across
 * the population, and nothing in here can read the world — the model only ever
 * sees what its owner's own senses produced. Two organisms with identical
 * genomes that lived in different places will hold different models, disagree
 * about the same situation, and act differently because of it.
 *
 * WHAT IT PREDICTS
 *
 *   [ current internal state , action taken ]  ->  [ next internal state , reward ]
 *
 * The "internal state" is not a description of the world written by this file.
 * It is the organism's own hidden layer — whatever its evolved brain happens to
 * compress its senses into. Nobody labels those units, nothing guarantees they
 * mean anything, and what they encode differs from lineage to lineage. That is
 * the point: the model learns to predict the organism's *own representation*,
 * so as the representation evolves, so does what there is to predict.
 *
 * WHY A LINEAR MODEL
 *
 * Thousands of these run at once. A linear map fitted by normalised least mean
 * squares is a few hundred multiply-adds, learns online from single samples
 * without a gradient library, cannot diverge if the step size is bounded, and
 * is small enough that carrying one is a plausible metabolic cost rather than an
 * absurd one. It is a weak model, and that is deliberate: an organism that
 * predicts its world well here has done so because its *brain* found a
 * representation that is linearly predictable, which is a real thing for
 * evolution to discover.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 * There is no notion of food, danger, another organism, or a place. There is no
 * global state, no lookup of anything the owner could not perceive, and no
 * target other than the owner's own next state and its own reward stream.
 */
import { MAX_HIDDEN } from '../genome/phenotype';
import { OUTPUT_COUNT } from '../brain/brain';

/** Row stride: latent columns, then every action channel, then a bias. */
export const MODEL_ROW = MAX_HIDDEN + OUTPUT_COUNT + 1;
/** One row per latent unit, plus one that predicts reward. */
export const MODEL_ROWS = MAX_HIDDEN + 1;
export const MODEL_STRIDE = MODEL_ROW * MODEL_ROWS;
/** Which row predicts the reward that arrives over the next model step. */
export const REWARD_ROW = MAX_HIDDEN;
/** Longest feature vector any organism can present. */
export const MODEL_FEATURES = MODEL_ROW;

/** Reused error slot so nothing allocates on the hot path. */
export interface PredictionError {
  latent: number;
  reward: number;
}

export function makePredictionError(): PredictionError {
  return { latent: 0, reward: 0 };
}

export interface RolloutResult {
  value: number;
  uncertainty: number;
  steps: number;
}

export function makeRolloutResult(): RolloutResult {
  return { value: 0, uncertainty: 0, steps: 0 };
}

/**
 * Build the feature vector for a (state, action) pair, returning its length.
 *
 * Compact: only the latent units this organism actually has are written, so a
 * narrow brain does proportionally less work. Everything past the used range is
 * zeroed, because the same scratch buffer is reused by organisms of different
 * widths within a tick.
 */
export function buildFeatures(
  feat: Float32Array,
  latent: ArrayLike<number>,
  latentOff: number,
  action: ArrayLike<number>,
  hiddenSize: number,
): number {
  for (let h = 0; h < hiddenSize; h++) feat[h] = latent[latentOff + h];
  for (let a = 0; a < OUTPUT_COUNT; a++) feat[hiddenSize + a] = action[a];
  const n = hiddenSize + OUTPUT_COUNT;
  feat[n] = 1;
  for (let k = n + 1; k < MODEL_ROW; k++) feat[k] = 0;
  return n + 1;
}

/**
 * Run the model forward one step. `out` receives the predicted next latent in
 * indices 0..hiddenSize-1 and the predicted reward at REWARD_ROW.
 *
 * Predictions are clamped to the range the quantities actually live in (the
 * latent is a tanh activation, so [-1,1]). An unbounded linear model rolled
 * forward four steps can turn a small weight error into an enormous number, and
 * an organism that imagines an impossible future is not making a mistake
 * selection can act on — it is just broken.
 */
export function predictInto(
  model: Float32Array,
  off: number,
  feat: Float32Array,
  featCount: number,
  hiddenSize: number,
  out: Float32Array,
): void {
  for (let o = 0; o < hiddenSize; o++) {
    const row = off + o * MODEL_ROW;
    let sum = 0;
    for (let k = 0; k < featCount; k++) sum += model[row + k] * feat[k];
    out[o] = sum < -1 ? -1 : sum > 1 ? 1 : sum;
  }
  const rrow = off + REWARD_ROW * MODEL_ROW;
  let r = 0;
  for (let k = 0; k < featCount; k++) r += model[rrow + k] * feat[k];
  out[REWARD_ROW] = r < -2 ? -2 : r > 2 ? 2 : r;
}

/**
 * Fit the model to one observed transition.
 *
 * Normalised LMS: the step is divided by the feature energy, which keeps a
 * single vivid moment from overwriting everything the organism has ever
 * learned. `decay` pulls unrefreshed weights back toward zero — an expectation
 * nobody keeps confirming is eventually given up, and how fast that happens is
 * genetic.
 *
 * The latent error and the reward error are reported separately because they
 * are different failures: being wrong about what the world will look like and
 * being wrong about whether it will go well are not the same mistake.
 */
export function learn(
  model: Float32Array,
  off: number,
  feat: Float32Array,
  featCount: number,
  hiddenSize: number,
  predicted: Float32Array,
  actualLatent: ArrayLike<number>,
  latentOff: number,
  actualReward: number,
  rate: number,
  decay: number,
  errOut: PredictionError,
): void {
  let energy = 1e-3;
  for (let k = 0; k < featCount; k++) energy += feat[k] * feat[k];
  const step = rate / energy;
  const keep = 1 - decay;

  let latentErr = 0;
  for (let o = 0; o < hiddenSize; o++) {
    const row = off + o * MODEL_ROW;
    const e = actualLatent[latentOff + o] - predicted[o];
    latentErr += e < 0 ? -e : e;
    const g = step * e;
    for (let k = 0; k < featCount; k++) model[row + k] = model[row + k] * keep + g * feat[k];
  }

  const rrow = off + REWARD_ROW * MODEL_ROW;
  const re = actualReward - predicted[REWARD_ROW];
  const rg = step * re;
  for (let k = 0; k < featCount; k++) model[rrow + k] = model[rrow + k] * keep + rg * feat[k];

  errOut.latent = hiddenSize > 0 ? latentErr / hiddenSize : 0;
  errOut.reward = re < 0 ? -re : re;
}

/**
 * Accumulate how much of each feature this organism has actually seen. This is
 * the raw material for knowing what it does *not* know: a feature the model has
 * barely been exposed to is one whose weights nothing has yet constrained.
 */
export function noteExposure(
  exposure: Float32Array,
  off: number,
  feat: Float32Array,
  featCount: number,
  forget: number,
): void {
  const keep = 1 - forget;
  for (let k = 0; k < featCount; k++) {
    const v = feat[k];
    exposure[off + k] = exposure[off + k] * keep + (v < 0 ? -v : v);
  }
}

/**
 * How poorly constrained this particular situation is, in [0,1].
 *
 * A cheap diagonal proxy for epistemic uncertainty: each feature contributes in
 * proportion to how strongly it is present and how little of it has been seen
 * before. It is not a posterior variance and does not pretend to be — it is a
 * quantity that is large in genuinely unfamiliar circumstances, small in
 * well-trodden ones, and costs one pass over the feature vector.
 *
 * The distinction that matters for curiosity is *not* made here: something can
 * be unfamiliar and permanently unlearnable. Whether the organism should care
 * is decided by combining this with its learning progress, which is the
 * caller's business.
 */
export function uncertainty(
  exposure: Float32Array,
  off: number,
  feat: Float32Array,
  featCount: number,
): number {
  let weighted = 0;
  let total = 1e-6;
  for (let k = 0; k < featCount; k++) {
    const v = feat[k] < 0 ? -feat[k] : feat[k];
    total += v;
    weighted += v / (1 + exposure[off + k]);
  }
  const u = weighted / total;
  return u < 0 ? 0 : u > 1 ? 1 : u;
}

/**
 * Imagine holding one action for several model steps and report what the
 * organism expects to get out of it.
 *
 * Held constant, deliberately. Rolling a *different* imagined action at each
 * step would need an imagined sensory input to feed the brain, and there is no
 * way to invert a latent state back into senses. What this can represent is
 * therefore a motor plan — "if I keep doing this, where does it go" — which is
 * a modest thing to be able to imagine and an honest one.
 *
 * All buffers are caller-owned; nothing is allocated here.
 */
export function rollout(
  model: Float32Array,
  off: number,
  exposure: Float32Array,
  expOff: number,
  latent: ArrayLike<number>,
  latentOff: number,
  action: ArrayLike<number>,
  hiddenSize: number,
  horizon: number,
  discount: number,
  feat: Float32Array,
  pred: Float32Array,
  imagined: Float32Array,
  out: RolloutResult,
): void {
  for (let h = 0; h < hiddenSize; h++) imagined[h] = latent[latentOff + h];

  let value = 0;
  let unc = 0;
  let weight = 1;
  let steps = 0;

  for (let t = 0; t < horizon; t++) {
    const featCount = buildFeatures(feat, imagined, 0, action, hiddenSize);
    // Uncertainty is only sampled on the first step. Beyond that the state
    // being scored is itself imagined, so "how unfamiliar is it" would be a
    // statement about a place the organism has never been and may never go.
    if (t === 0) unc = uncertainty(exposure, expOff, feat, featCount);
    predictInto(model, off, feat, featCount, hiddenSize, pred);
    value += weight * pred[REWARD_ROW];
    for (let h = 0; h < hiddenSize; h++) imagined[h] = pred[h];
    weight *= discount;
    steps++;
  }

  out.value = value;
  out.uncertainty = unc;
  out.steps = steps;
}
