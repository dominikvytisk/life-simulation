import { getClient } from '../app/client';
import { useStore } from '../app/store';
import { SPEED_PRESETS } from '../workers/protocol';
import { Button, fmt } from './ui';

export function TopBar() {
  const running = useStore((s) => s.running);
  const speedIndex = useStore((s) => s.speedIndex);
  const stats = useStore((s) => s.stats);
  const backend = useStore((s) => s.backend);
  const set = useStore((s) => s.set);
  const client = getClient();

  const toggle = () => {
    const next = !running;
    client.setRunning(next);
    set({ running: next });
  };

  const setSpeed = (i: number) => {
    const p = SPEED_PRESETS[i];
    client.setSpeed(p.ticksPerFrame, p.unlimited);
    set({ speedIndex: i });
  };

  return (
    <header className="flex shrink-0 items-center gap-4 border-b border-edge bg-panel px-3 py-2">
      <div className="flex items-baseline gap-2">
        <span className="text-[15px] tracking-[0.32em] text-accent">LIFE</span>
        <span className="hidden text-[9px] tracking-[0.16em] text-ink-dim sm:inline">
          DIGITAL EVOLUTION OBSERVATORY
        </span>
      </div>

      <div className="flex items-center gap-1">
        <Button onClick={toggle} active={running} tone="accent" className="w-16">
          {running ? '❙❙ PAUSE' : '▶ PLAY'}
        </Button>
        <Button onClick={() => client.stepOnce(1)} disabled={running} title="Advance one tick">
          ▸1
        </Button>
        <Button onClick={() => client.stepOnce(100)} disabled={running} title="Advance 100 ticks">
          ▸100
        </Button>
      </div>

      <div className="flex items-center gap-px">
        {SPEED_PRESETS.map((p, i) => (
          <Button key={p.label} active={speedIndex === i} onClick={() => setSpeed(i)}>
            {p.label}
          </Button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-4 overflow-hidden">
        <Readout label="tick" value={fmt(stats?.tick ?? 0)} />
        <Readout label="year" value={`${stats?.year ?? 0}`} />
        <Readout label="pop" value={fmt(stats?.population ?? 0)} tone="text-life" />
        <Readout label="species" value={`${stats?.livingSpecies ?? 0}`} tone="text-accent" />
        <Readout label="gen" value={fmt(stats?.maxGeneration ?? 0)} />
        <Readout
          label="ticks/s"
          value={fmt(stats?.ticksPerSecond ?? 0)}
          tone={(stats?.ticksPerSecond ?? 0) < 8 && running ? 'text-warn' : 'text-ink'}
        />
        <span
          title={
            backend === 'webgpu'
              ? 'Rendering through WebGPU'
              : backend === 'canvas2d'
                ? 'WebGPU unavailable — using the Canvas2D fallback'
                : 'Initialising renderer'
          }
          className={`border px-1.5 py-0.5 text-[9px] tracking-wider ${
            backend === 'webgpu'
              ? 'border-accent/40 text-accent'
              : backend === 'canvas2d'
                ? 'border-warn/40 text-warn'
                : 'border-edge text-ink-dim'
          }`}
        >
          {backend === 'webgpu' ? 'WEBGPU' : backend === 'canvas2d' ? 'CANVAS2D' : '…'}
        </span>
      </div>
    </header>
  );
}

function Readout({ label, value, tone = 'text-ink' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="hidden text-right md:block">
      <div className="label-xs">{label}</div>
      <div className={`text-[13px] leading-none tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}
