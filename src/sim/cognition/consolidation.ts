/**
 * Offline replay.
 *
 * An organism only ever gets one shot at each moment as it happens, and a
 * single-sample online fit throws most of that moment away. Holding a few
 * recent transitions and re-fitting them while at rest is the cheapest possible
 * version of something real animals do: the same experience is presented to the
 * learner more than once, and the second presentation happens when nothing else
 * is competing for the machinery.
 *
 * It is not free and it is not obviously worth it. Resting is time not spent
 * eating, the replay itself costs energy, and the buffer costs upkeep whether or
 * not it is ever used. Whether a lineage evolves to do it depends on whether
 * its world contains structure that one pass fails to extract — which is a
 * property of the environment, not of this file.
 *
 * The buffer holds *only what the organism itself perceived and did*. Nothing
 * is inserted into it from outside, so replaying it can never introduce
 * information the owner did not already have.
 */
import { OUTPUT_COUNT } from '../brain/brain';
import {
  MODEL_ROW,
  MODEL_ROWS,
  REWARD_ROW,
  type PredictionError,
  learn,
  predictInto,
} from './worldModel';

/** How many past transitions one organism can hold for replay. */
export const REPLAY_DEPTH = 4;
/** Features, then the target that followed them. */
export const REPLAY_ENTRY = MODEL_ROW + MODEL_ROWS;
export const REPLAY_STRIDE = REPLAY_DEPTH * REPLAY_ENTRY;

/**
 * Record one lived transition. The oldest is displaced — there is no priority
 * scheme, because ranking experiences by how surprising they were is exactly
 * the sort of thing that quietly turns into a designer's objective.
 */
export function pushReplay(
  replay: Float32Array,
  off: number,
  head: number,
  feat: Float32Array,
  featCount: number,
  actualLatent: ArrayLike<number>,
  latentOff: number,
  hiddenSize: number,
  actualReward: number,
): number {
  const base = off + head * REPLAY_ENTRY;
  for (let k = 0; k < featCount; k++) replay[base + k] = feat[k];
  for (let k = featCount; k < MODEL_ROW; k++) replay[base + k] = 0;
  const t = base + MODEL_ROW;
  for (let h = 0; h < hiddenSize; h++) replay[t + h] = actualLatent[latentOff + h];
  replay[t + REWARD_ROW] = actualReward;
  return (head + 1) % REPLAY_DEPTH;
}

/**
 * Re-fit the model on one stored transition.
 *
 * The feature length is recomputed from the organism's own width rather than
 * stored: latent units, every action channel, then the bias. The bias slot is
 * therefore 1 on any entry that was really written, which is how an unused slot
 * is told from a real one — a newborn that rests immediately trains on nothing
 * rather than on a buffer of zeroes.
 *
 * Returns whether anything was replayed.
 */
export function replayOne(
  replay: Float32Array,
  off: number,
  slot: number,
  model: Float32Array,
  modelOff: number,
  hiddenSize: number,
  rate: number,
  decay: number,
  feat: Float32Array,
  pred: Float32Array,
  err: PredictionError,
): boolean {
  const base = off + (slot % REPLAY_DEPTH) * REPLAY_ENTRY;
  const featCount = hiddenSize + OUTPUT_COUNT + 1;
  if (replay[base + featCount - 1] < 0.5) return false;

  for (let k = 0; k < featCount; k++) feat[k] = replay[base + k];
  const t = base + MODEL_ROW;
  predictInto(model, modelOff, feat, featCount, hiddenSize, pred);
  learn(
    model,
    modelOff,
    feat,
    featCount,
    hiddenSize,
    pred,
    replay,
    t,
    replay[t + REWARD_ROW],
    rate,
    decay,
    err,
  );
  return true;
}
