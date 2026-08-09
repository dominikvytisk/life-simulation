import { getClient } from '../app/client';
import { useStore } from '../app/store';
import { OVERLAY_MODES, type OverlayMode } from '../sim/world/painter';
import { WORLD_EVENT_INFO, type WorldEventTypeId } from '../sim/events/worldEvents';
import { Button, Section, fmt } from './ui';

/**
 * Map overlays and world events.
 *
 * Every event here changes an environmental variable, never an organism. That
 * distinction is the whole design: a heat wave raises temperature and lets the
 * consequences fall where evolved tolerance says they should.
 */
export function WorldPanel() {
  const overlay = useStore((s) => s.overlay);
  const active = useStore((s) => s.activeWorldEvents);
  const placement = useStore((s) => s.eventPlacement);
  const stats = useStore((s) => s.stats);
  const set = useStore((s) => s.set);
  const client = getClient();

  const setOverlay = (mode: OverlayMode) => {
    client.setOverlay(mode);
    set({ overlay: mode });
  };

  const fire = (type: WorldEventTypeId) => {
    const info = WORLD_EVENT_INFO[type];
    if (info.localized) {
      // Localised events need a target; the next map click supplies it.
      set({ eventPlacement: placement === type ? null : type });
    } else {
      client.worldEvent({ type });
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <Section title="Map overlay">
        <div className="grid grid-cols-2 gap-1">
          {OVERLAY_MODES.map((m) => (
            <Button key={m.id} active={overlay === m.id} onClick={() => setOverlay(m.id)}>
              {m.label}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-[9px] leading-snug text-ink-dim">
          Each overlay renders one field of the environment. Vegetation and signal field are the two
          worth watching while the simulation runs — they show what organisms are actually
          responding to.
        </p>
      </Section>

      <Section title="World events">
        <div className="grid grid-cols-3 gap-1">
          {(Object.keys(WORLD_EVENT_INFO) as WorldEventTypeId[]).map((type) => {
            const info = WORLD_EVENT_INFO[type];
            return (
              <Button
                key={type}
                active={placement === type}
                onClick={() => fire(type)}
                title={`${info.blurb}${info.localized ? '\n\nClick the map to place it.' : ''}`}
                className="flex flex-col items-center gap-0.5 py-1.5"
              >
                <span className="text-[15px] leading-none">{info.icon}</span>
                <span className="text-[9px] leading-none">{info.label}</span>
              </Button>
            );
          })}
        </div>
        <p className="mt-2 text-[9px] leading-snug text-ink-dim">
          Events perturb the environment, not the population. Nothing here kills a chosen organism —
          it changes temperature, water, or the food supply, and lets selection do the rest.
        </p>
      </Section>

      {active.length > 0 && (
        <Section title="Active forcings">
          <div className="space-y-1.5">
            {active.map((a, i) => {
              const info = WORLD_EVENT_INFO[a.type as WorldEventTypeId];
              return (
                <div key={i}>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-ink">
                      {info?.icon} {info?.label ?? a.type}
                    </span>
                    <span className="tabular-nums text-ink-dim">{fmt(a.ticksLeft)}t left</span>
                  </div>
                  <div className="mt-0.5 h-1 w-full bg-panel-2">
                    <div
                      className="h-1 bg-warn"
                      style={{ width: `${Math.min(100, a.progress * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      <Section title="Climate readout">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
          <span className="text-ink-dim">temperature</span>
          <span className="text-right tabular-nums">{stats?.temperature.toFixed(4) ?? '—'}</span>
          <span className="text-ink-dim">daylight</span>
          <span className="text-right tabular-nums">
            {stats ? `${(stats.light * 100).toFixed(0)}%` : '—'}
          </span>
          <span className="text-ink-dim">day / year</span>
          <span className="text-right tabular-nums">
            {stats ? `${stats.day} / ${stats.year}` : '—'}
          </span>
          <span className="text-ink-dim">total vegetation</span>
          <span className="text-right tabular-nums">{stats ? fmt(stats.totalVegetation) : '—'}</span>
          <span className="text-ink-dim">total carrion</span>
          <span className="text-right tabular-nums">
            {stats ? fmt(stats.totalCarrion, 1) : '—'}
          </span>
        </div>
      </Section>

      <Section title="Intervention">
        <div className="flex flex-wrap gap-1">
          <Button onClick={() => client.inject(200)} tone="accent">
            inject 200 founders
          </Button>
          <Button onClick={() => client.inject(1000)} tone="accent">
            inject 1000
          </Button>
        </div>
        <p className="mt-2 text-[9px] leading-snug text-ink-dim">
          Injected organisms have random genomes and untrained brains. They almost always lose to an
          established population — which is itself a useful measurement of how far evolution has
          gotten.
        </p>
      </Section>
    </div>
  );
}
