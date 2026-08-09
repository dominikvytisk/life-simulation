/**
 * Canvas2D fallback for machines without WebGPU.
 *
 * Deliberately simpler than the GPU path — the goal is that the simulation
 * remains observable everywhere, not that it looks identical. Two concessions
 * keep it usable: organisms below a few pixels are drawn as plain dots instead
 * of shaped bodies, and the terrain texture is blitted through an offscreen
 * canvas so the browser handles the scaling.
 */
import { SNAPSHOT_STRIDE, SnapshotField, SnapshotFlag } from '../sim/core/types';
import type { Camera, LifeRenderer } from './renderer';

export class Canvas2DRenderer implements LifeRenderer {
  readonly backend = 'canvas2d' as const;
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private terrainCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private terrainCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  private terrainGrid = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas2D not available');
    this.ctx = ctx;
  }

  resize(width: number, height: number, dpr: number): void {
    this.canvas.width = Math.max(1, Math.floor(width * dpr));
    this.canvas.height = Math.max(1, Math.floor(height * dpr));
  }

  updateTerrain(pixels: Uint8ClampedArray<ArrayBuffer>, grid: number): void {
    if (!this.terrainCanvas || this.terrainGrid !== grid) {
      this.terrainGrid = grid;
      this.terrainCanvas =
        typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(grid, grid)
          : Object.assign(document.createElement('canvas'), { width: grid, height: grid });
      this.terrainCtx = (this.terrainCanvas as HTMLCanvasElement).getContext('2d') as
        | CanvasRenderingContext2D
        | OffscreenCanvasRenderingContext2D;
    }
    this.terrainCtx?.putImageData(new ImageData(pixels, grid, grid), 0, 0);
  }

  render(
    snapshot: Float32Array,
    count: number,
    camera: Camera,
    worldSize: number,
    time: number,
  ): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05070c';
    ctx.fillRect(0, 0, w, h);

    const s = camera.scale;
    const ox = w / 2 - camera.x * s;
    const oy = h / 2 - camera.y * s;

    if (this.terrainCanvas) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.terrainCanvas as CanvasImageSource, ox, oy, worldSize * s, worldSize * s);
    }

    const pulse = 0.5 + 0.5 * Math.sin(time * 6);
    ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < count; i++) {
      const o = i * SNAPSHOT_STRIDE;
      const x = snapshot[o + SnapshotField.X] * s + ox;
      const y = snapshot[o + SnapshotField.Y] * s + oy;
      const r = Math.max(1.2, snapshot[o + SnapshotField.Radius] * s);
      if (x < -r || y < -r || x > w + r || y > h + r) continue;

      const hue = snapshot[o + SnapshotField.Hue];
      const energy = snapshot[o + SnapshotField.EnergyFraction];
      const diet = snapshot[o + SnapshotField.Diet];
      const flags = snapshot[o + SnapshotField.Flags];

      const hueDeg = (hue * 360 + diet * -40 + 360) % 360;
      const light = 32 + energy * 26;
      ctx.fillStyle = `hsl(${hueDeg} ${45 + diet * 30}% ${light}%)`;

      if (r < 2.5) {
        ctx.fillRect(x - r * 0.5, y - r * 0.5, r, r);
        continue;
      }

      const heading = snapshot[o + SnapshotField.Heading];
      const elong = snapshot[o + SnapshotField.Elongation];
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(heading);
      ctx.beginPath();
      ctx.ellipse(0, 0, r * (1 + elong * 0.65), r * (1 - elong * 0.25), 0, 0, Math.PI * 2);
      ctx.fill();

      if (flags & SnapshotFlag.Attacking) {
        ctx.fillStyle = 'rgba(255,90,60,0.55)';
        ctx.fill();
      }
      if (flags & SnapshotFlag.Signalling) {
        ctx.strokeStyle = `rgba(90,150,255,${0.25 + pulse * 0.4})`;
        ctx.lineWidth = Math.max(1, r * 0.25);
        ctx.stroke();
      }
      ctx.restore();

      if (flags & SnapshotFlag.Selected) {
        ctx.strokeStyle = '#eaf4ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r * 2.2 + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  destroy(): void {
    this.terrainCanvas = null;
    this.terrainCtx = null;
  }
}
