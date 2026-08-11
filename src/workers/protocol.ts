/**
 * Message contract between the UI thread and the simulation worker.
 *
 * Rules that keep this fast:
 *  - large payloads are ArrayBuffers and are *transferred*, never cloned
 *  - the snapshot buffer ping-pongs: the worker sends it, the UI draws from it
 *    and sends the same buffer back, so steady-state allocation is zero
 *  - the UI never asks for anything per-organism except the selected one
 */
import type { SimConfig } from '../sim/core/config';
import type { OverlayMode } from '../sim/world/painter';
import type { WorldEventSpec } from '../sim/events/worldEvents';
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
import type { SeriesKey } from '../analytics/history';

export type ToWorker =
  | { type: 'init'; config: Partial<SimConfig>; overlay: OverlayMode }
  | { type: 'setRunning'; running: boolean }
  | { type: 'setSpeed'; ticksPerFrame: number; unlimited: boolean }
  | { type: 'stepOnce'; count: number }
  | { type: 'reset'; config: Partial<SimConfig> }
  | { type: 'select'; id: number }
  | { type: 'pick'; x: number; y: number; radius: number }
  | { type: 'overlay'; mode: OverlayMode }
  | { type: 'worldEvent'; spec: WorldEventSpec }
  | { type: 'inject'; count: number }
  /** Where the human is listening from, in world units. Drives audio only. */
  | { type: 'listener'; x: number; y: number; radius: number; enabled: boolean }
  /**
   * Put a sound into the world from outside it. `frame` is a raw acoustic
   * frame — pitch, loudness, noisiness, timbre, sweep, tremolo — extracted
   * locally from a microphone. No text, no meaning, no label.
   */
  | { type: 'externalSound'; x: number; y: number; frame: number[]; ticks: number }
  | { type: 'requestDetail' }
  | { type: 'requestHistory' }
  | { type: 'returnSnapshot'; buffer: ArrayBuffer }
  | { type: 'returnTerrain'; buffer: ArrayBuffer }
  | { type: 'save' }
  | { type: 'fork' }
  | { type: 'load'; payload: unknown }
  | { type: 'setConfig'; patch: Partial<SimConfig> };

export type FromWorker =
  | { type: 'ready'; worldSize: number; gridSize: number }
  | {
      type: 'frame';
      snapshot: ArrayBuffer;
      count: number;
      stats: Stats;
      terrain?: ArrayBuffer;
      gridSize: number;
      events?: SimEventDTO[];
      eventRevision: number;
      selectedId: number;
      /** The handful of voices near the listening point, for synthesis. */
      voices?: AudibleVoice[];
    }
  | {
      type: 'detail';
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
  | { type: 'history'; ticks: Float64Array; series: Record<SeriesKey, Float32Array> }
  | { type: 'picked'; id: number }
  | { type: 'saved'; payload: unknown }
  | { type: 'forked'; payload: unknown }
  /** `error` is set when the payload could not be resumed into this build. */
  | { type: 'loaded'; error?: string };

export const SPEED_PRESETS = [
  { label: '1×', ticksPerFrame: 1, unlimited: false },
  { label: '2×', ticksPerFrame: 2, unlimited: false },
  { label: '5×', ticksPerFrame: 5, unlimited: false },
  { label: '10×', ticksPerFrame: 10, unlimited: false },
  { label: '100×', ticksPerFrame: 100, unlimited: false },
  { label: 'MAX', ticksPerFrame: 100000, unlimited: true },
];
