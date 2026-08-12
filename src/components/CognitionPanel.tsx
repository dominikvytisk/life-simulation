import { useStore } from '../app/store';
import { Bar, Section, Stat, fmt, hueColor } from './ui';
import type { SpeciesCognition } from '../sim/analysis/cognition';

/**
 * The cognitive observatory.
 *
 * Three things, in descending order of how much they can be trusted.
 *
 * First, what each species measured at, against generation. These are
 * measurements and they are presented as measurements: nowhere does this panel
 * say a lineage became smarter, because "smarter" is not a quantity anything
 * here computed. Prediction accuracy went from 0.31 to 0.62 is a fact about the
 * telemetry; what it means is the reader's problem, and deliberately so.
 *
 * Second, which environmental series moved together with which cognitive ones.
 * A correlation, labelled a correlation, with its coefficient and its sample
 * count on the same line.
 *
 * Third, a reading of all that, explicitly marked as a reading, together with
 * the experiment that would have to be run to turn it into a result. That
 * experiment exists — it is in the Lab tab — and this panel says so rather than
 * quietly implying the work has already been done.
 */
export function CognitionPanel() {
  const stats = useStore((s) => s.stats);
  const report = useStore((s) => s.cognition);
  const trajectories = useStore((s) => s.trajectories);

  if (!stats) {
    return <div className="p-4 text-[11px] text-ink-dim">waiting for the first telemetry…</div>;
  }

  const modelling = stats.modellingFraction;
  const planning = stats.planningFraction;

  return (
    <div className="h-full overflow-y-auto">
      <Section title="Where the population stands">
        <div className="grid grid-cols-3 gap-3">
          <Stat
            label="predicts at all"
            value={(modelling * 100).toFixed(0)}
            unit="%"
            tone={modelling > 0.5 ? 'accent' : 'default'}
            title="Fraction carrying a non-zero prediction rate. The rest form no expectations and pay nothing for the machinery."
          />
          <Stat
            label="prediction accuracy"
            value={stats.avgPredictionAccuracy.toFixed(2)}
            tone={stats.avgPredictionAccuracy > 0.6 ? 'accent' : 'default'}
            title="Averaged over the organisms that predict at all. Each is measured against its own next internal state — nothing here compares an organism to the world it cannot see."
          />
          <Stat
            label="deliberates"
            value={(planning * 100).toFixed(0)}
            unit="%"
            tone={planning > 0.05 ? 'accent' : 'default'}
            title="Fraction carrying both a non-zero prediction horizon and a non-zero planning budget."
          />
          <Stat label="mean learning rate" value={stats.avgPredictionRate.toFixed(3)} />
          <Stat
            label="learning progress"
            value={stats.avgLearningProgress.toFixed(4)}
            tone={stats.avgLearningProgress > 0 ? 'life' : 'default'}
            title="Long-run surprise minus recent surprise. Positive means the population has been getting better at prediction, not merely encountering less of it."
          />
          <Stat label="mean curiosity" value={stats.avgCuriosity.toFixed(3)} />
          <Stat label="plan horizon" value={stats.avgPlanHorizon.toFixed(2)} unit="steps" />
          <Stat
            label="novelty met"
            value={stats.avgNovelty.toFixed(2)}
            title="How unfamiliar, on average, the situations organisms are acting in are to their own models."
          />
          <Stat
            label="imagined steps"
            value={stats.planStepsPerTick.toFixed(1)}
            unit="/tick"
            title="Rollouts run across the whole population per tick, each one paid for in energy."
          />
        </div>

        {modelling < 0.02 && (
          <p className="mt-3 text-[10px] leading-snug text-ink-dim">
            Almost nothing in this world models anything. That is a legitimate outcome and not a
            malfunction: fitting a model costs upkeep from birth and returns nothing until there is
            structure worth predicting. If it stays this way, the finding is that this environment
            does not pay for prediction.
          </p>
        )}
      </Section>

      <Section title="Knowledge that outlived experience">
        <div className="grid grid-cols-3 gap-3">
          <Stat
            label="second-hand memories"
            value={(stats.socialMemoryFraction * 100).toFixed(1)}
            unit="%"
            tone={stats.socialMemoryFraction > 0.02 ? 'accent' : 'default'}
            title="Share of held place-memories formed from a sound rather than lived through. Nothing guarantees they are correct."
          />
          <Stat label="formed" value={stats.vicariousPerTick.toFixed(3)} unit="/tick" />
          <Stat
            label="toxin burden"
            value={stats.avgToxinLoad.toFixed(3)}
            tone={stats.avgToxinLoad > 0.3 ? 'warn' : 'default'}
            title="Mean accumulated dose. High and rising means the population is still eating what it should not."
          />
          <Stat label="deaths carrying a load" value={stats.toxinDeathsPerTick.toFixed(3)} unit="/tick" />
          <Stat label="memory importance" value={stats.avgMemoryImportance.toFixed(2)} />
          <Stat label="consolidation" value={stats.avgConsolidation.toFixed(3)} />
        </div>
      </Section>

      <Section title={`Cognitive development — ${trajectories.length} lineages`}>
        {trajectories.length === 0 ? (
          <p className="text-[10px] text-ink-dim">
            No species has been sampled long enough to have a trajectory yet.
          </p>
        ) : (
          <div className="space-y-4">
            {trajectories.map((t) => (
              <Trajectory key={t.id} t={t} />
            ))}
          </div>
        )}
        <p className="mt-3 text-[10px] leading-snug text-ink-dim">
          Every column is something that was measured. None of them is an intelligence score, and
          two lineages with identical numbers here can be doing completely different things — a
          deep planner running on a badly fitted model and an accurate predictor that never plans
          both show up as “cognitive”, and they are not the same animal.
        </p>
      </Section>

      <Section title="What moved with what">
        {!report || report.associations.length === 0 ? (
          <p className="text-[10px] leading-snug text-ink-dim">
            {report?.observations[0] ??
              'Nothing has passed the reporting threshold. A correlation over a handful of samples is noise with a number attached, so none is shown.'}
          </p>
        ) : (
          <div className="space-y-2">
            {report.associations.slice(0, 8).map((a, i) => (
              <div key={i} className="flex items-baseline gap-2 text-[10px]">
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{
                    background:
                      a.correlation > 0 ? 'var(--color-accent)' : 'var(--color-danger)',
                    opacity: 0.35 + Math.min(1, Math.abs(a.correlation)) * 0.65,
                  }}
                />
                <span className="text-ink">{a.driverLabel}</span>
                <span className="text-ink-dim">·</span>
                <span className="text-ink">{a.responseLabel}</span>
                <span className="ml-auto shrink-0 tabular-nums text-ink-dim">
                  r = {a.correlation.toFixed(2)} · n = {a.samples}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {report && report.hypothesis && (
        <Section title="Reading it">
          <p className="text-[10px] leading-relaxed text-ink">{report.hypothesis}</p>
          <div className="mt-3 border-l-2 border-warn/60 pl-2">
            <div className="label-xs mb-1">what would settle it</div>
            <p className="text-[10px] leading-relaxed text-ink-dim">{report.nextStep}</p>
          </div>
          <p className="mt-3 text-[9px] leading-relaxed text-ink-dim/70">
            This is one run of one world. Two quantities measured in the same world at the same time
            drift together for all sorts of reasons that have nothing to do with either causing the
            other, and this panel has no way to tell those cases apart. The Lab tab does: it forks
            the world, changes one factor, runs replicates, and reports a difference only when it
            exceeds how much the replicates vary on their own.
          </p>
        </Section>
      )}
    </div>
  );
}

/**
 * One lineage's numbers over time. Rows are generations, not ticks: what is
 * interesting is how far down a line of descent something changed, and a
 * long-lived species and a fast-breeding one cover very different amounts of
 * evolutionary distance in the same number of ticks.
 */
function Trajectory({ t }: { t: SpeciesCognition }) {
  const rows = pickRows(t);
  const first = rows[0];
  const last = rows[rows.length - 1];

  return (
    <div>
      <div className="mb-1 flex items-baseline gap-2">
        <span
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: hueColor(t.hue) }}
        />
        <span className="text-[11px] text-ink">{t.name}</span>
        {t.extinct && <span className="text-[9px] text-danger">extinct</span>}
        <span className="ml-auto text-[9px] tabular-nums text-ink-dim">
          gen {fmt(Math.round(first.generation))} → {fmt(Math.round(last.generation))}
        </span>
      </div>
      <table className="w-full text-[9px] tabular-nums">
        <thead>
          <tr className="text-ink-dim">
            <th className="text-left font-normal">gen</th>
            <th className="text-right font-normal">brain</th>
            <th className="text-right font-normal">memory</th>
            <th className="text-right font-normal">pred.</th>
            <th className="text-right font-normal">rate</th>
            <th className="text-right font-normal">plan</th>
            <th className="text-right font-normal">pop</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="text-ink">
              <td className="text-left text-ink-dim">{fmt(Math.round(r.generation))}</td>
              <td className="text-right">{r.brain.toFixed(1)}</td>
              <td className="text-right">{r.memory.toFixed(1)}</td>
              <td className="text-right">{r.predictionAccuracy.toFixed(2)}</td>
              <td className="text-right">{r.learningRate.toFixed(3)}</td>
              <td className="text-right">{r.planHorizon.toFixed(2)}</td>
              <td className="text-right text-ink-dim">{fmt(Math.round(r.population))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-1">
        <Bar value={last.predictionAccuracy} color="var(--color-accent)" height={3} />
      </div>
    </div>
  );
}

/** At most six rows, evenly spread across the lineage's whole history. */
function pickRows(t: SpeciesCognition) {
  const n = t.samples.length;
  if (n <= 6) return t.samples;
  const out = [];
  for (let i = 0; i < 6; i++) out.push(t.samples[Math.round((i * (n - 1)) / 5)]);
  return out;
}
