/**
 * Speciation by genetic drift from a representative genome.
 *
 * When an offspring is far enough from its parent species' representative, it
 * founds a new species branching off that parent. Species therefore form a real
 * phylogenetic tree with recorded origins, peaks and extinctions — the raw
 * material for the evolutionary tree view and the Museum of Life.
 *
 * Nothing here influences behaviour. Species are a *description* of the
 * population, not a mechanic organisms can perceive. (Organisms do sense
 * genetic similarity, but they sense the continuous distance, not the label.)
 */
import { GENOME_LENGTH, geneticDistance } from '../genome/loci';

export interface SpeciesRecord {
  id: number;
  ancestorId: number;
  name: string;
  originTick: number;
  extinctTick: number; // -1 while alive
  population: number;
  peakPopulation: number;
  totalBorn: number;
  totalDied: number;
  generationOrigin: number;
  hue: number;
  /** Running trait means, updated lazily for the analytics panels. */
  traits: Float32Array;
  descendants: number[];
}

const SYLLABLES_A = ['ka', 'ver', 'lim', 'thal', 'os', 'pyr', 'no', 'mar', 'ux', 'gel', 'sar', 'zen'];
const SYLLABLES_B = ['ith', 'ora', 'ex', 'ani', 'ur', 'eon', 'is', 'ade', 'yx', 'ome', 'ara', 'ux'];

export class SpeciesRegistry {
  readonly species = new Map<number, SpeciesRecord>();
  /** Representative genome per species id, packed contiguously. */
  private representatives: Float32Array;
  private repSlot = new Map<number, number>();
  private nextRepSlot = 0;
  private nextId = 1;
  private repCapacity: number;

  constructor(capacity = 2048) {
    this.repCapacity = capacity;
    this.representatives = new Float32Array(capacity * GENOME_LENGTH);
  }

  create(
    genome: Float32Array,
    genomeOff: number,
    ancestorId: number,
    tick: number,
    generation: number,
    hue: number,
  ): SpeciesRecord {
    const id = this.nextId++;
    if (this.nextRepSlot >= this.repCapacity) this.growRepresentatives();
    const slot = this.nextRepSlot++;
    this.repSlot.set(id, slot);
    const off = slot * GENOME_LENGTH;
    for (let i = 0; i < GENOME_LENGTH; i++) this.representatives[off + i] = genome[genomeOff + i];

    const rec: SpeciesRecord = {
      id,
      ancestorId,
      name: speciesName(id),
      originTick: tick,
      extinctTick: -1,
      population: 0,
      peakPopulation: 0,
      totalBorn: 0,
      totalDied: 0,
      generationOrigin: generation,
      hue,
      traits: new Float32Array(GENOME_LENGTH),
      descendants: [],
    };
    this.species.set(id, rec);
    const parent = this.species.get(ancestorId);
    if (parent) parent.descendants.push(id);
    return rec;
  }

  private growRepresentatives(): void {
    this.repCapacity *= 2;
    const next = new Float32Array(this.repCapacity * GENOME_LENGTH);
    next.set(this.representatives);
    this.representatives = next;
  }

  distanceToRepresentative(speciesId: number, genome: Float32Array, off: number): number {
    const slot = this.repSlot.get(speciesId);
    if (slot === undefined) return Infinity;
    return geneticDistance(genome, off, this.representatives, slot * GENOME_LENGTH);
  }

  representativeOffset(speciesId: number): number {
    const slot = this.repSlot.get(speciesId);
    return slot === undefined ? -1 : slot * GENOME_LENGTH;
  }

  get representativeBuffer(): Float32Array {
    return this.representatives;
  }

  /**
   * Classify an offspring. Returns the species it belongs to, creating a new
   * one if it has drifted past the threshold from its parent's representative.
   */
  classify(
    parentSpecies: number,
    genome: Float32Array,
    off: number,
    threshold: number,
    tick: number,
    generation: number,
    hue: number,
  ): number {
    const d = this.distanceToRepresentative(parentSpecies, genome, off);
    if (d <= threshold) return parentSpecies;
    return this.create(genome, off, parentSpecies, tick, generation, hue).id;
  }

  /**
   * Rebuild the registry from a saved payload. Representative slots are
   * assigned in creation order and ids increment in lockstep, so slot === id-1
   * always holds and does not need to be stored.
   */
  rehydrate(records: SpeciesRecord[], representatives: ArrayLike<number>): void {
    this.species.clear();
    this.repSlot.clear();
    let maxId = 0;
    for (const r of records) {
      this.species.set(r.id, r);
      this.repSlot.set(r.id, r.id - 1);
      if (r.id > maxId) maxId = r.id;
    }
    while (maxId * GENOME_LENGTH > this.representatives.length) this.growRepresentatives();
    this.representatives.set(representatives, 0);
    this.nextRepSlot = maxId;
    this.nextId = maxId + 1;
  }

  markExtinct(id: number, tick: number): void {
    const rec = this.species.get(id);
    if (rec && rec.extinctTick < 0) rec.extinctTick = tick;
  }

  livingSpecies(): SpeciesRecord[] {
    const out: SpeciesRecord[] = [];
    for (const s of this.species.values()) if (s.extinctTick < 0) out.push(s);
    return out;
  }

  extinctSpecies(): SpeciesRecord[] {
    const out: SpeciesRecord[] = [];
    for (const s of this.species.values()) if (s.extinctTick >= 0) out.push(s);
    return out;
  }
}

export function speciesName(id: number): string {
  const a = SYLLABLES_A[id % SYLLABLES_A.length];
  const b = SYLLABLES_B[(id * 7 + 3) % SYLLABLES_B.length];
  const n = Math.floor(id / (SYLLABLES_A.length * SYLLABLES_B.length));
  return (a + b).replace(/^./, (c) => c.toUpperCase()) + (n > 0 ? ` ${romanish(n)}` : '');
}

function romanish(n: number): string {
  const numerals: [number, string][] = [
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let out = '';
  let v = n;
  for (const [val, sym] of numerals) {
    while (v >= val) {
      out += sym;
      v -= val;
    }
  }
  return out || 'I';
}
