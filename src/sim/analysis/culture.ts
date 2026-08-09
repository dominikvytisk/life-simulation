/**
 * Culture measurement.
 *
 * "Culture" is not a flag anything sets. It is a claim that has to be
 * demonstrated, and this module tries to demonstrate it two independent ways:
 *
 * 1. Transmission signal. Compare how similar the *learned* weights of
 *    neighbours are against random pairs from the same population, and do the
 *    same for genetic distance as a control. If neighbours share learned
 *    behaviour more than random pairs do, but are no more closely related, the
 *    similarity did not come down the germline.
 *
 * 2. Meme persistence. Each organism carries the id of whoever last shaped its
 *    soma. A tag still carried by living organisms after the individual it is
 *    named after is dead is, by construction, behaviour that outlived its
 *    originator.
 *
 * Both are sampled, both use the deterministic RNG, and both can legitimately
 * report "no culture here" — which is what an ordinary run reports.
 */
import type { Rng } from '../core/rng';
import { PLASTIC_STRIDE } from '../brain/brain';
import { geneticDistance } from '../genome/loci';
import type { Population } from '../organisms/population';
import type { SpatialHash } from '../core/spatialHash';

export interface MemeRecord {
  tag: number;
  carriers: number;
  originTick: number;
  originatorAlive: boolean;
  /** Ticks the meme has survived its originator. Zero while the founder lives. */
  survivedOriginator: number;
}

export interface CultureReport {
  /** Cosine similarity of learned weights: neighbours vs random pairs. */
  neighbourSoma: number;
  randomSoma: number;
  /** Genetic similarity for the same pairs — the control. */
  neighbourGenetic: number;
  randomGenetic: number;
  /**
   * Neighbour soma excess after subtracting the genetic excess. Positive means
   * learned behaviour is clustering beyond what shared ancestry explains.
   */
  transmissionIndex: number;
  imitationsPerTick: number;
  distinctMemes: number;
  topMemes: MemeRecord[];
  /** Memes still carried after their originator died. */
  posthumousMemes: number;
  samples: number;
}

interface MemeState {
  originTick: number;
  originatorSlotId: number;
  lastSeenTick: number;
  originatorDiedTick: number;
}

const SAMPLE_PAIRS = 96;

export class CultureAnalyzer {
  private memes = new Map<number, MemeState>();
  private report: CultureReport = emptyReport();
  private imitationWindow = 0;
  private windowTicks = 0;

  noteImitation(): void {
    this.imitationWindow++;
  }

  noteMemeBirth(tag: number, tick: number, originatorId: number): void {
    if (!this.memes.has(tag)) {
      this.memes.set(tag, {
        originTick: tick,
        originatorSlotId: originatorId,
        lastSeenTick: tick,
        originatorDiedTick: -1,
      });
    }
  }

  noteOrganismDeath(id: number, tick: number): void {
    const m = this.memes.get(id);
    if (m && m.originatorDiedTick < 0) m.originatorDiedTick = tick;
  }

