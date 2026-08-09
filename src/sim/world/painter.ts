/**
 * Paints the environment into an RGBA texture on the worker thread.
 *
 * The map is a scientific readout, not a landscape painting: each overlay shows
 * one field of the world so you can see *why* organisms are where they are.
 * Runs on the worker so the main thread never blocks, and writes into a reused
 * buffer that is transferred (zero-copy) to the renderer.
 */
import type { SimConfig } from '../core/config';
import type { World } from './world';
import { Biome } from './world';

export type OverlayMode =
  | 'terrain'
  | 'vegetation'
  | 'temperature'
  | 'moisture'
  | 'elevation'
  | 'signals'
  | 'carrion'
  | 'fertility';

export const OVERLAY_MODES: { id: OverlayMode; label: string }[] = [
  { id: 'terrain', label: 'Terrain' },
  { id: 'vegetation', label: 'Vegetation' },
  { id: 'carrion', label: 'Carrion' },
  { id: 'temperature', label: 'Temperature' },
  { id: 'moisture', label: 'Moisture' },
  { id: 'elevation', label: 'Elevation' },
  { id: 'fertility', label: 'Fertility' },
  { id: 'signals', label: 'Signal field' },
];

// Base palette per biome, in a muted instrument-panel register.
const BIOME_COLORS: number[][] = [];
BIOME_COLORS[Biome.DeepWater] = [8, 18, 38];
BIOME_COLORS[Biome.ShallowWater] = [16, 42, 72];
BIOME_COLORS[Biome.Beach] = [64, 60, 48];
BIOME_COLORS[Biome.Grassland] = [30, 46, 30];
BIOME_COLORS[Biome.Forest] = [20, 40, 26];
BIOME_COLORS[Biome.Desert] = [64, 56, 38];
BIOME_COLORS[Biome.Tundra] = [44, 50, 54];
BIOME_COLORS[Biome.Mountain] = [46, 46, 50];
BIOME_COLORS[Biome.Snow] = [76, 82, 90];

