/** Shared renderer contract. Two backends implement it: WebGPU (preferred) and
 * Canvas2D (fallback, still usable for a few thousand organisms). */

export interface Camera {
  x: number; // world-space centre
  y: number;
  scale: number; // screen pixels per world unit
}

export interface LifeRenderer {
  readonly backend: 'webgpu' | 'canvas2d';
  resize(width: number, height: number, dpr: number): void;
  /** Non-shared buffer required: it is uploaded straight to a GPU texture. */
  updateTerrain(pixels: Uint8ClampedArray<ArrayBuffer>, grid: number): void;
  render(snapshot: Float32Array, count: number, camera: Camera, worldSize: number, time: number): void;
  destroy(): void;
}

export async function createRenderer(canvas: HTMLCanvasElement): Promise<LifeRenderer> {
  if ('gpu' in navigator) {
    try {
      const { WebGPURenderer } = await import('./webgpuRenderer');
      const r = await WebGPURenderer.create(canvas);
      if (r) return r;
    } catch (err) {
      console.warn('[LIFE] WebGPU unavailable, falling back to Canvas2D:', err);
    }
  }
  const { Canvas2DRenderer } = await import('./canvasRenderer');
  return new Canvas2DRenderer(canvas);
}
