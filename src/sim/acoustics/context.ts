/**
 * What an observer records alongside a sound.
 *
 * This file is the one place where the anti-cheating rule is easiest to break,
 * so it is worth being precise about what these arrays are.
 *
 * They are *measurements of the world*, taken by the analysis layer at the
 * moment a sound happens, in exactly the way a field biologist with a notebook
 * would take them: was the animal hungry, was there food here, was anything
 * large and carnivorous nearby. They are never shown to an organism, never
 * attached to a sound, and never travel with it. An organism that hears a call
 * receives pitch and loudness and nothing else — it has no access to the
 * emitter's situation, and no way to know why the sound was made.
 *
 * Their only consumer is the statistics module, which reports correlations
 * between them and acoustic clusters. That report is an observation about the
 * population, not a fact the population has access to.
 */

/** Circumstances recorded at the moment a vocalisation begins. */
export const CONTEXT_FEATURES = [
  'low energy',
  'injured',
  'large carnivore near',
  'food here',
  'crowded',
  'kin near',
  'ready to mate',
  'in a fight',
] as const;
export const CALL_CONTEXT_DIM = CONTEXT_FEATURES.length;

/**
 * What a listener did in the ticks after hearing something. `approach` is
 * measured from actual movement relative to where the sound came from, not
 * from any output the network produces — an organism has no "approach the
 * sound" action, only thrust and turn.
 */
export const RESPONSE_FEATURES = [
  'approach',
  'move faster',
  'turn',
  'eat',
  'attack',
  'mate',
  'answer',
  'fall silent',
] as const;
export const RESPONSE_DIM = RESPONSE_FEATURES.length;

export const Response = {
  Approach: 0,
  Speed: 1,
  Turn: 2,
  Eat: 3,
  Attack: 4,
  Mate: 5,
  Answer: 6,
  FallSilent: 7,
} as const;
