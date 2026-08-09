/**
 * End-to-end check of the fork/experiment pipeline without a browser.
 *
 * Reproduces exactly what experimentWorker does — restore a fork, apply a
 * patch, perturb the stream per replicate — and verifies the two properties the
 * whole feature rests on:
 *
 *   1. an empty patch on replicate 0 reproduces the parent bit for bit
 *   2. replicates diverge from each other, so the reported spread is real
 */
import { Simulation } from '../src/sim/simulation';
import { COMPARED_METRICS, compare, summarise, type ComparedMetric } from '../src/experiments/runner';
import type { SimConfig } from '../src/sim/core/config';

// Default world. A smaller one collapses to a handful of organisms, and an
// experiment run on a dying world measures nothing.
const base = { seed: 56433 };
const WARMUP = Number(process.argv[2] ?? 1500);
const TICKS = Number(process.argv[3] ?? 800);
const REPLICATES = Number(process.argv[4] ?? 3);

console.log(`warming parent world for ${WARMUP} ticks…`);
const parent = new Simulation(base);
for (let t = 0; t < WARMUP; t++) parent.step();
const payload = parent.serialize();
console.log(`forked at tick ${parent.tick}, population ${parent.pop.livingCount}`);

function fingerprint(s: Simulation): string {
  let h = 0;
  let alive = 0;
  for (let i = 0; i < s.pop.count; i++) {
    if (!s.pop.alive[i]) continue;
    alive++;
    h += s.pop.x[i] * (i + 1) + s.pop.energy[i] * (i + 7);
  }
  return `${alive}|${h.toFixed(4)}`;
}

function runArm(patch: Partial<SimConfig>, replicates: number) {
  const samples: Record<ComparedMetric, number>[] = [];
  const prints: string[] = [];
  let extinctions = 0;
  for (let r = 0; r < replicates; r++) {
    const cfg = { ...(payload.cfg as SimConfig), ...patch };
    const sim = new Simulation(cfg);
    sim.restore(payload as Record<string, any>);
    Object.assign(sim.cfg, patch);
    for (let k = 0; k < r * 1013; k++) sim.rng.nextU32();
    for (let t = 0; t < TICKS; t++) {
      sim.step();
      if (sim.pop.livingCount === 0) break;
    }
    if (sim.pop.livingCount === 0) extinctions++;
    prints.push(fingerprint(sim));
    const stats = sim.getStats() as unknown as Record<string, number>;
    const sample = {} as Record<ComparedMetric, number>;
    for (const m of COMPARED_METRICS) sample[m] = stats[m] ?? 0;
    samples.push(sample);
  }
  return { samples, prints, extinctions };
}

// --- property 1: the control's replicate 0 must equal the parent continued ---
console.log(`\nrunning control (${REPLICATES} replicates × ${TICKS} ticks)…`);
const control = runArm({}, REPLICATES);
for (let t = 0; t < TICKS; t++) parent.step();
const parentPrint = fingerprint(parent);
console.log(`  parent continued : ${parentPrint}`);
console.log(`  control rep 0    : ${control.prints[0]}`);
console.log(
  `  → ${control.prints[0] === parentPrint ? 'IDENTICAL — the control is a real control' : 'MISMATCH — forking is broken'}`,
);

const distinct = new Set(control.prints).size;
console.log(`  replicate spread : ${distinct}/${REPLICATES} distinct outcomes`);

// --- property 2: a patched arm must actually differ ---
console.log(`\nrunning treatment arm (scarce food)…`);
const treatment = runArm({ vegetationGrowthRate: 0.008 }, REPLICATES);

const controlResult = summarise('control', 'Control', control.samples, control.extinctions);
const armResult = summarise('scarce', 'Scarce food', treatment.samples, treatment.extinctions);
const comparisons = compare(controlResult, armResult);

console.log('\nmetric                control        treatment      delta%    d      verdict');
for (const c of comparisons.slice(0, 8)) {
  console.log(
    [
      c.metric.padEnd(22),
      `${c.controlMean.toFixed(2)}±${controlResult.sd[c.metric].toFixed(2)}`.padEnd(15),
      `${c.armMean.toFixed(2)}±${armResult.sd[c.metric].toFixed(2)}`.padEnd(15),
      `${c.deltaPercent >= 0 ? '+' : ''}${c.deltaPercent.toFixed(0)}%`.padEnd(10),
      c.effectSize.toFixed(1).padEnd(7),
      c.verdict,
    ].join(''),
  );
}

const conclusive = comparisons.filter((c) => c.verdict !== 'inconclusive').length;
console.log(
  `\n${conclusive}/${comparisons.length} metrics separated by more than the replicate spread`,
);
