/**
 * Gene space. Every locus is a float in [0,1]; the phenotype layer maps those
 * to physical quantities. Keeping the raw genome uniform means mutation,
 * crossover and genetic-distance code never needs to know what a gene *means*.
 *
 * NOTE: there is deliberately no "diet type", "species" or "role" gene that
 * switches behaviour. `Digestion` is a continuous gut-chemistry tradeoff, not
 * a class label — herbivores and carnivores have to be *discovered*.
 */
export const Locus = {
  BodySize: 0,
  Muscle: 1, // top speed / thrust per unit mass
  Strength: 2, // bite damage
  Armor: 3, // damage reduction, costs mass
  Spikes: 4, // passive retaliation damage
  VisionRange: 5,
  VisionAcuity: 6, // sharper directional discrimination, costs energy
  SmellRange: 7, // sampling radius of the signal fields
  Metabolism: 8, // burn rate; high = fast/responsive but expensive
  EnergyCapacity: 9,
  Lifespan: 10,
  Maturation: 11, // fraction of lifespan before reproduction is possible
  ReproThreshold: 12, // energy fraction required to reproduce
  OffspringInvestment: 13, // energy handed to each child
  Fecundity: 14, // clutch size
  Digestion: 15, // 0 = pure plant gut, 1 = pure meat gut
  TempPreference: 16,
  TempTolerance: 17,
  WaterAffinity: 18, // 0 = drowns, 1 = fully aquatic
  Camouflage: 19, // reduces detectability by others
  SignalGain: 20, // how loudly emitted signals are deposited
  SignalSensitivity: 21,
  BrainHidden: 22, // hidden layer width (structural)
  BrainContext: 23, // recurrent state width (structural, gives memory)
  Plasticity: 24, // lifetime Hebbian learning rate
  MutationRate: 25, // evolvable mutability
  Hue: 26, // near-neutral marker: drifts freely, useful for tracking lineages
  Pattern: 27, // second neutral marker used for body ornamentation

  // --- cognition, communication and sociality (capabilities, never behaviour) ---
  MemoryCapacity: 28, // number of episodic place-memories that can be held
  MemoryPersistence: 29, // how slowly those memories fade
  HearingRange: 30, // radius over which sound is audible at all
  SocialLearning: 31, // how strongly another organism's soma can be copied

  // --- vocal anatomy (what sounds the body can physically make) ---
  // These describe a sound-producing organ, not a vocabulary. Nothing here
  // knows what a sound is for; between them they only decide which corner of
  // acoustic space a given lineage can reach.
  VocalLowEdge: 32, // one edge of the producible frequency band
  VocalHighEdge: 33, // the other edge; the pair defines range and register
  VocalTimbre: 34, // tract character: bright/tonal at 0, rough/noisy at 1
  VocalAgility: 35, // how fast pitch and amplitude can be modulated
  VocalPower: 36, // loudness the apparatus can drive

  // --- auditory anatomy (what sounds the body can physically hear) ---
  AuditoryLowEdge: 37,
  AuditoryHighEdge: 38,
  AuditoryResolution: 39, // frequency discrimination; blurs everything below it
  SoundMemory: 40, // echoic depth and how many sound patterns can be held
} as const;

export type LocusName = keyof typeof Locus;
export const GENOME_LENGTH = 41;

export const LOCUS_NAMES: string[] = (() => {
  const arr = new Array<string>(GENOME_LENGTH);
  for (const [k, v] of Object.entries(Locus)) arr[v as number] = k;
  return arr;
})();

/** Human-readable labels for the inspector. */
export const LOCUS_LABELS: Record<string, string> = {
  BodySize: 'Body size',
  Muscle: 'Muscle',
  Strength: 'Strength',
  Armor: 'Armor',
  Spikes: 'Spikes',
  VisionRange: 'Vision range',
  VisionAcuity: 'Vision acuity',
  SmellRange: 'Smell range',
  Metabolism: 'Metabolism',
  EnergyCapacity: 'Energy capacity',
  Lifespan: 'Lifespan',
  Maturation: 'Maturation',
  ReproThreshold: 'Repro. threshold',
  OffspringInvestment: 'Offspring investment',
  Fecundity: 'Fecundity',
  Digestion: 'Gut (plant↔meat)',
  TempPreference: 'Temp. preference',
  TempTolerance: 'Temp. tolerance',
  WaterAffinity: 'Water affinity',
  Camouflage: 'Camouflage',
  SignalGain: 'Signal gain',
  SignalSensitivity: 'Signal sensitivity',
  BrainHidden: 'Brain width',
  BrainContext: 'Memory width',
  Plasticity: 'Plasticity',
  MutationRate: 'Mutation rate',
  Hue: 'Hue (neutral)',
  Pattern: 'Pattern (neutral)',
  MemoryCapacity: 'Memory capacity',
  MemoryPersistence: 'Memory persistence',
  HearingRange: 'Hearing range',
  SocialLearning: 'Social learning',
  VocalLowEdge: 'Voice band edge A',
  VocalHighEdge: 'Voice band edge B',
  VocalTimbre: 'Vocal tract timbre',
  VocalAgility: 'Vocal agility',
  VocalPower: 'Vocal power',
  AuditoryLowEdge: 'Hearing band edge A',
  AuditoryHighEdge: 'Hearing band edge B',
  AuditoryResolution: 'Frequency resolution',
  SoundMemory: 'Sound memory',
};

