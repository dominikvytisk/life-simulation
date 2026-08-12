/**
 * The environment. Structure-of-arrays over a square grid of cells.
 *
 * Static layers (generated once):   elevation, moisture, baseTemperature, fertility
 * Dynamic layers (updated per tick): vegetation, carrion, signal0, signal1, scorch
 *
 * Organisms never read "biome" as an enum — they read the raw scalar fields.
 * Biomes exist only as a human-facing label for the map legend.
 */
import type { SimConfig } from '../core/config';
import type { Rng } from '../core/rng';
import { SimplexNoise } from './noise';

export const Biome = {
  DeepWater: 0,
  ShallowWater: 1,
  Beach: 2,
  Grassland: 3,
  Forest: 4,
  Desert: 5,
  Tundra: 6,
  Mountain: 7,
  Snow: 8,
} as const;
export type BiomeId = (typeof Biome)[keyof typeof Biome];

export const BIOME_NAMES = [
  'Deep Water',
  'Shallow Water',
  'Beach',
  'Grassland',
  'Forest',
  'Desert',
  'Tundra',
  'Mountain',
  'Snow',
];

export class World {
  readonly size: number; // world units per axis
  readonly grid: number; // cells per axis
  readonly cellSize: number;

  // Static layers
  readonly elevation: Float32Array;
  readonly moisture: Float32Array;
  readonly baseTemperature: Float32Array;
  readonly fertility: Float32Array; // vegetation carrying capacity, 0..1
  readonly biome: Uint8Array;
  /**
   * What the vegetation here looks like. A visible, smoothly varying property
   * with no consequences of its own — an organism can perceive it directly and
   * it does nothing. Its only significance is that it happens to be correlated
   * with `toxinBase` through `toxicityAt`, and that correlation is a fact about
   * this world that has to be learned rather than sensed.
   */
  readonly flora: Float32Array;
  /**
   * The part of toxicity that flora does *not* predict. Without it the
   * relationship would be exact, and an organism that noticed it once would
   * never need its model again. With it, prediction is worth something and
   * remains imperfect no matter how good the learner is.
   */
  readonly toxinBase: Float32Array;

  // Dynamic layers
  readonly vegetation: Float32Array; // biomass, 0..capacity
  readonly carrion: Float32Array; // dead biomass
  readonly signal0: Float32Array; // pheromone channel A
  readonly signal1: Float32Array; // pheromone channel B
  readonly scorch: Float32Array; // fire/meteor damage, suppresses fertility, decays

  // Scratch buffer for diffusion (allocated once, never per tick)
  private diffScratch: Float32Array;

  // Global forcing
  light = 1; // 0..1 day/night
  seasonalTemperature = 0;

  constructor(cfg: SimConfig, rng: Rng) {
    this.size = cfg.worldSize;
    this.grid = cfg.gridSize;
    this.cellSize = cfg.worldSize / cfg.gridSize;
    const n = this.grid * this.grid;

    this.elevation = new Float32Array(n);
    this.moisture = new Float32Array(n);
    this.baseTemperature = new Float32Array(n);
    this.fertility = new Float32Array(n);
    this.biome = new Uint8Array(n);
    this.flora = new Float32Array(n);
    this.toxinBase = new Float32Array(n);
    this.vegetation = new Float32Array(n);
    this.carrion = new Float32Array(n);
    this.signal0 = new Float32Array(n);
    this.signal1 = new Float32Array(n);
    this.scorch = new Float32Array(n);
    this.diffScratch = new Float32Array(n);

    this.generate(cfg, rng);
  }

