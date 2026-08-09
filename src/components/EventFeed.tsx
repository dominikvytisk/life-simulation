import { useStore } from '../app/store';
import { EventKind } from '../sim/events/eventLog';

const KIND_STYLE: Record<number, { mark: string; className: string }> = {
  [EventKind.Speciation]: { mark: '⑂', className: 'text-accent' },
  [EventKind.Extinction]: { mark: '†', className: 'text-danger' },
  [EventKind.WorldEvent]: { mark: '◈', className: 'text-warn' },
  [EventKind.PopulationCrash]: { mark: '↓', className: 'text-danger' },
  [EventKind.PopulationBoom]: { mark: '↑', className: 'text-life' },
  [EventKind.Milestone]: { mark: '•', className: 'text-ink-dim' },
  [EventKind.FirstPredation]: { mark: '⚑', className: 'text-danger' },
};

/** Reverse-chronological log of the things worth noticing. */
export function EventFeed({ limit = 60 }: { limit?: number }) {
  const events = useStore((s) => s.events);
  const shown = events.slice(-limit).reverse();

  if (shown.length === 0) {
    return <div className="py-4 text-center text-[10px] text-ink-dim">nothing has happened yet</div>;
  }

  return (
    <ul className="space-y-0.5">
      {shown.map((e, i) => {
        const style = KIND_STYLE[e.kind] ?? KIND_STYLE[EventKind.Milestone];
        return (
          <li key={`${e.tick}-${i}`} className="flex gap-1.5 text-[10px] leading-snug">
            <span className={`w-3 shrink-0 text-center ${style.className}`}>{style.mark}</span>
            <span className="w-12 shrink-0 tabular-nums text-ink-faint text-ink-dim/60">
              {e.tick.toLocaleString()}
            </span>
            <span className="min-w-0 flex-1 text-ink-dim">{e.text}</span>
          </li>
        );
      })}
    </ul>
  );
}