/**
 * Per-locus weighting for genetic distance. Neutral markers count for little,
 * so speciation tracks ecologically meaningful divergence rather than drift.
 */
export const DISTANCE_WEIGHTS = (() => {
  const w = new Float32Array(GENOME_LENGTH).fill(1);
  w[Locus.Hue] = 0.15;
  w[Locus.Pattern] = 0.15;
  w[Locus.MutationRate] = 0.3;
  w[Locus.Digestion] = 2.2; // diet divergence is a strong speciation signal
  w[Locus.BodySize] = 1.8;
  w[Locus.WaterAffinity] = 1.6;
  w[Locus.BrainHidden] = 0.6;
  w[Locus.BrainContext] = 0.6;
  w[Locus.MemoryCapacity] = 0.6;
  w[Locus.MemoryPersistence] = 0.4;
  w[Locus.SocialLearning] = 0.5;
  // Vocal and auditory anatomy weigh less than body plan but more than a
  // neutral marker: two populations that can no longer hear each other are
  // genuinely diverging, and this is the term that lets that show up in the
  // speciation measure without dominating it.
  w[Locus.VocalLowEdge] = 0.7;
  w[Locus.VocalHighEdge] = 0.7;
  w[Locus.VocalTimbre] = 0.5;
  w[Locus.VocalAgility] = 0.5;
  w[Locus.VocalPower] = 0.5;
  w[Locus.AuditoryLowEdge] = 0.7;
  w[Locus.AuditoryHighEdge] = 0.7;
  w[Locus.AuditoryResolution] = 0.4;
  w[Locus.SoundMemory] = 0.5;
  return w;
})();

const WEIGHT_SUM = DISTANCE_WEIGHTS.reduce((a, b) => a + b, 0);

/**
 * What kind of change a mutation at each locus represents. This is a reporting
 * classification only — it does not affect how mutation works. It exists so the
 * chronicle can say "this lineage's last 400 mutations were 70% sensory"
 * instead of just counting them.
 */
export const MutationCategory = {
  Parameter: 0,
  Morphological: 1,
  Sensory: 2,
  Developmental: 3,
  Neural: 4,
  Structural: 5,
} as const;
export type MutationCategoryId = (typeof MutationCategory)[keyof typeof MutationCategory];

export const MUTATION_CATEGORY_NAMES = [
  'parameter',
  'morphological',
  'sensory',
  'developmental',
  'neural',
  'structural',
];

export const LOCUS_CATEGORY: Uint8Array = (() => {
  const c = new Uint8Array(GENOME_LENGTH).fill(MutationCategory.Parameter);
  for (const l of [Locus.BodySize, Locus.Muscle, Locus.Strength, Locus.Armor, Locus.Spikes]) {
    c[l] = MutationCategory.Morphological;
  }
  for (const l of [
    Locus.VisionRange,
    Locus.VisionAcuity,
    Locus.SmellRange,
    Locus.HearingRange,
    Locus.SignalSensitivity,
    Locus.AuditoryLowEdge,
    Locus.AuditoryHighEdge,
    Locus.AuditoryResolution,
  ]) {
    c[l] = MutationCategory.Sensory;
  }
  for (const l of [
    Locus.VocalLowEdge,
    Locus.VocalHighEdge,
    Locus.VocalTimbre,
    Locus.VocalAgility,
    Locus.VocalPower,
  ]) {
    c[l] = MutationCategory.Morphological;
  }
  for (const l of [
    Locus.Lifespan,
    Locus.Maturation,
    Locus.ReproThreshold,
    Locus.OffspringInvestment,
    Locus.Fecundity,
  ]) {
    c[l] = MutationCategory.Developmental;
  }
  for (const l of [
    Locus.BrainHidden,
    Locus.BrainContext,
    Locus.Plasticity,
    Locus.MemoryCapacity,
    Locus.MemoryPersistence,
    Locus.SocialLearning,
    Locus.SoundMemory,
  ]) {
    c[l] = MutationCategory.Neural;
  }
  return c;
})();

export type MutationTally = Uint32Array; // indexed by MutationCategory
export function makeMutationTally(): MutationTally {
  return new Uint32Array(MUTATION_CATEGORY_NAMES.length);
}

/**
 * Weighted mean absolute difference between two genomes, in [0,1].
 * Used for mate compatibility, kin recognition and speciation.
 */
export function geneticDistance(a: Float32Array, ao: number, b: Float32Array, bo: number): number {
  let sum = 0;
  for (let i = 0; i < GENOME_LENGTH; i++) {
    const d = a[ao + i] - b[bo + i];
    sum += (d < 0 ? -d : d) * DISTANCE_WEIGHTS[i];
  }
  return sum / WEIGHT_SUM;
}
