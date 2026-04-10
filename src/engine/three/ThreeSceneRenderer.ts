// Three.js 3D Scene Renderer - renders 3D-enabled layers to an OffscreenCanvas.
// The output is imported into the existing WebGPU compositor as a texture.

import { Logger } from '../../services/logger';
import type { Layer3DData, CameraConfig } from './types';
import { DEFAULT_CAMERA_CONFIG } from './types';
import { loadGaussianSplatAsset } from '../gaussian/loaders';
import type { GaussianSplatAsset, GaussianSplatFormat } from '../gaussian/loaders';

const log = Logger.create('ThreeSceneRenderer');

type THREE = typeof import('three');
type SplatShaderMaterial = import('three').ShaderMaterial & {
  uniforms: {
    uOpacity: { value: number };
    uSplatScale: { value: number };
    uViewportSize: { value: import('three').Vector2 };
  };
};

interface ManagedMesh {
  mesh: import('three').Mesh | import('three').Group;
  texture: import('three').Texture | import('three').VideoTexture;
  layerId: string;
  lastSourceType: 'video' | 'image' | 'canvas' | 'model' | null;
  planeW: number;
  planeH: number;
  isModel?: boolean;
  modelUrl?: string;
}

interface ManagedSplat {
  layerId: string;
  mesh: import('three').Mesh;
  geometry: import('three').InstancedBufferGeometry;
  material: SplatShaderMaterial;
  splatUrl?: string;
  loadPromise: Promise<void> | null;
  splatCount: number;
  centers: Float32Array;
  colors: Float32Array;
  opacities: Float32Array;
  axisX: Float32Array;
  axisY: Float32Array;
  axisZ: Float32Array;
  sortIndices: number[];
  sortDepths: Float32Array;
  lastSortCameraPosition: [number, number, number] | null;
  lastSortCameraDirection: [number, number, number] | null;
  sortFrame: number;
}

const modelCache = new Map<string, import('three').Group>();
const modelLoading = new Set<string>();
const splatAssetCache = new Map<string, Promise<GaussianSplatAsset>>();
const DEFAULT_THREE_SPLAT_BUDGET = 60000;

export class ThreeSceneRenderer {
  private THREE: THREE | null = null;
  private renderer: import('three').WebGLRenderer | null = null;
  private scene: import('three').Scene | null = null;
  private camera: import('three').PerspectiveCamera | null = null;
  private canvas: OffscreenCanvas | null = null;
  private meshes = new Map<string, ManagedMesh>();
  private splatObjects = new Map<string, ManagedSplat>();
  private width = 0;
  private height = 0;
  private initialized = false;
  private modelFileNames = new Map<string, string>();

