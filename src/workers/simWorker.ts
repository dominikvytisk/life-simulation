/// <reference lib="webworker" />
/**
 * Simulation host. Owns the Simulation instance and drives the tick loop
 * completely independently of rendering.
 *
 * Two clocks:
 *   - the *simulation* advances by whole ticks, as many as the speed setting
 *     and the frame budget allow
 *   - the *frame* is emitted at ~30 Hz regardless, so at MAX speed thousands of
 *     ticks can pass between two drawn frames
 *
 * The loop is budget-bounded rather than count-bounded: it will stop early
 * rather than freeze the worker, which keeps the UI responsive when the
 * population is large.
 */
import { Simulation } from '../sim/simulation';
import { SNAPSHOT_STRIDE } from '../sim/core/types';
import { paintWorld, type OverlayMode } from '../sim/world/painter';
import type { FromWorker, ToWorker } from './protocol';

const FRAME_INTERVAL_MS = 33;
const MAX_BUDGET_MS = 26;
const TERRAIN_EVERY_FRAMES = 6;

let sim: Simulation | null = null;
let running = false;
let ticksPerFrame = 1;
let unlimited = false;
let overlay: OverlayMode = 'terrain';
/**
 * Where the user is listening from. Only voices near this point are turned
 * into real audio: the simulation carries thousands of sounds as feature
 * vectors and synthesises at most a dozen of them.
 */
let listener = { x: 0, y: 0, radius: 700, enabled: false };

let snapshotPool: ArrayBuffer[] = [];
let terrainPool: ArrayBuffer[] = [];
let frameCounter = 0;
let lastEventRevision = -1;
let timer: ReturnType<typeof setTimeout> | null = null;

// Rolling performance measurement.
let perfTicks = 0;
let perfMs = 0;
let perfWindowStart = 0;

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(msg, transfer);
}

// Pooled buffers are only reused at an exact size match. A larger recycled
// buffer would produce an over-long view, and `new ImageData(pixels, g, g)` in
// the Canvas2D renderer throws when the array is not exactly g*g*4 — which
// would only show up on a machine without WebGPU, after a world reload.
function snapshotBuffer(capacity: number): Float32Array {
  const bytes = capacity * SNAPSHOT_STRIDE * 4;
  for (let i = 0; i < snapshotPool.length; i++) {
    if (snapshotPool[i].byteLength === bytes) return new Float32Array(snapshotPool.splice(i, 1)[0]);
  }
  return new Float32Array(capacity * SNAPSHOT_STRIDE);
}

function terrainBuffer(grid: number): Uint8ClampedArray {
  const bytes = grid * grid * 4;
  for (let i = 0; i < terrainPool.length; i++) {
    if (terrainPool[i].byteLength === bytes) {
      return new Uint8ClampedArray(terrainPool.splice(i, 1)[0]);
    }
  }
  return new Uint8ClampedArray(bytes);
}

function emitFrame(includeTerrain: boolean): void {
  if (!sim) return;
  const snap = snapshotBuffer(sim.cfg.maxPopulation);
  const count = sim.fillSnapshot(snap);
  const stats = sim.getStats();

  let terrain: ArrayBuffer | undefined;
  const transfer: Transferable[] = [snap.buffer];
  if (includeTerrain) {
    const tex = terrainBuffer(sim.world.grid);
    paintWorld(sim.world, sim.cfg, overlay, tex, sim.worldEvents.floodOffset);
    terrain = tex.buffer as ArrayBuffer;
    transfer.push(terrain);
  }

  const voices = listener.enabled
    ? sim.audibleVoices(listener.x, listener.y, listener.radius, 12)
    : undefined;

  const revision = sim.events.revision;
  const events = revision !== lastEventRevision ? sim.events.recent(120) : undefined;
  lastEventRevision = revision;

  post(
    {
      type: 'frame',
      snapshot: snap.buffer as ArrayBuffer,
      count,
      stats,
      terrain,
      gridSize: sim.world.grid,
      events,
      eventRevision: revision,
      selectedId: sim.selectedId,
      voices,
    },
    transfer,
  );
}

function runFrame(): void {
  if (!sim) return;
  const start = performance.now();

  if (running) {
    const deadline = start + (unlimited ? MAX_BUDGET_MS : MAX_BUDGET_MS);
    let done = 0;
    const target = ticksPerFrame;
    // Check the clock every few ticks rather than every tick: performance.now()
    // is not free, and at 1x we would otherwise spend more time measuring than
    // simulating.
    while (done < target) {
      sim.step();
      done++;
      if ((done & 7) === 0 && performance.now() > deadline) break;
    }
    perfTicks += done;
  }

  const elapsed = performance.now() - start;
  perfMs += elapsed;
  if (start - perfWindowStart > 500) {
    const seconds = (start - perfWindowStart) / 1000;
    sim.setPerformance(perfTicks / seconds, perfTicks > 0 ? perfMs / perfTicks : 0);
    perfTicks = 0;
    perfMs = 0;
    perfWindowStart = start;
  }

  frameCounter++;
  emitFrame(frameCounter % TERRAIN_EVERY_FRAMES === 0);

  const delay = Math.max(0, FRAME_INTERVAL_MS - (performance.now() - start));
  timer = setTimeout(runFrame, delay);
}

