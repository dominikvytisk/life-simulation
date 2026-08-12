import { useMemo } from 'react';
import { useStore } from '../app/store';
import { Chart, type Series } from './Chart';
import { Section } from './ui';

/**
 * Time series. The pairings are chosen so each chart answers a question:
 * population against food shows whether the ecosystem is resource-limited,
 * predation against population shows whether cycles have formed, brain size
 * against lifespan shows whether investment in cognition is paying off.
 */
export function ChartsPanel() {
  const history = useStore((s) => s.history);

  const charts = useMemo(() => {
    if (!history) return null;
    const s = history.series;
    const groups: { title: string; series: Series[]; zeroBased?: boolean }[] = [
      {
        title: 'Population & species',
        series: [
          { label: 'population', data: s.population, color: '#7ddc7d' },
          { label: 'species', data: s.species, color: '#4ee0c8', secondary: true },
        ],
      },
      {
        title: 'Births & deaths per tick',
        series: [
          { label: 'births', data: s.births, color: '#6aa8ff' },
          { label: 'deaths', data: s.deaths, color: '#ff6b5e' },
        ],
      },
      {
        title: 'Resources',
        series: [
          { label: 'vegetation', data: s.vegetation, color: '#7ddc7d' },
          { label: 'carrion', data: s.carrion, color: '#ff8a5e', secondary: true },
        ],
      },
      {
        title: 'Predation & carnivory',
        series: [
          { label: 'kills/tick', data: s.predationRate, color: '#ff6b5e' },
          { label: 'mean gut (meat)', data: s.carnivory, color: '#ffb454', secondary: true },
        ],
      },
      {
        title: 'Genetic diversity',
        series: [{ label: 'mean pairwise distance', data: s.diversity, color: '#c98aff' }],
        zeroBased: false,
      },
      {
        title: 'Brain hardware',
        series: [
          { label: 'brain units', data: s.avgBrainSize, color: '#4ee0c8' },
          { label: 'plasticity', data: s.avgPlasticity, color: '#6aa8ff', secondary: true },
        ],
        zeroBased: false,
      },
      {
        // Accuracy is measured against each organism's own next internal state,
        // so it says the models fit — not that anything is using them well.
        title: 'Prediction',
        series: [
          { label: 'accuracy', data: s.predictionAccuracy, color: '#4ee0c8' },
          { label: 'learning rate', data: s.predictionRate, color: '#ffb454', secondary: true },
        ],
        zeroBased: false,
      },
      {
        // Progress and novelty are deliberately charted together: novelty alone
        // rising is an organism meeting things it cannot predict, which is not
        // the same as learning and should not be read as it.
        title: 'Learning progress & novelty',
        series: [
          { label: 'learning progress', data: s.learningProgress, color: '#7ddc7d' },
          { label: 'novelty met', data: s.novelty, color: '#c98aff', secondary: true },
        ],
        zeroBased: false,
      },
      {
        title: 'Curiosity & deliberation',
        series: [
          { label: 'mean curiosity', data: s.curiosity, color: '#ff8ac8' },
          { label: 'plan horizon', data: s.planning, color: '#5ed3ff', secondary: true },
        ],
        zeroBased: false,
      },
      {
        title: 'Delayed consequences & second-hand belief',
        series: [
          { label: 'toxin burden', data: s.toxinLoad, color: '#ff8a5e' },
          { label: 'heard-not-lived memories/tick', data: s.vicarious, color: '#5ed3ff', secondary: true },
        ],
        zeroBased: false,
      },
      {
        title: 'Body plan drift',
        series: [
          { label: 'size', data: s.avgSize, color: '#ffb454' },
          { label: 'top speed', data: s.avgSpeed, color: '#6aa8ff', secondary: true },
        ],
        zeroBased: false,
      },
      {
        title: 'Vision & lifespan',
        series: [
          { label: 'vision range', data: s.avgVision, color: '#4ee0c8' },
          { label: 'lifespan', data: s.avgLifespan, color: '#c98aff', secondary: true },
        ],
        zeroBased: false,
      },
      {
        title: 'Generations',
        series: [{ label: 'mean generation', data: s.avgGeneration, color: '#7ddc7d' }],
      },
      {
        title: 'Climate',
        series: [{ label: 'temperature', data: s.temperature, color: '#ffb454' }],
        zeroBased: false,
      },
      {
        title: 'Pheromone field activity',
        series: [{ label: 'total field', data: s.signalActivity, color: '#6aa8ff' }],
      },
      {
        title: 'Communication',
        series: [
          { label: 'broadcast per organism', data: s.broadcast, color: '#5ed3ff' },
          { label: 'group size', data: s.groupSize, color: '#ffb454', secondary: true },
        ],
        zeroBased: false,
      },
      {
        title: 'Memory',
        series: [{ label: 'mean memory slots', data: s.avgMemory, color: '#c98aff' }],
        zeroBased: false,
      },
      {
        title: 'Social transmission',
        series: [
          { label: 'imitations/tick', data: s.imitation, color: '#4ee0c8' },
          { label: 'transmission index', data: s.transmission, color: '#ff8ac8', secondary: true },
        ],
        zeroBased: false,
      },
      {
        title: 'Energy sharing',
        series: [{ label: 'transfers/tick', data: s.sharing, color: '#7ddc7d' }],
      },
    ];
    return groups;
  }, [history]);

  if (!history || !charts) {
    return <div className="p-4 text-[11px] text-ink-dim">waiting for the first samples…</div>;
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b border-edge/70 px-3 py-2 text-[10px] text-ink-dim">
        {history.ticks.length} samples · every 60 ticks · x axis is simulation time
      </div>
      {charts.map((c) => (
        <Section key={c.title} title={c.title}>
          <Chart ticks={history.ticks} series={c.series} zeroBased={c.zeroBased ?? true} />
        </Section>
      ))}
    </div>
  );
}
