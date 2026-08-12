/**
 * World events perturb the *environment*, never the organisms directly.
 *
 * A heat wave does not kill anything: it raises temperature, and organisms
 * whose evolved thermal tolerance cannot cope then starve or overheat on their
 * own. A meteor does not choose victims: it scorches terrain and destroys
 * vegetation in a radius. This is the difference between an ecosystem
 * responding to a shock and a script deleting rows from an array.
 *
 * The only exception is the direct blast radius of a meteor, which does deal
 * physical damage — that one genuinely is a physical impact.
 */
import type { SimConfig } from '../core/config';
import type { World } from '../world/world';
import type { Rng } from '../core/rng';

export const WorldEventType = {
  Meteor: 'meteor',
  Fire: 'fire',
  Flood: 'flood',
  Volcano: 'volcano',
  IceAge: 'iceAge',
  HeatWave: 'heatWave',
  Rain: 'rain',
  Bloom: 'bloom',
  Blight: 'blight',
  ToxicShift: 'toxicShift',
} as const;
export type WorldEventTypeId = (typeof WorldEventType)[keyof typeof WorldEventType];

export interface WorldEventSpec {
  type: WorldEventTypeId;
  x?: number;
  y?: number;
  radius?: number;
  magnitude?: number;
  durationTicks?: number;
}

/** An event that keeps forcing the environment for a while. */
interface ActiveForcing {
  type: WorldEventTypeId;
  ticksLeft: number;
  totalTicks: number;
  tempDelta: number;
  vegMultiplier: number;
  moistureDelta: number;
  /** How far the dangerous band of vegetation has moved. */
  toxicDelta: number;
}

export const WORLD_EVENT_INFO: Record<
  WorldEventTypeId,
  { label: string; icon: string; blurb: string; localized: boolean }
> = {
  meteor: {
    label: 'Meteor',
    icon: '☄',
    blurb: 'Impact blast, crater scorching, followed by a global cooling dust veil.',
    localized: true,
  },
  fire: {
    label: 'Wildfire',
    icon: '🔥',
    blurb: 'Burns vegetation across a region; fertile land recovers over time.',
    localized: true,
  },
  flood: {
    label: 'Flood',
    icon: '🌊',
    blurb: 'Raises the water line; lowland grazers must move or drown.',
    localized: false,
  },
  volcano: {
    label: 'Volcano',
    icon: '🌋',
    blurb: 'Local devastation, then unusually fertile soil.',
    localized: true,
  },
  iceAge: {
    label: 'Ice Age',
    icon: '❄',
    blurb: 'Sustained global cooling. Thermal tolerance becomes the dominant filter.',
    localized: false,
  },
  heatWave: {
    label: 'Heat Wave',
    icon: '☀',
    blurb: 'Sustained global warming; vegetation belts shift toward the poles.',
    localized: false,
  },
  rain: {
    label: 'Rain',
    icon: '🌧',
    blurb: 'Boosts vegetation growth everywhere for a while.',
    localized: false,
  },
  bloom: {
    label: 'Abundance',
    icon: '🍖',
    blurb: 'Vegetation surges. Watch what happens when scarcity disappears.',
    localized: false,
  },
  blight: {
    label: 'Blight',
    icon: '☠',
    blurb: 'Vegetation regrowth collapses. Competition intensifies.',
    localized: false,
  },
  toxicShift: {
    label: 'Chemical shift',
    icon: '🧪',
    blurb:
      'Which kind of growth is poisonous moves. Nothing dies of it directly, but everything that learned the old rule is now wrong.',
    localized: false,
  },
};

/** How much racket each kind of weather makes. Nothing else consults this. */
const EVENT_NOISE: Partial<Record<WorldEventTypeId, number>> = {
  rain: 0.22,
  flood: 0.12,
  volcano: 0.18,
  fire: 0.14,
  meteor: 0.1,
  heatWave: 0.04,
};

export class WorldEventSystem {
  private active: ActiveForcing[] = [];
  /** Extra water level added by floods. */
  floodOffset = 0;
  /**
   * Ambient acoustic noise from weather, 0 when the world is still. Rain and
   * wind are loud, and a loud world is one where a quiet call does not arrive.
   * This is weather, not a communication mechanic: it happens to organisms, and
   * whether they do anything about it is their problem.
   */
  acousticNoise = 0;

