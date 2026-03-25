// Gaussian splat module — public API

// Existing gaussian-avatar renderer (WebGL canvas-copy bridge)
export { GaussianSplatSceneRenderer, getGaussianSplatSceneRenderer } from './GaussianSplatSceneRenderer';

// Loader stack
export {
  loadGaussianSplatAsset,
  loadGaussianSplatAssetCached,
  parseGaussianSplatHeader,
  getSplatCache,
  detectFormat,
} from './loaders';

export type {
  GaussianSplatFormat,
  GaussianSplatMetadata,
  GaussianSplatBuffer,
  GaussianSplatFrame,
  GaussianSplatAsset,
  SplatCache,
} from './loaders';

// WebGPU GPU renderer core
export { GaussianSplatGpuRenderer, getGaussianSplatGpuRenderer } from './core/GaussianSplatGpuRenderer';
export type { UploadableSplatData, SplatCameraParams } from './core/GaussianSplatGpuRenderer';
export { SplatRenderTargetPool } from './core/SplatRenderTargetPool';
export { buildSplatCamera } from './core/SplatCameraUtils';