  /**
   * Sample the population. Called on the stats interval, not every tick — the
   * cosine similarity of two plastic vectors is PLASTIC_STRIDE multiplies and
   * doing it for every organism every tick would dominate the whole simulation.
   */
  update(
    pop: Population,
    spatial: SpatialHash,
    rng: Rng,
    tick: number,
    ticksElapsed: number,
    live: Int32Array,
    liveCount: number,
  ): void {
    this.windowTicks += ticksElapsed;
    if (liveCount < 8) {
      this.report = emptyReport();
      return;
    }

    let nSoma = 0;
    let nSomaSum = 0;
    let nGenSum = 0;
    let nPairs = 0;
    let rSomaSum = 0;
    let rGenSum = 0;
    let rPairs = 0;

    const scratch = new Int32Array(32);

    for (let s = 0; s < SAMPLE_PAIRS; s++) {
      const a = live[rng.int(liveCount)];
      // --- neighbour pair ---
      const found = spatial.queryInto(pop.x[a], pop.y[a], 90, scratch);
      let partner = -1;
      for (let k = 0; k < found; k++) {
        const j = scratch[k];
        if (j !== a && pop.alive[j]) {
          partner = j;
          break;
        }
      }
      if (partner >= 0) {
        nSomaSum += somaSimilarity(pop, a, partner);
        nGenSum += 1 - geneticDistance(pop.genome, pop.genomeOffset(a), pop.genome, pop.genomeOffset(partner));
        nPairs++;
      }
      // --- random pair from anywhere in the world ---
      const b = live[rng.int(liveCount)];
      if (b !== a) {
        rSomaSum += somaSimilarity(pop, a, b);
        rGenSum += 1 - geneticDistance(pop.genome, pop.genomeOffset(a), pop.genome, pop.genomeOffset(b));
        rPairs++;
      }
      nSoma++;
    }

    // --- meme census ---
    const counts = new Map<number, number>();
    for (let i = 0; i < liveCount; i++) {
      const tag = pop.memeTag[live[i]];
      if (tag === 0) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    let posthumous = 0;
    const records: MemeRecord[] = [];
    for (const [tag, carriers] of counts) {
      const state = this.memes.get(tag);
      if (!state) continue;
      state.lastSeenTick = tick;
      const originatorAlive = state.originatorDiedTick < 0;
      if (!originatorAlive) posthumous++;
      records.push({
        tag,
        carriers,
        originTick: state.originTick,
        originatorAlive,
        survivedOriginator: originatorAlive ? 0 : tick - state.originatorDiedTick,
      });
    }
    records.sort((a, b) => b.carriers - a.carriers);

    // Forget memes nobody carries, so the map does not grow without bound.
    if (this.memes.size > 4000) {
      for (const [tag, state] of this.memes) {
        if (!counts.has(tag) && tick - state.lastSeenTick > 5000) this.memes.delete(tag);
      }
    }

    const nSomaAvg = nPairs > 0 ? nSomaSum / nPairs : 0;
    const rSomaAvg = rPairs > 0 ? rSomaSum / rPairs : 0;
    const nGenAvg = nPairs > 0 ? nGenSum / nPairs : 0;
    const rGenAvg = rPairs > 0 ? rGenSum / rPairs : 0;

    this.report = {
      neighbourSoma: nSomaAvg,
      randomSoma: rSomaAvg,
      neighbourGenetic: nGenAvg,
      randomGenetic: rGenAvg,
      // Subtracting the genetic excess is the whole point: neighbours are
      // usually relatives, and relatives inherit similar brains. What is left
      // over is the part shared ancestry does not account for.
      transmissionIndex: nSomaAvg - rSomaAvg - (nGenAvg - rGenAvg),
      imitationsPerTick: this.windowTicks > 0 ? this.imitationWindow / this.windowTicks : 0,
      distinctMemes: counts.size,
      topMemes: records.slice(0, 8),
      posthumousMemes: posthumous,
      samples: nSoma,
    };
    this.imitationWindow = 0;
    this.windowTicks = 0;
  }

  current(): CultureReport {
    return this.report;
  }

  reset(): void {
    this.memes.clear();
    this.report = emptyReport();
    this.imitationWindow = 0;
    this.windowTicks = 0;
  }
}

/** Cosine similarity of two organisms' learned (non-inherited) weights. */
function somaSimilarity(pop: Population, a: number, b: number): number {
  const ao = pop.plasticOffset(a);
  const bo = pop.plasticOffset(b);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < PLASTIC_STRIDE; i++) {
    const x = pop.plastic[ao + i];
    const y = pop.plastic[bo + i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na < 1e-9 || nb < 1e-9) return 0;
  return dot / Math.sqrt(na * nb);
}

function emptyReport(): CultureReport {
  return {
    neighbourSoma: 0,
    randomSoma: 0,
    neighbourGenetic: 0,
    randomGenetic: 0,
    transmissionIndex: 0,
    imitationsPerTick: 0,
    distinctMemes: 0,
    topMemes: [],
    posthumousMemes: 0,
    samples: 0,
  };
}
