/** Shared value types that cross the worker boundary. Keep these structurally
 * cloneable — no classes, no functions. */
import type { NicheProfile } from '../analysis/niches';
import type { CultureReport } from '../analysis/culture';
import type { SignalMeaning } from '../analysis/signals';
import type { AnomalyReport, Milestone } from '../analysis/chronicle';

export type { NicheProfile, CultureReport, SignalMeaning, AnomalyReport, Milestone };

export interface Stats {
  tick: number;
  population: number;
  livingSpecies: number;
  totalSpeciesEverCreated: number;
  extinctSpecies: number;
  births: number;
  deaths: number;
  birthsPerTick: number;
  deathsPerTick: number;
  killsPerTick: number;
  sharesPerTick: number;
  imitationsPerTick: number;
  avgEnergy: number;
  avgAge: number;
  avgLifespan: number;
  avgBrainSize: number;
  avgSize: number;
  avgSpeed: number;
  avgVision: number;
  avgGeneration: number;
  maxGeneration: number;
  avgPlasticity: number;
  avgMutationRate: number;
  avgMemorySlots: number;
  avgHearingRange: number;
  avgSocialLearning: number;
  avgGroupSize: number;
  /** Mean broadcast output per organism, across all channels. */
  broadcastActivity: number;
  /** Learned-behaviour clustering beyond what relatedness explains. */
  transmissionIndex: number;
  distinctMemes: number;
  posthumousMemes: number;
  /** Strongest measured signal-channel correlation, 0 if none detected. */
  signalMeaningConfidence: number;
  diversity: number;
  carnivory: number; // mean gut specialisation, 0 = all plant, 1 = all meat
  carnivoreFraction: number; // fraction with a meat-leaning gut
  aquaticFraction: number;
  totalVegetation: number;
  totalCarrion: number;
  signalActivity: number;
  temperature: number;
  light: number;
  day: number;
  year: number;
  ticksPerSecond: number;
  msPerTick: number;
}

export interface SpeciesSummary {
  id: number;
  name: string;
  ancestorId: number;
  population: number;
  peakPopulation: number;
  originTick: number;
  extinctTick: number;
  generationOrigin: number;
  totalBorn: number;
  hue: number;
  traits: number[]; // mean genome of living members
  avgSize: number;
  avgSpeed: number;
  avgBrain: number;
  avgMemory: number;
  avgSocialLearning: number;
  carnivory: number;
  /** Inferred from telemetry, never assigned. Null until enough samples. */
  niche: NicheProfile | null;
}

export interface OrganismInspection {
  slot: number;
  id: number;
  speciesId: number;
  speciesName: string;
  generation: number;
  parentA: number;
  parentB: number;
  /** Unbroken maternal line id — a family label, not a species. */
  matriline: number;
  /** Whose learned behaviour this organism is currently running. */
  memeTag: number;
  age: number;
  lifespan: number;
  maturationAge: number;
  energy: number;
  maxEnergy: number;
  health: number;
  x: number;
  y: number;
  heading: number;
  speed: number;
  children: number;
  kills: number;
  plantEaten: number;
  meatEaten: number;
  preyEaten: number;
  socialContacts: number;
  distanceTravelled: number;
  imitations: number;
  mutations: number;
  energyGiven: number;
  energyReceived: number;
  kinTag: number[];
  memories: { x: number; y: number; valence: number; strength: number }[];
  emitted: number[];
  genome: number[];
  phenotype: Record<string, number>;
  brainInputs: number[];
  brainHidden: number[];
  brainOutputs: number[];
  brainContext: number[];
  hiddenSize: number;
  contextSize: number;
  /** Flattened input->hidden and hidden->output weight matrices for the brain view. */
  w1: number[];
  w2: number[];
}

export interface SimEventDTO {
  tick: number;
  kind: number;
  text: string;
  speciesId?: number;
  x?: number;
  y?: number;
}

/** Floats per organism in the render snapshot. */
export const SNAPSHOT_STRIDE = 10;

export const SnapshotField = {
  X: 0,
  Y: 1,
  Heading: 2,
  Radius: 3,
  Hue: 4,
  EnergyFraction: 5,
  Elongation: 6,
  Diet: 7,
  Armor: 8,
  Flags: 9,
} as const;

export const SnapshotFlag = {
  Selected: 1,
  Attacking: 2,
  Mating: 4,
  Eating: 8,
  Signalling: 16,
  Juvenile: 32,
} as const;