  async initialize(width: number, height: number): Promise<boolean> {
    if (this.initialized && this.width === width && this.height === height) {
      return true;
    }

    try {
      if (!this.THREE) {
        log.info('Loading Three.js...');
        this.THREE = await import('three');
        log.info('Three.js loaded', { version: this.THREE.REVISION });
      }

      const T = this.THREE;
      this.width = width;
      this.height = height;

      if (!this.canvas) {
        this.canvas = new OffscreenCanvas(width, height);
      } else {
        this.canvas.width = width;
        this.canvas.height = height;
      }

      if (!this.renderer) {
        this.renderer = new T.WebGLRenderer({
          canvas: this.canvas as unknown as HTMLCanvasElement,
          alpha: true,
          antialias: true,
          premultipliedAlpha: false,
        });
        this.renderer.setClearColor(0x000000, 0);
      }
      this.renderer.setSize(width, height, false);

      if (!this.scene) {
        this.scene = new T.Scene();
        const ambient = new T.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambient);
        const directional = new T.DirectionalLight(0xffffff, 0.8);
        directional.position.set(1, 2, 3);
        this.scene.add(directional);
      }

      if (!this.camera) {
        this.camera = new T.PerspectiveCamera(
          DEFAULT_CAMERA_CONFIG.fov,
          width / height,
          DEFAULT_CAMERA_CONFIG.near,
          DEFAULT_CAMERA_CONFIG.far,
        );
        this.camera.position.set(
          DEFAULT_CAMERA_CONFIG.position.x,
          DEFAULT_CAMERA_CONFIG.position.y,
          DEFAULT_CAMERA_CONFIG.position.z,
        );
        this.camera.up.set(
          DEFAULT_CAMERA_CONFIG.up?.x ?? 0,
          DEFAULT_CAMERA_CONFIG.up?.y ?? 1,
          DEFAULT_CAMERA_CONFIG.up?.z ?? 0,
        );
        this.camera.lookAt(
          DEFAULT_CAMERA_CONFIG.target.x,
          DEFAULT_CAMERA_CONFIG.target.y,
          DEFAULT_CAMERA_CONFIG.target.z,
        );
      }

      this.initialized = true;
      log.info('ThreeSceneRenderer initialized', { width, height });
      return true;
    } catch (err) {
      log.error('Failed to initialize ThreeSceneRenderer', err);
      return false;
    }
  }

  private getCameraZForFill(fovDeg: number, planeH: number): number {
    return planeH / (2 * Math.tan((fovDeg * Math.PI / 180) / 2));
  }

  private resolveGaussianSplatFormat(fileName?: string, url?: string): GaussianSplatFormat | undefined {
    const candidate = (fileName || url || '').toLowerCase();
    if (candidate.endsWith('.ply')) return 'ply';
    if (candidate.endsWith('.splat')) return 'splat';
    if (candidate.endsWith('.ksplat')) return 'ksplat';

    return undefined;
  }

  private createSplatMaterial(T: THREE): SplatShaderMaterial {
    return new T.ShaderMaterial({
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
      uniforms: {
        uOpacity: { value: 1 },
        uSplatScale: { value: 1 },
        uViewportSize: { value: new T.Vector2(Math.max(this.width, 1), Math.max(this.height, 1)) },
      },
      vertexShader: `
        attribute vec3 instanceCenter;
        attribute vec3 instanceColor;
        attribute float instanceOpacity;
        attribute vec3 instanceAxisX;
        attribute vec3 instanceAxisY;
        attribute vec3 instanceAxisZ;

        varying vec3 vColor;
        varying float vOpacity;
        varying vec2 vLocalCoord;
        uniform float uSplatScale;
        uniform vec2 uViewportSize;

        vec2 projectAxisFromCamera(vec3 centerCam, vec3 axisCam, vec2 ndcCenter) {
          vec4 clipAxis = projectionMatrix * vec4(centerCam + axisCam, 1.0);
          float safeW = max(abs(clipAxis.w), 1e-6);
          return clipAxis.xy / safeW - ndcCenter;
        }

        void main() {
          vColor = instanceColor;
          vOpacity = instanceOpacity;
          vLocalCoord = position.xy;

          vec4 centerCam4 = modelViewMatrix * vec4(instanceCenter, 1.0);
          vec3 centerCam = centerCam4.xyz;
          vec3 axisCamX = mat3(modelViewMatrix) * (instanceAxisX * uSplatScale);
          vec3 axisCamY = mat3(modelViewMatrix) * (instanceAxisY * uSplatScale);
          vec3 axisCamZ = mat3(modelViewMatrix) * (instanceAxisZ * uSplatScale);
          float supportRadius = max(length(axisCamX), max(length(axisCamY), length(axisCamZ)));
          float viewDepth = -centerCam.z;
          if (viewDepth <= max(0.01, supportRadius * 1.5)) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            vOpacity = 0.0;
            return;
          }

          vec4 clipCenter = projectionMatrix * centerCam4;
          float safeW = max(abs(clipCenter.w), 1e-6);
          vec2 ndcCenter = clipCenter.xy / safeW;

          vec2 dx = projectAxisFromCamera(centerCam, axisCamX, ndcCenter);
          vec2 dy = projectAxisFromCamera(centerCam, axisCamY, ndcCenter);
          vec2 dz = projectAxisFromCamera(centerCam, axisCamZ, ndcCenter);

          float c00 = dx.x * dx.x + dy.x * dy.x + dz.x * dz.x;
          float c01 = dx.x * dx.y + dy.x * dy.y + dz.x * dz.y;
          float c11 = dx.y * dx.y + dy.y * dy.y + dz.y * dz.y;

          float trace = c00 + c11;
          float determinant = c00 * c11 - c01 * c01;
          float discriminant = sqrt(max(trace * trace * 0.25 - determinant, 0.0));
          float lambda1 = max(trace * 0.5 + discriminant, 1e-8);
          float lambda2 = max(trace * 0.5 - discriminant, 1e-8);

          vec2 eigenVector1 = abs(c01) > 1e-6
            ? normalize(vec2(c01, lambda1 - c00))
            : vec2(1.0, 0.0);
          vec2 eigenVector2 = vec2(-eigenVector1.y, eigenVector1.x);

          float sigmaExtent = 1.6;
          vec2 ndcAxis1 = eigenVector1 * sqrt(lambda1) * sigmaExtent;
          vec2 ndcAxis2 = eigenVector2 * sqrt(lambda2) * sigmaExtent;
          float minAxisLen = 1.75 / max(min(uViewportSize.x, uViewportSize.y), 1.0);
          float maxAxisLen = 0.12;
          float axis1Len = clamp(length(ndcAxis1), minAxisLen, maxAxisLen);
          float axis2Len = clamp(length(ndcAxis2), minAxisLen, maxAxisLen);
          ndcAxis1 = (length(ndcAxis1) > 1e-6 ? normalize(ndcAxis1) : vec2(1.0, 0.0)) * axis1Len;
          ndcAxis2 = (length(ndcAxis2) > 1e-6 ? normalize(ndcAxis2) : vec2(0.0, 1.0)) * axis2Len;
          vec2 ndcOffset = position.x * ndcAxis1 + position.y * ndcAxis2;

          gl_Position = clipCenter;
          gl_Position.xy += ndcOffset * safeW;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vOpacity;
        varying vec2 vLocalCoord;
        uniform float uOpacity;

        void main() {
          vec2 sigmaCoord = vLocalCoord * 2.25;
          float radius2 = dot(sigmaCoord, sigmaCoord);
          float alpha = exp(-0.5 * radius2) * vOpacity * uOpacity;
          if (alpha <= 0.002) discard;

          gl_FragColor = vec4(vColor * alpha, alpha);
        }
      `,
    }) as SplatShaderMaterial;
  }

  private createManagedSplat(T: THREE, layerId: string): ManagedSplat {
    const geometry = new T.InstancedBufferGeometry();
    geometry.setAttribute(
      'position',
      new T.Float32BufferAttribute([
        -1, -1, 0,
         1, -1, 0,
         1,  1, 0,
        -1,  1, 0,
      ], 3),
    );
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('instanceCenter', new T.InstancedBufferAttribute(new Float32Array(), 3));
    geometry.setAttribute('instanceColor', new T.InstancedBufferAttribute(new Float32Array(), 3));
    geometry.setAttribute('instanceOpacity', new T.InstancedBufferAttribute(new Float32Array(), 1));
    geometry.setAttribute('instanceAxisX', new T.InstancedBufferAttribute(new Float32Array(), 3));
    geometry.setAttribute('instanceAxisY', new T.InstancedBufferAttribute(new Float32Array(), 3));
    geometry.setAttribute('instanceAxisZ', new T.InstancedBufferAttribute(new Float32Array(), 3));
    geometry.instanceCount = 0;

    const material = this.createSplatMaterial(T);
    const mesh = new T.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;

    return {
      layerId,
      mesh,
      geometry,
      material,
      loadPromise: null,
      splatCount: 0,
      centers: new Float32Array(),
      colors: new Float32Array(),
      opacities: new Float32Array(),
      axisX: new Float32Array(),
      axisY: new Float32Array(),
      axisZ: new Float32Array(),
      sortIndices: [],
      sortDepths: new Float32Array(),
      lastSortCameraPosition: null,
      lastSortCameraDirection: null,
      sortFrame: 0,
    };
  }

  private async loadGaussianSplatAssetForLayer(layer: Layer3DData): Promise<GaussianSplatAsset> {
    if (!layer.gaussianSplatUrl) {
      throw new Error('Gaussian splat layer is missing a source URL');
    }

    const cacheKey = `${layer.gaussianSplatFileName || layer.gaussianSplatUrl}|${layer.gaussianSplatUrl}`;
    const cached = splatAssetCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const promise = (async () => {
      const response = await fetch(layer.gaussianSplatUrl!);
      if (!response.ok) {
        throw new Error(`Failed to fetch gaussian splat asset: HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const fileName = layer.gaussianSplatFileName || 'scene.ply';
      const file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
      const format = this.resolveGaussianSplatFormat(fileName, layer.gaussianSplatUrl);
      return await loadGaussianSplatAsset(file, format);
    })();

    splatAssetCache.set(cacheKey, promise);
    return promise;
  }

  private async populateSplatGeometry(
    T: THREE,
    managed: ManagedSplat,
    layer: Layer3DData,
  ): Promise<void> {
    const asset = await this.loadGaussianSplatAssetForLayer(layer);
    const frame = asset.frames[0];
    if (!frame) {
      throw new Error('Gaussian splat asset has no frames');
    }

    const canonical = frame.buffer.data;
    const totalSplats = frame.buffer.splatCount;
    const requestedMaxSplats = layer.gaussianSplatSettings?.render.maxSplats ?? 0;
    const targetMaxSplats = requestedMaxSplats > 0 ? requestedMaxSplats : DEFAULT_THREE_SPLAT_BUDGET;
    const stride = totalSplats > targetMaxSplats
      ? Math.ceil(totalSplats / targetMaxSplats)
      : 1;
    const splatCount = Math.ceil(totalSplats / stride);

    const centers = new Float32Array(splatCount * 3);
    const colors = new Float32Array(splatCount * 3);
    const opacities = new Float32Array(splatCount);
    const axisX = new Float32Array(splatCount * 3);
    const axisY = new Float32Array(splatCount * 3);
    const axisZ = new Float32Array(splatCount * 3);

    let outIndex = 0;
    for (let splatIndex = 0; splatIndex < totalSplats; splatIndex += stride) {
      const base = splatIndex * 14;
      const target = outIndex * 3;
      const px = canonical[base + 0];
      const py = canonical[base + 1];
      const pz = canonical[base + 2];
      const sx = Math.max(canonical[base + 3], 0.0005);
      const sy = Math.max(canonical[base + 4], 0.0005);
      const sz = Math.max(canonical[base + 5], 0.0005);
      const qw = canonical[base + 6];
      const qx = canonical[base + 7];
      const qy = canonical[base + 8];
      const qz = canonical[base + 9];

      const xx = 1 - 2 * (qy * qy + qz * qz);
      const xy = 2 * (qx * qy - qz * qw);
      const xz = 2 * (qx * qz + qy * qw);
      const yx = 2 * (qx * qy + qz * qw);
      const yy = 1 - 2 * (qx * qx + qz * qz);
      const yz = 2 * (qy * qz - qx * qw);
      const zx = 2 * (qx * qz - qy * qw);
      const zy = 2 * (qy * qz + qx * qw);
      const zz = 1 - 2 * (qx * qx + qy * qy);

      centers[target + 0] = px;
      centers[target + 1] = py;
      centers[target + 2] = pz;

      colors[target + 0] = Math.max(0, Math.min(1, canonical[base + 10]));
      colors[target + 1] = Math.max(0, Math.min(1, canonical[base + 11]));
      colors[target + 2] = Math.max(0, Math.min(1, canonical[base + 12]));
      opacities[outIndex] = Math.max(0, Math.min(1, canonical[base + 13]));

      axisX[target + 0] = xx * sx;
      axisX[target + 1] = yx * sx;
      axisX[target + 2] = zx * sx;
      axisY[target + 0] = xy * sy;
      axisY[target + 1] = yy * sy;
      axisY[target + 2] = zy * sy;
      axisZ[target + 0] = xz * sz;
      axisZ[target + 1] = yz * sz;
      axisZ[target + 2] = zz * sz;

      outIndex += 1;
    }

    managed.centers = centers;
    managed.colors = colors;
    managed.opacities = opacities;
    managed.axisX = axisX;
    managed.axisY = axisY;
    managed.axisZ = axisZ;
    managed.splatCount = splatCount;
    managed.sortIndices = Array.from({ length: splatCount }, (_, index) => index);
    managed.sortDepths = new Float32Array(splatCount);
    managed.lastSortCameraPosition = null;
    managed.lastSortCameraDirection = null;
    managed.sortFrame = 0;

    const instanceCenters = new Float32Array(centers.length);
    const instanceColors = new Float32Array(colors.length);
    const instanceOpacities = new Float32Array(opacities.length);
    const instanceAxisX = new Float32Array(axisX.length);
    const instanceAxisY = new Float32Array(axisY.length);
    const instanceAxisZ = new Float32Array(axisZ.length);

    managed.geometry.setAttribute('instanceCenter', new T.InstancedBufferAttribute(instanceCenters, 3));
    managed.geometry.setAttribute('instanceColor', new T.InstancedBufferAttribute(instanceColors, 3));
    managed.geometry.setAttribute('instanceOpacity', new T.InstancedBufferAttribute(instanceOpacities, 1));
    managed.geometry.setAttribute('instanceAxisX', new T.InstancedBufferAttribute(instanceAxisX, 3));
    managed.geometry.setAttribute('instanceAxisY', new T.InstancedBufferAttribute(instanceAxisY, 3));
    managed.geometry.setAttribute('instanceAxisZ', new T.InstancedBufferAttribute(instanceAxisZ, 3));
    managed.geometry.instanceCount = splatCount;
    managed.geometry.boundingSphere = new T.Sphere(new T.Vector3(0, 0, 0), 1e9);

    this.updateSplatSort(managed, true);

    log.info('Three.js splat mesh loaded', {
      layerId: layer.layerId,
      fileName: layer.gaussianSplatFileName,
      totalSplats,
      renderedSplats: splatCount,
      stride,
    });
  }

  private updateSplatSort(managed: ManagedSplat, force = false): void {
    if (!this.camera || managed.splatCount === 0) {
      return;
    }

    managed.sortFrame += 1;
    const interval = managed.splatCount <= 12000
      ? 1
      : managed.splatCount <= 30000
        ? 2
        : managed.splatCount <= 60000
          ? 4
          : 8;

    const cameraPosition = new this.THREE!.Vector3();
    const cameraDirection = new this.THREE!.Vector3();
    const worldPosition = new this.THREE!.Vector3();
    const toCamera = new this.THREE!.Vector3();

    this.camera.getWorldPosition(cameraPosition);
    this.camera.getWorldDirection(cameraDirection);

    const posTuple: [number, number, number] = [cameraPosition.x, cameraPosition.y, cameraPosition.z];
    const dirTuple: [number, number, number] = [cameraDirection.x, cameraDirection.y, cameraDirection.z];

    const movedEnough = !managed.lastSortCameraPosition ||
      ((managed.lastSortCameraPosition[0] - posTuple[0]) ** 2 +
       (managed.lastSortCameraPosition[1] - posTuple[1]) ** 2 +
       (managed.lastSortCameraPosition[2] - posTuple[2]) ** 2) > 0.0001;
    const rotatedEnough = !managed.lastSortCameraDirection ||
      (managed.lastSortCameraDirection[0] * dirTuple[0] +
       managed.lastSortCameraDirection[1] * dirTuple[1] +
       managed.lastSortCameraDirection[2] * dirTuple[2]) < 0.9995;

    if (!force && !movedEnough && !rotatedEnough && (managed.sortFrame % interval !== 0)) {
      return;
    }

    managed.mesh.updateMatrixWorld(true);

    for (let i = 0; i < managed.splatCount; i += 1) {
      const base = i * 3;
      worldPosition.set(
        managed.centers[base + 0],
        managed.centers[base + 1],
        managed.centers[base + 2],
      ).applyMatrix4(managed.mesh.matrixWorld);
      toCamera.copy(worldPosition).sub(cameraPosition);
      managed.sortDepths[i] = toCamera.dot(cameraDirection);
      managed.sortIndices[i] = i;
    }

    managed.sortIndices.sort((a, b) => managed.sortDepths[b] - managed.sortDepths[a]);
    managed.lastSortCameraPosition = posTuple;
    managed.lastSortCameraDirection = dirTuple;

    const centerAttr = managed.geometry.getAttribute('instanceCenter') as import('three').InstancedBufferAttribute;
    const colorAttr = managed.geometry.getAttribute('instanceColor') as import('three').InstancedBufferAttribute;
    const opacityAttr = managed.geometry.getAttribute('instanceOpacity') as import('three').InstancedBufferAttribute;
    const axisXAttr = managed.geometry.getAttribute('instanceAxisX') as import('three').InstancedBufferAttribute;
    const axisYAttr = managed.geometry.getAttribute('instanceAxisY') as import('three').InstancedBufferAttribute;
    const axisZAttr = managed.geometry.getAttribute('instanceAxisZ') as import('three').InstancedBufferAttribute;

    const centerArray = centerAttr.array as Float32Array;
    const colorArray = colorAttr.array as Float32Array;
    const opacityArray = opacityAttr.array as Float32Array;
    const axisXArray = axisXAttr.array as Float32Array;
    const axisYArray = axisYAttr.array as Float32Array;
    const axisZArray = axisZAttr.array as Float32Array;

    for (let outIndex = 0; outIndex < managed.splatCount; outIndex += 1) {
      const sourceIndex = managed.sortIndices[outIndex];
      const sourceBase = sourceIndex * 3;
      const targetBase = outIndex * 3;

      centerArray[targetBase + 0] = managed.centers[sourceBase + 0];
      centerArray[targetBase + 1] = managed.centers[sourceBase + 1];
      centerArray[targetBase + 2] = managed.centers[sourceBase + 2];

      colorArray[targetBase + 0] = managed.colors[sourceBase + 0];
      colorArray[targetBase + 1] = managed.colors[sourceBase + 1];
      colorArray[targetBase + 2] = managed.colors[sourceBase + 2];

      axisXArray[targetBase + 0] = managed.axisX[sourceBase + 0];
      axisXArray[targetBase + 1] = managed.axisX[sourceBase + 1];
      axisXArray[targetBase + 2] = managed.axisX[sourceBase + 2];

      axisYArray[targetBase + 0] = managed.axisY[sourceBase + 0];
      axisYArray[targetBase + 1] = managed.axisY[sourceBase + 1];
      axisYArray[targetBase + 2] = managed.axisY[sourceBase + 2];

      axisZArray[targetBase + 0] = managed.axisZ[sourceBase + 0];
      axisZArray[targetBase + 1] = managed.axisZ[sourceBase + 1];
      axisZArray[targetBase + 2] = managed.axisZ[sourceBase + 2];

      opacityArray[outIndex] = managed.opacities[sourceIndex];
    }

    centerAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    opacityAttr.needsUpdate = true;
    axisXAttr.needsUpdate = true;
    axisYAttr.needsUpdate = true;
    axisZAttr.needsUpdate = true;
  }

  renderScene(
    layers: Layer3DData[],
    cameraConfig: CameraConfig,
    width: number,
    height: number,
  ): OffscreenCanvas | null {
    if (!this.initialized || !this.THREE || !this.renderer || !this.scene || !this.camera) {
      return null;
    }

    const T = this.THREE;
    const outputAspect = width / Math.max(height, 1);

    if (this.width !== width || this.height !== height) {
      this.width = width;
      this.height = height;
      if (this.canvas) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
      this.renderer.setSize(width, height, false);
    }

    const worldHeight = 2.0;
    const fov = cameraConfig.fov;
    const defaultCameraZ = this.getCameraZForFill(fov, worldHeight);
    const applyDefaultDistance = cameraConfig.applyDefaultDistance !== false;

    this.camera.fov = fov;
    this.camera.aspect = outputAspect;
    this.camera.near = cameraConfig.near;
    this.camera.far = cameraConfig.far;
    this.camera.up.set(
      cameraConfig.up?.x ?? DEFAULT_CAMERA_CONFIG.up?.x ?? 0,
      cameraConfig.up?.y ?? DEFAULT_CAMERA_CONFIG.up?.y ?? 1,
      cameraConfig.up?.z ?? DEFAULT_CAMERA_CONFIG.up?.z ?? 0,
    );
    this.camera.position.set(
      cameraConfig.position.x,
      cameraConfig.position.y,
      cameraConfig.position.z + (applyDefaultDistance ? defaultCameraZ : 0),
    );
    this.camera.lookAt(
      cameraConfig.target.x,
      cameraConfig.target.y,
      cameraConfig.target.z,
    );
    this.camera.updateProjectionMatrix();

    const activeLayerIds = new Set<string>();

    for (const layer of layers) {
      activeLayerIds.add(layer.layerId);

      if (layer.gaussianSplatUrl) {
        this.disposeManagedMeshById(layer.layerId);
        this.syncSplatLayer(layer, outputAspect, worldHeight);
        continue;
      }

      this.disposeManagedSplatById(layer.layerId);

      let managed = this.meshes.get(layer.layerId);
      const sourceAspect = layer.sourceWidth / Math.max(layer.sourceHeight, 1);
      let planeW: number;
      let planeH: number;
      if (sourceAspect >= outputAspect) {
        planeW = worldHeight * outputAspect;
        planeH = planeW / sourceAspect;
      } else {
        planeH = worldHeight;
        planeW = planeH * sourceAspect;
      }

      if (layer.meshType && !layer.modelUrl) {
        const meshKey = `primitive:${layer.meshType}`;
        if (!managed || managed.modelUrl !== meshKey) {
          if (managed) this.disposeManagedMesh(managed);
          const geometry = this.createPrimitiveGeometry(T, layer.meshType);
          const material = new T.MeshStandardMaterial({
            color: 0xaaaaaa,
            metalness: 0.3,
            roughness: 0.6,
          });
          const mesh = new T.Mesh(geometry, material);
          managed = {
            mesh,
            texture: new T.Texture(),
            layerId: layer.layerId,
            lastSourceType: 'model',
            planeW: 1,
            planeH: 1,
            isModel: true,
            modelUrl: meshKey,
          };
          this.meshes.set(layer.layerId, managed);
          this.scene.add(mesh);
        }

        const material = (managed.mesh as import('three').Mesh).material as import('three').MeshStandardMaterial;
        if (layer.wireframe) {
          material.wireframe = true;
          material.color.setHex(0x4488ff);
          material.emissive.setHex(0x2244aa);
        } else {
          material.wireframe = false;
          material.color.setHex(0xaaaaaa);
          material.emissive.setHex(0x000000);
        }
      } else if (layer.modelUrl) {
        if (layer.modelFileName) {
          this.setModelFileName(layer.modelUrl, layer.modelFileName);
        }

        if (!managed || managed.modelUrl !== layer.modelUrl) {
          this.loadModel(T, layer.layerId, layer.modelUrl);
          const cachedGroup = modelCache.get(layer.modelUrl);
          if (cachedGroup) {
            if (managed) this.disposeManagedMesh(managed);
            const group = cachedGroup.clone();
            managed = {
              mesh: group,
              texture: new T.Texture(),
              layerId: layer.layerId,
              lastSourceType: 'model',
              planeW: 1,
              planeH: 1,
              isModel: true,
              modelUrl: layer.modelUrl,
            };
            this.meshes.set(layer.layerId, managed);
            this.scene.add(group);
          } else {
            continue;
          }
        }

        if (managed?.isModel) {
          (managed.mesh as import('three').Group).traverse((child) => {
            const mesh = child as import('three').Mesh;
            if (!mesh.isMesh) return;
            const material = mesh.material as import('three').MeshStandardMaterial;
            if (layer.wireframe) {
              material.wireframe = true;
              material.color.setHex(0x4488ff);
              material.emissive.setHex(0x2244aa);
            } else {
              material.wireframe = false;
            }
          });
        }
      } else {
        if (!managed || managed.isModel) {
          if (managed) this.disposeManagedMesh(managed);
          managed = this.createMeshForLayer(T, layer, planeW, planeH);
          this.meshes.set(layer.layerId, managed);
          this.scene.add(managed.mesh);
        } else if (managed.planeW !== planeW || managed.planeH !== planeH) {
          (managed.mesh as import('three').Mesh).geometry.dispose();
          (managed.mesh as import('three').Mesh).geometry = new T.PlaneGeometry(planeW, planeH);
          managed.planeW = planeW;
          managed.planeH = planeH;
        }

        this.updateTextureSource(T, managed, layer);
      }

      if (!managed) continue;

      const halfWorldW = (worldHeight * outputAspect) / 2;
      const halfWorldH = worldHeight / 2;
      managed.mesh.position.set(
        layer.position.x * halfWorldW,
        -layer.position.y * halfWorldH,
        layer.position.z,
      );

      managed.mesh.rotation.order = 'ZYX';
      managed.mesh.rotation.set(
        -layer.rotation.x,
        layer.rotation.y,
        layer.rotation.z,
      );

      managed.mesh.scale.set(
        layer.scale.x,
        layer.scale.y,
        layer.scale.z,
      );

      if (managed.isModel) {
        (managed.mesh as import('three').Group).traverse((child) => {
          if (!(child as import('three').Mesh).isMesh) return;
          const material = (child as import('three').Mesh).material as import('three').MeshStandardMaterial;
          material.opacity = layer.opacity;
          material.transparent = layer.opacity < 1;
        });
        managed.mesh.visible = layer.opacity > 0;
      } else {
        const material = (managed.mesh as import('three').Mesh).material as import('three').MeshBasicMaterial;
        material.opacity = layer.opacity;
        // Text and image planes can carry their own alpha even at opacity 1.
        // Turning transparency off here makes the plane render as an opaque black quad.
        material.transparent = true;
        material.visible = layer.opacity > 0;
      }
    }

    for (const [layerId, managed] of this.meshes) {
      if (!activeLayerIds.has(layerId)) {
        this.disposeManagedMesh(managed);
        this.meshes.delete(layerId);
      }
    }

    for (const [layerId, managed] of this.splatObjects) {
      if (!activeLayerIds.has(layerId)) {
        this.disposeManagedSplat(managed);
        this.splatObjects.delete(layerId);
      }
    }

    this.renderer.render(this.scene, this.camera);
    return this.canvas;
  }

  private syncSplatLayer(layer: Layer3DData, outputAspect: number, worldHeight: number): void {
    if (!this.scene || !this.THREE) return;

    let managed = this.splatObjects.get(layer.layerId);
    if (!managed || managed.splatUrl !== layer.gaussianSplatUrl) {
      if (managed) {
        this.disposeManagedSplat(managed);
      }

      managed = this.createManagedSplat(this.THREE, layer.layerId);
      managed.splatUrl = layer.gaussianSplatUrl;
      this.splatObjects.set(layer.layerId, managed);
      this.scene.add(managed.mesh);

      if (layer.gaussianSplatUrl) {
        managed.loadPromise = this.populateSplatGeometry(this.THREE, managed, layer).catch((error) => {
          log.error('Failed to build Three.js gaussian splat mesh', {
            layerId: layer.layerId,
            fileName: layer.gaussianSplatFileName,
            error,
          });
        });
      }
    }

    const halfWorldW = (worldHeight * outputAspect) / 2;
    const halfWorldH = worldHeight / 2;
    managed.mesh.position.set(
      layer.position.x * halfWorldW,
      -layer.position.y * halfWorldH,
      layer.position.z,
    );
    managed.mesh.rotation.order = 'ZYX';
    managed.mesh.rotation.set(
      -layer.rotation.x,
      layer.rotation.y,
      layer.rotation.z,
    );
    managed.mesh.scale.set(
      layer.scale.x,
      layer.scale.y,
      layer.scale.z,
    );
    managed.mesh.visible = layer.opacity > 0;
    managed.material.uniforms.uOpacity.value = layer.opacity;
    managed.material.uniforms.uViewportSize.value.set(Math.max(this.width, 1), Math.max(this.height, 1));
    managed.material.uniforms.uSplatScale.value =
      layer.gaussianSplatSettings?.render?.splatScale ?? 1;
    if (managed.splatCount > 0) {
      this.updateSplatSort(managed);
    }
  }

  private createPrimitiveGeometry(T: THREE, meshType: string): import('three').BufferGeometry {
    switch (meshType) {
      case 'cube':
        return new T.BoxGeometry(0.6, 0.6, 0.6);
      case 'sphere':
        return new T.SphereGeometry(0.35, 32, 24);
      case 'plane':
        return new T.PlaneGeometry(0.8, 0.8);
      case 'cylinder':
        return new T.CylinderGeometry(0.25, 0.25, 0.6, 32);
      case 'torus':
        return new T.TorusGeometry(0.3, 0.1, 16, 48);
      case 'cone':
        return new T.ConeGeometry(0.3, 0.6, 32);
      default:
        return new T.BoxGeometry(0.6, 0.6, 0.6);
    }
  }

  setModelFileName(url: string, fileName: string): void {
    this.modelFileNames.set(url, fileName);
  }

  private async loadModel(T: THREE, _layerId: string, url: string): Promise<void> {
    if (modelCache.has(url) || modelLoading.has(url)) return;
    modelLoading.add(url);

    try {
      const fileName = this.modelFileNames.get(url) || url;
      const ext = fileName.split('.').pop()?.toLowerCase() || '';
      let group: import('three').Group;

      if (ext === 'obj') {
        const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
        const loader = new OBJLoader();
        group = await loader.loadAsync(url);
      } else {
        const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
        const loader = new GLTFLoader();
        const gltf = await loader.loadAsync(url);
        group = gltf.scene;
      }

      const box = new T.Box3().setFromObject(group);
      const size = box.getSize(new T.Vector3());
      const center = box.getCenter(new T.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      group.position.sub(center);
      group.scale.multiplyScalar(1 / maxDim);

      const defaultMaterial = new T.MeshStandardMaterial({
        color: 0x888888,
        roughness: 0.5,
        metalness: 0.3,
      });
      group.traverse((child) => {
        const mesh = child as import('three').Mesh;
        if (!mesh.isMesh) return;
        const material = mesh.material as import('three').MeshStandardMaterial;
        if (!material.map && (!material.color || material.color.getHex() === 0xffffff)) {
          mesh.material = defaultMaterial.clone();
        }
      });

      modelCache.set(url, group);
      modelLoading.delete(url);
      log.info('3D model loaded', {
        url: url.substring(0, 50),
        ext,
        vertices: this.countVertices(group),
      });
    } catch (err) {
      log.error('Failed to load 3D model', err);
      modelLoading.delete(url);
    }
  }

  private countVertices(obj: import('three').Object3D): number {
    let count = 0;
    obj.traverse((child) => {
      const mesh = child as import('three').Mesh;
      if (mesh.isMesh && mesh.geometry) {
        count += mesh.geometry.attributes.position?.count ?? 0;
      }
    });
    return count;
  }

  private createMeshForLayer(T: THREE, layer: Layer3DData, planeW: number, planeH: number): ManagedMesh {
    const geometry = new T.PlaneGeometry(planeW, planeH);
    const material = new T.MeshBasicMaterial({
      side: T.DoubleSide,
      transparent: true,
      opacity: layer.opacity,
    });
    const mesh = new T.Mesh(geometry, material);
    const texture = new T.Texture();

    return {
      mesh,
      texture,
      layerId: layer.layerId,
      lastSourceType: null,
      planeW,
      planeH,
    };
  }

  private updateTextureSource(T: THREE, managed: ManagedMesh, layer: Layer3DData): void {
    const mesh = managed.mesh as import('three').Mesh;
    const material = mesh.material as import('three').MeshBasicMaterial;

    if (layer.videoElement) {
      if (managed.lastSourceType !== 'video' || (managed.texture as { image?: unknown }).image !== layer.videoElement) {
        managed.texture.dispose();
        managed.texture = new T.VideoTexture(layer.videoElement);
        managed.texture.colorSpace = T.SRGBColorSpace;
        material.map = managed.texture;
        material.needsUpdate = true;
        managed.lastSourceType = 'video';
      }
      managed.texture.needsUpdate = true;
    } else if (layer.imageElement) {
      if (managed.lastSourceType !== 'image' || (managed.texture as { image?: unknown }).image !== layer.imageElement) {
        managed.texture.dispose();
        managed.texture = new T.Texture(layer.imageElement);
        managed.texture.colorSpace = T.SRGBColorSpace;
        managed.texture.needsUpdate = true;
        material.map = managed.texture;
        material.needsUpdate = true;
        managed.lastSourceType = 'image';
      }
    } else if (layer.canvas) {
      if (managed.lastSourceType !== 'canvas' || (managed.texture as { image?: unknown }).image !== layer.canvas) {
        managed.texture.dispose();
        managed.texture = new T.CanvasTexture(layer.canvas);
        managed.texture.colorSpace = T.SRGBColorSpace;
        material.map = managed.texture;
        material.needsUpdate = true;
        managed.lastSourceType = 'canvas';
      } else {
        managed.texture.needsUpdate = true;
      }
    }
  }

  private disposeManagedMeshById(layerId: string): void {
    const managed = this.meshes.get(layerId);
    if (!managed) return;
    this.disposeManagedMesh(managed);
    this.meshes.delete(layerId);
  }

  private disposeManagedMesh(managed: ManagedMesh): void {
    this.scene?.remove(managed.mesh);
    if (!managed.isModel) {
      managed.texture.dispose();
      const mesh = managed.mesh as import('three').Mesh;
      (mesh.material as import('three').MeshBasicMaterial).dispose();
      mesh.geometry.dispose();
    }
  }

  private disposeManagedSplatById(layerId: string): void {
    const managed = this.splatObjects.get(layerId);
    if (!managed) return;
    this.disposeManagedSplat(managed);
    this.splatObjects.delete(layerId);
  }

  private disposeManagedSplat(managed: ManagedSplat): void {
    this.scene?.remove(managed.mesh);
    managed.material.dispose();
    managed.geometry.dispose();
  }

  clearScene(): void {
    if (!this.scene) return;

    for (const [, managed] of this.meshes) {
      this.disposeManagedMesh(managed);
    }
    this.meshes.clear();

    for (const [, managed] of this.splatObjects) {
      this.disposeManagedSplat(managed);
    }
    this.splatObjects.clear();
  }

  dispose(): void {
    this.clearScene();
    this.renderer?.dispose();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.canvas = null;
    this.initialized = false;
    log.info('ThreeSceneRenderer disposed');
  }

  get isInitialized(): boolean {
    return this.initialized;
  }
}

let instance: ThreeSceneRenderer | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    instance?.dispose();
    instance = null;
  });
}

export function getThreeSceneRenderer(): ThreeSceneRenderer {
  if (!instance) {
    instance = new ThreeSceneRenderer();
  }
  return instance;
}
