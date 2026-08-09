/// <reference lib="webworker" />
/**
 * Headless experiment arm. Restores a forked world, applies a config patch,
 * and runs it forward for a fixed number of ticks — several times, so the
 * result comes with a spread rather than a single number.
 *
 * Replicates differ only in how the RNG stream continues. Replicate 0 does not
 * perturb it at all, so an arm with an empty patch reproduces the parent world
 * exactly; later replicates advance the stream first, giving genuinely
 * different futures from identical starting conditions. That is the correct
 * notion of a replicate here: reseeding instead would regenerate the terrain
 * and change the experiment rather than repeat it.
 */
import { Simulation } from '../sim/simulation';
import type { SimConfig } from '../sim/core/config';
import { COMPARED_METRICS, type ComparedMetric } from '../experiments/runner';

export type ToExperiment = {
  type: 'run';
  armId: string;
  label: string;
  payload: Record<string, any>;
  patch: Partial<SimConfig>;
  ticks: number;
  replicates: number;
};

export type FromExperiment =
  | { type: 'progress'; armId: string; replicate: number; ticksDone: number; ticksTotal: number }
  | {
      type: 'result';
      armId: string;
      label: string;
      samples: Record<ComparedMetric, number>[];
      extinctions: number;
    }
  | { type: 'failed'; armId: string; message: string };

function post(msg: FromExperiment): void {
  (self as unknown as Worker).postMessage(msg);
}

self.onmessage = (ev: MessageEvent<ToExperiment>) => {
  const msg = ev.data;
  if (msg.type !== 'run') return;

  try {
    const samples: Record<ComparedMetric, number>[] = [];
    let extinctions = 0;

    for (let r = 0; r < msg.replicates; r++) {
      // The patch is applied to the *parent's* config so the static world is
      // regenerated identically; only the changed knobs differ.
      const cfg = { ...(msg.payload.cfg as SimConfig), ...msg.patch };
      const sim = new Simulation(cfg);
      sim.restore(msg.payload);
      // Reapply the patch after restore — restore() copies the saved config
      // fields that the patch is meant to override.
      Object.assign(sim.cfg, msg.patch);

      for (let k = 0; k < r * 1013; k++) sim.rng.nextU32();

      const report = Math.max(1, Math.floor(msg.ticks / 20));
      for (let t = 0; t < msg.ticks; t++) {
        sim.step();
        if (sim.pop.livingCount === 0) break;
        if (t % report === 0) {
          post({
            type: 'progress',
            armId: msg.armId,
            replicate: r,
            ticksDone: t,
            ticksTotal: msg.ticks,
          });
        }
      }

      if (sim.pop.livingCount === 0) extinctions++;
      const stats = sim.getStats() as unknown as Record<string, number>;
      const sample = {} as Record<ComparedMetric, number>;
      for (const m of COMPARED_METRICS) sample[m] = stats[m] ?? 0;
      samples.push(sample);
    }

    post({ type: 'result', armId: msg.armId, label: msg.label, samples, extinctions });
  } catch (err) {
    post({ type: 'failed', armId: msg.armId, message: String(err) });
  }
};