  private generate(cfg: SimConfig, rng: Rng): void {
    const elevNoise = new SimplexNoise(rng);
    const moistNoise = new SimplexNoise(rng);
    const detailNoise = new SimplexNoise(rng);
    const floraNoise = new SimplexNoise(rng);
    const toxinNoise = new SimplexNoise(rng);
    const g = this.grid;
    const inv = 1 / g;

    for (let y = 0; y < g; y++) {
      for (let x = 0; x < g; x++) {
        const i = y * g + x;
        const fx = x * inv;
        const fy = y * inv;

        // Continental shape: FBM plus a soft radial falloff so the world has
        // coastlines rather than wrapping land, which creates island dynamics.
        const base = elevNoise.fbm(fx * 3.1, fy * 3.1, 6) * 0.5 + 0.5;
        const ridge = elevNoise.ridged(fx * 5.7 + 11.3, fy * 5.7 - 4.2, 4);
        const dx = fx - 0.5;
        const dy = fy - 0.5;
        const radial = 1 - Math.min(1, Math.sqrt(dx * dx + dy * dy) * 1.95);
        const falloff = smoothstep(0, 0.55, radial);

        let e = base * 0.72 + ridge * 0.28;
        e = e * (0.35 + 0.65 * falloff);
        e += detailNoise.fbm(fx * 14, fy * 14, 3) * 0.035;
        e = clamp01(e);
        this.elevation[i] = e;

        // Moisture: own noise field, boosted near water, dried by altitude.
        let m = moistNoise.fbm(fx * 2.4 - 7.7, fy * 2.4 + 3.3, 5) * 0.5 + 0.5;
        m = clamp01(m * 0.75 + (1 - e) * 0.45 - Math.max(0, e - 0.6) * 0.5);
        this.moisture[i] = m;

        // Temperature: latitude gradient + altitude lapse rate + local variation.
        const latitude = Math.abs(fy - 0.5) * 2; // 0 equator, 1 pole
        let t = 1 - latitude * 0.95;
        t -= Math.max(0, e - cfg.waterLevel) * 0.75; // higher = colder
        t += detailNoise.fbm(fx * 4 + 31, fy * 4 - 17, 3) * 0.08;
        this.baseTemperature[i] = clamp01(t);

        // Fertility: needs water, warmth and land. Peak in warm-wet lowlands.
        const land = e > cfg.waterLevel ? 1 : 0;
        const warmth = 1 - Math.abs(this.baseTemperature[i] - 0.62) * 1.9;
        const wet = smoothstep(0.18, 0.72, m);
        const flat = 1 - smoothstep(0.62, 0.9, e);
        this.fertility[i] = land * clamp01(warmth) * wet * flat;

        // Flora varies on a coarser scale than terrain detail, so a patch of
        // one kind of growth is big enough to be worth learning about and small
        // enough that an organism meets several kinds in a lifetime. It leans
        // on moisture, which means it is partly predictable from things an
        // organism can already sense — and only partly.
        this.flora[i] = clamp01(
          floraNoise.fbm(fx * 6.3 + 19.1, fy * 6.3 - 8.4, 4) * 0.5 + 0.5 + (m - 0.5) * 0.25,
        );
        this.toxinBase[i] = clamp01(toxinNoise.fbm(fx * 9.1 - 3.7, fy * 9.1 + 24.5, 3) * 0.5 + 0.5);

        this.biome[i] = classifyBiome(e, m, this.baseTemperature[i], cfg.waterLevel);
        // Seed vegetation at capacity so the first generation has something to eat.
        this.vegetation[i] = this.fertility[i] * (0.35 + rng.next() * 0.5);
      }
    }
  }

  index(worldX: number, worldY: number): number {
    const cx = Math.min(this.grid - 1, Math.max(0, (worldX / this.cellSize) | 0));
    const cy = Math.min(this.grid - 1, Math.max(0, (worldY / this.cellSize) | 0));
    return cy * this.grid + cx;
  }

  /** Capacity for vegetation at a cell, after scorch and global forcing. */
  capacityAt(i: number, cfg: SimConfig): number {
    const seasonal = 1 + this.seasonalTemperature * 0.6;
    const heat = this.baseTemperature[i] + cfg.globalTemperatureOffset + this.seasonalTemperature;
    // Vegetation dies off outside a viable thermal band.
    const thermal = clamp01(1 - Math.abs(heat - 0.6) * 2.1);
    return this.fertility[i] * thermal * seasonal * Math.max(0, 1 - this.scorch[i]);
  }

  /**
   * How much of a slow poison the vegetation at a cell carries, 0..1.
   *
   * The dangerous band sits at a particular appearance, and where that band
   * sits can move (a `toxicShift` event does exactly that). Nothing about the
   * cell announces this: an organism that has learned to avoid one look has
   * learned a fact that was true when it learned it, and a lineage carrying
   * that lesson through a shift is carrying a false belief.
   */
  toxicityAt(i: number, cfg: SimConfig): number {
    if (cfg.toxinPotency <= 0) return 0;
    const center = cfg.floraToxicCenter + cfg.toxicCenterOffset;
    let d = this.flora[i] - center;
    if (d < 0) d = -d;
    // Sharp in flora, so most of the map carries none of it at all and the
    // patches that do are worth having an opinion about. The second factor is
    // the part appearance does not predict: within the dangerous band, how bad
    // it actually is still varies, and no amount of learning removes that.
    return clamp01((1 - d * 6) * (0.5 + this.toxinBase[i] * 0.7));
  }

  /** Temperature actually experienced at a cell right now. */
  temperatureAt(i: number, cfg: SimConfig): number {
    return (
      this.baseTemperature[i] +
      cfg.globalTemperatureOffset +
      this.seasonalTemperature +
      (this.light - 0.5) * 0.08
    );
  }

  isWater(i: number, cfg: SimConfig): boolean {
    return this.elevation[i] < cfg.waterLevel;
  }

