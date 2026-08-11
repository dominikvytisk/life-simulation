import { useEffect, useState } from 'react';
import { getClient } from '../app/client';
import { useStore } from '../app/store';
import { EXPERIMENTS, experimentById } from '../experiments/presets';
import {
  deleteWorld,
  exportWorld,
  importWorld,
  listWorlds,
  loadWorld,
  saveWorld,
  type WorldSaveMeta,
} from '../persistence/db';
import { DEFAULT_CONFIG, type SimConfig } from '../sim/core/config';
import { Button, Section, fmt } from './ui';

/**
 * Experiment setup, live parameter tuning and persistence.
 *
 * Presets change the world's physics and then get out of the way — see
 * experiments/presets.ts. Restarting is cheap and reproducible: the same seed
 * with the same config replays identically.
 */
export function LabPanel() {
  const experimentId = useStore((s) => s.experimentId);
  const seed = useStore((s) => s.seed);
  const stats = useStore((s) => s.stats);
  const set = useStore((s) => s.set);
  const client = getClient();

  const [saves, setSaves] = useState<WorldSaveMeta[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [live, setLive] = useState<Partial<SimConfig>>({});

  const refreshSaves = () => listWorlds().then(setSaves).catch(() => undefined);
  useEffect(() => {
    refreshSaves();
  }, []);

  const experiment = experimentById(experimentId);

  const start = (id: string, newSeed = seed) => {
    const exp = experimentById(id);
    const config = { ...exp.config, seed: newSeed };
    client.reset(config);
    client.setRunning(true);
    set({
      experimentId: id,
      seed: newSeed,
      running: true,
      events: [],
      history: null,
      inspection: null,
      selectedId: 0,
      species: [],
      extinct: [],
    });
    setLive({});
    // Fire the preset's scheduled shocks relative to now.
    for (const s of exp.schedule ?? []) {
      window.setTimeout(() => client.worldEvent(s.spec), Math.min(60_000, s.atTick * 4));
    }
  };

  const applyLive = (patch: Partial<SimConfig>) => {
    const next = { ...live, ...patch };
    setLive(next);
    client.setConfig(patch);
  };

  const doSave = async () => {
    setBusy('saving');
    client.on({
      onSaved: async (payload) => {
        const name = `${experiment.name} · t${fmt((payload as any).tick ?? 0)}`;
        await saveWorld(`w-${Date.now()}`, name, payload as Record<string, any>);
        await refreshSaves();
        setBusy(null);
      },
    });
    client.save();
  };

  const doExport = () => {
    setBusy('exporting');
    client.on({
      onSaved: (payload) => {
        exportWorld(payload as Record<string, any>, `${experiment.name}-t${(payload as any).tick}`);
        setBusy(null);
      },
    });
    client.save();
  };

  /**
   * Loading can legitimately fail — a world saved before the vocal apparatus
   * existed has a different genome length and cannot be resumed. The worker
   * refuses rather than corrupting it, and the reason is shown here.
   */
  const applyLoad = (payload: unknown) =>
    new Promise<void>((resolve) => {
      client.on({
        onLoaded: (error) => {
          if (error) setLoadError(error);
          else {
            setLoadError(null);
            set({ running: false, events: [], history: null, inspection: null, selectedId: 0 });
          }
          resolve();
        },
      });
      client.load(payload);
    });

  const doLoad = async (key: string) => {
    setBusy('loading');
    const payload = await loadWorld(key);
    if (payload) await applyLoad(payload);
    setBusy(null);
  };

  const doImport = async (file: File) => {
    setBusy('importing');
    try {
      const payload = await importWorld(file);
      await applyLoad(payload);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not read that file.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <Section title="Experiments">
        <div className="space-y-1">
          {EXPERIMENTS.map((e) => (
            <button
              key={e.id}
              onClick={() => start(e.id)}
              className={`flex w-full items-start gap-2 border px-2 py-1.5 text-left transition-colors ${
                experimentId === e.id
                  ? 'border-accent/60 bg-accent/5'
                  : 'border-edge/60 bg-panel-2 hover:border-edge-2'
              }`}
            >
              <span className="text-[14px] leading-none">{e.icon}</span>
              <span className="min-w-0">
                <span className="block text-[11px] text-ink">{e.name}</span>
                <span className="block text-[9px] leading-snug text-ink-dim">{e.hypothesis}</span>
              </span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="What to watch">
        <p className="text-[10px] leading-relaxed text-ink-dim">{experiment.whatToWatch}</p>
      </Section>

      <Section title="Determinism">
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-ink-dim">seed</label>
          <input
            type="number"
            value={seed}
            onChange={(e) => set({ seed: Number(e.target.value) || 0 })}
            className="w-24 border border-edge bg-panel-2 px-1.5 py-1 text-[11px] tabular-nums text-ink outline-none focus:border-accent/60"
          />
          <Button onClick={() => start(experimentId, seed)} tone="accent">
            restart
          </Button>
          <Button onClick={() => start(experimentId, Math.floor(Math.random() * 1e9))}>
            random seed
          </Button>
        </div>
        <p className="mt-2 text-[9px] leading-snug text-ink-dim">
          The same seed and configuration reproduce the run exactly, tick for tick. All randomness
          comes from one seeded stream — nothing in the simulation reads the clock.
        </p>
      </Section>

      <Section title="Live parameters">
        <div className="space-y-2">
          <Slider
            label="vegetation growth"
            min={0.0005}
            max={0.03}
            step={0.0005}
            value={live.vegetationGrowthRate ?? DEFAULT_CONFIG.vegetationGrowthRate}
            onChange={(v) => applyLive({ vegetationGrowthRate: v })}
            format={(v) => v.toFixed(4)}
          />
          <Slider
            label="metabolic cost"
            min={0.2}
            max={3}
            step={0.05}
            value={live.basalMetabolicCost ?? DEFAULT_CONFIG.basalMetabolicCost}
            onChange={(v) => applyLive({ basalMetabolicCost: v })}
            format={(v) => v.toFixed(2)}
          />
          <Slider
            label="mutation rate"
            min={0.005}
            max={0.3}
            step={0.005}
            value={live.baseMutationRate ?? DEFAULT_CONFIG.baseMutationRate}
            onChange={(v) => applyLive({ baseMutationRate: v })}
            format={(v) => v.toFixed(3)}
          />
          <Slider
            label="brain mutation"
            min={0.002}
            max={0.2}
            step={0.002}
            value={live.brainMutationRate ?? DEFAULT_CONFIG.brainMutationRate}
            onChange={(v) => applyLive({ brainMutationRate: v })}
            format={(v) => v.toFixed(3)}
          />
          <Slider
            label="speciation threshold"
            min={0.1}
            max={0.9}
            step={0.01}
            value={live.speciationThreshold ?? DEFAULT_CONFIG.speciationThreshold}
            onChange={(v) => applyLive({ speciationThreshold: v })}
            format={(v) => v.toFixed(2)}
          />
          <Slider
            label="mating compatibility"
            min={0.05}
            max={0.9}
            step={0.01}
            value={live.compatibilityThreshold ?? DEFAULT_CONFIG.compatibilityThreshold}
            onChange={(v) => applyLive({ compatibilityThreshold: v })}
            format={(v) => v.toFixed(2)}
          />
          <Slider
            label="damage scale"
            min={1}
            max={40}
            step={0.5}
            value={live.damageScale ?? DEFAULT_CONFIG.damageScale}
            onChange={(v) => applyLive({ damageScale: v })}
            format={(v) => v.toFixed(1)}
          />
          <Slider
            label="signal decay"
            min={0.002}
            max={0.2}
            step={0.002}
            value={live.signalDecay ?? DEFAULT_CONFIG.signalDecay}
            onChange={(v) => applyLive({ signalDecay: v })}
            format={(v) => v.toFixed(3)}
          />
        </div>
        <p className="mt-2 text-[9px] leading-snug text-ink-dim">
          Live edits apply immediately but break exact reproducibility of the current run — the
          seed alone no longer determines the outcome. Restart to get a clean, replayable run.
        </p>
      </Section>

      <Section
        title="Saved worlds"
        right={
          <span className="text-[9px] text-ink-dim">
            {stats ? `${fmt(stats.population)} organisms live` : ''}
          </span>
        }
      >
        <div className="mb-2 flex flex-wrap gap-1">
          <Button onClick={doSave} disabled={busy !== null} tone="accent">
            {busy === 'saving' ? 'saving…' : 'save world'}
          </Button>
          <Button onClick={doExport} disabled={busy !== null}>
            export file
          </Button>
          <label className="cursor-pointer border border-edge bg-panel-2 px-2 py-1 text-[11px] text-ink-dim hover:border-edge-2 hover:text-ink">
            import file
            <input
              type="file"
              accept=".json,.life.json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) doImport(f);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        {loadError && (
          <p className="mb-2 border border-danger/40 bg-panel-2 px-2 py-1 text-[9px] leading-snug text-danger">
            {loadError}
          </p>
        )}
        {saves.length === 0 ? (
          <p className="text-[10px] text-ink-dim">nothing saved yet</p>
        ) : (
          <div className="space-y-1">
            {saves.map((s) => (
              <div key={s.key} className="flex items-center gap-2 border border-edge/60 bg-panel-2 px-2 py-1">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[10px] text-ink">{s.name}</div>
                  <div className="text-[9px] text-ink-dim">
                    tick {fmt(s.tick)} · {fmt(s.population)} alive · seed {s.seed} ·{' '}
                    {new Date(s.savedAt).toLocaleString()}
                  </div>
                </div>
                <Button onClick={() => doLoad(s.key)} disabled={busy !== null}>
                  load
                </Button>
                <Button
                  tone="danger"
                  onClick={() => deleteWorld(s.key).then(refreshSaves)}
                  disabled={busy !== null}
                >
                  ✕
                </Button>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  format,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  return (
    <div>
      <div className="flex justify-between text-[10px]">
        <span className="text-ink-dim">{label}</span>
        <span className="tabular-nums text-ink">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-0.5 h-1 w-full appearance-none bg-edge accent-[var(--color-accent)]"
      />
    </div>
  );
}
