/**
 * Headless benchmark / ecosystem probe.
 *
 *   npx esbuild scripts/bench.ts --bundle --format=esm --platform=node --outfile=.bench.mjs
 *   node .bench.mjs [ticks] [seed]
 *
 * Prints a line every 250 ticks so a long run can be watched live. Useful for
 * checking that the energy economy actually stabilises and for profiling the
 * tick cost as the population grows.
 */
import { Simulation } from '../src/sim/simulation';
import { Locus } from '../src/sim/genome/loci';

const totalTicks = Number(process.argv[2] ?? 4000);
const seed = Number(process.argv[3] ?? 2024);
const overrides = process.argv[4] ? JSON.parse(process.argv[4]) : {};

const sim = new Simulation({ seed, ...overrides });
console.log(
  `world ${sim.world.size} · grid ${sim.world.grid} · founders ${sim.pop.livingCount} · cap ${sim.cfg.maxPopulation} · seed ${seed}`,
);
console.log(
  't       pop   spec  gen(mean/max)  carniv  brain  mem   group  bcast  imit/t  transm  memes(post)  share/t  sigR   veg     ms/tick',
);

let windowStart = Date.now();
const INTERVAL = 250;

for (let t = 1; t <= totalTicks; t++) {
  sim.step();
  if (t % INTERVAL !== 0) continue;

  const p = sim.pop;
  let n = 0;
  let energy = 0;
  let gen = 0;
  let maxGen = 0;
  let carn = 0;
  let aqua = 0;
  let brain = 0;
  for (let i = 0; i < p.count; i++) {
    if (!p.alive[i]) continue;
    n++;
    energy += p.energy[i] / p.maxEnergy[i];
    gen += p.generation[i];
    if (p.generation[i] > maxGen) maxGen = p.generation[i];
    carn += p.genome[p.genomeOffset(i) + Locus.Digestion];
    if (p.waterAffinity[i] > 0.5) aqua++;
    brain += p.hiddenSize[i] + p.contextSize[i];
  }
  let veg = 0;
  for (let i = 0; i < sim.world.vegetation.length; i++) veg += sim.world.vegetation[i];

  const inv = 1 / (n || 1);
  const ms = (Date.now() - windowStart) / INTERVAL;
  windowStart = Date.now();
  const stats = sim.getStats();
  const culture = sim.getCulture();
  void energy;
  void aqua;

  console.log(
    [
      String(t).padEnd(8),
      String(n).padEnd(6),
      String(sim.species.livingSpecies().length).padEnd(6),
      `${(gen * inv).toFixed(1)}/${maxGen}`.padEnd(15),
      (carn * inv).toFixed(3).padEnd(8),
      (brain * inv).toFixed(1).padEnd(7),
      stats.avgMemorySlots.toFixed(2).padEnd(6),
      stats.avgGroupSize.toFixed(1).padEnd(7),
      stats.broadcastActivity.toFixed(2).padEnd(7),
      stats.imitationsPerTick.toFixed(3).padEnd(8),
      culture.transmissionIndex.toFixed(3).padEnd(8),
      `${culture.distinctMemes}(${culture.posthumousMemes})`.padEnd(13),
      stats.sharesPerTick.toFixed(3).padEnd(9),
      stats.signalMeaningConfidence.toFixed(2).padEnd(7),
      veg.toFixed(0).padEnd(8),
      ms.toFixed(2),
    ].join(''),
  );

  if (n === 0) {
    console.log('EXTINCT');
    break;
  }
}