export function paintWorld(
  world: World,
  cfg: SimConfig,
  mode: OverlayMode,
  out: Uint8ClampedArray,
  floodOffset = 0,
): void {
  const g = world.grid;
  const n = g * g;
  const waterLevel = cfg.waterLevel + floodOffset;

  for (let i = 0; i < n; i++) {
    let r = 0;
    let gr = 0;
    let b = 0;

    switch (mode) {
      case 'terrain': {
        const c = BIOME_COLORS[world.biome[i]] ?? [30, 30, 30];
        r = c[0];
        gr = c[1];
        b = c[2];
        const e = world.elevation[i];
        if (e < waterLevel) {
          // Deeper water reads darker and bluer.
          const depth = Math.min(1, (waterLevel - e) * 5);
          r = 10 + (1 - depth) * 14;
          gr = 26 + (1 - depth) * 26;
          b = 52 + (1 - depth) * 34;
        } else {
          // Vegetation greens the land; scorch blackens and reddens it.
          const v = Math.min(1, world.vegetation[i] * 1.6);
          r = r * (1 - v * 0.45) + 18 * v;
          gr = gr * (1 - v * 0.2) + 132 * v;
          b = b * (1 - v * 0.5) + 46 * v;
          // Relief shading from the local slope: makes topography legible.
          const shade = hillshade(world, i, g);
          r *= shade;
          gr *= shade;
          b *= shade;
          const s = world.scorch[i];
          if (s > 0) {
            r = r * (1 - s) + 42 * s;
            gr = gr * (1 - s) + 16 * s;
            b = b * (1 - s) + 14 * s;
          }
        }
        const carrion = Math.min(1, world.carrion[i] * 0.04);
        if (carrion > 0.02) {
          r = r * (1 - carrion * 0.7) + 150 * carrion * 0.7;
          gr = gr * (1 - carrion * 0.7) + 60 * carrion * 0.7;
          b = b * (1 - carrion * 0.7) + 66 * carrion * 0.7;
        }
        break;
      }
      case 'vegetation': {
        const cap = world.capacityAt(i, cfg);
        const v = cap > 0 ? Math.min(1, world.vegetation[i] / cap) : 0;
        const abs = Math.min(1, world.vegetation[i] * 1.6);
        [r, gr, b] = viridis(v * 0.85 * (0.25 + abs * 0.75));
        if (world.elevation[i] < waterLevel) {
          r *= 0.25;
          gr *= 0.3;
          b *= 0.45;
        }
        break;
      }
      case 'carrion': {
        const c = Math.min(1, world.carrion[i] * 0.045);
        [r, gr, b] = inferno(c);
        break;
      }
      case 'temperature': {
        const t = world.temperatureAt(i, cfg);
        [r, gr, b] = diverging((t - 0.5) * 2);
        break;
      }
      case 'moisture':
        [r, gr, b] = ocean(world.moisture[i]);
        break;
      case 'elevation': {
        const e = world.elevation[i];
        const v = Math.min(1, Math.max(0, e));
        if (e < waterLevel) {
          [r, gr, b] = [10, 30 + v * 40, 60 + v * 60];
        } else {
          const s = hillshade(world, i, g);
          const t = (e - waterLevel) / (1 - waterLevel);
          r = (40 + t * 190) * s;
          gr = (44 + t * 185) * s;
          b = (52 + t * 175) * s;
        }
        break;
      }
      case 'fertility':
        [r, gr, b] = viridis(world.fertility[i]);
        break;
      case 'signals': {
        const s0 = Math.min(1, world.signal0[i] * 1.4);
        const s1 = Math.min(1, world.signal1[i] * 1.4);
        r = 12 + s1 * 235;
        gr = 14 + Math.min(s0, s1) * 120;
        b = 20 + s0 * 235;
        break;
      }
    }

    const o = i * 4;
    out[o] = r;
    out[o + 1] = gr;
    out[o + 2] = b;
    out[o + 3] = 255;
  }
}

/** Cheap directional shading from the elevation gradient. */
function hillshade(world: World, i: number, g: number): number {
  const x = i % g;
  const y = (i / g) | 0;
  const l = world.elevation[y * g + Math.max(0, x - 1)];
  const rr = world.elevation[y * g + Math.min(g - 1, x + 1)];
  const u = world.elevation[Math.max(0, y - 1) * g + x];
  const d = world.elevation[Math.min(g - 1, y + 1) * g + x];
  const dx = rr - l;
  const dy = d - u;
  return Math.max(0.55, Math.min(1.35, 1 - (dx + dy) * 5));
}

// --- Small perceptual colour ramps. Approximations, but monotonic in lightness
// --- so they stay readable in a dark UI and survive greyscale printing.
function viridis(t: number): [number, number, number] {
  const x = clamp01(t);
  return [
    255 * (0.267 + x * (0.0 + x * (1.35 - x * 0.72))),
    255 * (0.004 + x * (1.02 - x * 0.14)),
    255 * (0.329 + x * (0.86 - x * 1.05)),
  ];
}

function inferno(t: number): [number, number, number] {
  const x = clamp01(t);
  return [255 * Math.min(1, x * 2.1), 255 * Math.max(0, x * 1.4 - 0.45) ** 1.2, 255 * (x < 0.4 ? x * 0.9 : Math.max(0, 0.36 - (x - 0.4) * 0.5) + x * x * 0.6)];
}

function diverging(t: number): [number, number, number] {
  const x = Math.max(-1, Math.min(1, t));
  if (x < 0) return [30 + (1 + x) * 90, 70 + (1 + x) * 110, 190 - (1 + x) * 40];
  return [190 + x * 55, 120 - x * 90, 60 - x * 40];
}

function ocean(t: number): [number, number, number] {
  const x = clamp01(t);
  return [20 + (1 - x) * 90, 50 + x * 70, 60 + x * 165];
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
