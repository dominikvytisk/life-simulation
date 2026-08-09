/**
 * Uniform-grid spatial index, rebuilt every tick by counting sort.
 *
 * Rebuild is O(N) with zero allocation after construction; a neighbourhood
 * query touches only the 3x3 (or larger) cell block around a point. This is the
 * single most important structure in the simulation — without it, sensing is
 * O(N^2) and the population ceiling is a few hundred organisms.
 *
 * Indices within a cell come out in ascending slot order, which keeps
 * neighbour iteration deterministic.
 */
export class SpatialHash {
  readonly cols: number;
  readonly rows: number;
  readonly cellSize: number;
  private readonly invCell: number;
  private readonly worldSize: number;

  /** cellStart[c] .. cellStart[c+1] indexes into `items`. */
  private readonly cellStart: Int32Array;
  private readonly cellCount: Int32Array;
  private readonly items: Int32Array;

  constructor(worldSize: number, cellSize: number, capacity: number) {
    this.worldSize = worldSize;
    this.cellSize = cellSize;
    this.invCell = 1 / cellSize;
    this.cols = Math.ceil(worldSize / cellSize);
    this.rows = this.cols;
    const cells = this.cols * this.rows;
    this.cellStart = new Int32Array(cells + 1);
    this.cellCount = new Int32Array(cells);
    this.items = new Int32Array(capacity);
  }

  private cellIndex(x: number, y: number): number {
    let cx = (x * this.invCell) | 0;
    let cy = (y * this.invCell) | 0;
    if (cx < 0) cx = 0;
    else if (cx >= this.cols) cx = this.cols - 1;
    if (cy < 0) cy = 0;
    else if (cy >= this.rows) cy = this.rows - 1;
    return cy * this.cols + cx;
  }

  /** Counting-sort rebuild over all live slots. */
  build(alive: Uint8Array, xs: Float32Array, ys: Float32Array, count: number): void {
    const cells = this.cols * this.rows;
    this.cellCount.fill(0);

    for (let i = 0; i < count; i++) {
      if (!alive[i]) continue;
      this.cellCount[this.cellIndex(xs[i], ys[i])]++;
    }

    let acc = 0;
    for (let c = 0; c < cells; c++) {
      this.cellStart[c] = acc;
      acc += this.cellCount[c];
    }
    this.cellStart[cells] = acc;

    // Reuse cellCount as a write cursor.
    this.cellCount.fill(0);
    for (let i = 0; i < count; i++) {
      if (!alive[i]) continue;
      const c = this.cellIndex(xs[i], ys[i]);
      this.items[this.cellStart[c] + this.cellCount[c]++] = i;
    }
  }

  /**
   * Visit every candidate within `radius` of (x, y).
   * The callback receives the slot index; distance filtering is the caller's
   * job (it usually needs the squared distance anyway).
   */
  forEachInRadius(x: number, y: number, radius: number, fn: (slot: number) => void): void {
    const r = Math.ceil(radius * this.invCell);
    let cx = (x * this.invCell) | 0;
    let cy = (y * this.invCell) | 0;
    if (cx < 0) cx = 0;
    else if (cx >= this.cols) cx = this.cols - 1;
    if (cy < 0) cy = 0;
    else if (cy >= this.rows) cy = this.rows - 1;

    const x0 = Math.max(0, cx - r);
    const x1 = Math.min(this.cols - 1, cx + r);
    const y0 = Math.max(0, cy - r);
    const y1 = Math.min(this.rows - 1, cy + r);

    for (let gy = y0; gy <= y1; gy++) {
      const row = gy * this.cols;
      for (let gx = x0; gx <= x1; gx++) {
        const c = row + gx;
        const start = this.cellStart[c];
        const end = this.cellStart[c + 1];
        for (let k = start; k < end; k++) fn(this.items[k]);
      }
    }
  }

  /**
   * Allocation-free query, filling `out` with candidate slots and returning how
   * many were written.
   *
   * Cells are visited in expanding rings (Chebyshev distance 0, 1, 2, …) rather
   * than in raster order. That matters when `out` fills up: in a dense cluster
   * the buffer is the organism's attention limit, and ring order means the
   * candidates it drops are the *far* ones. Raster order would instead silently
   * discard everything to the south-east, which is a directional bias in
   * perception that nothing in the model should have.
   *
   * Order within a ring is fixed, so the result stays deterministic.
   */
  queryInto(x: number, y: number, radius: number, out: Int32Array): number {
    const r = Math.ceil(radius * this.invCell);
    let cx = (x * this.invCell) | 0;
    let cy = (y * this.invCell) | 0;
    if (cx < 0) cx = 0;
    else if (cx >= this.cols) cx = this.cols - 1;
    if (cy < 0) cy = 0;
    else if (cy >= this.rows) cy = this.rows - 1;

    const cap = out.length;
    let n = 0;

    for (let ring = 0; ring <= r; ring++) {
      const minX = cx - ring;
      const maxX = cx + ring;
      const minY = cy - ring;
      const maxY = cy + ring;

      for (let gy = minY; gy <= maxY; gy++) {
        if (gy < 0 || gy >= this.rows) continue;
        const onHorizontalEdge = gy === minY || gy === maxY;
        const row = gy * this.cols;
        // Interior rows only contribute their two edge columns.
        const step = onHorizontalEdge ? 1 : maxX - minX === 0 ? 1 : maxX - minX;
        for (let gx = minX; gx <= maxX; gx += step) {
          if (gx < 0 || gx >= this.cols) continue;
          const c = row + gx;
          const end = this.cellStart[c + 1];
          for (let k = this.cellStart[c]; k < end; k++) {
            if (n >= cap) return n;
            out[n++] = this.items[k];
          }
        }
      }
    }
    return n;
  }

  get worldExtent(): number {
    return this.worldSize;
  }
}
