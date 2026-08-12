/**
 * Application shell. Its only jobs are wiring the worker's messages into the
 * store, polling for the low-frequency detail payloads, and laying out the
 * panels. No simulation logic lives on this side of the worker boundary.
 */
import { useEffect } from 'react';
import { getClient } from './app/client';
import { useStore, type PanelTab } from './app/store';
import { WorldCanvas } from './components/WorldCanvas';
import { TopBar } from './components/TopBar';
import { OverviewPanel } from './components/OverviewPanel';
import { ChartsPanel } from './components/ChartsPanel';
import { SpeciesPanel } from './components/SpeciesPanel';
import { MuseumPanel } from './components/MuseumPanel';
import { Inspector } from './components/Inspector';
import { WorldPanel } from './components/WorldPanel';
import { LabPanel } from './components/LabPanel';
import { SignalsPanel } from './components/SignalsPanel';
import { VoicePanel } from './components/VoicePanel';
import { VoiceSynth } from './audio/synth';
import { ChroniclePanel } from './components/ChroniclePanel';
import { CognitionPanel } from './components/CognitionPanel';
import { ExperimentsPanel } from './components/ExperimentsPanel';
import { experimentById } from './experiments/presets';

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'overview', label: 'World' },
  { id: 'charts', label: 'Charts' },
  { id: 'species', label: 'Species' },
  { id: 'voice', label: 'Voice' },
  { id: 'signals', label: 'Culture' },
  { id: 'chronicle', label: 'History' },
  { id: 'cognition', label: 'Minds' },
  { id: 'experiments', label: 'Lab' },
  { id: 'museum', label: 'Museum' },
  { id: 'brain', label: 'Inspect' },
  { id: 'world', label: 'Events' },
  { id: 'lab', label: 'Setup' },
];