  /**
   * Apply an event. Localised events write into the terrain immediately;
   * sustained events register a forcing that decays over its duration.
   * Returns a human-readable description for the event log.
   */
  trigger(spec: WorldEventSpec, world: World, _cfg: SimConfig, rng: Rng): string {
    const mag = spec.magnitude ?? 1;
    const x = spec.x ?? rng.range(0, world.size);
    const y = spec.y ?? rng.range(0, world.size);

    switch (spec.type) {
      case 'meteor': {
        const r = spec.radius ?? world.size * 0.09 * mag;
        this.scorchArea(world, x, y, r, 1);
        this.active.push({
          type: 'meteor',
          ticksLeft: 2400,
          totalTicks: 2400,
          tempDelta: -0.22 * mag,
          vegMultiplier: 0.55,
          moistureDelta: 0,
          toxicDelta: 0,
        });
        return `Meteor impact at (${x.toFixed(0)}, ${y.toFixed(0)}) — ${r.toFixed(0)}u crater, dust veil cooling the world`;
      }
      case 'volcano': {
        const r = spec.radius ?? world.size * 0.05 * mag;
        this.scorchArea(world, x, y, r, 1);
        // Ash enriches the surrounding ring.
        this.fertilizeRing(world, x, y, r, r * 2.2, 0.25 * mag);
        this.active.push({
          type: 'volcano',
          ticksLeft: 1200,
          totalTicks: 1200,
          tempDelta: -0.1 * mag,
          vegMultiplier: 0.8,
          moistureDelta: 0,
          toxicDelta: 0,
        });
        return `Volcanic eruption at (${x.toFixed(0)}, ${y.toFixed(0)}) — ash cloud, then enriched soil`;
      }
      case 'fire': {
        const r = spec.radius ?? world.size * 0.14 * mag;
        this.burnArea(world, x, y, r);
        return `Wildfire sweeps a ${(r * 2).toFixed(0)}u region near (${x.toFixed(0)}, ${y.toFixed(0)})`;
      }
      case 'flood': {
        this.floodOffset += 0.03 * mag;
        this.active.push({
          type: 'flood',
          ticksLeft: spec.durationTicks ?? 1800,
          totalTicks: spec.durationTicks ?? 1800,
          tempDelta: -0.02,
          vegMultiplier: 0.85,
          moistureDelta: 0.15 * mag,
          toxicDelta: 0,
        });
        return `Flood — sea level rises by ${(0.03 * mag).toFixed(3)}`;
      }
      case 'iceAge':
        this.active.push({
          type: 'iceAge',
          ticksLeft: spec.durationTicks ?? 9000,
          totalTicks: spec.durationTicks ?? 9000,
          tempDelta: -0.3 * mag,
          vegMultiplier: 0.5,
          moistureDelta: -0.05,
          toxicDelta: 0,
        });
        return `Ice age begins — global temperature falling by ${(0.3 * mag).toFixed(2)}`;
      case 'heatWave':
        this.active.push({
          type: 'heatWave',
          ticksLeft: spec.durationTicks ?? 4000,
          totalTicks: spec.durationTicks ?? 4000,
          tempDelta: 0.26 * mag,
          vegMultiplier: 0.75,
          moistureDelta: -0.12,
          toxicDelta: 0,
        });
        return `Heat wave — global temperature rising by ${(0.26 * mag).toFixed(2)}`;
      case 'rain':
        this.active.push({
          type: 'rain',
          ticksLeft: spec.durationTicks ?? 1500,
          totalTicks: spec.durationTicks ?? 1500,
          tempDelta: -0.03,
          vegMultiplier: 1.7,
          moistureDelta: 0.1,
          toxicDelta: 0,
        });
        return 'Heavy rain — vegetation growth accelerates';
      case 'bloom':
        this.active.push({
          type: 'bloom',
          ticksLeft: spec.durationTicks ?? 3000,
          totalTicks: spec.durationTicks ?? 3000,
          tempDelta: 0,
          vegMultiplier: 3.2,
          moistureDelta: 0,
          toxicDelta: 0,
        });
        return 'Abundance — food is everywhere. Selection pressure on foraging collapses';
      case 'blight':
        this.active.push({
          type: 'blight',
          ticksLeft: spec.durationTicks ?? 3000,
          totalTicks: spec.durationTicks ?? 3000,
          tempDelta: 0,
          vegMultiplier: 0.15,
          moistureDelta: 0,
          toxicDelta: 0,
        });
        return 'Blight — vegetation regrowth nearly halts';
      case 'toxicShift': {
        // Which appearance is dangerous moves, by an amount and in a direction
        // nothing announces. This kills nobody. What it does is invalidate
        // every model in the world at once, which is a different kind of
        // pressure from a meteor: the organisms that come through it are the
        // ones whose learning could keep up, not the ones that were furthest
        // from the impact.
        const shift = (rng.chance(0.5) ? -1 : 1) * (0.18 + rng.next() * 0.3) * mag;
        this.active.push({
          type: 'toxicShift',
          ticksLeft: spec.durationTicks ?? 12000,
          totalTicks: spec.durationTicks ?? 12000,
          tempDelta: 0,
          vegMultiplier: 1,
          moistureDelta: 0,
          toxicDelta: shift,
        });
        return `Chemical shift — the dangerous band of vegetation moves by ${shift.toFixed(2)}`;
      }
      default:
        return 'Unknown event';
    }
  }

