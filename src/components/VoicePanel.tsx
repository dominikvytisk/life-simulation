import { useEffect, useRef } from 'react';
import { useStore } from '../app/store';
import { getClient } from '../app/client';
import { Bar, Button, Section, Stat, fmt } from './ui';
import { ASSOCIATION_THRESHOLD, describeCall } from '../sim/analysis/acoustics';
import { CALL_NAMES, pitchToHz } from '../sim/acoustics/sound';
import type { CallCluster } from '../sim/core/types';
import { FirstContact } from './FirstContact';

/**
 * The acoustic observatory.
 *
 * Every number here is a measurement taken from outside the organisms. The
 * panel is written to keep four things visibly separate, because conflating
 * them is exactly how a simulation ends up claiming to have invented language:
 *
 *   OBSERVED    this happened, and here is the count
 *   CORRELATED  these two things co-occur, and here is the effect size
 *   INFERRED    a reading of the correlation, offered as a guess
 *   UNKNOWN     recurring, and fits nothing
 *
 * No sound in this simulation has a meaning. Some of them have statistics.
 */
export function VoicePanel() {
  const acoustics = useStore((s) => s.acoustics);
  const stats = useStore((s) => s.stats);
  const audioEnabled = useStore((s) => s.audioEnabled);
  const set = useStore((s) => s.set);

  const clusters = acoustics?.clusters ?? [];
  const enough = (acoustics?.observations ?? 0) >= 300;

  return (
    <div className="h-full overflow-y-auto">
      <Section
        title="Acoustic activity"
        right={
          <Button
            active={audioEnabled}
            tone="accent"
            onClick={() => set({ audioEnabled: !audioEnabled })}
            title="Synthesise the voices nearest the centre of the view. Nothing is downloaded; the sound is generated from each organism's own vocal parameters."
          >
            {audioEnabled ? 'listening' : 'listen'}
          </Button>
        }
      >
        <div className="grid grid-cols-3 gap-3">
          <Stat label="calls / tick" value={(stats?.callsPerTick ?? 0).toFixed(3)} tone="accent" />
          <Stat label="mean loudness" value={(stats?.broadcastActivity ?? 0).toFixed(3)} />
          <Stat label="call shapes" value={fmt(clusters.length)} />
          <Stat
            label="repertoire"
            value={`${(stats?.vocalDiversity ?? 0).toFixed(2)} bits`}
            title="Shannon entropy over which call shape gets used. Zero means one sound; higher means several used at comparable rates."
          />
          <Stat
            label="scatter"
            value={(stats?.vocalPrecision ?? 0).toFixed(3)}
            title="Mean acoustic distance from a call to the centre of its own shape. Low means calls are being reproduced precisely."
          />
          <Stat
            label="coupling"
            value={(acoustics?.strongestCoupling ?? 0).toFixed(2)}
            tone={(acoustics?.strongestCoupling ?? 0) > 0.6 ? 'accent' : 'default'}
            title="The strongest shape for which the emitter's circumstances and the listeners' behaviour both stand out at once. One side alone only says calling tracks the caller's state."
          />
        </div>
        {enough && (stats?.callsPerTick ?? 0) < 0.001 && (
          <p className="mt-2 border border-warn/40 bg-panel-2 px-2 py-1 text-[9px] leading-snug text-warn">
            Nothing has called recently. Everything below describes the last few thousand
            vocalisations, the most recent of which was at tick{' '}
            {fmt(acoustics!.lastObservationTick)} — it is history, not a description of the world
            as it is now.
          </p>
        )}
        <Spectrogram />
        <p className="mt-2 text-[9px] leading-snug text-ink-dim">
          Organisms have a vocal apparatus and an ear, both grown from the genome, and seven brain
          outputs that drive the apparatus. No output means anything. What follows is what an
          observer with a microphone and a notebook would be able to say about the result.
        </p>
      </Section>

      {!enough ? (
        <Section title="Repertoire">
          <p className="text-[10px] text-ink-dim">
            {fmt(acoustics?.observations ?? 0)} vocalisations recorded, of 300 needed. Nothing is
            reported below that, because a shape seen twice is not a shape.
          </p>
        </Section>
      ) : clusters.length === 0 ? (
        <Section title="Repertoire">
          <p className="text-[10px] text-ink-dim">
            Sound is being made, but it does not fall into recurring shapes. This is an ordinary
            outcome and it is not a failure state: an ecosystem is allowed to be noisy without
            being communicative.
          </p>
        </Section>
      ) : (
        <Section title="Repertoire">
          <div className="space-y-2">
            {clusters.map((c) => (
              <ClusterCard key={c.id} cluster={c} />
            ))}
          </div>
        </Section>
      )}

      {enough && (
        <>
          <Section title="Sequence">
            <div className="grid grid-cols-3 gap-3">
              <Stat
                label="order info"
                value={`${(acoustics!.sequence.mutualInformation).toFixed(3)} bits`}
                tone={acoustics!.sequence.mutualInformation > 0.25 ? 'accent' : 'default'}
                title="Mutual information between one call and the emitter's next call. Zero means the previous call tells you nothing about the next."
              />
              <Stat label="repetition" value={acoustics!.sequence.repetition.toFixed(2)} />
              <Stat label="samples" value={fmt(acoustics!.sequence.samples)} />
            </div>
            {acoustics!.sequence.topTransitions.length > 0 && (
              <div className="mt-2 space-y-0.5">
                {acoustics!.sequence.topTransitions.map((t) => (
                  <div
                    key={`${t.from}-${t.to}`}
                    className="flex items-center gap-2 text-[9px] text-ink-dim"
                  >
                    <span className="text-ink">#{t.from}</span>
                    <span>→</span>
                    <span className="text-ink">#{t.to}</span>
                    <span className="ml-auto tabular-nums">
                      {(t.probability * 100).toFixed(0)}% of #{t.from}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-2 text-[9px] leading-snug text-ink-dim">
              No syntax is defined anywhere. An organism holds its voice open for as long as it
              chooses and opens it again when it chooses; if an order emerges from that, this is
              where it would show up.
            </p>
          </Section>

          <Section title="Exchange">
            <div className="grid grid-cols-3 gap-3">
              <Stat
                label="alternation"
                value={acoustics!.turnTaking.alternation.toFixed(3)}
                tone={acoustics!.turnTaking.alternation > 0.1 ? 'accent' : 'default'}
                title="How much more often a call follows hearing something than the rate at which organisms have simply heard something."
              />
              <Stat
                label="convergence"
                value={acoustics!.turnTaking.convergence.toFixed(3)}
                tone={acoustics!.turnTaking.convergence > 0.02 ? 'accent' : 'default'}
                title="How much closer a reply sits, acoustically, to the call it followed than two unrelated calls sit to each other."
              />
              <Stat label="samples" value={fmt(acoustics!.turnTaking.samples)} />
            </div>
            <p className="mt-2 text-[9px] leading-snug text-ink-dim">
              Reply rate {acoustics!.turnTaking.replyRate.toFixed(3)} against a baseline of{' '}
              {acoustics!.turnTaking.baseline.toFixed(3)} — the baseline is how often an organism
              has recently heard anything at all, so alternation above zero is the part that
              hearing does not already explain. There is no conversation system in the code.
            </p>
          </Section>

          <Section title="Dialects">
            <div className="grid grid-cols-3 gap-3">
              <Stat
                label="between regions"
                value={`${acoustics!.dialects.divergence.toFixed(3)} bits`}
                tone={acoustics!.dialects.divergence > 0.2 ? 'accent' : 'default'}
              />
              <Stat
                label="between species"
                value={`${acoustics!.dialects.speciesDivergence.toFixed(3)} bits`}
              />
              <Stat label="regions sampled" value={fmt(acoustics!.dialects.regions.length)} />
            </div>
            {acoustics!.dialects.pairs.length > 0 && (
              <div className="mt-2 space-y-0.5">
                {acoustics!.dialects.pairs.map((p) => (
                  <div key={`${p.a}-${p.b}`} className="flex items-center gap-2 text-[9px]">
                    <span className="text-ink-dim">
                      region {p.a} vs {p.b}
                    </span>
                    <div className="flex-1">
                      <Bar value={Math.min(1, p.divergence)} height={3} />
                    </div>
                    <span className="tabular-nums text-ink-dim">{p.divergence.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-2 text-[9px] leading-snug text-ink-dim">
              Jensen-Shannon divergence between the call repertoires of different parts of the map.
              Nothing creates dialects; the world is simply large enough that separated populations
              can drift apart, and this measures whether they have.
            </p>
          </Section>

          {acoustics!.unknown.length > 0 && (
            <Section title="Unknown patterns">
              <div className="space-y-1">
                {acoustics!.unknown.map((u, i) => (
                  <div key={i} className="border border-warn/40 bg-panel-2 px-2 py-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] tracking-[0.14em] text-warn">UNKNOWN</span>
                      <span className="ml-auto text-[9px] tabular-nums text-ink-dim">
                        {fmt(u.count)}× since tick {fmt(u.firstTick)}
                      </span>
                    </div>
                    <div className="text-[10px] text-ink">{describeCall(u.centroid)}</div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[9px] leading-snug text-ink-dim">
                These recur but fit none of the established shapes, and every shape slot is
                currently occupied by something better established. They are kept as they are
                rather than forced into a category that does not fit.
              </p>
            </Section>
          )}
        </>
      )}

      <FirstContact />
    </div>
  );
}

/**
 * One recurring call shape. The layout puts the physics first and the guess
 * last, with the guess visibly labelled as a guess.
 */
function ClusterCard({ cluster }: { cluster: CallCluster }) {
  const weak = cluster.confidence < ASSOCIATION_THRESHOLD;
  return (
    <div
      className={`border p-2 ${weak ? 'border-edge/50 bg-panel' : 'border-accent/40 bg-panel-2'}`}
    >
      <div className="mb-1 flex items-baseline gap-2">
        <span className={`text-[11px] ${weak ? 'text-ink-dim' : 'text-accent'}`}>
          shape #{cluster.id}
        </span>
        <span className="text-[9px] text-ink-dim">{describeCall(cluster.centroid)}</span>
        <span className="ml-auto text-[9px] tabular-nums text-ink-dim">
          {(cluster.share * 100).toFixed(1)}%
        </span>
      </div>

      <CallGlyph centroid={cluster.centroid} />

      <div className="mt-1.5 grid grid-cols-2 gap-2">
        <div>
          <div className="label-xs mb-0.5">
            <span className="text-ink-dim/70">CORRELATED</span> emitted when
          </div>
          {cluster.emitterContext.length === 0 ? (
            <div className="text-[9px] text-ink-dim/60">nothing above d={ASSOCIATION_THRESHOLD}</div>
          ) : (
            cluster.emitterContext.map((a) => (
              <div key={a.label} className="flex justify-between text-[9px]">
                <span className="truncate text-ink-dim">{a.label}</span>
                <span
                  className="tabular-nums"
                  style={{ color: a.d > 0 ? 'var(--color-life)' : 'var(--color-danger)' }}
                >
                  {a.d > 0 ? '+' : ''}
                  {a.d.toFixed(2)}
                </span>
              </div>
            ))
          )}
        </div>
        <div>
          <div className="label-xs mb-0.5">
            <span className="text-ink-dim/70">CORRELATED</span> listeners then
          </div>
          {cluster.listenerResponse.length === 0 ? (
            <div className="text-[9px] text-ink-dim/60">
              {cluster.responseSamples < 25 ? 'too few listeners' : 'no measurable response'}
            </div>
          ) : (
            cluster.listenerResponse.map((a) => (
              <div key={a.label} className="flex justify-between text-[9px]">
                <span className="truncate text-ink-dim">{a.label}</span>
                <span
                  className="tabular-nums"
                  style={{ color: a.d > 0 ? 'var(--color-life)' : 'var(--color-danger)' }}
                >
                  {a.d > 0 ? '+' : ''}
                  {a.d.toFixed(2)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-ink-dim">
        <span>
          <span className="text-ink-dim/70">OBSERVED</span> gen {cluster.firstGeneration.toFixed(0)}–
          {cluster.lastGeneration.toFixed(0)}
        </span>
        <span>scatter {cluster.scatter.toFixed(3)}</span>
        <span>drift {cluster.drift.toFixed(4)}</span>
        {cluster.species.length > 0 && (
          <span>
            mostly species #{cluster.species[0].id} ({(cluster.species[0].share * 100).toFixed(0)}%)
          </span>
        )}
      </div>

      <Interpretation cluster={cluster} />
    </div>
  );
}

/**
 * A guess, and labelled as one. This is the only place in the whole system
 * that puts words to a sound, and it is a sentence about a correlation
 * measured over a population — not a fact about what anything means.
 */
function Interpretation({ cluster }: { cluster: CallCluster }) {
  if (cluster.confidence < ASSOCIATION_THRESHOLD) {
    return (
      <div className="mt-1.5 border-t border-edge/60 pt-1 text-[9px] text-ink-dim/70">
        <span className="tracking-[0.14em] text-ink-dim/60">UNKNOWN</span> — used often enough to be
        a shape, but not associated with any circumstance or any response that was measured.
      </div>
    );
  }
  const ctx = cluster.emitterContext[0];
  const resp = cluster.listenerResponse[0];
  const parts: string[] = [];
  if (ctx) parts.push(`used disproportionately when the emitter is ${describeContext(ctx.label, ctx.d)}`);
  if (resp) parts.push(`listeners ${describeResponse(resp.label, resp.d)}`);
  // A standardised difference of 1.5 is a very large effect; the bar saturates
  // there rather than at the clamp, so ordinary findings stay readable.
  const strength = Math.min(1, cluster.confidence / 1.5);
  return (
    <div className="mt-1.5 border-t border-edge/60 pt-1">
      <div className="flex items-center gap-2">
        <span className="text-[9px] tracking-[0.14em] text-warn">INFERRED</span>
        <div className="flex-1">
          <Bar value={strength} color="var(--color-warn)" height={3} />
        </div>
        <span className="text-[9px] tabular-nums text-ink-dim">
          {(strength * 100).toFixed(0)}%
        </span>
      </div>
      <p className="mt-0.5 text-[9px] leading-snug text-ink-dim">
        {parts.join('; ')}. This is a correlation over sampled organisms and nothing more — it does
        not show the sound caused the response, and the organisms have no access to it.
      </p>
    </div>
  );
}

function describeContext(label: string, d: number): string {
  return d > 0 ? `experiencing "${label}"` : `not experiencing "${label}"`;
}

function describeResponse(label: string, d: number): string {
  return d > 0 ? `tend toward "${label}"` : `tend away from "${label}"`;
}

/** A small picture of the sound: pitch track over its duration. */
function CallGlyph({ centroid }: { centroid: number[] }) {
  const pitch = centroid[0];
  const sweep = centroid[1];
  const noisiness = centroid[3];
  const tremolo = centroid[5];
  const w = 120;
  const h = 22;
  const start = clamp01(pitch - sweep / 2);
  const end = clamp01(pitch + sweep / 2);
  const points: string[] = [];
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = start + (end - start) * t;
    const wobble = Math.sin(t * Math.PI * 2 * (2 + tremolo * 8)) * tremolo * 0.06;
    points.push(`${(t * w).toFixed(1)},${((1 - clamp01(p + wobble)) * h).toFixed(1)}`);
  }
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-[22px] w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label={`pitch track, ${pitchToHz(pitch).toFixed(0)} hertz`}
    >
      <rect width={w} height={h} fill="#141b26" />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={1 + noisiness * 2.5}
        strokeOpacity={1 - noisiness * 0.55}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * Rolling spectrogram of whatever is audible near the view centre. Built from
 * the same voice frames the synthesiser uses, so what is drawn and what is
 * heard are the same handful of organisms.
 */
function Spectrogram() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const column = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#0b1017';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const client = getClient();
    let raf = 0;
    const draw = () => {
      const voices = client.latestVoices;
      const w = canvas.width;
      const h = canvas.height;
      const x = column.current % w;
      // Scroll by drawing one column at a time and clearing the one ahead.
      ctx.fillStyle = '#0b1017';
      ctx.fillRect(x, 0, 2, h);
      for (const v of voices) {
        const y = (1 - v.pitch) * h;
        const level = Math.min(1, v.loudness / (1 + v.distance / 160));
        if (level < 0.02) continue;
        const hue = v.external ? 40 : 190 - v.timbre * 70;
        ctx.fillStyle = `hsl(${hue} 80% ${30 + level * 45}% / ${0.25 + level * 0.75})`;
        const thickness = 1 + v.noisiness * h * 0.35;
        ctx.fillRect(x, y - thickness / 2, 1, thickness);
      }
      ctx.fillStyle = 'rgba(120,160,200,0.35)';
      ctx.fillRect((x + 2) % w, 0, 1, h);
      column.current++;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="mt-2">
      <canvas
        ref={canvasRef}
        width={340}
        height={72}
        className="w-full border border-edge/60"
        style={{ imageRendering: 'pixelated' }}
      />
      <div className="mt-0.5 flex justify-between text-[8px] text-ink-dim/70">
        <span>{pitchToHz(1).toFixed(0)} Hz</span>
        <span>voices near the view centre · vertical axis is log frequency</span>
        <span>{pitchToHz(0).toFixed(0)} Hz</span>
      </div>
    </div>
  );
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export { CALL_NAMES };
