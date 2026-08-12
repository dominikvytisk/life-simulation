/**
 * Deterministic per-(organism, tick, channel) sensory error, in [-1, 1).
 *
 * Between the world and an organism there is an instrument, and no instrument
 * reads true. This is the whole of that idea: a cheap eye reports a gradient
 * roughly, a sharp one reports it almost exactly, and neither ever receives the
 * number the world actually holds.
 *
 * Hashed rather than drawn from the simulation RNG, deliberately. Sensory error
 * belongs to one animal reading one quantity at one moment; routing tens of
 * thousands of those through the shared stream every tick would make the run's
 * entire randomness depend on how many organisms happened to be alive, which is
 * exactly the coupling that would make a forked experiment drift away from its
 * own control for reasons nobody chose.
 */
export function senseNoise(slot: number, tick: number, channel: number): number {
  let h = Math.imul(slot ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (tick + channel * 0x27d4eb2f), 0xc2b2ae35);
  h ^= h >>> 15;
  return (h >>> 0) / 2147483648 - 1;
}
