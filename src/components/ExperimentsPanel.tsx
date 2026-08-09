import { useEffect, useRef, useState } from 'react';
import { getClient } from '../app/client';
import { runExperiment } from '../app/experimentClient';
import { useStore } from '../app/store';
import { HYPOTHESES, type ComparedMetric } from '../experiments/runner';
import { Button, Section, fmt } from './ui';

/**
 * Controlled experiments on forks of the live world.
 *
 * Every arm starts from a byte-exact copy of the current state, so the control
 * arm is a genuine control — same organisms, same genomes, same RNG position —
 * and not merely a similar-looking separate run. Replicates differ only in how
 * the random stream continues from that shared instant.
 */
export function ExperimentsPanel() {
  const running = useStore((s) => s.experimentRunning);
  const report = useStore((s) => s.experiment);
  const progress = useStore((s) => s.experimentProgress);
  const error = useStore((s) => s.experimentError);
  const stats = useStore((s) => s.stats);
  const set = useStore((s) => s.set);

  const [hypothesisId, setHypothesisId] = useState(HYPOTHESES[0].id);
  const [ticks, setTicks] = useState(2000);
  const [replicates, setReplicates] = useState(3);
  const pendingFork = useRef<((payload: unknown) => void) | null>(null);

  const hypothesis = HYPOTHESES.find((h) => h.id === hypothesisId) ?? HYPOTHESES[0];

  useEffect(() => {
    getClient().on({
      onForked: (payload) => {
        pendingFork.current?.(payload);
        pendingFork.current = null;
      },
    });
  }, []);

  const start = () => {
    if (running) return;
    set({ experimentRunning: true, experimentError: null, experimentProgress: {}, experiment: null });
    const client = getClient();
    pendingFork.current = (payload) => {
      runExperiment(
        payload as Record<string, any>,
        hypothesis.arms,
        ticks,
        replicates,
        (p) => {
          const cur = { ...useStore.getState().experimentProgress };
          cur[p.armId] = p.fraction;
          set({ experimentProgress: cur });
        },
      )
        .then((r) => set({ experiment: r, experimentRunning: false }))
        .catch((e) => set({ experimentError: String(e), experimentRunning: false }));
    };
    client.fork();
  };

  return (
    <div className="h-full overflow-y-auto">
      <Section title="Hypothesis">
        <div className="space-y-1">
          {HYPOTHESES.map((h) => (
            <button
              key={h.id}
              disabled={running}
              onClick={() => setHypothesisId(h.id)}
              className={`w-full border px-2 py-1.5 text-left transition-colors disabled:opacity-50 ${
                hypothesisId === h.id
                  ? 'border-accent/60 bg-accent/5'
                  : 'border-edge/60 bg-panel-2 hover:border-edge-2'
              }`}
            >
              <span className="block text-[11px] text-ink">{h.claim}</span>
              <span className="block text-[9px] leading-snug text-ink-dim">{h.reasoning}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Design">
        <div className="mb-2 space-y-1">
          {hypothesis.arms.map((a) => (
            <div key={a.id} className="flex items-baseline gap-2 text-[10px]">
              <span className={a.id === 'control' ? 'text-accent' : 'text-ink'}>{a.label}</span>
              <span className="ml-auto truncate text-[9px] text-ink-dim">
                {Object.keys(a.patch).length === 0
                  ? 'no changes (control)'
                  : Object.entries(a.patch)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(', ')}
              </span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-ink-dim">ticks</label>
          <input
            type="number"
            value={ticks}
            disabled={running}
            onChange={(e) => setTicks(Math.max(200, Number(e.target.value) || 200))}
            className="w-20 border border-edge bg-panel-2 px-1.5 py-1 text-[11px] tabular-nums text-ink outline-none focus:border-accent/60"
          />
          <label className="text-[10px] text-ink-dim">replicates</label>
          <input
            type="number"
            value={replicates}
            disabled={running}
            onChange={(e) => setReplicates(Math.min(8, Math.max(1, Number(e.target.value) || 1)))}
            className="w-14 border border-edge bg-panel-2 px-1.5 py-1 text-[11px] tabular-nums text-ink outline-none focus:border-accent/60"
          />
          <Button onClick={start} disabled={running || !stats} tone="accent">
            {running ? 'running…' : 'fork & run'}
          </Button>
        </div>
        <p className="mt-2 text-[9px] leading-snug text-ink-dim">
          Forks from the live world at tick {fmt(stats?.tick ?? 0)}. Each arm runs{' '}
          {replicates} replicate{replicates === 1 ? '' : 's'} of {fmt(ticks)} ticks in its own
          worker. This takes a while and will use every core you have.
        </p>
      </Section>

      {running && (
        <Section title="Progress">
          <div className="space-y-1.5">
            {hypothesis.arms.map((a) => (
              <div key={a.id}>
                <div className="flex justify-between text-[10px]">
                  <span className="text-ink-dim">{a.label}</span>
                  <span className="tabular-nums text-ink-dim">
                    {Math.round((progress[a.id] ?? 0) * 100)}%
                  </span>
                </div>
                <div className="h-1 w-full bg-panel-2">
                  <div
                    className="h-1 bg-accent transition-[width]"
                    style={{ width: `${Math.min(100, (progress[a.id] ?? 0) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {error && (
        <Section title="Failed">
          <p className="text-[10px] text-danger">{error}</p>
        </Section>
      )}

      {report && <Results watch={hypothesis.watch} />}
    </div>
  );
}

function Results({ watch }: { watch: ComparedMetric[] }) {
  const report = useStore((s) => s.experiment)!;
  const control = report.arms.find((a) => a.id === 'control') ?? report.arms[0];

  return (
    <>
      <Section title={`Result — ${report.replicates} replicates × ${fmt(report.ticks)} ticks`}>
        <div className="space-y-2">
          {report.arms.map((arm) => (
            <div key={arm.id} className="border border-edge/60 bg-panel-2 p-2">
              <div className="mb-1 flex items-baseline gap-2">
                <span className={`text-[11px] ${arm.id === control.id ? 'text-accent' : 'text-ink'}`}>
                  {arm.label}
                </span>
                {arm.extinctions > 0 && (
                  <span className="text-[9px] text-danger">
                    {arm.extinctions}/{arm.replicates} went extinct
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                {watch.map((m) => (
                  <div key={m} className="flex justify-between text-[9px]">
                    <span className="truncate text-ink-dim">{m}</span>
                    <span className="tabular-nums text-ink">
                      {arm.mean[m].toFixed(3)}
                      <span className="text-ink-dim"> ±{arm.sd[m].toFixed(3)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[9px] leading-snug text-ink-dim">
          ± is the standard deviation across replicates, not a confidence interval. With{' '}
          {report.replicates} replicate{report.replicates === 1 ? '' : 's'} this is a rough measure
          of how much the world varies on its own.
        </p>
      </Section>

      {Object.entries(report.comparisons).map(([armId, comparisons]) => {
        const arm = report.arms.find((a) => a.id === armId);
        const shown = comparisons.filter((c) => watch.includes(c.metric));
        return (
          <Section key={armId} title={`${arm?.label ?? armId} vs ${control.label}`}>
            <div className="space-y-0.5">
              {shown.map((c) => (
                <div key={c.metric} className="flex items-baseline gap-2 text-[10px]">
                  <span className="w-28 truncate text-ink-dim">{c.metric}</span>
                  <span
                    className="w-16 text-right tabular-nums"
                    style={{
                      color:
                        c.verdict === 'inconclusive'
                          ? 'var(--color-ink-dim)'
                          : c.verdict === 'higher'
                            ? 'var(--color-life)'
                            : 'var(--color-danger)',
                    }}
                  >
                    {c.deltaPercent > 0 ? '+' : ''}
                    {c.deltaPercent.toFixed(0)}%
                  </span>
                  <span className="w-12 text-right text-[9px] tabular-nums text-ink-dim">
                    d={c.effectSize.toFixed(1)}
                  </span>
                  <span className="flex-1 text-right text-[9px] text-ink-dim">{c.verdict}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[9px] leading-snug text-ink-dim">
              d is the difference in units of the pooled replicate spread. Anything under 1 is
              reported as inconclusive: the arms differ by less than the world varies on its own,
              so the change cannot be attributed to the manipulation.
            </p>
          </Section>
        );
      })}
    </>
  );
}