  /** Advance vegetation, carrion decay, scorch recovery, and signal fields. */
  step(cfg: SimConfig, tick: number): void {
    const n = this.grid * this.grid;
    const growth = cfg.vegetationGrowthRate * cfg.vegetationGrowthMultiplier;

    // Day/night and seasons.
    const dayPhase = (tick % cfg.ticksPerDay) / cfg.ticksPerDay;
    this.light = 0.5 - 0.5 * Math.cos(dayPhase * Math.PI * 2);
    const yearPhase = (tick % (cfg.ticksPerDay * cfg.daysPerYear)) / (cfg.ticksPerDay * cfg.daysPerYear);
    this.seasonalTemperature = Math.sin(yearPhase * Math.PI * 2) * cfg.seasonAmplitude;

    const lightFactor = 0.35 + this.light * 0.65;

    for (let i = 0; i < n; i++) {
      // Logistic vegetation growth toward the current capacity.
      const cap = this.capacityAt(i, cfg);
      if (cap > 0.001) {
        const v = this.vegetation[i];
        // Logistic growth plus a colonisation term. The constant term matters
        // more than it looks: pure logistic growth from v == 0 is exactly zero,
        // so a grazed-bare cell would stay bare forever and the world would be
        // stripped permanently after the first population boom.
        this.vegetation[i] =
          v + growth * lightFactor * v * (1 - v / cap) + growth * 0.08 * cap * lightFactor;
        if (this.vegetation[i] > cap) this.vegetation[i] = cap;
      } else if (this.vegetation[i] > 0) {
        this.vegetation[i] *= 0.985;
      }

      if (this.carrion[i] > 0) {
        this.carrion[i] *= 1 - cfg.carrionDecayRate;
        if (this.carrion[i] < 1e-4) this.carrion[i] = 0;
      }
      if (this.scorch[i] > 0) {
        this.scorch[i] -= 0.0008;
        if (this.scorch[i] < 0) this.scorch[i] = 0;
      }
    }

    this.stepSignal(this.signal0, cfg);
    this.stepSignal(this.signal1, cfg);
  }

  /**
   * Decay + 4-neighbour diffusion. This turns the emitted signals into a
   * persistent scent/pheromone landscape, which is what makes trail-following,
   * alarm calls and territory marking *possible* (never guaranteed).
   */
  private stepSignal(field: Float32Array, cfg: SimConfig): void {
    const g = this.grid;
    const d = cfg.signalDiffusion;
    const keep = (1 - cfg.signalDecay) * (1 - d);
    const share = d * 0.25 * (1 - cfg.signalDecay);
    const out = this.diffScratch;

    for (let y = 0; y < g; y++) {
      const row = y * g;
      const up = (y > 0 ? y - 1 : y) * g;
      const dn = (y < g - 1 ? y + 1 : y) * g;
      for (let x = 0; x < g; x++) {
        const i = row + x;
        const l = row + (x > 0 ? x - 1 : x);
        const r = row + (x < g - 1 ? x + 1 : x);
        const s = field[l] + field[r] + field[up + x] + field[dn + x];
        const v = field[i] * keep + s * share;
        out[i] = v < 1e-5 ? 0 : v;
      }
    }
    field.set(out);
  }

  /** Bilinear sample of any layer in world coordinates. */
  sample(field: Float32Array, worldX: number, worldY: number): number {
    const g = this.grid;
    const fx = worldX / this.cellSize - 0.5;
    const fy = worldY / this.cellSize - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const cx0 = Math.min(g - 1, Math.max(0, x0));
    const cy0 = Math.min(g - 1, Math.max(0, y0));
    const cx1 = Math.min(g - 1, Math.max(0, x0 + 1));
    const cy1 = Math.min(g - 1, Math.max(0, y0 + 1));
    const a = field[cy0 * g + cx0];
    const b = field[cy0 * g + cx1];
    const c = field[cy1 * g + cx0];
    const d = field[cy1 * g + cx1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  }

  /** Central-difference gradient of a layer, in world units. */
  gradient(field: Float32Array, worldX: number, worldY: number, out: { x: number; y: number }): void {
    const h = this.cellSize;
    out.x = (this.sample(field, worldX + h, worldY) - this.sample(field, worldX - h, worldY)) / 2;
    out.y = (this.sample(field, worldX, worldY + h) - this.sample(field, worldX, worldY - h)) / 2;
  }

  /** Snapshot of the dynamic layers, for saving. */
  serializeDynamic(): Record<string, Float32Array> {
    return {
      vegetation: this.vegetation,
      carrion: this.carrion,
      signal0: this.signal0,
      signal1: this.signal1,
      scorch: this.scorch,
    };
  }
}

function classifyBiome(e: number, m: number, t: number, waterLevel: number): BiomeId {
  if (e < waterLevel - 0.09) return Biome.DeepWater;
  if (e < waterLevel) return Biome.ShallowWater;
  if (e < waterLevel + 0.02) return Biome.Beach;
  if (e > 0.82) return t < 0.3 ? Biome.Snow : Biome.Mountain;
  if (t < 0.24) return Biome.Tundra;
  if (m < 0.28) return Biome.Desert;
  if (m > 0.55) return Biome.Forest;
  return Biome.Grassland;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
