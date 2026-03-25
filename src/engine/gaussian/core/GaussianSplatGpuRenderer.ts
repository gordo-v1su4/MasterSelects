// WebGPU Gaussian Splat Renderer
// Renders splat data into GPU textures for compositor integration.
// Uses instanced quad rendering with 2D gaussian evaluation.

import { Logger } from '../../../services/logger';
import { SplatRenderTargetPool } from './SplatRenderTargetPool';
import shaderSource from '../shaders/gaussianSplat.wgsl?raw';

const log = Logger.create('GaussianSplatGpuRenderer');

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UploadableSplatData {
  splatCount: number;
  /** Canonical Float32Array: 14 floats per splat
   *  [x,y,z, sx,sy,sz, rw,rx,ry,rz, r,g,b, opacity] */
  data: Float32Array;
}

export interface SplatCameraParams {
  viewMatrix: Float32Array;       // 4x4 column-major
  projectionMatrix: Float32Array; // 4x4 column-major
  viewport: { width: number; height: number };
  fov: number;
  near: number;
  far: number;
}

interface SplatSceneGpuResources {
  splatBuffer: GPUBuffer;
  splatCount: number;
  bindGroup: GPUBindGroup;
}

// Camera uniform buffer size: 2 mat4x4f (128 bytes) + vec2f (8 bytes) + vec2f pad (8 bytes) = 144 bytes
const CAMERA_UNIFORM_SIZE = 144;

// Floats per splat in the canonical layout
const FLOATS_PER_SPLAT = 14;

// ── Renderer Class ────────────────────────────────────────────────────────────

export class GaussianSplatGpuRenderer {
  private device: GPUDevice | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private sceneCache: Map<string, SplatSceneGpuResources> = new Map();
  private cameraUniformBuffer: GPUBuffer | null = null;
  private renderTargetPool!: SplatRenderTargetPool;
  private _initialized = false;

  // Bind group layouts (shared across scenes)
  private splatDataBindGroupLayout: GPUBindGroupLayout | null = null;
  private cameraBindGroupLayout: GPUBindGroupLayout | null = null;
  private cameraBindGroup: GPUBindGroup | null = null;

  get isInitialized(): boolean {
    return this._initialized;
  }

  initialize(device: GPUDevice): void {
    if (this._initialized) {
      // If re-initializing with a different device, dispose old resources
      if (this.device !== device) {
        log.info('Device changed, re-initializing');
        this.disposeGpuResources();
      } else {
        return;
      }
    }

    this.device = device;

    try {
      this.createPipeline();
      this.createCameraBuffer();
      this.renderTargetPool = new SplatRenderTargetPool(device);
      this._initialized = true;
      log.info('GaussianSplatGpuRenderer initialized');
    } catch (err) {
      log.error('Failed to initialize GaussianSplatGpuRenderer', err);
      this.device = null;
      this._initialized = false;
    }
  }

  /** Upload splat data for a clip. Called once per clip (or on temporal frame change). */
  uploadScene(clipId: string, data: UploadableSplatData): boolean {
    if (!this._initialized || !this.device) {
      log.warn('Cannot upload scene: renderer not initialized');
      return false;
    }

    if (data.splatCount <= 0 || data.data.length < data.splatCount * FLOATS_PER_SPLAT) {
      log.warn('Invalid splat data', {
        clipId,
        splatCount: data.splatCount,
        dataLength: data.data.length,
        expected: data.splatCount * FLOATS_PER_SPLAT,
      });
      return false;
    }

    try {
      // Release existing scene for this clip
      this.releaseScene(clipId);

      const bufferSize = data.splatCount * FLOATS_PER_SPLAT * 4; // 4 bytes per float

      const splatBuffer = this.device.createBuffer({
        size: bufferSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        label: `splat-data-${clipId}`,
      });

      // Write the raw ArrayBuffer to the GPU (avoids TS 5.9 Float32Array<ArrayBufferLike> compat issue)
      const byteOffset = data.data.byteOffset;
      const byteLength = data.splatCount * FLOATS_PER_SPLAT * 4;
      this.device.queue.writeBuffer(splatBuffer, 0, data.data.buffer, byteOffset, byteLength);

      const bindGroup = this.device.createBindGroup({
        layout: this.splatDataBindGroupLayout!,
        entries: [
          { binding: 0, resource: { buffer: splatBuffer } },
        ],
        label: `splat-bind-group-${clipId}`,
      });

      this.sceneCache.set(clipId, {
        splatBuffer,
        splatCount: data.splatCount,
        bindGroup,
      });

      log.debug('Uploaded scene', { clipId, splatCount: data.splatCount, bufferSize });
      return true;
    } catch (err) {
      log.error('Failed to upload scene', { clipId, error: err });
      return false;
    }
  }

  /** Release GPU resources for a clip */
  releaseScene(clipId: string): void {
    const scene = this.sceneCache.get(clipId);
    if (scene) {
      scene.splatBuffer.destroy();
      this.sceneCache.delete(clipId);
      log.debug('Released scene', { clipId });
    }
  }

