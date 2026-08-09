/**
 * Drives a set of experiment arms across a small worker pool.
 *
 * One worker per arm, replicates run sequentially inside it. The saved world
 * state is tens of megabytes and postMessage has to clone it per worker, so
 * spawning a worker per replicate would spend more time copying than
 * simulating.
 */
import type { SimConfig } from '../sim/core/config';
import {
  compare,
  summarise,
  type ArmResult,
  type ComparedMetric,
  type ExperimentArm,
  type ExperimentReport,
} from '../experiments/runner';
import type { FromExperiment, ToExperiment } from '../workers/experimentWorker';

export interface ExperimentProgress {
  armId: string;
  replicate: number;
  fraction: number;
}

const MAX_PARALLEL = 4;

export function runExperiment(
  payload: Record<string, any>,
  arms: ExperimentArm[],
  ticks: number,
  replicates: number,
  onProgress: (p: ExperimentProgress) => void,
): Promise<ExperimentReport> {
  return new Promise((resolve, reject) => {
    const results = new Map<string, ArmResult>();
    const queue = [...arms];
    let active = 0;
    let failed: string | null = null;

    const finish = () => {
      if (failed) {
        reject(new Error(failed));
        return;
      }
      const control = results.get('control') ?? results.get(arms[0].id);
      const comparisons: Record<string, ReturnType<typeof compare>> = {};
      if (control) {
        for (const arm of arms) {
          if (arm.id === control.id) continue;
          const r = results.get(arm.id);
          if (r) comparisons[arm.id] = compare(control, r);
        }
      }
      resolve({
        ticks,
        replicates,
        arms: arms.map((a) => results.get(a.id)).filter(Boolean) as ArmResult[],
        comparisons,
        startedFromTick: (payload.tick as number) ?? 0,
      });
    };

    const pump = () => {
      while (active < MAX_PARALLEL && queue.length > 0) {
        const arm = queue.shift()!;
        active++;
        const worker = new Worker(new URL('../workers/experimentWorker.ts', import.meta.url), {
          type: 'module',
        });
        worker.onmessage = (ev: MessageEvent<FromExperiment>) => {
          const m = ev.data;
          if (m.type === 'progress') {
            onProgress({
              armId: m.armId,
              replicate: m.replicate,
              fraction: (m.replicate + m.ticksDone / m.ticksTotal) / replicates,
            });
            return;
          }
          if (m.type === 'failed') {
            failed = `${m.armId}: ${m.message}`;
          } else if (m.type === 'result') {
            results.set(
              m.armId,
              summarise(m.armId, m.label, m.samples as Record<ComparedMetric, number>[], m.extinctions),
            );
          }
          worker.terminate();
          active--;
          if (queue.length > 0) pump();
          else if (active === 0) finish();
        };
        worker.onerror = (e) => {
          failed = `${arm.id}: ${e.message}`;
          worker.terminate();
          active--;
          if (active === 0) finish();
        };
        const msg: ToExperiment = {
          type: 'run',
          armId: arm.id,
          label: arm.label,
          payload,
          patch: arm.patch as Partial<SimConfig>,
          ticks,
          replicates,
        };
        worker.postMessage(msg);
      }
    };

    pump();
    if (arms.length === 0) finish();
  });
}
