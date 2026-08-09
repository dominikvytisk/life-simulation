import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { SpatialHash } from './core/spatialHash';
import { forward, hebbianUpdate, BRAIN_STRIDE, INPUT_COUNT, OUTPUT_COUNT, PLASTIC_STRIDE, randomizeBrain } from './brain/brain';
import { MAX_CONTEXT, MAX_HIDDEN } from './genome/phenotype';
import { Rng } from './core/rng';
import { SpeciesRegistry } from './species/speciation';
import { GENOME_LENGTH } from './genome/loci';

/** Small worlds so the suite stays fast; the invariants do not depend on scale. */
const small = { worldSize: 1024, gridSize: 64, initialPopulation: 250, maxPopulation: 3000 };

function fingerprint(sim: Simulation): string {
  const p = sim.pop;
  let hx = 0;
  let hy = 0;
  let he = 0;
  let alive = 0;
  for (let i = 0; i < p.count; i++) {
    if (!p.alive[i]) continue;
    alive++;
    hx += p.x[i] * (i + 1);
    hy += p.y[i] * (i + 3);
    he += p.energy[i] * (i + 7);
  }
  return [alive, sim.tick, hx.toFixed(4), hy.toFixed(4), he.toFixed(4)].join('|');
}

describe('deterministic simulation', () => {
  it('two runs with the same seed produce identical state', () => {
    const a = new Simulation({ ...small, seed: 424242 });
    const b = new Simulation({ ...small, seed: 424242 });
    for (let t = 0; t < 400; t++) {
      a.step();
      b.step();
    }
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(a.totalBirths).toBe(b.totalBirths);
    expect(a.totalDeaths).toBe(b.totalDeaths);
    expect(a.species.species.size).toBe(b.species.species.size);
  });

  it('different seeds produce different worlds', () => {
    const a = new Simulation({ ...small, seed: 1 });
    const b = new Simulation({ ...small, seed: 2 });
    for (let t = 0; t < 200; t++) {
      a.step();
      b.step();
    }
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it('world generation is deterministic', () => {
    const a = new Simulation({ ...small, seed: 777 });
    const b = new Simulation({ ...small, seed: 777 });
    expect(Array.from(a.world.elevation.slice(0, 200))).toEqual(
      Array.from(b.world.elevation.slice(0, 200)),
    );
    expect(Array.from(a.world.fertility.slice(0, 200))).toEqual(
      Array.from(b.world.fertility.slice(0, 200)),
    );
  });
});

describe('simulation invariants', () => {
  it('never produces NaN or out-of-bounds organisms', () => {
    const sim = new Simulation({ ...small, seed: 31337 });
    for (let t = 0; t < 600; t++) {
      sim.step();
      if (t % 100 !== 0) continue;
      const p = sim.pop;
      for (let i = 0; i < p.count; i++) {
        if (!p.alive[i]) continue;
        expect(Number.isFinite(p.x[i])).toBe(true);
        expect(Number.isFinite(p.y[i])).toBe(true);
        expect(Number.isFinite(p.energy[i])).toBe(true);
        expect(p.x[i]).toBeGreaterThanOrEqual(0);
        expect(p.x[i]).toBeLessThanOrEqual(sim.world.size);
        expect(p.y[i]).toBeGreaterThanOrEqual(0);
        expect(p.y[i]).toBeLessThanOrEqual(sim.world.size);
        expect(p.energy[i]).toBeGreaterThanOrEqual(0);
        expect(p.health[i]).toBeLessThanOrEqual(1.0001);
      }
    }
  });

  it('keeps the living count consistent with the alive flags', () => {
    const sim = new Simulation({ ...small, seed: 8 });
    for (let t = 0; t < 300; t++) sim.step();
    let counted = 0;
    for (let i = 0; i < sim.pop.count; i++) if (sim.pop.alive[i]) counted++;
    expect(counted).toBe(sim.pop.livingCount);
  });

  it('recycles slots instead of growing without bound', () => {
    const sim = new Simulation({ ...small, seed: 9, maxPopulation: 900 });
    for (let t = 0; t < 900; t++) sim.step();
    expect(sim.pop.count).toBeLessThanOrEqual(900);
    expect(sim.pop.livingCount).toBeLessThanOrEqual(900);
  });

  it('never exceeds the population cap', () => {
    const sim = new Simulation({
      ...small,
      seed: 10,
      maxPopulation: 500,
      initialPopulation: 400,
      vegetationGrowthRate: 0.05,
    });
    for (let t = 0; t < 500; t++) {
      sim.step();
      expect(sim.pop.livingCount).toBeLessThanOrEqual(500);
    }
  });

  it('assigns every living organism to a registered species', () => {
    const sim = new Simulation({ ...small, seed: 11, speciationThreshold: 0.12 });
    for (let t = 0; t < 500; t++) sim.step();
    for (let i = 0; i < sim.pop.count; i++) {
      if (!sim.pop.alive[i]) continue;
      expect(sim.species.species.has(sim.pop.speciesId[i])).toBe(true);
    }
  });

  it('species population counters match the actual population', () => {
    const sim = new Simulation({ ...small, seed: 12, speciationThreshold: 0.15 });
    for (let t = 0; t < 400; t++) sim.step();
    const counts = new Map<number, number>();
    for (let i = 0; i < sim.pop.count; i++) {
      if (!sim.pop.alive[i]) continue;
      const s = sim.pop.speciesId[i];
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    for (const [id, n] of counts) {
      expect(sim.species.species.get(id)!.population).toBe(n);
    }
  });

  it('produces descendants — inheritance actually runs', () => {
    const sim = new Simulation({
      worldSize: 2048,
      gridSize: 128,
      // Founder density has to match the default world's, or the test measures
      // a bottleneck that the real configuration does not have.
      initialPopulation: 1200,
      maxPopulation: 4000,
      seed: 2024,
    });
    // Track the deepest lineage seen *during* the run. Checking only the final
    // tick would make this a test of whether one particular lineage happened to
    // survive, which is exactly the kind of thing the simulation is allowed to
    // decide for itself.
    let deepest = 0;
    for (let t = 0; t < 3000; t++) {
      sim.step();
      if (t % 100 !== 0) continue;
      for (let i = 0; i < sim.pop.count; i++) {
        if (sim.pop.alive[i] && sim.pop.generation[i] > deepest) deepest = sim.pop.generation[i];
      }
    }
    expect(sim.totalBirths).toBeGreaterThan(0);
    expect(deepest).toBeGreaterThan(2);
  }, 60000);

  it('conserves matter into carrion when organisms die', () => {
    const sim = new Simulation({ ...small, seed: 13, initialPopulation: 300 });
    for (let t = 0; t < 400; t++) sim.step();
    let carrion = 0;
    for (let i = 0; i < sim.world.carrion.length; i++) carrion += sim.world.carrion[i];
    expect(sim.totalDeaths).toBeGreaterThan(0);
    expect(carrion).toBeGreaterThan(0);
  });

  it('vegetation stays within its carrying capacity', () => {
    const sim = new Simulation({ ...small, seed: 14 });
    for (let t = 0; t < 500; t++) sim.step();
    for (let i = 0; i < sim.world.vegetation.length; i++) {
      expect(sim.world.vegetation[i]).toBeGreaterThanOrEqual(0);
      expect(sim.world.vegetation[i]).toBeLessThanOrEqual(sim.world.capacityAt(i, sim.cfg) + 1e-3);
    }
  });
});

describe('energy economy', () => {
  /**
   * Regression: reproduction used to let a parent overdraw. It paid for a whole
   * clutch, went negative, and was clamped back to zero — so every unaffordable
   * offspring arrived carrying energy that had been created from nothing. The
   * population then grew until it hit the array cap regardless of how much food
   * the world produced, which erased the entire ecology.
   */
  it('never lets a parent pay more energy than it has', () => {
    const sim = new Simulation({ ...small, seed: 40, initialPopulation: 400 });
    for (let t = 0; t < 800; t++) {
      sim.step();
      const p = sim.pop;
      for (let i = 0; i < p.count; i++) {
        if (!p.alive[i]) continue;
        expect(p.energy[i]).toBeGreaterThanOrEqual(0);
        expect(p.energy[i]).toBeLessThanOrEqual(p.maxEnergy[i] + 1e-3);
      }
    }
  });

  it('keeps the population below the array cap when food is scarce', () => {
    // A world this unproductive must be limited by its own vegetation, not by
    // maxPopulation. Sitting exactly at the cap is the signature of the
    // energy-minting bug above.
    const sim = new Simulation({
      ...small,
      seed: 41,
      maxPopulation: 6000,
      initialPopulation: 600,
      vegetationGrowthRate: 0.004,
    });
    for (let t = 0; t < 2500; t++) sim.step();
    expect(sim.pop.livingCount).toBeLessThan(6000);
  });

  /**
   * Regression: carrion used to be stored as biomass, deposited divided by
   * carrionEnergyDensity and eaten multiplied by it, so the constant cancelled
   * and the knob did nothing at all.
   */
  it('carrionEnergyDensity actually changes how fast a corpse feeds', () => {
    const run = (density: number) => {
      const sim = new Simulation({ ...small, seed: 42, carrionEnergyDensity: density });
      const p = sim.pop;
      // Make the whole founder cohort meat-only and flood the world with
      // corpses. Measuring one organism would just test whether its particular
      // random brain happened to switch its Eat output on.
      for (let i = 0; i < p.count; i++) {
        if (!p.alive[i]) continue;
        p.meatEfficiency[i] = 1;
        p.plantEfficiency[i] = 0;
      }
      sim.world.carrion.fill(5000);
      sim.world.vegetation.fill(0);
      for (let t = 0; t < 5; t++) sim.step();
      let eaten = 0;
      for (let i = 0; i < p.count; i++) if (p.alive[i]) eaten += p.meatEaten[i];
      return eaten;
    };
    const slow = run(20);
    const fast = run(400);
    expect(fast).toBeGreaterThan(slow);
  });

  it('a corpse returns roughly the energy its owner was carrying', () => {
    const sim = new Simulation({ ...small, seed: 43, initialPopulation: 50 });
    sim.step();
    const p = sim.pop;
    let slot = -1;
    for (let i = 0; i < p.count; i++) {
      if (p.alive[i]) {
        slot = i;
        break;
      }
    }
    const ci = sim.world.index(p.x[slot], p.y[slot]);
    const carrionBefore = sim.world.carrion[ci];
    const energy = p.energy[slot];
    p.health[slot] = -1; // kill it on the next tick
    sim.step();
    const deposited = sim.world.carrion[ci] - carrionBefore;
    expect(deposited).toBeGreaterThan(0);
    // Body tissue adds a little on top, but a corpse must not be worth wildly
    // more than the organism ever held.
    expect(deposited).toBeLessThan(energy + p.mass[slot] * 2 + 1);
  });
});

describe('save and restore', () => {
  it('round-trips into an identical fingerprint', () => {
    const sim = new Simulation({ ...small, seed: 606 });
    for (let t = 0; t < 300; t++) sim.step();
    const before = fingerprint(sim);
    const payload = sim.serialize();

    const restored = new Simulation({ ...small, seed: 606 });
    restored.restore(payload as Record<string, any>);
    expect(fingerprint(restored)).toBe(before);
    expect(restored.tick).toBe(sim.tick);
    expect(restored.species.species.size).toBe(sim.species.species.size);
  });

  it('a restored world keeps running without corruption', () => {
    const sim = new Simulation({ ...small, seed: 607 });
    for (let t = 0; t < 200; t++) sim.step();
    const restored = new Simulation({ ...small, seed: 607 });
    restored.restore(sim.serialize() as Record<string, any>);
    for (let t = 0; t < 100; t++) restored.step();
    for (let i = 0; i < restored.pop.count; i++) {
      if (!restored.pop.alive[i]) continue;
      expect(Number.isFinite(restored.pop.x[i])).toBe(true);
      expect(restored.species.species.has(restored.pop.speciesId[i])).toBe(true);
    }
  });
});

describe('world events act on the environment', () => {
  it('a meteor destroys vegetation without directly deleting organisms', () => {
    const sim = new Simulation({ ...small, seed: 15 });
    for (let t = 0; t < 50; t++) sim.step();
    const popBefore = sim.pop.livingCount;
    let vegBefore = 0;
    for (let i = 0; i < sim.world.vegetation.length; i++) vegBefore += sim.world.vegetation[i];

    sim.triggerWorldEvent({ type: 'meteor', x: 512, y: 512, radius: 300, magnitude: 1 });

    let vegAfter = 0;
    for (let i = 0; i < sim.world.vegetation.length; i++) vegAfter += sim.world.vegetation[i];
    expect(vegAfter).toBeLessThan(vegBefore);
    // The impact itself removes no organisms — starvation does that later.
    expect(sim.pop.livingCount).toBe(popBefore);
  });

  it('an ice age lowers the global temperature offset', () => {
    const sim = new Simulation({ ...small, seed: 16 });
    sim.triggerWorldEvent({ type: 'iceAge', magnitude: 1 });
    for (let t = 0; t < 60; t++) sim.step();
    expect(sim.cfg.globalTemperatureOffset).toBeLessThan(0);
  });

  it('a blight suppresses vegetation regrowth', () => {
    const sim = new Simulation({ ...small, seed: 17 });
    sim.triggerWorldEvent({ type: 'blight', magnitude: 1 });
    for (let t = 0; t < 60; t++) sim.step();
    expect(sim.cfg.vegetationGrowthMultiplier).toBeLessThan(1);
  });
});

describe('spatial hash', () => {
  it('finds exactly the points inside the radius', () => {
    const rng = new Rng(20);
    const n = 2000;
    const xs = new Float32Array(n);
    const ys = new Float32Array(n);
    const alive = new Uint8Array(n).fill(1);
    for (let i = 0; i < n; i++) {
      xs[i] = rng.range(0, 1000);
      ys[i] = rng.range(0, 1000);
    }
    const hash = new SpatialHash(1000, 40, n);
    hash.build(alive, xs, ys, n);

    for (let trial = 0; trial < 30; trial++) {
      const px = rng.range(0, 1000);
      const py = rng.range(0, 1000);
      const r = 60;
      const brute = new Set<number>();
      for (let i = 0; i < n; i++) {
        const dx = xs[i] - px;
        const dy = ys[i] - py;
        if (dx * dx + dy * dy <= r * r) brute.add(i);
      }
      const found = new Set<number>();
      hash.forEachInRadius(px, py, r, (i) => {
        const dx = xs[i] - px;
        const dy = ys[i] - py;
        if (dx * dx + dy * dy <= r * r) found.add(i);
      });
      expect([...found].sort()).toEqual([...brute].sort());
    }
  });

  it('ignores dead slots after a rebuild', () => {
    const n = 100;
    const xs = new Float32Array(n).fill(50);
    const ys = new Float32Array(n).fill(50);
    const alive = new Uint8Array(n).fill(1);
    for (let i = 0; i < n; i += 2) alive[i] = 0;
    const hash = new SpatialHash(200, 20, n);
    hash.build(alive, xs, ys, n);
    let seen = 0;
    hash.forEachInRadius(50, 50, 10, (i) => {
      expect(alive[i]).toBe(1);
      seen++;
    });
    expect(seen).toBe(50);
  });
});

describe('neural network', () => {
  it('produces bounded outputs for any input', () => {
    const rng = new Rng(21);
    const brain = new Float32Array(BRAIN_STRIDE);
    const plastic = new Float32Array(PLASTIC_STRIDE);
    randomizeBrain(brain, 0, () => rng.next());
    const inputs = new Float32Array(INPUT_COUNT);
    const context = new Float32Array(MAX_CONTEXT);
    const hidden = new Float32Array(MAX_HIDDEN);
    const outputs = new Float32Array(OUTPUT_COUNT);

    for (let t = 0; t < 200; t++) {
      for (let i = 0; i < INPUT_COUNT; i++) inputs[i] = rng.range(-5, 5);
      forward(brain, 0, plastic, 0, inputs, context, 0, hidden, outputs, MAX_HIDDEN, MAX_CONTEXT);
      for (let o = 0; o < OUTPUT_COUNT; o++) {
        expect(Number.isFinite(outputs[o])).toBe(true);
        expect(Math.abs(outputs[o])).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is deterministic for identical inputs and state', () => {
    const rng = new Rng(22);
    const brain = new Float32Array(BRAIN_STRIDE);
    const plastic = new Float32Array(PLASTIC_STRIDE);
    randomizeBrain(brain, 0, () => rng.next());
    const inputs = new Float32Array(INPUT_COUNT).map(() => rng.range(-1, 1));
    const hidden = new Float32Array(MAX_HIDDEN);
    const outA = new Float32Array(OUTPUT_COUNT);
    const outB = new Float32Array(OUTPUT_COUNT);

    forward(brain, 0, plastic, 0, inputs, new Float32Array(MAX_CONTEXT), 0, hidden, outA, 8, 2);
    forward(brain, 0, plastic, 0, inputs, new Float32Array(MAX_CONTEXT), 0, hidden, outB, 8, 2);
    expect(Array.from(outA)).toEqual(Array.from(outB));
  });

  it('recurrent context changes the response to identical sensory input', () => {
    const rng = new Rng(23);
    const brain = new Float32Array(BRAIN_STRIDE);
    const plastic = new Float32Array(PLASTIC_STRIDE);
    randomizeBrain(brain, 0, () => rng.next());
    const inputs = new Float32Array(INPUT_COUNT).map(() => rng.range(-1, 1));
    const hidden = new Float32Array(MAX_HIDDEN);
    const outputs = new Float32Array(OUTPUT_COUNT);

    const ctx = new Float32Array(MAX_CONTEXT);
    forward(brain, 0, plastic, 0, inputs, ctx, 0, hidden, outputs, 10, MAX_CONTEXT);
    const first = Array.from(outputs);
    forward(brain, 0, plastic, 0, inputs, ctx, 0, hidden, outputs, 10, MAX_CONTEXT);
    const second = Array.from(outputs);
    expect(first).not.toEqual(second);
  });

  it('hebbian plasticity moves weights and stays clamped', () => {
    const plastic = new Float32Array(PLASTIC_STRIDE);
    const hidden = new Float32Array(MAX_HIDDEN).fill(1);
    const outputs = new Float32Array(OUTPUT_COUNT).fill(1);
    for (let t = 0; t < 2000; t++) hebbianUpdate(plastic, 0, hidden, outputs, MAX_HIDDEN, 1, 0.05);
    let changed = 0;
    for (let i = 0; i < PLASTIC_STRIDE; i++) {
      expect(Math.abs(plastic[i])).toBeLessThanOrEqual(1.5001);
      if (plastic[i] !== 0) changed++;
    }
    expect(changed).toBeGreaterThan(0);
  });

  it('zero plasticity leaves the soma untouched', () => {
    const plastic = new Float32Array(PLASTIC_STRIDE);
    const hidden = new Float32Array(MAX_HIDDEN).fill(1);
    const outputs = new Float32Array(OUTPUT_COUNT).fill(1);
    hebbianUpdate(plastic, 0, hidden, outputs, MAX_HIDDEN, 1, 0);
    expect(plastic.every((v) => v === 0)).toBe(true);
  });
});

describe('speciation', () => {
  it('keeps similar genomes in the parent species and splits divergent ones', () => {
    const reg = new SpeciesRegistry();
    const base = new Float32Array(GENOME_LENGTH).fill(0.5);
    const root = reg.create(base, 0, 0, 0, 0, 0.5);

    const near = Float32Array.from(base);
    near[0] = 0.55;
    expect(reg.classify(root.id, near, 0, 0.4, 10, 1, 0.5)).toBe(root.id);

    const far = new Float32Array(GENOME_LENGTH).fill(0.98);
    const newId = reg.classify(root.id, far, 0, 0.4, 20, 2, 0.7);
    expect(newId).not.toBe(root.id);
    expect(reg.species.get(newId)!.ancestorId).toBe(root.id);
    expect(reg.species.get(root.id)!.descendants).toContain(newId);
  });

  it('records extinction permanently', () => {
    const reg = new SpeciesRegistry();
    const g = new Float32Array(GENOME_LENGTH).fill(0.5);
    const s = reg.create(g, 0, 0, 0, 0, 0.3);
    reg.markExtinct(s.id, 500);
    expect(reg.species.get(s.id)!.extinctTick).toBe(500);
    // A later mark must not overwrite the original extinction time.
    reg.markExtinct(s.id, 900);
    expect(reg.species.get(s.id)!.extinctTick).toBe(500);
    expect(reg.extinctSpecies()).toHaveLength(1);
    expect(reg.livingSpecies()).toHaveLength(0);
  });

  it('rehydrates from a saved record set', () => {
    const reg = new SpeciesRegistry();
    const g = new Float32Array(GENOME_LENGTH).fill(0.5);
    const a = reg.create(g, 0, 0, 0, 0, 0.1);
    const b = reg.create(g, 0, a.id, 5, 1, 0.2);

    const reg2 = new SpeciesRegistry();
    reg2.rehydrate([a, b], reg.representativeBuffer);
    expect(reg2.species.size).toBe(2);
    expect(reg2.distanceToRepresentative(b.id, g, 0)).toBe(0);
    // New species continue the id sequence rather than colliding.
    const c = reg2.create(g, 0, b.id, 9, 2, 0.3);
    expect(c.id).toBe(b.id + 1);
  });
});

describe('render snapshot', () => {
  it('packs only living organisms, densely', () => {
    const sim = new Simulation({ ...small, seed: 30 });
    for (let t = 0; t < 200; t++) sim.step();
    const buf = new Float32Array(sim.cfg.maxPopulation * 10);
    const count = sim.fillSnapshot(buf);
    expect(count).toBe(sim.pop.livingCount);
    for (let i = 0; i < count; i++) {
      const o = i * 10;
      expect(Number.isFinite(buf[o])).toBe(true);
      expect(buf[o + 3]).toBeGreaterThan(0); // radius
    }
  });
});
