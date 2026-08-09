/**
 * WebGPU backend.
 *
 * Per frame it does exactly two draw calls: one full-world textured quad for
 * the environment, one instanced quad for every organism. Instance data is the
 * simulation's snapshot buffer uploaded verbatim — there is no per-organism
 * JavaScript work in the render path at all, which is what allows the organism
 * count to grow without the frame rate following it.
 */
import { SNAPSHOT_STRIDE } from '../sim/core/types';
import { ORGANISM_WGSL } from './shaders/organisms';
import { TERRAIN_WGSL } from './shaders/terrain';
import type { Camera, LifeRenderer } from './renderer';

const UNIFORM_FLOATS = 8; // vec2 center, scale, time, vec2 viewport, worldSize, pad

export class WebGPURenderer implements LifeRenderer {
  readonly backend = 'webgpu' as const;

  private device: GPUDevice;
  private context: GPUCanvasContext;
  private canvas: HTMLCanvasElement;

  private uniformBuffer: GPUBuffer;
  private uniformData = new Float32Array(UNIFORM_FLOATS);

  private terrainTexture: GPUTexture;
  private terrainSampler: GPUSampler;
  private terrainGrid = 0;
  private terrainPipeline: GPURenderPipeline;
  private terrainBindGroup!: GPUBindGroup;
  private terrainBindGroupLayout: GPUBindGroupLayout;

  private organismPipeline: GPURenderPipeline;
  private organismBindGroup: GPUBindGroup;
  private instanceBuffer: GPUBuffer;
  private instanceCapacity = 0;

  private destroyed = false;

  private constructor(
    canvas: HTMLCanvasElement,
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
  ) {
    this.canvas = canvas;
    this.device = device;
    this.context = context;

    this.uniformBuffer = device.createBuffer({
      size: UNIFORM_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.terrainSampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
    });
    // Placeholder until the first terrain payload arrives.
    this.terrainTexture = this.createTerrainTexture(1);

    // ---- terrain pipeline ----
    this.terrainBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });
    const terrainModule = device.createShaderModule({ code: TERRAIN_WGSL, label: 'terrain' });
    this.terrainPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.terrainBindGroupLayout] }),
      vertex: { module: terrainModule, entryPoint: 'vs' },
      fragment: { module: terrainModule, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    this.rebuildTerrainBindGroup();

    // ---- organism pipeline ----
    const organismLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    const organismModule = device.createShaderModule({ code: ORGANISM_WGSL, label: 'organisms' });
    const stride = SNAPSHOT_STRIDE * 4;
    this.organismPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [organismLayout] }),
      vertex: {
        module: organismModule,
        entryPoint: 'vs',
        buffers: [
          {
            arrayStride: stride,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' }, // x, y
              { shaderLocation: 1, offset: 8, format: 'float32x2' }, // heading, radius
              { shaderLocation: 2, offset: 16, format: 'float32x2' }, // hue, energy
              { shaderLocation: 3, offset: 24, format: 'float32x3' }, // elongation, diet, armor
              { shaderLocation: 4, offset: 36, format: 'float32' }, // flags
            ],
          },
        ],
      },
      fragment: {
        module: organismModule,
        entryPoint: 'fs',
        targets: [
          {
            format,
            blend: {
              // Premultiplied-style additive-over blend: overlapping glows sum
              // instead of flickering, which is what makes swarms readable.
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
    });
    this.organismBindGroup = device.createBindGroup({
      layout: organismLayout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });

    this.instanceBuffer = this.createInstanceBuffer(4096);
  }

  static async create(canvas: HTMLCanvasElement): Promise<WebGPURenderer | null> {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu');
    if (!context) return null;
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });
    device.lost.then((info) => {
      if (info.reason !== 'destroyed') console.error('[LIFE] WebGPU device lost:', info.message);
    });
    return new WebGPURenderer(canvas, device, context, format);
  }

  private createTerrainTexture(grid: number): GPUTexture {
    this.terrainGrid = grid;
    return this.device.createTexture({
      size: [grid, grid, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  private rebuildTerrainBindGroup(): void {
    this.terrainBindGroup = this.device.createBindGroup({
      layout: this.terrainBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.terrainTexture.createView() },
        { binding: 2, resource: this.terrainSampler },
      ],
    });
  }

  private createInstanceBuffer(capacity: number): GPUBuffer {
    this.instanceCapacity = capacity;
    return this.device.createBuffer({
      size: capacity * SNAPSHOT_STRIDE * 4,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }

  resize(width: number, height: number, dpr: number): void {
    const w = Math.max(1, Math.floor(width * dpr));
    const h = Math.max(1, Math.floor(height * dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  updateTerrain(pixels: Uint8ClampedArray<ArrayBuffer>, grid: number): void {
    if (this.destroyed) return;
    if (grid !== this.terrainGrid) {
      this.terrainTexture.destroy();
      this.terrainTexture = this.createTerrainTexture(grid);
      this.rebuildTerrainBindGroup();
    }
    this.device.queue.writeTexture(
      { texture: this.terrainTexture },
      pixels,
      { bytesPerRow: grid * 4, rowsPerImage: grid },
      { width: grid, height: grid },
    );
  }

  render(
    snapshot: Float32Array,
    count: number,
    camera: Camera,
    worldSize: number,
    time: number,
  ): void {
    if (this.destroyed) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (w === 0 || h === 0) return;

    const u = this.uniformData;
    u[0] = camera.x;
    u[1] = camera.y;
    u[2] = camera.scale;
    u[3] = time;
    u[4] = w;
    u[5] = h;
    u[6] = worldSize;
    u[7] = 0;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, u);

    if (count > this.instanceCapacity) {
      this.instanceBuffer.destroy();
      this.instanceBuffer = this.createInstanceBuffer(Math.ceil(count * 1.4));
    }
    if (count > 0) {
      // Upload only the populated prefix of the snapshot.
      this.device.queue.writeBuffer(
        this.instanceBuffer,
        0,
        snapshot.buffer,
        snapshot.byteOffset,
        count * SNAPSHOT_STRIDE * 4,
      );
    }

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0.02, g: 0.03, b: 0.05, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    pass.setPipeline(this.terrainPipeline);
    pass.setBindGroup(0, this.terrainBindGroup);
    pass.draw(6);

    if (count > 0) {
      pass.setPipeline(this.organismPipeline);
      pass.setBindGroup(0, this.organismBindGroup);
      pass.setVertexBuffer(0, this.instanceBuffer);
      pass.draw(6, count);
    }

    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    this.destroyed = true;
    this.instanceBuffer.destroy();
    this.terrainTexture.destroy();
    this.uniformBuffer.destroy();
    this.device.destroy();
  }
}
