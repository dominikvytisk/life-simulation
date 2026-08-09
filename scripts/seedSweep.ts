/**
 * Robustness check: does the world survive its founder bottleneck across seeds?
 *
 * The first thousand ticks are supposed to be brutal — random brains mostly
 * starve — but a world that goes fully extinct before selection can act is a
 * broken world, not a harsh one. This sweeps seeds and reports survival.
 *
 *   npx esbuild scripts/seedSweep.ts --bundle --format=esm --platform=node --outfile=.sweep.mjs
 *   node .sweep.mjs [ticks] [seedCount]
 */
import { Simulation } from '../src/sim/simulation';
import { Locus } from '../src/sim/genome/loci';

const ticks = Number(process.argv[2] ?? 6000);
const seedCount = Number(process.argv[3] ?? 8);
const overrides = process.argv[4] ? JSON.parse(process.argv[4]) : {};

console.log(`seed    minPop  finalPop  species  maxGen  carniv  brain  survived`);
let survivors = 0;

for (let s = 0; s < seedCount; s++) {
  const seed = 1000 + s * 7919;
  const sim = new Simulation({ seed, ...overrides });
  let minPop = Infinity;
  for (let t = 0; t < ticks; t++) {
    sim.step();
    if (t % 25 === 0) minPop = Math.min(minPop, sim.pop.livingCount);
    if (sim.pop.livingCount === 0) break;
  }
  const p = sim.pop;
  let n = 0;
  let maxGen = 0;
  let carn = 0;
  let brain = 0;
  for (let i = 0; i < p.count; i++) {
    if (!p.alive[i]) continue;
    n++;
    if (p.generation[i] > maxGen) maxGen = p.generation[i];
    carn += p.genome[p.genomeOffset(i) + Locus.Digestion];
    brain += p.hiddenSize[i] + p.contextSize[i];
  }
  const inv = 1 / (n || 1);
  if (n > 0) survivors++;
  console.log(
    [
      String(seed).padEnd(8),
      String(minPop === Infinity ? 0 : minPop).padEnd(8),
      String(n).padEnd(10),
      String(sim.species.livingSpecies().length).padEnd(9),
      String(maxGen).padEnd(8),
      (carn * inv).toFixed(3).padEnd(8),
      (brain * inv).toFixed(1).padEnd(7),
      n > 0 ? 'yes' : 'EXTINCT',
    ].join(''),
  );
}

console.log(`\n${survivors}/${seedCount} worlds survived ${ticks} ticks`);
