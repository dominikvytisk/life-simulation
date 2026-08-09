/**
 * Ecological niche inference.
 *
 * Nothing here assigns a species a role. Every field is an exponentially
 * weighted average of what members of that species were actually doing and
 * where they actually were, sampled from the live population. The labels at the
 * bottom are thresholds over those measurements, and they are allowed to say
 * "unclear" — which they often do, and should.
 *
 * The averages decay so a species that changes habitat is described by where it
 * lives now rather than where it started.
 */
import { BIOME_NAMES } from '../world/world';

const BIOME_COUNT = 9;
/** Weight given to the newest sample. ~200 samples of memory. */
const ALPHA = 0.005;

export interface NicheAccumulator {
  samples: number;
  temperature: number;
  elevation: number;
  moisture: number;
  waterDepth: number;
  /** Light level weighted by how active the organism was — reveals diurnality. */
  activityLight: number;
  activityTotal: number;
  biome: Float32Array;
  dietPlant: number;
  dietCarrion: number;
  dietPredation: number;
  bodySize: number;
  speed: number;
  vision: number;
  memory: number;
  signalling: number;
  grouping: number;
}

export interface NicheProfile {
  habitat: string;
  habitatConfidence: number;
  activity: string;
  diet: string;
  dietMix: { plant: number; carrion: number; predation: number };
  temperatureRange: [number, number];
  temperature: number;
  waterDepth: number;
  grouping: string;
  communication: string;
  memoryUse: string;
  samples: number;
}

export function makeNicheAccumulator(): NicheAccumulator {
  return {
    samples: 0,
    temperature: 0,
    elevation: 0,
    moisture: 0,
    waterDepth: 0,
    activityLight: 0,
    activityTotal: 0,
    biome: new Float32Array(BIOME_COUNT),
    dietPlant: 0,
    dietCarrion: 0,
    dietPredation: 0,
    bodySize: 0,
    speed: 0,
    vision: 0,
    memory: 0,
    signalling: 0,
    grouping: 0,
  };
}

/** Fold one organism's current situation into its species' running profile. */
export function accumulate(
  a: NicheAccumulator,
  temperature: number,
  elevation: number,
  moisture: number,
  waterDepth: number,
  light: number,
  movement: number,
  biome: number,
  plantEnergy: number,
  carrionEnergy: number,
  predationEnergy: number,
  bodySize: number,
  speed: number,
  vision: number,
  memorySlots: number,
  signalOutput: number,
  neighbourCount: number,
): void {
  // The first samples set the baseline outright; afterwards the average decays.
  const w = a.samples < 20 ? 1 / (a.samples + 1) : ALPHA;
  a.samples++;
  const mix = (prev: number, v: number) => prev + (v - prev) * w;

  a.temperature = mix(a.temperature, temperature);
  a.elevation = mix(a.elevation, elevation);
  a.moisture = mix(a.moisture, moisture);
  a.waterDepth = mix(a.waterDepth, waterDepth);
  // Activity-weighted light: an organism that only moves in the dark drags this
  // toward zero even though it experiences the same day/night cycle as everyone.
  a.activityLight += light * movement;
  a.activityTotal += movement;
  a.bodySize = mix(a.bodySize, bodySize);
  a.speed = mix(a.speed, speed);
  a.vision = mix(a.vision, vision);
  a.memory = mix(a.memory, memorySlots);
  a.signalling = mix(a.signalling, signalOutput);
  a.grouping = mix(a.grouping, neighbourCount);

  for (let i = 0; i < BIOME_COUNT; i++) a.biome[i] *= 1 - w;
  if (biome >= 0 && biome < BIOME_COUNT) a.biome[biome] += w;

  const total = plantEnergy + carrionEnergy + predationEnergy;
  if (total > 0) {
    a.dietPlant = mix(a.dietPlant, plantEnergy / total);
    a.dietCarrion = mix(a.dietCarrion, carrionEnergy / total);
    a.dietPredation = mix(a.dietPredation, predationEnergy / total);
  }
}

export function describe(a: NicheAccumulator): NicheProfile {
  // Habitat = the biome the species is most often found in, but only if it
  // actually prefers it. A species spread evenly gets "generalist".
  let bestBiome = 0;
  let bestShare = 0;
  let biomeSum = 0;
  for (let i = 0; i < BIOME_COUNT; i++) {
    biomeSum += a.biome[i];
    if (a.biome[i] > bestShare) {
      bestShare = a.biome[i];
      bestBiome = i;
    }
  }
  const share = biomeSum > 0 ? bestShare / biomeSum : 0;
  const habitat = share > 0.45 ? BIOME_NAMES[bestBiome] : 'generalist';

  const meanLight = a.activityTotal > 0.0001 ? a.activityLight / a.activityTotal : 0.5;
  const activity =
    a.activityTotal < 0.0001
      ? 'sessile'
      : meanLight > 0.62
        ? 'diurnal'
        : meanLight < 0.38
          ? 'nocturnal'
          : 'cathemeral';

  const { dietPlant: p, dietCarrion: c, dietPredation: k } = a;
  let diet = 'unclear';
  const sum = p + c + k;
  if (sum > 0.001) {
    const meat = (c + k) / sum;
    if (meat < 0.15) diet = 'herbivore';
    else if (meat > 0.8) diet = k > c * 1.5 ? 'predator' : 'scavenger';
    else diet = k > 0.25 * sum ? 'omnivore (hunts)' : 'omnivore';
  }

  const grouping = a.grouping > 6 ? 'gregarious' : a.grouping > 2 ? 'loose groups' : 'solitary';
  const communication =
    a.signalling > 0.35 ? 'vocal' : a.signalling > 0.1 ? 'occasional' : 'silent';
  const memoryUse = a.memory > 4 ? 'strong' : a.memory > 1.2 ? 'some' : 'none';

  // A tolerance band rather than a measured min/max: the running average cannot
  // recover true extremes, so this is stated as an estimate around the mean.
  const spread = 0.06;
  return {
    habitat,
    habitatConfidence: share,
    activity,
    diet,
    dietMix: { plant: p, carrion: c, predation: k },
    temperatureRange: [a.temperature - spread, a.temperature + spread],
    temperature: a.temperature,
    waterDepth: a.waterDepth,
    grouping,
    communication,
    memoryUse,
    samples: a.samples,
  };
}
