import { getClient } from '../app/client';
import { useStore } from '../app/store';
import { GENOME_LENGTH, LOCUS_LABELS, LOCUS_NAMES, Locus } from '../sim/genome/loci';
import { Bar, Button, Section, Stat, TraitRow, fmt, hueColor } from './ui';
import { BrainView } from './BrainView';
import { pitchToHz } from '../sim/acoustics/sound';

/**
 * Everything knowable about one organism. Genome, expressed body, live brain,
 * lineage and life history — the tool for answering "what is this thing and why
 * is it behaving like that".
 */
export function Inspector() {
  const data = useStore((s) => s.inspection);
  const selectedId = useStore((s) => s.selectedId);
  const follow = useStore((s) => s.followSelection);
  const set = useStore((s) => s.set);
  const client = getClient();

  if (!selectedId) {
    return (
      <div className="p-4 text-[11px] leading-relaxed text-ink-dim">
        Click any organism in the world to inspect it.
        <br />
        <span className="text-ink-dim/60">
          You will see its genome, its body, its live neural activity and its ancestry.
        </span>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-4 text-[11px] text-ink-dim">
        <span className="text-danger">Organism #{selectedId} is gone.</span>
        <br />
        <span className="text-ink-dim/60">It died, or was eaten.</span>
        <div className="mt-3">
          <Button onClick={() => set({ selectedId: 0, inspection: null })}>clear selection</Button>
        </div>
      </div>
    );
  }

  const p = data.phenotype;
  const energyFrac = data.maxEnergy > 0 ? data.energy / data.maxEnergy : 0;
  const ageFrac = data.lifespan > 0 ? data.age / data.lifespan : 0;
  const dietGene = data.genome[Locus.Digestion];

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
        <span
          className="inline-block h-3 w-3 rounded-full"
          style={{ background: hueColor(data.genome[Locus.Hue]) }}
        />
        <div className="min-w-0">
          <div className="truncate text-[13px] text-ink">{data.speciesName}</div>
          <div className="text-[9px] text-ink-dim">
            organism #{data.id} · generation {data.generation}
          </div>
        </div>
        <div className="ml-auto flex gap-1">
          <Button
            active={follow}
            onClick={() => set({ followSelection: !follow })}
            title="Keep the camera centred on this organism"
          >
            follow
          </Button>
          <Button
            onClick={() => {
              client.select(0);
              set({ selectedId: 0, inspection: null, followSelection: false });
            }}
          >
            ✕
          </Button>
        </div>
      </div>

      <Section title="Vitals">
        <div className="space-y-1.5">
          <VitalBar label="energy" value={energyFrac} color="var(--color-life)" note={`${data.energy.toFixed(0)} / ${data.maxEnergy.toFixed(0)}`} />
          <VitalBar label="health" value={data.health} color="var(--color-accent)" note={`${(data.health * 100).toFixed(0)}%`} />
          <VitalBar
            label="age"
            value={ageFrac}
            color={ageFrac > 0.8 ? 'var(--color-danger)' : 'var(--color-warn)'}
            note={`${fmt(data.age)} / ${fmt(data.lifespan)}`}
          />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <Stat label="speed" value={data.speed.toFixed(1)} unit="u/s" />
          <Stat label="position" value={`${data.x.toFixed(0)},${data.y.toFixed(0)}`} />
          <Stat
            label="stage"
            value={data.age < data.maturationAge ? 'juvenile' : 'adult'}
            tone={data.age < data.maturationAge ? 'warn' : 'default'}
          />
        </div>
      </Section>

      <Section title="Life history">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="children" value={data.children} tone="life" />
          <Stat label="kills" value={data.kills} tone={data.kills > 0 ? 'danger' : 'default'} />
          <Stat label="encounters" value={fmt(data.socialContacts)} />
          <Stat label="plant eaten" value={data.plantEaten.toFixed(2)} tone="life" />
          <Stat label="carrion" value={data.meatEaten.toFixed(1)} tone="warn" />
          <Stat label="live prey" value={data.preyEaten.toFixed(1)} tone="danger" />
        </div>
        <div className="mt-2 space-y-0.5 text-[10px] text-ink-dim">
          <div>
            parents:{' '}
            {data.parentA ? (
              <>
                #{data.parentA}
                {data.parentB ? ` × #${data.parentB}` : ' (self-replicated)'}
              </>
            ) : (
              'founder — no parents'
            )}
          </div>
          <div>
            maternal line: <span className="text-ink">#{data.matriline}</span>
          </div>
          <div className="flex items-center gap-1">
            kin markers:
            {data.kinTag.map((t, i) => (
              <span
                key={i}
                title={t.toFixed(4)}
                className="inline-block h-2.5 w-2.5"
                style={{ background: `hsl(${(t * 360).toFixed(0)} 55% 55%)` }}
              />
            ))}
          </div>
        </div>
      </Section>

      <Section title="Learning & culture">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="imitations" value={data.imitations} tone={data.imitations > 0 ? 'accent' : 'default'} />
          <Stat label="mutations at birth" value={data.mutations} />
          <Stat label="energy given" value={data.energyGiven.toFixed(1)} tone="life" />
          <Stat label="energy received" value={data.energyReceived.toFixed(1)} />
          <Stat label="plasticity" value={p.plasticity.toFixed(4)} />
          <Stat label="social learning" value={p.socialLearningRate.toFixed(3)} />
        </div>
        <div className="mt-2 text-[10px] text-ink-dim">
          running behaviour lineage{' '}
          <span className={data.memeTag === data.id ? 'text-accent' : 'text-ink'}>
            #{data.memeTag}
          </span>
          {data.memeTag === data.id
            ? ' — worked this out itself'
            : ' — inherited or copied from another organism'}
        </div>
      </Section>

      <Section title="Prediction & deliberation">
        {data.predictionRate <= 0 ? (
          <p className="text-[10px] leading-snug text-ink-dim">
            This organism models nothing. It senses, it acts, and it never forms an expectation
            about what happens next. Carrying a model costs upkeep from birth, so not carrying one
            is a legitimate strategy — and in most worlds most lineages take it.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Stat
                label="prediction accuracy"
                value={(1 / (1 + data.predictionError)).toFixed(2)}
                tone={data.modelConfidence > 0.6 ? 'accent' : 'default'}
                title="1 / (1 + recent surprise). Measured against this organism's own next internal state — not against the world, which it cannot see."
              />
              <Stat
                label="surprise"
                value={data.predictionError.toFixed(3)}
                tone={data.predictionError > 0.6 ? 'warn' : 'default'}
                title="How wrong its last expectation turned out to be. Not the same thing as anything going badly."
              />
              <Stat
                label="reward error"
                value={data.rewardError.toFixed(3)}
                title="Being wrong about whether the next stretch would go well, kept separate from being wrong about what it would look like."
              />
              <Stat
                label="learning progress"
                value={data.learningProgress.toFixed(4)}
                tone={data.learningProgress > 0 ? 'life' : 'default'}
                title="Long-run surprise minus recent surprise. Positive means it has been getting better lately. A permanently unpredictable situation gives high surprise and zero progress."
              />
              <Stat
                label="novelty"
                value={data.novelty.toFixed(2)}
                title="How little its model has been exposed to the situation it is acting in."
              />
              <Stat
                label="intrinsic drive"
                value={data.intrinsic.toFixed(3)}
                tone={data.intrinsic > 0.05 ? 'accent' : 'default'}
                title="Curiosity x learning progress x novelty. Value taken from learning rather than from anything the world handed over."
              />
              <Stat label="model fits" value={data.modelSamples} title="Transitions fitted in this life." />
              <Stat label="learning rate" value={data.predictionRate.toFixed(3)} />
              <Stat label="curiosity" value={data.curiosity.toFixed(3)} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <Stat
                label="plan horizon"
                value={data.planHorizon}
                unit="steps"
                tone={data.planHorizon > 0 ? 'accent' : 'default'}
              />
              <Stat label="plan budget" value={data.planBudget} unit="options" />
              <Stat
                label="plan advantage"
                value={data.planAdvantage.toFixed(3)}
                tone={data.planAdvantage > 0.01 ? 'life' : 'default'}
                title="How much better its model expected the chosen action to go than the one instinct proposed. Zero means deliberating changed nothing."
              />
            </div>
            <p className="mt-2 text-[10px] leading-snug text-ink-dim">
              {data.planHorizon > 0 && data.planBudget > 0
                ? `Before acting, this organism imagines ${data.planBudget} variations on what its network proposed and runs each ${data.planHorizon} model step${data.planHorizon > 1 ? 's' : ''} forward, paying energy per imagined step. If its model is wrong, deliberating makes the decision worse.`
                : 'This organism does not deliberate. Whatever its network produces is what it does.'}
              {data.consolidations > 0 &&
                ` It has replayed stored experience ${data.consolidations} time${data.consolidations === 1 ? '' : 's'} while resting.`}
            </p>
          </>
        )}
      </Section>

      <Section title="Body burden">
        <div className="grid grid-cols-3 gap-3">
          <Stat
            label="toxin load"
            value={data.toxinLoad.toFixed(3)}
            tone={data.toxinLoad > 0.3 ? 'danger' : data.toxinLoad > 0.1 ? 'warn' : 'default'}
            title="Accumulated from eating growth that carried it. Above the harmless threshold it costs health every tick, hundreds of ticks after the meal that caused it."
          />
          <Stat label="clearance" value={p.toxinClearance?.toFixed(4) ?? '—'} />
          <Stat
            label="vicarious beliefs"
            value={data.vicariousMemories}
            tone={data.vicariousMemories > 0 ? 'accent' : 'default'}
            title="Place memories formed from a sound rather than from experience. Some of them may be wrong."
          />
        </div>
      </Section>

      <Section title={`Episodic memory — ${data.memories.length}/${p.memorySlots} slots`}>
        {p.memorySlots === 0 ? (
          <p className="text-[10px] leading-snug text-ink-dim">
            This lineage carries no memory. Slots cost upkeep every tick, so remembering nothing is
            a legitimate strategy and a common one.
          </p>
        ) : data.memories.length === 0 ? (
          <p className="text-[10px] text-ink-dim">nothing notable has happened yet</p>
        ) : (
          <div className="space-y-1">
            {data.memories.map((m, i) => {
              const dx = m.x - data.x;
              const dy = m.y - data.y;
              const dist = Math.hypot(dx, dy);
              return (
                <div key={i} className="flex items-center gap-2 text-[9px]">
                  <span
                    className="inline-block h-2 w-2 shrink-0"
                    style={{
                      background: m.valence > 0 ? 'var(--color-life)' : 'var(--color-danger)',
                      opacity: 0.35 + m.strength * 0.65,
                    }}
                  />
                  <span className="text-ink-dim">
                    ({m.x.toFixed(0)}, {m.y.toFixed(0)})
                  </span>
                  <span className={m.valence > 0 ? 'text-life' : 'text-danger'}>
                    {m.valence > 0 ? '+' : ''}
                    {m.valence.toFixed(2)}
                  </span>
                  {m.social && (
                    <span
                      className="text-accent"
                      title="Never lived. This belief was formed from a sound heard from that direction."
                    >
                      heard
                    </span>
                  )}
                  <span className="ml-auto tabular-nums text-ink-dim">
                    {dist.toFixed(0)}u away · {(m.strength * 100).toFixed(0)}%
                    {m.importance > 0.05 && ` · use ${m.importance.toFixed(1)}`}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Voice">
        <div className="grid grid-cols-3 gap-3">
          <Stat
            label="state"
            value={data.calling ? `calling ${data.callTicks.toFixed(0)}t` : 'silent'}
            tone={data.calling ? 'accent' : 'default'}
          />
          <Stat
            label="pitch"
            value={data.calling ? `${pitchToHz(data.voice[0]).toFixed(0)} Hz` : '—'}
          />
          <Stat label="loudness" value={data.voice[1].toFixed(2)} />
        </div>
        <div className="mt-2 space-y-0.5">
          <TraitRow
            label="Voice band"
            value={data.phenotype.vocalHigh - data.phenotype.vocalLow}
            display={`${pitchToHz(data.phenotype.vocalLow).toFixed(0)}–${pitchToHz(data.phenotype.vocalHigh).toFixed(0)} Hz`}
          />
          <TraitRow
            label="Hearing band"
            value={data.phenotype.auditoryHigh - data.phenotype.auditoryLow}
            display={`${pitchToHz(data.phenotype.auditoryLow).toFixed(0)}–${pitchToHz(data.phenotype.auditoryHigh).toFixed(0)} Hz`}
          />
          <TraitRow label="Vocal power" value={data.phenotype.vocalPower} />
          <TraitRow label="Vocal agility" value={data.phenotype.vocalAgility} />
          <TraitRow label="Freq. resolution" value={data.phenotype.auditoryResolution} />
          <TraitRow
            label="Echoic depth"
            value={data.phenotype.echoicDepth / 4}
            display={data.phenotype.echoicDepth.toFixed(0)}
          />
        </div>
        <p className="mt-1 text-[9px] leading-snug text-ink-dim">
          An organ, not a vocabulary. The bands are what this body can physically produce and
          receive; two organisms whose bands do not overlap cannot hear each other at all, however
          much either one shouts.
        </p>
      </Section>

      <Section title="What it has heard">
        {data.echoic.length === 0 ? (
          <p className="text-[10px] text-ink-dim">
            {data.ticksSinceHeard < 0
              ? 'This organism has never heard a sound.'
              : 'Nothing in the echoic buffer.'}
          </p>
        ) : (
          <div className="space-y-0.5">
            {data.echoic.map((e, i) => (
              <div
                key={i}
                className="grid grid-cols-[26px_1fr_54px_46px] items-center gap-2 text-[9px]"
              >
                <span className="text-ink-dim">t-{i}</span>
                <Bar value={e.pitch} color="var(--color-accent-2)" height={4} />
                <span className="tabular-nums text-ink-dim">
                  {pitchToHz(e.pitch).toFixed(0)} Hz
                </span>
                <span className="text-right tabular-nums text-ink-dim/70">
                  gap {e.gap.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="What it thinks sounds mean">
        {data.soundMemory.length === 0 ? (
          <p className="text-[10px] text-ink-dim">
            {data.phenotype.soundPrototypes === 0
              ? 'This genome pays for no auditory memory. Sounds arrive and are gone.'
              : 'No sound has recurred often enough to be held yet.'}
          </p>
        ) : (
          <div className="space-y-1">
            {data.soundMemory.map((m, i) => (
              <div key={i} className="border border-edge/60 bg-panel-2 px-2 py-1">
                <div className="flex items-center gap-2 text-[9px]">
                  <span className="text-ink">{pitchToHz(m.pitch).toFixed(0)} Hz</span>
                  <span className="text-ink-dim">
                    {m.noisiness > 0.6 ? 'noisy' : m.noisiness < 0.3 ? 'tonal' : 'mixed'}
                  </span>
                  <span
                    className="ml-auto tabular-nums"
                    style={{
                      color:
                        m.valence > 0.05
                          ? 'var(--color-life)'
                          : m.valence < -0.05
                            ? 'var(--color-danger)'
                            : 'var(--color-ink-dim)',
                    }}
                    title="What tended to happen to this organism after it heard this sound. Learned from its own reward stream and shared with nobody."
                  >
                    {m.valence > 0 ? '+' : ''}
                    {m.valence.toFixed(3)}
                  </span>
                </div>
                <div className="mt-0.5">
                  <Bar value={m.strength} height={2} />
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-1 text-[9px] leading-snug text-ink-dim">
          These are this individual's own expectations, worked out from what happened after it
          heard each sound. Another organism that heard the same call in a worse moment holds the
          opposite value for it, permanently. Nothing here is inherited and nothing here is shared.
        </p>
      </Section>

      <Section title="Live brain">
        <BrainView data={data} />
      </Section>

      <Section title="Expressed body">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
          <PhenoRow k="radius" v={p.radius.toFixed(2)} />
          <PhenoRow k="mass" v={p.mass.toFixed(1)} />
          <PhenoRow k="top speed" v={p.maxSpeed.toFixed(1)} />
          <PhenoRow k="turn rate" v={p.turnRate.toFixed(2)} />
          <PhenoRow k="bite damage" v={p.attackDamage.toFixed(2)} />
          <PhenoRow k="armor" v={p.armor.toFixed(2)} />
          <PhenoRow k="spikes" v={p.spikes.toFixed(2)} />
          <PhenoRow k="vision" v={`${p.visionRange.toFixed(0)}u`} />
          <PhenoRow k="acuity" v={p.visionAcuity.toFixed(2)} />
          <PhenoRow k="smell" v={`${p.smellRange.toFixed(0)}u`} />
          <PhenoRow k="hearing" v={`${p.hearingRange.toFixed(0)}u`} />
          <PhenoRow k="camouflage" v={p.camouflage.toFixed(2)} />
          <PhenoRow k="memory slots" v={`${p.memorySlots}`} />
          <PhenoRow k="forget rate" v={p.memoryDecay.toFixed(4)} />
          <PhenoRow k="clutch size" v={`${p.fecundity}`} />
          <PhenoRow k="distance lived" v={fmt(data.distanceTravelled)} />
          <PhenoRow k="upkeep/tick" v={p.upkeep.toFixed(3)} />
          <PhenoRow k="plasticity" v={p.plasticity.toFixed(4)} />
        </div>

        <div className="mt-3">
          <div className="label-xs mb-1">Gut specialisation</div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-life">plant</span>
            <div className="relative h-2 flex-1 bg-panel-2">
              <div
                className="absolute top-0 h-2 w-[3px] bg-ink"
                style={{ left: `${dietGene * 100}%` }}
              />
            </div>
            <span className="text-[9px] text-danger">meat</span>
          </div>
          <div className="mt-1 flex justify-between text-[9px] text-ink-dim">
            <span>plant efficiency {(p.plantEfficiency * 100).toFixed(0)}%</span>
            <span>meat efficiency {(p.meatEfficiency * 100).toFixed(0)}%</span>
          </div>
        </div>

        <div className="mt-3">
          <div className="label-xs mb-1">Thermal niche</div>
          <div className="relative h-3 bg-panel-2">
            <div
              className="absolute top-0 h-3 bg-accent/25"
              style={{
                left: `${Math.max(0, (p.tempPreference - p.tempTolerance) * 100)}%`,
                width: `${Math.min(100, p.tempTolerance * 200)}%`,
              }}
            />
            <div
              className="absolute top-0 h-3 w-[2px] bg-accent"
              style={{ left: `${p.tempPreference * 100}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[9px] text-ink-dim">
            <span>cold</span>
            <span>
              prefers {p.tempPreference.toFixed(2)} ± {p.tempTolerance.toFixed(2)}
            </span>
            <span>hot</span>
          </div>
        </div>
      </Section>

      <Section title="Genome">
        <div className="mb-2 text-[9px] leading-snug text-ink-dim">
          {GENOME_LENGTH} loci, each in [0,1]. These do not set behaviour — they build the body and
          the senses that the brain then has to work with.
        </div>
        {data.genome.map((v, i) => (
          <TraitRow
            key={i}
            label={LOCUS_LABELS[LOCUS_NAMES[i]] ?? LOCUS_NAMES[i]}
            value={v}
            color={geneColor(i)}
          />
        ))}
      </Section>
    </div>
  );
}

function VitalBar({
  label,
  value,
  color,
  note,
}: {
  label: string;
  value: number;
  color: string;
  note: string;
}) {
  return (
    <div>
      <div className="mb-0.5 flex justify-between text-[10px]">
        <span className="text-ink-dim">{label}</span>
        <span className="tabular-nums text-ink-dim">{note}</span>
      </div>
      <Bar value={value} color={color} height={7} />
    </div>
  );
}

function PhenoRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <span className="text-ink-dim">{k}</span>
      <span className="text-right tabular-nums text-ink">{v}</span>
    </>
  );
}

/** Colour genes by functional group so the genome bar chart is scannable. */
function geneColor(i: number): string {
  if (i <= Locus.Spikes) return '#ffb454'; // body & combat
  if (i <= Locus.SmellRange) return '#4ee0c8'; // senses
  if (i <= Locus.EnergyCapacity) return '#7ddc7d'; // metabolism
  if (i <= Locus.Fecundity) return '#c98aff'; // reproduction
  if (i <= Locus.WaterAffinity) return '#6aa8ff'; // ecology
  if (i <= Locus.SignalSensitivity) return '#5ed3ff'; // communication
  if (i <= Locus.MutationRate) return '#ff8ac8'; // cognition & evolvability
  return '#55607a'; // neutral markers
}