function startLoop(): void {
  if (timer !== null) return;
  perfWindowStart = performance.now();
  timer = setTimeout(runFrame, 0);
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'init': {
      overlay = msg.overlay;
      sim = new Simulation(msg.config);
      lastEventRevision = -1;
      post({ type: 'ready', worldSize: sim.world.size, gridSize: sim.world.grid });
      emitFrame(true);
      startLoop();
      break;
    }
    case 'reset': {
      snapshotPool = [];
      terrainPool = [];
      sim = new Simulation(msg.config);
      lastEventRevision = -1;
      post({ type: 'ready', worldSize: sim.world.size, gridSize: sim.world.grid });
      emitFrame(true);
      break;
    }
    case 'setRunning':
      running = msg.running;
      break;
    case 'setSpeed':
      ticksPerFrame = msg.ticksPerFrame;
      unlimited = msg.unlimited;
      break;
    case 'stepOnce': {
      if (!sim) break;
      for (let i = 0; i < msg.count; i++) sim.step();
      emitFrame(true);
      break;
    }
    case 'select':
      sim?.select(msg.id);
      break;
    case 'pick': {
      if (!sim) break;
      const id = sim.pick(msg.x, msg.y, msg.radius);
      sim.select(id);
      post({ type: 'picked', id });
      break;
    }
    case 'overlay':
      overlay = msg.mode;
      if (sim) emitFrame(true);
      break;
    case 'worldEvent':
      sim?.triggerWorldEvent(msg.spec);
      if (sim) emitFrame(true);
      break;
    case 'inject':
      sim?.inject(msg.count);
      break;
    case 'listener':
      listener = { x: msg.x, y: msg.y, radius: msg.radius, enabled: msg.enabled };
      break;
    case 'externalSound':
      sim?.emitExternalSound(msg.x, msg.y, msg.frame, msg.ticks);
      break;
    case 'requestDetail': {
      if (!sim) break;
      post({
        type: 'detail',
        inspection: sim.inspect(),
        species: sim.speciesSummaries(50),
        extinct: sim.extinctSummaries(150),
        activeEvents: sim.worldEvents.activeEvents(),
        culture: sim.getCulture(),
        acoustics: sim.acoustics.report(),
        firstContact: sim.firstContact(),
        milestones: sim.chronicle.getMilestones(),
        anomalies: sim.chronicle.getAnomalies(30),
        mutationTally: Array.from(sim.mutationTally),
        cognition: sim.cognitionReport(),
        trajectories: sim.cognitionLedger.trajectories(10),
      });
      break;
    }
    case 'requestHistory': {
      if (!sim) break;
      const h = sim.history.toChrono();
      post({ type: 'history', ticks: h.ticks, series: h.series });
      break;
    }
    case 'returnSnapshot':
      if (snapshotPool.length < 3) snapshotPool.push(msg.buffer);
      break;
    case 'returnTerrain':
      if (terrainPool.length < 3) terrainPool.push(msg.buffer);
      break;
    case 'save':
      if (sim) post({ type: 'saved', payload: sim.serialize() });
      break;
    case 'fork':
      // Same serialisation as a save; the distinction is what the main thread
      // does with it — hand it to experiment workers rather than to storage.
      if (sim) post({ type: 'forked', payload: sim.serialize() });
      break;
    case 'load': {
      const payload = msg.payload as { cfg: Partial<import('../sim/core/config').SimConfig> };
      const previous = sim;
      try {
        snapshotPool = [];
        terrainPool = [];
        sim = new Simulation(payload.cfg);
        sim.restore(payload as Record<string, unknown>);
      } catch (err) {
        // A save from an incompatible build cannot be resumed. Put the running
        // world back rather than leaving the worker holding a half-built one,
        // and tell the user why instead of failing silently.
        sim = previous;
        post({ type: 'loaded', error: err instanceof Error ? err.message : 'Could not load that world.' });
        break;
      }
      lastEventRevision = -1;
      post({ type: 'ready', worldSize: sim.world.size, gridSize: sim.world.grid });
      post({ type: 'loaded' });
      emitFrame(true);
      break;
    }
    case 'setConfig':
      if (sim) Object.assign(sim.cfg, msg.patch);
      break;
    default:
      break;
  }
};
