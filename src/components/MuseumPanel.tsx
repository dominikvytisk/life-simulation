import { useMemo, useState } from 'react';
import { useStore } from '../app/store';
import { Section, TraitRow, fmt, hueColor } from './ui';
import { LOCUS_LABELS, LOCUS_NAMES } from '../sim/genome/loci';
import type { SpeciesSummary } from '../sim/core/types';

/**
 * The Museum of Life. Every species that has ever existed keeps its record
 * after it dies out: when it appeared, what it became, how long it lasted and
 * what killed it off (implicitly — by what was happening at its extinction
 * tick). Extinction is permanent and irreversible here, exactly as it should be.
 */
export function MuseumPanel() {
  const extinct = useStore((s) => s.extinct);
  const [sort, setSort] = useState<'recent' | 'peak' | 'longest'>('recent');
  const [selected, setSelected] = useState<number | null>(null);

  const sorted = useMemo(() => {
    const copy = [...extinct];
    if (sort === 'peak') copy.sort((a, b) => b.peakPopulation - a.peakPopulation);
    else if (sort === 'longest')
      copy.sort((a, b) => b.extinctTick - b.originTick - (a.extinctTick - a.originTick));
    else copy.sort((a, b) => b.extinctTick - a.extinctTick);
    return copy;
  }, [extinct, sort]);

  const detail = sorted.find((s) => s.id === selected) ?? null;

  if (extinct.length === 0) {
    return (
      <div className="p-4 text-[11px] leading-relaxed text-ink-dim">
        No species has gone extinct yet.
        <br />
        <span className="text-ink-dim/60">
          When one does, its complete record is preserved here permanently.
        </span>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <Section
        title={`Museum of Life — ${extinct.length} extinct`}
        right={
          <div className="flex gap-1">
            {(['recent', 'peak', 'longest'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSort(s)}
                className={`px-1 text-[9px] ${sort === s ? 'text-accent' : 'text-ink-dim hover:text-ink'}`}
              >
                {s}
              </button>
            ))}
          </div>
        }
      >
        <div className="space-y-1">
          {sorted.slice(0, 120).map((s) => (
            <button
              key={s.id}
              onClick={() => setSelected(s.id === selected ? null : s.id)}
              className={`flex w-full items-center gap-2 border px-2 py-1 text-left transition-colors ${
                s.id === selected
                  ? 'border-accent/50 bg-accent/5'
                  : 'border-edge/60 bg-panel-2 hover:border-edge-2'
              }`}
            >
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full opacity-50"
                style={{ background: hueColor(s.hue) }}
              />
              <span className="truncate text-[11px] text-ink-dim">{s.name}</span>
              <span className="ml-auto shrink-0 text-[9px] tabular-nums text-ink-dim/70">
                peak {fmt(s.peakPopulation)} · lived {fmt(s.extinctTick - s.originTick)}t
              </span>
            </button>
          ))}
        </div>
      </Section>

      {detail && <SpecimenSheet s={detail} />}
    </div>
  );
}

function SpecimenSheet({ s }: { s: SpeciesSummary }) {
  const lifespan = s.extinctTick - s.originTick;
  const dominant = useMemo(
    () =>
      s.traits
        .map((v, i) => ({ i, v, dev: Math.abs(v - 0.5) }))
        .sort((a, b) => b.dev - a.dev)
        .slice(0, 10),
    [s.traits],
  );

  return (
    <Section title="Specimen record">
      <div className="mb-2 flex items-center gap-2">
        <span
          className="inline-block h-3 w-3 rounded-full"
          style={{ background: hueColor(s.hue), opacity: 0.6 }}
        />
        <span className="text-[13px] text-ink">{s.name}</span>
        <span className="text-[9px] text-ink-dim">#{s.id}</span>
      </div>
      <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
        <Row k="origin" v={`tick ${fmt(s.originTick)}`} />
        <Row k="extinction" v={`tick ${fmt(s.extinctTick)}`} />
        <Row k="duration" v={`${fmt(lifespan)} ticks`} />
        <Row k="peak population" v={fmt(s.peakPopulation)} />
        <Row k="total born" v={fmt(s.totalBorn)} />
        <Row k="branched from" v={s.ancestorId === 0 ? 'founder stock' : `species #${s.ancestorId}`} />
        <Row k="origin generation" v={`${s.generationOrigin}`} />
      </dl>
      <h4 className="label-xs mb-1">Reference genome</h4>
      {dominant.map((t) => (
        <TraitRow
          key={t.i}
          label={LOCUS_LABELS[LOCUS_NAMES[t.i]] ?? LOCUS_NAMES[t.i]}
          value={t.v}
          color={hueColor(s.hue, 45, 45)}
        />
      ))}
    </Section>
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