  /** Recompute the global forcing terms from all active events. */
  update(cfg: SimConfig): void {
    let temp = 0;
    let veg = 1;
    let noise = 0;
    let toxic = 0;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      a.ticksLeft--;
      // Ramp in and out so nothing snaps discontinuously.
      const t = a.ticksLeft / a.totalTicks;
      const envelope = Math.min(1, Math.min(t * 6, (1 - t) * 6 + 0.35));
      temp += a.tempDelta * envelope;
      veg *= 1 + (a.vegMultiplier - 1) * envelope;
      noise += (EVENT_NOISE[a.type] ?? 0) * envelope;
      toxic += a.toxicDelta * envelope;
      if (a.ticksLeft <= 0) this.active.splice(i, 1);
    }
    cfg.globalTemperatureOffset = temp;
    cfg.vegetationGrowthMultiplier = veg;
    cfg.toxicCenterOffset = toxic;
    this.acousticNoise = noise;
    if (this.floodOffset > 0) this.floodOffset *= 0.99975;
  }

  activeEvents(): { type: WorldEventTypeId; ticksLeft: number; progress: number }[] {
    return this.active.map((a) => ({
      type: a.type,
      ticksLeft: a.ticksLeft,
      progress: 1 - a.ticksLeft / a.totalTicks,
    }));
  }

  reset(): void {
    this.active.length = 0;
    this.floodOffset = 0;
    this.acousticNoise = 0;
  }

  private scorchArea(world: World, x: number, y: number, r: number, intensity: number): void {
    this.forCellsInRadius(world, x, y, r, (i, falloff) => {
      world.vegetation[i] = 0;
      world.carrion[i] *= 1 - falloff;
      world.scorch[i] = Math.min(1, world.scorch[i] + intensity * falloff);
    });
  }

  private burnArea(world: World, x: number, y: number, r: number): void {
    this.forCellsInRadius(world, x, y, r, (i, falloff) => {
      // Fire only takes hold where there is fuel.
      const fuel = world.vegetation[i];
      if (fuel <= 0.02) return;
      const burn = Math.min(1, falloff * 1.6);
      world.vegetation[i] *= 1 - burn;
      world.scorch[i] = Math.min(1, world.scorch[i] + burn * 0.55);
    });
  }

  private fertilizeRing(
    world: World,
    x: number,
    y: number,
    inner: number,
    outer: number,
    amount: number,
  ): void {
    this.forCellsInRadius(world, x, y, outer, (i, _f, dist) => {
      if (dist < inner) return;
      world.fertility[i] = Math.min(1, world.fertility[i] + amount * (1 - (dist - inner) / (outer - inner)));
    });
  }

  private forCellsInRadius(
    world: World,
    x: number,
    y: number,
    r: number,
    fn: (i: number, falloff: number, dist: number) => void,
  ): void {
    const cs = world.cellSize;
    const g = world.grid;
    const cx = x / cs;
    const cy = y / cs;
    const cr = r / cs;
    const x0 = Math.max(0, Math.floor(cx - cr));
    const x1 = Math.min(g - 1, Math.ceil(cx + cr));
    const y0 = Math.max(0, Math.floor(cy - cr));
    const y1 = Math.min(g - 1, Math.ceil(cy + cr));
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const dx = gx + 0.5 - cx;
        const dy = gy + 0.5 - cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > cr) continue;
        const falloff = 1 - d / cr;
        fn(gy * g + gx, falloff * falloff, d * cs);
      }
    }
  }
}
