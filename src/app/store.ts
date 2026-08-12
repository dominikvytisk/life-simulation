/**
 * UI state only. The simulation's authoritative state lives in the worker;
 * what is kept here is what React needs to draw panels — summaries that update
 * a few times a second, never per-organism data.
 */
import { create } from 'zustand';
import type { OverlayMode } from '../sim/world/painter';
import type { SeriesKey } from '../analytics/history';
import type {
  AcousticReport,
  AnomalyReport,
  CultureReport,
  FirstContactReport,
  Milestone,
  OrganismInspection,
  SimEventDTO,
  SpeciesSummary,
  Stats,
} from '../sim/core/types';
import type { SimConfig } from '../sim/core/config';
import type { ExperimentReport } from '../experiments/runner';
import type { CognitionReport, SpeciesCognition } from '../sim/analysis/cognition';

export type PanelTab =
  | 'overview'
  | 'charts'
  | 'species'
  | 'museum'
  | 'brain'
  | 'signals'
  | 'voice'
  | 'chronicle'
  | 'experiments'
  | 'cognition'
  | 'world'
  | 'lab';

interface UIState {
  ready: boolean;
  running: boolean;
  speedIndex: number;
  overlay: OverlayMode;
  backend: 'webgpu' | 'canvas2d' | 'pending';
  tab: PanelTab;
  showInspector: boolean;

  stats: Stats | null;
  events: SimEventDTO[];
  species: SpeciesSummary[];
  extinct: SpeciesSummary[];
  activeWorldEvents: { type: string; ticksLeft: number; progress: number }[];
  culture: CultureReport | null;
  acoustics: AcousticReport | null;
  firstContact: FirstContactReport | null;
  /** Audio output and microphone input are both opt-in and off by default. */
  audioEnabled: boolean;
  micEnabled: boolean;
  micError: string | null;
  /** Live acoustic frame from the microphone, for the First Contact display. */
  micFrame: number[] | null;
  /** Where a human sound is placed in the world. Null means the view centre. */
  contactPoint: { x: number; y: number } | null;
  milestones: Milestone[];
  anomalies: AnomalyReport[];
  mutationTally: number[];
  cognition: CognitionReport | null;
  trajectories: SpeciesCognition[];
  experiment: ExperimentReport | null;
  experimentRunning: boolean;
  experimentProgress: Record<string, number>;
  experimentError: string | null;
  inspection: OrganismInspection | null;
  selectedId: number;
  history: { ticks: Float64Array; series: Record<SeriesKey, Float32Array> } | null;

  experimentId: string;
  seed: number;
  pendingConfig: Partial<SimConfig>;
  followSelection: boolean;
  eventPlacement: string | null;

  set: (patch: Partial<UIState>) => void;
}

export const useStore = create<UIState>((set) => ({
  ready: false,
  running: false,
  speedIndex: 1,
  overlay: 'terrain',
  backend: 'pending',
  tab: 'overview',
  showInspector: false,

  stats: null,
  events: [],
  species: [],
  extinct: [],
  activeWorldEvents: [],
  culture: null,
  acoustics: null,
  firstContact: null,
  audioEnabled: false,
  micEnabled: false,
  micError: null,
  micFrame: null,
  contactPoint: null,
  milestones: [],
  anomalies: [],
  mutationTally: [],
  cognition: null,
  trajectories: [],
  experiment: null,
  experimentRunning: false,
  experimentProgress: {},
  experimentError: null,
  inspection: null,
  selectedId: 0,
  history: null,

  experimentId: 'baseline',
  seed: 1337,
  pendingConfig: {},
  followSelection: false,
  eventPlacement: null,

  set: (patch) => set(patch),
}));
