/**
 * Experiment presets.
 *
 * Each one is a *config*, not a script. None of them assign roles, spawn
 * predators, or reward a behaviour — they change the physics and economics of
 * the world and then leave it alone. "Predator arms race" does not create
 * predators; it makes plants scarce and meat rich, so a lineage that evolves a
 * meat gut has somewhere to go.
 */
import type { SimConfig } from '../sim/core/config';
import type { WorldEventSpec } from '../sim/events/worldEvents';

export interface Experiment {
  id: string;
  name: string;
  icon: string;
  hypothesis: string;
  whatToWatch: string;
  config: Partial<SimConfig>;
  /** Events fired once the world is running, at the given tick offsets. */
  schedule?: { atTick: number; spec: WorldEventSpec }[];
}

export const EXPERIMENTS: Experiment[] = [
  {
    id: 'baseline',
    name: 'Baseline World',
    icon: '🌍',
    hypothesis: 'A default world with balanced resources and no interference.',
    whatToWatch: 'The first few thousand ticks are mostly starvation. Watch for the moment the population stops crashing and starts oscillating — that is when foraging has evolved.',
    config: {},
  },
  {
    id: 'arms-race',
    name: 'Predator Arms Race',
    icon: '🩸',
    hypothesis:
      'Dense prey plus very energy-rich corpses and cheap attacks should make carnivory profitable, and prey should answer with speed, armor or camouflage.',
    whatToWatch:
      'The carnivory chart. Predator-prey cycles show up as out-of-phase oscillations between population and predation rate.',
    config: {
      // Note what this does *not* do: starve the plants. Scarce vegetation
      // thins the herbivores, and a predator in an empty world finds nothing to
      // hunt. Predation needs dense prey. So plants stay abundant and the
      // change is on the other side of the ledger — meat is worth far more per
      // bite, corpses persist, and striking is cheap.
      vegetationGrowthRate: 0.022,
      carrionEnergyDensity: 260,
      carrionDecayRate: 0.001,
      damageScale: 20,
      attackCost: 0.35,
      attackCooldownTicks: 4,
      initialPopulation: 2600,
    },
  },
  {
    id: 'islands',
    name: 'Island Evolution',
    icon: '🏝',
    hypothesis:
      'A flooded world fragments the land. Isolated populations should diverge and speciate independently.',
    whatToWatch:
      'The species count should climb steadily. Compare traits between species — island populations often dwarf or gigantify.',
    config: {
      waterLevel: 0.52,
      speciationThreshold: 0.1,
      compatibilityThreshold: 0.16,
      initialPopulation: 2200,
    },
  },
  {
    id: 'ice-age',
    name: 'Ice Age',
    icon: '❄',
    hypothesis:
      'Sustained cooling should collapse the vegetation belt toward the equator and select hard on thermal tolerance.',
    whatToWatch:
      'Populations retreating toward the warm band, then either adapting or going extinct. Mutation rate often rises first.',
    config: { seasonAmplitude: 0.2 },
    schedule: [{ atTick: 1500, spec: { type: 'iceAge', magnitude: 1.1, durationTicks: 30000 } }],
  },
  {
    id: 'intelligence',
    name: 'Complex Environment',
    icon: '🧠',
    hypothesis:
      'Patchy, fast-changing resources should reward memory and larger brains — if the upkeep cost is worth paying.',
    whatToWatch:
      'Average brain size and plasticity. Brains only grow when the environment is hard enough to justify their cost.',
    config: {
      // Food is rich but the world swings hard and fast, so remembering where
      // things were is worth more than reacting to what is in front of you.
      vegetationGrowthRate: 0.024,
      vegetationEnergyDensity: 30,
      seasonAmplitude: 0.3,
      ticksPerDay: 140,
      daysPerYear: 14,
      brainMutationRate: 0.055,
      structuralMutationRate: 0.02,
    },
  },
  {
    id: 'communication',
    name: 'Signal Economy',
    icon: '📡',
    hypothesis:
      'Long-lived, far-diffusing signal fields plus clustered food should make broadcasting worth its metabolic cost.',
    whatToWatch:
      'Signal activity rising alongside population. Switch the map to the Signal Field overlay and look for trails and territories.',
    config: {
      signalDecay: 0.012,
      signalDiffusion: 0.16,
      signalDeposit: 0.6,
      vegetationGrowthRate: 0.013,
      initialPopulation: 2200,
    },
  },
  {
    id: 'social',
    name: 'Dangerous World',
    icon: '👥',
    hypothesis:
      'When solitary organisms die easily, grouping can pay off — through dilution of risk and shared discovery of food.',
    whatToWatch:
      'Clustering on the map. Group living has no rule behind it, so if herds appear they are genuinely emergent.',
    config: {
      damageScale: 26,
      attackCost: 0.5,
      vegetationGrowthRate: 0.014,
      initialPopulation: 2600,
    },
  },
  {
    id: 'abundance',
    name: 'Unlimited Food',
    icon: '🍽',
    hypothesis: 'With scarcity removed, selection on foraging vanishes. What replaces it?',
    whatToWatch:
      'Population saturates at the world cap, then genetic diversity drifts. Competition usually shifts from food to space and mates.',
    config: {
      vegetationGrowthRate: 0.07,
      vegetationEnergyDensity: 60,
      initialPopulation: 1200,
    },
  },
  {
    id: 'extinction',
    name: 'Mass Extinction',
    icon: '☄',
    hypothesis:
      'A large impact should collapse the ecosystem and let a different set of survivors radiate into the empty niches.',
    whatToWatch:
      'The Museum of Life after the impact. Compare which traits the survivors had against the pre-impact averages.',
    config: { initialPopulation: 2400 },
    schedule: [
      { atTick: 6000, spec: { type: 'meteor', magnitude: 1.6 } },
      { atTick: 6200, spec: { type: 'fire', magnitude: 2 } },
    ],
  },
  {
    id: 'aquatic',
    name: 'Ocean World',
    icon: '🌊',
    hypothesis:
      'With most of the map underwater, water affinity becomes the primary axis of adaptation.',
    whatToWatch:
      'The aquatic fraction climbing, and whether coastal generalists or full swimmers dominate.',
    config: { waterLevel: 0.6, initialPopulation: 2600, drowningDamage: 0.7 },
  },
];

export function experimentById(id: string): Experiment {
  return EXPERIMENTS.find((e) => e.id === id) ?? EXPERIMENTS[0];
}
