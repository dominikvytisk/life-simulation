/**
 * Main-thread handle on the simulation worker.
 *
 * Owns the buffer ping-pong: the worker transfers a snapshot over, we hold it
 * while the renderer draws from it, and we hand the *previous* buffer back on
 * the next frame. Steady state allocates nothing and copies nothing.
 *
 * React never sees the snapshot. High-frequency data (positions) goes straight
 * to the renderer; only low-frequency summaries reach the store, throttled, so
 * a 12,000-organism world still re-renders the UI a handful of times a second.
 */
import type { SimConfig } from '../sim/core/config';
import type { OverlayMode } from '../sim/world/painter';
import type { WorldEventSpec } from '../sim/events/worldEvents';
import type { FromWorker, ToWorker } from '../workers/protocol';
import type { SeriesKey } from '../analytics/history';
import type {
  AcousticReport,
  AnomalyReport,
  AudibleVoice,
  CultureReport,
  FirstContactReport,
  Milestone,
  OrganismInspection,
  SimEventDTO,
  SpeciesSummary,
  Stats,
} from '../sim/core/types';

export interface DetailPayload {
  inspection: OrganismInspection | null;
  species: SpeciesSummary[];
  extinct: SpeciesSummary[];
  activeEvents: { type: string; ticksLeft: number; progress: number }[];
  culture: CultureReport;
  acoustics: AcousticReport;
  firstContact: FirstContactReport;
  milestones: Milestone[];
  anomalies: AnomalyReport[];
  mutationTally: number[];
}

export interface HistoryPayload {
  ticks: Float64Array;
  series: Record<SeriesKey, Float32Array>;
}

type Listeners = {
  onStats?: (s: Stats) => void;
  onEvents?: (e: SimEventDTO[]) => void;
  onDetail?: (detail: DetailPayload) => void;
  onForked?: (payload: unknown) => void;
  onHistory?: (h: HistoryPayload) => void;
  onPicked?: (id: number) => void;
  onVoices?: (voices: AudibleVoice[]) => void;
  onReady?: (worldSize: number, gridSize: number) => void;
  onSaved?: (payload: unknown) => void;
  onLoaded?: (error?: string) => void;
};

export class SimClient {
  private worker: Worker;
  private listeners: Listeners = {};

  /** Latest organism snapshot; the renderer reads this directly. */
  snapshot: Float32Array | null = null;
  /**
   * The handful of voices near the listening point. Read directly by the
   * synthesiser and the spectrogram at frame rate; never routed through React,
   * for the same reason the snapshot is not.
   */
  latestVoices: AudibleVoice[] = [];
  count = 0;
  worldSize = 4096;
  gridSize = 256;

  /** Set when a new terrain texture arrives; the renderer consumes and clears it. */
  pendingTerrain: Uint8ClampedArray<ArrayBuffer> | null = null;
  pendingTerrainGrid = 0;

  private recycleSnapshot: ArrayBuffer | null = null;
  private recycleTerrain: ArrayBuffer | null = null;
  private lastStatsPush = 0;
  private statsIntervalMs = 150;