export function App() {
  const tab = useStore((s) => s.tab);
  const ready = useStore((s) => s.ready);
  const audioEnabled = useStore((s) => s.audioEnabled);
  const set = useStore((s) => s.set);

  // ---- worker wiring ----
  useEffect(() => {
    const client = getClient();
    client.on({
      onReady: () => set({ ready: true }),
      onStats: (stats) => set({ stats }),
      onEvents: (events) => set({ events }),
      onDetail: (d) =>
        set({
          inspection: d.inspection,
          species: d.species,
          extinct: d.extinct,
          activeWorldEvents: d.activeEvents,
          culture: d.culture,
          acoustics: d.acoustics,
          firstContact: d.firstContact,
          milestones: d.milestones,
          anomalies: d.anomalies,
          mutationTally: d.mutationTally,
          cognition: d.cognition,
          trajectories: d.trajectories,
        }),
      onHistory: (history) => set({ history }),
      onPicked: (id) => set({ selectedId: id, tab: id ? 'brain' : useStore.getState().tab }),
    });

    const { seed, experimentId, overlay } = useStore.getState();
    client.init({ ...experimentById(experimentId).config, seed }, overlay);
    return () => {
      // The worker is a module singleton and deliberately outlives the mount,
      // so StrictMode's double-invoke does not restart the world.
    };
  }, [set]);

  // ---- low-frequency polling ----
  // Species tables, the museum and the selected organism's brain state are
  // pulled on a timer rather than pushed every frame: they are expensive to
  // build and nobody can read them 30 times a second.
  useEffect(() => {
    const client = getClient();
    const needsDetail =
      tab === 'species' ||
      tab === 'museum' ||
      tab === 'brain' ||
      tab === 'world' ||
      tab === 'signals' ||
      tab === 'voice' ||
      tab === 'chronicle' ||
      tab === 'cognition';
    const detailTimer = window.setInterval(() => {
      if (needsDetail || useStore.getState().selectedId) client.requestDetail();
    }, 400);
    const historyTimer = window.setInterval(() => {
      if (tab === 'charts') client.requestHistory();
    }, 1000);
    if (needsDetail) client.requestDetail();
    if (tab === 'charts') client.requestHistory();
    return () => {
      window.clearInterval(detailTimer);
      window.clearInterval(historyTimer);
    };
  }, [tab]);

  // ---- audio ----
  // Voices are only reported by the worker while something is listening, and
  // only synthesised after an explicit click: browsers require a gesture to
  // start an AudioContext, and silently starting one would be rude anyway.
  useEffect(() => {
    const client = getClient();
    const wantsVoices = audioEnabled || tab === 'voice';
    client.setListenerEnabled(wantsVoices);
    if (!audioEnabled) return;

    const synth = new VoiceSynth();
    let disposed = false;
    let raf = 0;
    synth
      .start()
      .then(() => {
        if (disposed) {
          synth.stop();
          return;
        }
        const pump = () => {
          synth.update(
            client.latestVoices.map((v) => ({
              id: v.id,
              // Pan and attenuate relative to the listening point rather than
              // to the world origin.
              x: v.x - client.listenerX,
              y: v.y - client.listenerY,
              distance: v.distance,
              pitch: v.pitch,
              loudness: v.loudness,
              noisiness: v.noisiness,
              timbre: v.timbre,
              slope: v.slope,
              tremolo: v.tremolo,
              external: v.external,
            })),
          );
          raf = requestAnimationFrame(pump);
        };
        raf = requestAnimationFrame(pump);
      })
      .catch(() => set({ audioEnabled: false }));

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      synth.stop();
    };
  }, [audioEnabled, tab, set]);

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const client = getClient();
      const state = useStore.getState();
      switch (e.key) {
        case ' ': {
          e.preventDefault();
          const next = !state.running;
          client.setRunning(next);
          set({ running: next });
          break;
        }
        case 'Escape':
          set({ eventPlacement: null });
          break;
        case '.':
          if (!state.running) client.stepOnce(1);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [set]);

  return (
    <div className="flex h-full flex-col bg-ground text-ink">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          <WorldCanvas />
          {!ready && (
            <div className="absolute inset-0 grid place-items-center bg-ground/80">
              <div className="text-center">
                <div className="text-[13px] tracking-[0.3em] text-accent">GENERATING WORLD</div>
                <div className="mt-1 text-[10px] text-ink-dim">
                  terrain · climate · founder genomes
                </div>
              </div>
            </div>
          )}
          <Legend />
        </main>

        <aside className="flex w-[400px] shrink-0 flex-col border-l border-edge bg-panel">
          <nav className="flex shrink-0 flex-wrap border-b border-edge">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => set({ tab: t.id })}
                className={`w-1/4 border-r border-b border-edge/60 px-1 py-1.5 text-[10px] transition-colors ${
                  tab === t.id
                    ? 'bg-accent/10 text-accent'
                    : 'text-ink-dim hover:bg-panel-2 hover:text-ink'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1">
            {tab === 'overview' && <OverviewPanel />}
            {tab === 'charts' && <ChartsPanel />}
            {tab === 'species' && <SpeciesPanel />}
            {tab === 'voice' && <VoicePanel />}
            {tab === 'signals' && <SignalsPanel />}
            {tab === 'chronicle' && <ChroniclePanel />}
            {tab === 'cognition' && <CognitionPanel />}
            {tab === 'experiments' && <ExperimentsPanel />}
            {tab === 'museum' && <MuseumPanel />}
            {tab === 'brain' && <Inspector />}
            {tab === 'world' && <WorldPanel />}
            {tab === 'lab' && <LabPanel />}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** Explains the visual encoding, since organism appearance is generated from
 * the genome rather than assigned. */
function Legend() {
  return (
    <div className="pointer-events-none absolute right-2 bottom-2 hidden max-w-[240px] border border-edge/60 bg-ground/75 px-2 py-1.5 text-[9px] leading-relaxed text-ink-dim lg:block">
      <div className="mb-1 tracking-[0.14em] text-ink">MORPHOLOGY IS GENERATED</div>
      elongated body → muscle · thick rim → armor · warm tint → meat gut · size →
      body-size gene · brightness → energy
      <div className="mt-1 text-ink-dim/70">
        drag to pan · scroll to zoom · click an organism · space to pause
      </div>
    </div>
  );
}
