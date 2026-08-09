import { useStore } from '../app/store';
import { Bar, Section, Stat, fmt } from './ui';
import { MEANING_THRESHOLD } from '../sim/analysis/signals';

/**
 * What the signal channels have come to mean — measured, not defined.
 *
 * Two independent correlations per channel: what an emitter is experiencing
 * when it broadcasts, and what listeners do when they hear it. A channel that
 * correlates with nothing is shown as carrying no detectable meaning, which is
 * the normal state of affairs and is stated plainly rather than dressed up.
 */
export function SignalsPanel() {
  const signals = useStore((s) => s.signals);
  const samples = useStore((s) => s.signalSamples);
  const culture = useStore((s) => s.culture);
  const stats = useStore((s) => s.stats);

  const meaningful = signals.filter((s) => s.confidence >= MEANING_THRESHOLD);

  return (
    <div className="h-full overflow-y-auto">
      <Section title="Communication">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="broadcast" value={(stats?.broadcastActivity ?? 0).toFixed(3)} tone="accent" />
          <Stat label="channels w/ signal" value={`${meaningful.length}/${signals.length || 8}`} />
          <Stat label="samples" value={fmt(samples)} />
        </div>
        <p className="mt-2 text-[9px] leading-snug text-ink-dim">
          Eight channels exist. None has an assigned meaning. These numbers are Pearson correlations
          measured over sampled organisms — the emitter column is what was happening when the
          channel was used, the listener column is what organisms hearing it did next. Correlation
          only; nothing here demonstrates that the signal <em>caused</em> the response.
        </p>
      </Section>

      {samples < 400 ? (
        <Section title="Channels">
          <p className="text-[10px] text-ink-dim">
            Not enough observations yet ({fmt(samples)} of 400 needed). Nothing will be reported
            until the sample is large enough to mean anything.
          </p>
        </Section>
      ) : (
        <Section title="Channels">
          <div className="space-y-2">
            {signals.map((s) => {
              const silent = s.confidence < MEANING_THRESHOLD;
              return (
                <div
                  key={s.channel}
                  className={`border p-2 ${silent ? 'border-edge/50 bg-panel' : 'border-accent/40 bg-panel-2'}`}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className={`text-[11px] ${silent ? 'text-ink-dim' : 'text-accent'}`}>
                      channel {s.channel}
                    </span>
                    <span className="ml-auto text-[9px] text-ink-dim">
                      usage {s.usage.toFixed(3)}
                    </span>
                  </div>
                  <div className="mb-1.5">
                    <Bar
                      value={s.confidence}
                      color={silent ? '#2a3446' : 'var(--color-accent)'}
                      height={3}
                    />
                  </div>
                  {silent ? (
                    <p className="text-[9px] text-ink-dim/70">
                      no correlation above r={MEANING_THRESHOLD} — carries no detectable meaning
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <CorrelationList title="emitted when" items={s.emitterContext} />
                      <CorrelationList title="listeners then" items={s.listenerResponse} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}

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

function CorrelationList({
  title,
  items,
}: {
  title: string;
  items: { label: string; r: number }[];
}) {
  return (
    <div>
      <div className="label-xs mb-0.5">{title}</div>
      {items.length === 0 ? (
        <div className="text-[9px] text-ink-dim/60">—</div>
      ) : (
        items.map((it) => (
          <div key={it.label} className="flex justify-between text-[9px]">
            <span className="truncate text-ink-dim">{it.label}</span>
            <span
              className="tabular-nums"
              style={{ color: it.r > 0 ? 'var(--color-life)' : 'var(--color-danger)' }}
            >
              {it.r > 0 ? '+' : ''}
              {it.r.toFixed(2)}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