  constructor() {
    this.worker = new Worker(new URL('../workers/simWorker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.handle(ev.data);
  }

  on(listeners: Listeners): void {
    this.listeners = { ...this.listeners, ...listeners };
  }

  private send(msg: ToWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(msg, transfer);
  }

  private handle(msg: FromWorker): void {
    switch (msg.type) {
      case 'ready':
        this.worldSize = msg.worldSize;
        this.gridSize = msg.gridSize;
        this.listeners.onReady?.(msg.worldSize, msg.gridSize);
        break;

      case 'frame': {
        // Return the buffer we finished with before taking the new one.
        if (this.recycleSnapshot) {
          this.send({ type: 'returnSnapshot', buffer: this.recycleSnapshot }, [this.recycleSnapshot]);
          this.recycleSnapshot = null;
        }
        if (this.snapshot) this.recycleSnapshot = this.snapshot.buffer as ArrayBuffer;
        this.snapshot = new Float32Array(msg.snapshot);
        this.count = msg.count;

        if (msg.terrain) {
          if (this.recycleTerrain) {
            this.send({ type: 'returnTerrain', buffer: this.recycleTerrain }, [this.recycleTerrain]);
            this.recycleTerrain = null;
          }
          if (this.pendingTerrain) this.recycleTerrain = this.pendingTerrain.buffer as ArrayBuffer;
          this.pendingTerrain = new Uint8ClampedArray(msg.terrain);
          this.pendingTerrainGrid = msg.gridSize;
          this.terrainDirty = true;
        }

        const now = performance.now();
        if (now - this.lastStatsPush > this.statsIntervalMs) {
          this.lastStatsPush = now;
          this.listeners.onStats?.(msg.stats);
        }
        if (msg.events) this.listeners.onEvents?.(msg.events);
        // Voices bypass the stats throttle: audio has to track the world at
        // frame rate or it stops sounding like the thing on screen.
        if (msg.voices) {
          this.latestVoices = msg.voices;
          this.listeners.onVoices?.(msg.voices);
        } else if (this.latestVoices.length > 0 && !this.listenerEnabled) {
          this.latestVoices = [];
        }
        break;
      }

      case 'detail':
        this.listeners.onDetail?.({
          inspection: msg.inspection,
          species: msg.species,
          extinct: msg.extinct,
          activeEvents: msg.activeEvents,
          culture: msg.culture,
          acoustics: msg.acoustics,
          firstContact: msg.firstContact,
          milestones: msg.milestones,
          anomalies: msg.anomalies,
          mutationTally: msg.mutationTally,
        });
        break;
      case 'forked':
        this.listeners.onForked?.(msg.payload);
        break;
      case 'history':
        this.listeners.onHistory?.({ ticks: msg.ticks, series: msg.series });
        break;
      case 'picked':
        this.listeners.onPicked?.(msg.id);
        break;
      case 'saved':
        this.listeners.onSaved?.(msg.payload);
        break;
      case 'loaded':
        this.listeners.onLoaded?.(msg.error);
        break;
    }
  }

  private terrainDirty = false;

  /**
   * Hand the terrain texture to the renderer exactly once per arrival. Returns
   * null when nothing new came in, so the caller can skip the GPU upload. The
   * buffer itself stays owned by the client until the next terrain frame, when
   * it is recycled back to the worker.
   */
  takeTerrain(): { pixels: Uint8ClampedArray<ArrayBuffer>; grid: number } | null {
    if (!this.terrainDirty || !this.pendingTerrain) return null;
    this.terrainDirty = false;
    return { pixels: this.pendingTerrain, grid: this.pendingTerrainGrid };
  }

  // ---- commands ----
  init(config: Partial<SimConfig>, overlay: OverlayMode): void {
    this.send({ type: 'init', config, overlay });
  }
  reset(config: Partial<SimConfig>): void {
    this.snapshot = null;
    this.count = 0;
    this.recycleSnapshot = null;
    this.recycleTerrain = null;
    this.pendingTerrain = null;
    this.send({ type: 'reset', config });
  }
  setRunning(running: boolean): void {
    this.send({ type: 'setRunning', running });
  }
  setSpeed(ticksPerFrame: number, unlimited: boolean): void {
    this.send({ type: 'setSpeed', ticksPerFrame, unlimited });
  }
  stepOnce(count = 1): void {
    this.send({ type: 'stepOnce', count });
  }
  select(id: number): void {
    this.send({ type: 'select', id });
  }
  pick(x: number, y: number, radius: number): void {
    this.send({ type: 'pick', x, y, radius });
  }
  setOverlay(mode: OverlayMode): void {
    this.send({ type: 'overlay', mode });
  }
  worldEvent(spec: WorldEventSpec): void {
    this.send({ type: 'worldEvent', spec });
  }
  inject(count: number): void {
    this.send({ type: 'inject', count });
  }
  /** Where the listening point currently is, in world units. */
  get listenerX(): number {
    return this.listenerPos.x;
  }
  get listenerY(): number {
    return this.listenerPos.y;
  }

  private listenerEnabled = false;
  private listenerSentAt = 0;
  private listenerPos = { x: 0, y: 0, radius: 0 };

  /** Turn voice reporting on or off. Off by default: no audio without a click. */
  setListenerEnabled(enabled: boolean): void {
    if (this.listenerEnabled === enabled) return;
    this.listenerEnabled = enabled;
    if (!enabled) this.latestVoices = [];
    this.send({
      type: 'listener',
      x: this.listenerPos.x,
      y: this.listenerPos.y,
      radius: this.listenerPos.radius || 700,
      enabled,
    });
  }

  /**
   * Follow the camera. Called every rendered frame, so it throttles and skips
   * entirely while nothing is listening.
   */
  trackListener(x: number, y: number, radius: number): void {
    this.listenerPos = { x, y, radius };
    if (!this.listenerEnabled) return;
    const now = performance.now();
    if (now - this.listenerSentAt < 120) return;
    this.listenerSentAt = now;
    this.send({ type: 'listener', x, y, radius, enabled: true });
  }
  /** Put a sound into the world. `frame` is raw acoustics, never a symbol. */
  externalSound(x: number, y: number, frame: number[], ticks = 3): void {
    this.send({ type: 'externalSound', x, y, frame, ticks });
  }
  requestDetail(): void {
    this.send({ type: 'requestDetail' });
  }
  requestHistory(): void {
    this.send({ type: 'requestHistory' });
  }
  save(): void {
    this.send({ type: 'save' });
  }
  fork(): void {
    this.send({ type: 'fork' });
  }
  load(payload: unknown): void {
    this.snapshot = null;
    this.count = 0;
    this.recycleSnapshot = null;
    this.recycleTerrain = null;
    this.pendingTerrain = null;
    this.send({ type: 'load', payload });
  }
  setConfig(patch: Partial<SimConfig>): void {
    this.send({ type: 'setConfig', patch });
  }
  destroy(): void {
    this.worker.terminate();
  }
}
