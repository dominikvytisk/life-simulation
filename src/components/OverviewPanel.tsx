import { useStore } from '../app/store';
import { Bar, Section, Stat, fmt } from './ui';
import { EventFeed } from './EventFeed';

/**
 * The at-a-glance state of the ecosystem. Grouped by question rather than by
 * data source: "how many are there", "what are they becoming", "what is the
 * world doing to them".
 */
export function OverviewPanel() {
  const stats = useStore((s) => s.stats);
  if (!stats) return <div className="p-4 text-ink-dim">initialising…</div>;

  const netFlow = stats.birthsPerTick - stats.deathsPerTick;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <Section title="Population">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="alive" value={fmt(stats.population)} tone="life" />
          <Stat label="species" value={stats.livingSpecies} tone="accent" />
          <Stat label="extinct" value={stats.extinctSpecies} tone="danger" />
          <Stat label="births/tick" value={stats.birthsPerTick.toFixed(2)} />
          <Stat label="deaths/tick" value={stats.deathsPerTick.toFixed(2)} />
          <Stat
            label="net flow"
            value={`${netFlow >= 0 ? '+' : ''}${netFlow.toFixed(2)}`}
            tone={netFlow >= 0 ? 'life' : 'danger'}
          />
          <Stat label="total born" value={fmt(stats.births)} />
          <Stat label="total died" value={fmt(stats.deaths)} />
          <Stat label="predation/tick" value={stats.killsPerTick.toFixed(3)} tone="danger" />
        </div>
      </Section>

      <Section title="Evolution">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="max gen" value={fmt(stats.maxGeneration)} tone="accent" />
          <Stat label="mean gen" value={stats.avgGeneration.toFixed(1)} />
          <Stat label="diversity" value={stats.diversity.toFixed(3)} />
          <Stat label="brain units" value={stats.avgBrainSize.toFixed(1)} />
          <Stat label="plasticity" value={stats.avgPlasticity.toFixed(4)} />
          <Stat label="mutability" value={stats.avgMutationRate.toFixed(2)} />
        </div>
      </Section>

      <Section title="Cognition & society">
        <div className="grid grid-cols-3 gap-3">
          <Stat
            label="memory slots"
            value={stats.avgMemorySlots.toFixed(2)}
            tone={stats.avgMemorySlots > 1 ? 'accent' : 'default'}
          />
          <Stat label="hearing" value={fmt(stats.avgHearingRange)} unit="u" />
          <Stat label="group size" value={stats.avgGroupSize.toFixed(2)} />
          <Stat label="broadcast" value={stats.broadcastActivity.toFixed(3)} />
          <Stat
            label="imitations/tick"
            value={stats.imitationsPerTick.toFixed(3)}
            tone={stats.imitationsPerTick > 0 ? 'accent' : 'default'}
          />
          <Stat label="transfers/tick" value={stats.sharesPerTick.toFixed(3)} />
          <Stat
            label="signal meaning"
            value={stats.signalMeaningConfidence.toFixed(2)}
            title="Strongest measured correlation between any channel and any context or response"
          />
          <Stat
            label="transmission"
            value={stats.transmissionIndex.toFixed(4)}
            tone={stats.transmissionIndex > 0.02 ? 'life' : 'default'}
            title="Learned-behaviour clustering beyond what relatedness explains"
          />
          <Stat
            label="posthumous memes"
            value={stats.posthumousMemes}
            tone={stats.posthumousMemes > 0 ? 'life' : 'default'}
          />
        </div>
        <div className="mt-3 space-y-1.5">
          <MeterRow
            label="carnivory"
            value={stats.carnivory}
            note={`${(stats.carnivoreFraction * 100).toFixed(0)}% meat-gutted`}
            color="var(--color-danger)"
          />
          <MeterRow
            label="aquatic"
            value={stats.aquaticFraction}
            note={`${(stats.aquaticFraction * 100).toFixed(0)}% water-adapted`}
            color="var(--color-accent-2)"
          />
          <MeterRow
            label="mean energy"
            value={stats.avgEnergy}
            note={`${(stats.avgEnergy * 100).toFixed(0)}% of capacity`}
            color="var(--color-life)"
          />
        </div>
      </Section>

      <Section title="Body plans (population mean)">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="size" value={stats.avgSize.toFixed(2)} unit="u" />
          <Stat label="top speed" value={stats.avgSpeed.toFixed(1)} unit="u/s" />
          <Stat label="vision" value={fmt(stats.avgVision)} unit="u" />
          <Stat label="age" value={fmt(stats.avgAge)} unit="t" />
          <Stat label="lifespan" value={fmt(stats.avgLifespan)} unit="t" />
          <Stat label="ms/tick" value={stats.msPerTick.toFixed(2)} />
        </div>
      </Section>

      <Section title="Environment">
        <div className="grid grid-cols-3 gap-3">
          <Stat
            label="temperature"
            value={stats.temperature.toFixed(3)}
            tone={stats.temperature > 0.66 ? 'warn' : stats.temperature < 0.34 ? 'accent' : 'default'}
          />
          <Stat label="daylight" value={`${(stats.light * 100).toFixed(0)}%`} />
          <Stat label="day" value={fmt(stats.day)} />
          <Stat label="vegetation" value={fmt(stats.totalVegetation)} tone="life" />
          <Stat label="carrion" value={fmt(stats.totalCarrion, 1)} tone="danger" />
          <Stat label="signal field" value={fmt(stats.signalActivity, 1)} tone="accent" />
        </div>
      </Section>

      <Section title="Event log">
        <EventFeed limit={40} />
      </Section>
    </div>
  );
}

function MeterRow({
  label,
  value,
  note,
  color,
}: {
  label: string;
  value: number;
  note: string;
  color: string;
}) {
  return (
    <div>
      <div className="mb-0.5 flex justify-between text-[10px] text-ink-dim">
        <span>{label}</span>
        <span className="tabular-nums">{note}</span>
      </div>
      <Bar value={value} color={color} />
    </div>
  );
}
