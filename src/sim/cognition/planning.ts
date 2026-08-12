/**
 * Internal simulation, and what an organism does with it.
 *
 * The brain still decides. What this adds is the possibility of *checking* a
 * decision before committing to it: take the action the network just produced,
 * invent a few variations on it, run each one forward through the organism's
 * own learned model of the world, and keep whichever one the model expects to
 * go best. With a horizon of zero or a budget of zero — which is what almost
 * every founder has — none of this runs and the organism acts on its raw
 * network output exactly as it did before. Deliberation is a refinement a
 * lineage can evolve into, not a faculty granted to it.
 *
 * Three things are worth being explicit about.
 *
 * There is no planning *algorithm* in the sense of a rule that knows what to do
 * about anything. Nothing here can tell a predator from a plant. It compares
 * numbers its owner's model produced and picks the larger one, and if that
 * model is wrong — which early in life it always is — the plan is worse than no
 * plan at all. Deliberating badly is a real way to die here.
 *
 * The candidates are perturbations of the brain's own proposal rather than
 * samples from the whole action space. An organism considers doing roughly what
 * it was already going to do, slightly differently. How slightly is genetic,
 * and it is the *same* gene that sets how much the unexplained is worth: an
 * incurious animal considers small variations on its habit, a curious one
 * entertains stranger ideas. One gene, two consequences, as with everything
 * else in this codebase that has more than one.
 *
 * A candidate is scored on predicted reward *plus* how little the model knows
 * about it, weighted by curiosity. That single line is where exploration and
 * exploitation come from. Nothing declares a mode; an organism whose curiosity
 * is zero maximises expected reward and repeats what works, one whose curiosity
 * is high will take an action it expects to go worse in order to find out what
 * happens, and everything in between exists too. Which of those survives is a
 * question about the world, not about this file.
 */
import { OUTPUT_COUNT } from '../brain/brain';
import type { Rng } from '../core/rng';
import {
  type RolloutResult,
  rollout,
} from './worldModel';

/** How much a step further into an imagined future is discounted. */
export const PLAN_DISCOUNT = 0.85;

export interface PlanResult {
  /** Predicted value of the chosen action minus that of the brain's own. */
  advantage: number;
  /** Model steps actually rolled — what the deliberation is charged for. */
  steps: number;
  /** How unfamiliar the chosen action was, in [0,1]. */
  uncertainty: number;
}

export function makePlanResult(): PlanResult {
  return { advantage: 0, steps: 0, uncertainty: 0 };
}

/**
 * Choose an action by imagining a few. `chosen` receives the winner.
 *
 * The first candidate is always the brain's untouched output, so deliberation
 * can only ever *decline* to change anything — an organism whose model is
 * useless still has its instinct to fall back on, and the advantage reported
 * back is exactly zero when nothing better was imagined.
 */
export function deliberate(
  model: Float32Array,
  modelOff: number,
  exposure: Float32Array,
  expOff: number,
  latent: ArrayLike<number>,
  latentOff: number,
  base: Float32Array,
  hiddenSize: number,
  horizon: number,
  budget: number,
  curiosity: number,
  jitter: number,
  rng: Rng,
  feat: Float32Array,
  pred: Float32Array,
  imagined: Float32Array,
  candidate: Float32Array,
  chosen: Float32Array,
  scratch: RolloutResult,
  out: PlanResult,
): void {
  out.advantage = 0;
  out.steps = 0;
  out.uncertainty = 0;
  for (let o = 0; o < OUTPUT_COUNT; o++) chosen[o] = base[o];
  if (horizon <= 0 || budget <= 0) return;

  rollout(
    model,
    modelOff,
    exposure,
    expOff,
    latent,
    latentOff,
    base,
    hiddenSize,
    horizon,
    PLAN_DISCOUNT,
    feat,
    pred,
    imagined,
    scratch,
  );
  const baseValue = scratch.value + curiosity * scratch.uncertainty;
  let bestValue = baseValue;
  let steps = scratch.steps;
  out.uncertainty = scratch.uncertainty;

  for (let c = 1; c < budget; c++) {
    // Triangular noise: two uniforms summed. Cheaper than a normal draw and
    // concentrated near no change, so most alternatives considered are small
    // departures and the occasional one is genuinely different.
    for (let o = 0; o < OUTPUT_COUNT; o++) {
      const n = rng.next() + rng.next() - 1;
      let v = base[o] + n * jitter;
      if (v > 1) v = 1;
      else if (v < -1) v = -1;
      candidate[o] = v;
    }
    rollout(
      model,
      modelOff,
      exposure,
      expOff,
      latent,
      latentOff,
      candidate,
      hiddenSize,
      horizon,
      PLAN_DISCOUNT,
      feat,
      pred,
      imagined,
      scratch,
    );
    steps += scratch.steps;
    const value = scratch.value + curiosity * scratch.uncertainty;
    if (value > bestValue) {
      bestValue = value;
      out.uncertainty = scratch.uncertainty;
      for (let o = 0; o < OUTPUT_COUNT; o++) chosen[o] = candidate[o];
    }
  }

  out.advantage = bestValue - baseValue;
  out.steps = steps;
}
