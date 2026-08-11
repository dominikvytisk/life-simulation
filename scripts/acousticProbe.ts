/**
 * Headless probe of the acoustic layer.
 *
 *   npm run voice -- 12000 7
 *
 * Not a test. This is for looking at whether the physics and the economics
 * produce anything at all, before anybody starts interpreting the statistics.
 * A run that stays silent is a legitimate answer and this will say so.
 */
import { Simulation } from '../src/sim/simulation';

const TICKS = Number(process.argv[2] ?? 6000);
const seed = Number(process.argv[3] ?? 7);

const sim = new Simulation({ seed });
const t0 = Date.now();
for (let t = 0; t < TICKS; t++) {
  sim.step();
  if ((t + 1) % 2000 === 0) {
    const s = sim.getStats();
    const a = sim.acoustics.report();
    console.log(
      `tick ${String(t + 1).padStart(6)} pop ${String(s.population).padStart(5)} ` +
        `gen ${s.avgGeneration.toFixed(1).padStart(5)} calls/t ${s.callsPerTick.toFixed(4)} ` +
        `loud ${s.broadcastActivity.toFixed(4)} shapes ${a.clusters.length} ` +
        `H ${a.diversity.toFixed(2)} maxD ${a.strongestAssociation.toFixed(2)} ` +
        `seq ${a.sequence.mutualInformation.toFixed(2)} turn ${a.turnTaking.alternation.toFixed(3)} ` +
        `dial ${a.dialects.divergence.toFixed(3)} obs ${a.observations.toFixed(0)}`,
    );
  }
}
const ms = Date.now() - t0;
console.log(`\n${TICKS} ticks in ${ms}ms = ${(ms / TICKS).toFixed(2)} ms/tick`);

const report = sim.acoustics.report();
for (const c of report.clusters.slice(0, 6)) {
  console.log(
    `  shape #${c.id} ${(c.share * 100).toFixed(1)}%  ` +
      `${c.pitchHz.toFixed(0)}Hz ${c.durationTicks.toFixed(1)}t  ` +
      `ctx[${c.emitterContext.map((x) => `${x.label} ${x.d.toFixed(2)}`).join(', ')}]  ` +
      `resp[${c.listenerResponse.map((x) => `${x.label} ${x.d.toFixed(2)}`).join(', ')}]`,
  );
}
if (report.clusters.length === 0) {
  console.log('  no recurring call shapes — this world has not developed one, which is allowed');
}
for (const u of report.unknown) {
  console.log(`  UNKNOWN pattern ${u.pitchHz.toFixed(0)}Hz seen ${u.count.toFixed(0)}x`);
}
console.log(
  `sequence ${report.sequence.mutualInformation.toFixed(3)} bits · ` +
    `turn-taking ${report.turnTaking.alternation.toFixed(3)} · ` +
    `convergence ${report.turnTaking.convergence.toFixed(3)} · ` +
    `dialects ${report.dialects.divergence.toFixed(3)} bits · ` +
    `generations spanned ${report.generationSpan.toFixed(0)}`,
);
console.log('milestones:', sim.chronicle.getMilestones().map((m) => m.id).join(', ') || 'none');
