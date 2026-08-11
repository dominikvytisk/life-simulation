import { useStore } from '../app/store';
import { Section, Stat, fmt } from './ui';

/**
 * Culture: behaviour that spreads between organisms rather than down the
 * germline, and how far it travels.
 *
 * The acoustic side of communication lives in the Voice panel. What is here is
 * the other half — whether learned behaviour is being copied at all, and
 * whether any of it outlives the individual that worked it out. The two are
 * measured completely independently, so a world can have one without the other
 * and frequently does.
 */
export function SignalsPanel() {
  const culture = useStore((s) => s.culture);
  const stats = useStore((s) => s.stats);
  const acoustics = useStore((s) => s.acoustics);

  return (
    <div className="h-full overflow-y-auto">
      <Section title="Transmission at a glance">
        <div className="grid grid-cols-3 gap-3">
          <Stat
            label="imitations/tick"
            value={(stats?.imitationsPerTick ?? 0).toFixed(3)}
            tone="accent"
          />
          <Stat label="calls/tick" value={(stats?.callsPerTick ?? 0).toFixed(3)} />
          <Stat
            label="call shapes"
            value={fmt(acoustics?.clusters.length ?? 0)}
            title="Recurring acoustic shapes found by clustering. See the Voice panel."
          />
        </div>
        <p className="mt-2 text-[9px] leading-snug text-ink-dim">
          Two independent routes for something to spread without being inherited: copying a
          neighbour's learned weights outright, and hearing a sound often enough to form an
          association with it. Neither is a culture system — they are a copy operation and an ear,
          and whether anything cultural comes of them is what the numbers below try to establish.
        </p>
      </Section>

      <Section title="Cultural transmission">
        {!culture || culture.samples === 0 ? (
          <p className="text-[10px] text-ink-dim">no samples yet</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Stat
                label="transmission"
                value={culture.transmissionIndex.toFixed(4)}
                tone={culture.transmissionIndex > 0.02 ? 'accent' : 'default'}
              />
              <Stat label="imitations/tick" value={culture.imitationsPerTick.toFixed(3)} />
              <Stat label="distinct memes" value={fmt(culture.distinctMemes)} />
              <Stat
                label="outlived founder"
                value={fmt(culture.posthumousMemes)}
                tone={culture.posthumousMemes > 0 ? 'life' : 'default'}
              />
              <Stat label="neighbour soma" value={culture.neighbourSoma.toFixed(3)} />
              <Stat label="random soma" value={culture.randomSoma.toFixed(3)} />
            </div>
            <p className="mt-2 text-[9px] leading-snug text-ink-dim">
              Neighbours share learned weights at {culture.neighbourSoma.toFixed(3)} vs{' '}
              {culture.randomSoma.toFixed(3)} for random pairs. Neighbours are also more closely
              related ({culture.neighbourGenetic.toFixed(3)} vs {culture.randomGenetic.toFixed(3)}),
              and relatives inherit similar brains — so the genetic excess is subtracted out. What
              is left is the transmission index. Positive means learned behaviour is clustering
              beyond what shared ancestry accounts for.
            </p>
          </>
        )}
      </Section>

      {culture && culture.topMemes.length > 0 && (
        <Section title="Behaviour lineages">
          <div className="space-y-1">
            {culture.topMemes.map((m) => (
              <div
                key={m.tag}
                className="flex items-center gap-2 border border-edge/60 bg-panel-2 px-2 py-1"
              >
                <span className="text-[10px] text-ink">#{m.tag}</span>
                <span className="text-[9px] text-ink-dim">from tick {fmt(m.originTick)}</span>
                <span className="ml-auto text-[10px] tabular-nums text-life">{m.carriers}</span>
                {!m.originatorAlive && (
                  <span
                    className="text-[9px] text-accent"
                    title="The organism this behaviour came from is dead; the behaviour is not."
                  >
                    +{fmt(m.survivedOriginator)}t posthumous
                  </span>
                )}
              </div>
            ))}
          </div>
          <p className="mt-2 text-[9px] leading-snug text-ink-dim">
            Each tag names the organism whose learned weights this behaviour traces back to. A tag
            still carried after its originator has died is behaviour that outlived the individual
            that worked it out — the plain definition of the thing, with no separate culture system
            anywhere in the code.
          </p>
        </Section>
      )}
    </div>
  );
}
