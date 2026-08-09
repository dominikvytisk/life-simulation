/**
 * Ring-buffer event log. Only *notable* events are recorded — births and deaths
 * are far too frequent to log individually, so they are counted in the stats
 * instead. What lands here is what a person would want to scroll back through:
 * speciations, extinctions, world events, population crashes, records broken.
 */
export const EventKind = {
  Speciation: 0,
  Extinction: 1,
  WorldEvent: 2,
  PopulationCrash: 3,
  PopulationBoom: 4,
  Milestone: 5,
  FirstPredation: 6,
  /** Emitted by the chronicle when a series leaves its own baseline. */
  Anomaly: 7,
} as const;
export type EventKindId = (typeof EventKind)[keyof typeof EventKind];

export interface SimEvent {
  tick: number;
  kind: EventKindId;
  text: string;
  speciesId?: number;
  x?: number;
  y?: number;
}

export class EventLog {
  private buffer: SimEvent[] = [];
  private readonly max: number;
  /** Monotonic counter so the UI can cheaply detect "anything new?". */
  revision = 0;

  constructor(max = 600) {
    this.max = max;
  }

  push(e: SimEvent): void {
    this.buffer.push(e);
    if (this.buffer.length > this.max) this.buffer.splice(0, this.buffer.length - this.max);
    this.revision++;
  }

  recent(n: number): SimEvent[] {
    return this.buffer.slice(Math.max(0, this.buffer.length - n));
  }

  all(): SimEvent[] {
    return this.buffer;
  }

  clear(): void {
    this.buffer.length = 0;
    this.revision++;
  }
}
