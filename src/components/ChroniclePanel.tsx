import { useStore } from '../app/store';
import { Section, fmt } from './ui';
import { MUTATION_CATEGORY_NAMES } from '../sim/genome/loci';

/**
 * The world's history, derived rather than authored.
 *
 * Milestones fire when a measurable threshold is crossed and stays crossed;
 * anomalies fire when a series leaves its own rolling baseline by more than
 * three standard deviations for several samples. Both carry the numbers that
 * triggered them so the claim can be checked rather than taken on trust.
 */
export function ChroniclePanel() {
  const milestones = useStore((s) => s.milestones);
  const anomalies = useStore((s) => s.anomalies);
  const tally = useStore((s) => s.mutationTally);
  const stats = useStore((s) => s.stats);

  const totalMutations = tally.reduce((a, b) => a + b, 0);

  return (
    <div className="h-full overflow-y-auto">
      <Section title={`Timeline — ${milestones.length} milestones`}>
        {milestones.length === 0 ? (
          <p className="text-[10px] leading-relaxed text-ink-dim">
            Nothing has happened yet that meets the evidence bar.
            <br />
            <span className="text-ink-dim/60">
              Milestones are not scheduled. If communication never evolves, no communication
              milestone is ever written.
            </span>
          </p>
        ) : (
          <ol className="relative space-y-3 pl-4">
            <span className="absolute top-1 bottom-1 left-[3px] w-px bg-edge" />
            {milestones.map((m) => (
              <li key={m.id} className="relative">
                <span className="absolute top-[5px] -left-[13px] h-1.5 w-1.5 rounded-full bg-accent" />
                <div className="flex items-baseline gap-2">
                  <span className="text-[11px] text-ink">{m.label}</span>
                  <span className="text-[9px] tabular-nums text-ink-dim">
                    tick {fmt(m.tick)} · gen {m.generation}
                  </span>
                </div>
                <p className="text-[9px] leading-snug text-ink-dim">{m.evidence}</p>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title={`Anomalies — ${anomalies.length}`}>
        {anomalies.length === 0 ? (
          <p className="text-[10px] text-ink-dim">
            No series has left its own baseline by more than 3.2σ.
          </p>
        ) : (
          <div className="space-y-1">
            {anomalies.map((a, i) => (
              <div key={`${a.tick}-${i}`} className="border border-edge/60 bg-panel-2 px-2 py-1">
                <div className="flex items-baseline gap-2">
                  <span
                    className="text-[10px]"
                    style={{
                      color: a.direction === 'above' ? 'var(--color-life)' : 'var(--color-danger)',
                    }}
                  >
                    {a.direction === 'above' ? '▲' : '▼'} {a.series}
                  </span>
                  <span className="ml-auto text-[9px] tabular-nums text-ink-dim">
                    tick {fmt(a.tick)}
                  </span>
                </div>
                <div className="text-[9px] tabular-nums text-ink-dim">
                  {format(a.value)} vs expected {format(a.expected)} · z={a.z.toFixed(1)}
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-[9px] leading-snug text-ink-dim">
          Each baseline is that series' own recent history, so an anomaly means "unusual for this
          world", not "unusual in general". A drifting world moves its own baseline with it.
        </p>
      </Section>

      <Section title="Mutation record">
        {totalMutations === 0 ? (
          <p className="text-[10px] text-ink-dim">no mutations recorded yet</p>
        ) : (
          <>
            <div className="space-y-1">
              {tally.map((count, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-24 text-[10px] text-ink-dim">
                    {MUTATION_CATEGORY_NAMES[i]}
                  </span>
                  <div className="h-1.5 flex-1 bg-panel-2">
                    <div
                      className="h-1.5 bg-accent-2"
                      style={{ width: `${(count / totalMutations) * 100}%` }}
                    />
                  </div>
                  <span className="w-14 text-right text-[9px] tabular-nums text-ink-dim">
                    {fmt(count)}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[9px] leading-snug text-ink-dim">
              {fmt(totalMutations)} inherited changes since the world began. The categories describe
              what was hit, not how mutation works — every locus mutates the same way.
            </p>
          </>
        )}
      </Section>

      {stats && (
        <Section title="Where the world stands">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
            <Row k="generation" v={`${stats.maxGeneration} deep`} />
            <Row k="species alive" v={`${stats.livingSpecies}`} />
            <Row k="species lost" v={`${stats.extinctSpecies}`} />
            <Row k="mean memory" v={stats.avgMemorySlots.toFixed(2)} />
            <Row k="mean group" v={stats.avgGroupSize.toFixed(2)} />
            <Row k="imitations/tick" v={stats.imitationsPerTick.toFixed(3)} />
            <Row k="transfers/tick" v={stats.sharesPerTick.toFixed(3)} />
            <Row k="transmission" v={stats.transmissionIndex.toFixed(4)} />
          </dl>
        </Section>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-ink-dim">{k}</dt>
      <dd className="text-right tabular-nums text-ink">{v}</dd>
    </>
  );
}

function format(v: number): string {
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 1) return v.toFixed(2);
  return v.toFixed(4);
}