  /** Render one splat layer into a GPU texture. Returns textureView or null. */
  renderToTexture(
    clipId: string,
    camera: SplatCameraParams,
    viewport: { width: number; height: number },
    commandEncoder: GPUCommandEncoder,
  ): GPUTextureView | null {
    if (!this._initialized || !this.device || !this.pipeline) {
      return null;
    }

    const scene = this.sceneCache.get(clipId);
    if (!scene) {
      log.debug('No scene uploaded for clip', { clipId });
      return null;
    }

    if (viewport.width <= 0 || viewport.height <= 0) {
      return null;
    }

    try {
      // Update camera uniforms
      this.writeCameraUniforms(camera);

      // Acquire render target from pool
      const { view: targetView } = this.renderTargetPool.acquire(viewport.width, viewport.height);

      // Create render pass
      const passEncoder = commandEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: targetView,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
        label: `splat-render-pass-${clipId}`,
      });

      passEncoder.setPipeline(this.pipeline);
      passEncoder.setBindGroup(0, scene.bindGroup);
      passEncoder.setBindGroup(1, this.cameraBindGroup!);

      // Instanced draw: 4 vertices per quad, one instance per splat
      passEncoder.draw(4, scene.splatCount, 0, 0);
      passEncoder.end();

      return targetView;
    } catch (err) {
      log.error('renderToTexture failed', { clipId, error: err });
      return null;
    }
  }

  /** Called at start of each frame to reset per-frame state */
  beginFrame(): void {
    if (this.renderTargetPool) {
      this.renderTargetPool.resetFrame();
    }
  }

  hasScene(clipId: string): boolean {
    return this.sceneCache.has(clipId);
  }

  dispose(): void {
    this.disposeGpuResources();
    this.device = null;
    this._initialized = false;
    log.info('GaussianSplatGpuRenderer disposed');
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private disposeGpuResources(): void {
    // Release all scenes
    for (const [clipId, scene] of this.sceneCache) {
      scene.splatBuffer.destroy();
      log.debug('Disposed scene buffer', { clipId });
    }
    this.sceneCache.clear();

    // Dispose camera buffer
    if (this.cameraUniformBuffer) {
      this.cameraUniformBuffer.destroy();
      this.cameraUniformBuffer = null;
    }

    // Dispose render target pool
    if (this.renderTargetPool) {
      this.renderTargetPool.dispose();
    }

    // Nullify pipeline and layouts (they don't need explicit destruction)
    this.pipeline = null;
    this.splatDataBindGroupLayout = null;
    this.cameraBindGroupLayout = null;
    this.cameraBindGroup = null;
  }

  private createPipeline(): void {
    if (!this.device) return;

    const shaderModule = this.device.createShaderModule({
      code: shaderSource,
      label: 'gaussian-splat-shader',
    });

    // Group 0: splat data storage buffer
    this.splatDataBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' },
        },
      ],
      label: 'splat-data-bind-group-layout',
    });

    // Group 1: camera uniforms
    this.cameraBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'uniform' },
        },
      ],
      label: 'splat-camera-bind-group-layout',
    });

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.splatDataBindGroupLayout, this.cameraBindGroupLayout],
      label: 'gaussian-splat-pipeline-layout',
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format: 'rgba8unorm',
            blend: {
              color: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
          },
        ],
      },
      primitive: {
        topology: 'triangle-strip',
        stripIndexFormat: undefined,
      },
      label: 'gaussian-splat-render-pipeline',
    });

    log.debug('Render pipeline created');
  }

  private createCameraBuffer(): void {
    if (!this.device) return;

    this.cameraUniformBuffer = this.device.createBuffer({
      size: CAMERA_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'splat-camera-uniforms',
    });

    this.cameraBindGroup = this.device.createBindGroup({
      layout: this.cameraBindGroupLayout!,
      entries: [
        { binding: 0, resource: { buffer: this.cameraUniformBuffer } },
      ],
      label: 'splat-camera-bind-group',
    });
  }

  private writeCameraUniforms(camera: SplatCameraParams): void {
    if (!this.device || !this.cameraUniformBuffer) return;

    // Layout: mat4x4f view (64 bytes) + mat4x4f projection (64 bytes) + vec2f viewport (8 bytes) + vec2f pad (8 bytes)
    const data = new Float32Array(CAMERA_UNIFORM_SIZE / 4);

    // Copy view matrix (16 floats at offset 0)
    data.set(camera.viewMatrix, 0);

    // Copy projection matrix (16 floats at offset 16)
    data.set(camera.projectionMatrix, 16);

    // Viewport (2 floats at offset 32)
    data[32] = camera.viewport.width;
    data[33] = camera.viewport.height;

    // Padding (2 floats at offset 34) — zero-initialized by Float32Array

    this.device.queue.writeBuffer(this.cameraUniformBuffer, 0, data);
  }
}

// ── HMR Singleton ─────────────────────────────────────────────────────────────

let instance: GaussianSplatGpuRenderer | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  if (import.meta.hot.data?.gaussianSplatGpuRenderer) {
    instance = import.meta.hot.data.gaussianSplatGpuRenderer;
  }
  import.meta.hot.dispose((data) => {
    data.gaussianSplatGpuRenderer = instance;
  });
}

export function getGaussianSplatGpuRenderer(): GaussianSplatGpuRenderer {
  if (!instance) instance = new GaussianSplatGpuRenderer();
  return instance;
}
