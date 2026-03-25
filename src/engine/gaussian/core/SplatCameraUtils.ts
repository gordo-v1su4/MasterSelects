// Camera utilities for gaussian splat rendering.
// Builds view and projection matrices from layer transform properties.

import type { SplatCameraParams } from './GaussianSplatGpuRenderer';

/**
 * Build view + projection matrices from a layer's transform properties.
 *
 * Mapping:
 *  - position.z  -> camera distance from origin (default 5)
 *  - rotation    -> orbit angles (x = pitch, y = yaw). Accepts number (yaw only) or {x,y,z}.
 *  - scale.x     -> zoom multiplier (affects FOV)
 *  - settings.nearPlane / farPlane  -> clipping planes
 */
export function buildSplatCamera(
  layer: {
    position: { x: number; y: number; z: number };
    scale: { x: number; y: number; z?: number };
    rotation: number | { x: number; y: number; z: number };
  },
  settings: { nearPlane: number; farPlane: number },
  viewport: { width: number; height: number },
): SplatCameraParams {
  // Extract orbit angles
  let pitch = 0;
  let yaw = 0;
  if (typeof layer.rotation === 'number') {
    yaw = layer.rotation * (Math.PI / 180);
  } else {
    pitch = layer.rotation.x * (Math.PI / 180);
    yaw = layer.rotation.y * (Math.PI / 180);
  }

  // Camera distance (position.z, default 5)
  const distance = layer.position.z !== 0 ? Math.abs(layer.position.z) : 5;

  // Zoom from scale.x (default 1)
  const zoom = Math.max(0.01, layer.scale.x || 1);

  // FOV: base 60 degrees, scaled inversely by zoom
  const baseFovDeg = 60;
  const fovDeg = baseFovDeg / zoom;
  const fov = fovDeg * (Math.PI / 180);

  const near = settings.nearPlane;
  const far = settings.farPlane;
  const aspect = viewport.width / Math.max(1, viewport.height);

  // Build orbital camera position
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);

  // Camera position on orbit sphere + pan offset
  const eyeX = distance * cosPitch * sinYaw + layer.position.x;
  const eyeY = distance * sinPitch + layer.position.y;
  const eyeZ = distance * cosPitch * cosYaw;

  // Look-at target is world origin + pan offset
  const targetX = layer.position.x;
  const targetY = layer.position.y;
  const targetZ = 0;

  // Build view matrix (lookAt)
  const viewMatrix = lookAt(
    eyeX, eyeY, eyeZ,
    targetX, targetY, targetZ,
    0, 1, 0,
  );

  // Build projection matrix
  const projectionMatrix = perspective(fov, aspect, near, far);

  return {
    viewMatrix,
    projectionMatrix,
    viewport,
    fov,
    near,
    far,
  };
}

/**
 * Build a column-major 4x4 lookAt view matrix.
 */
function lookAt(
  eyeX: number, eyeY: number, eyeZ: number,
  targetX: number, targetY: number, targetZ: number,
  upX: number, upY: number, upZ: number,
): Float32Array {
  // Forward (from target to eye)
  let fX = eyeX - targetX;
  let fY = eyeY - targetY;
  let fZ = eyeZ - targetZ;
  let len = Math.sqrt(fX * fX + fY * fY + fZ * fZ);
  if (len > 0) { fX /= len; fY /= len; fZ /= len; }

  // Right = up x forward
  let rX = upY * fZ - upZ * fY;
  let rY = upZ * fX - upX * fZ;
  let rZ = upX * fY - upY * fX;
  len = Math.sqrt(rX * rX + rY * rY + rZ * rZ);
  if (len > 0) { rX /= len; rY /= len; rZ /= len; }

  // True up = forward x right
  const uX = fY * rZ - fZ * rY;
  const uY = fZ * rX - fX * rZ;
  const uZ = fX * rY - fY * rX;

  // Column-major 4x4
  const m = new Float32Array(16);
  m[0]  = rX;   m[1]  = uX;   m[2]  = fX;   m[3]  = 0;
  m[4]  = rY;   m[5]  = uY;   m[6]  = fY;   m[7]  = 0;
  m[8]  = rZ;   m[9]  = uZ;   m[10] = fZ;   m[11] = 0;
  m[12] = -(rX * eyeX + rY * eyeY + rZ * eyeZ);
  m[13] = -(uX * eyeX + uY * eyeY + uZ * eyeZ);
  m[14] = -(fX * eyeX + fY * eyeY + fZ * eyeZ);
  m[15] = 1;

  return m;
}

/**
 * Build a column-major 4x4 perspective projection matrix.
 */
function perspective(
  fovY: number,
  aspect: number,
  near: number,
  far: number,
): Float32Array {
  const f = 1.0 / Math.tan(fovY * 0.5);
  const rangeInv = 1.0 / (near - far);

  const m = new Float32Array(16);
  m[0]  = f / aspect;
  m[1]  = 0;
  m[2]  = 0;
  m[3]  = 0;

  m[4]  = 0;
  m[5]  = f;
  m[6]  = 0;
  m[7]  = 0;

  m[8]  = 0;
  m[9]  = 0;
  m[10] = far * rangeInv;
  m[11] = -1;

  m[12] = 0;
  m[13] = 0;
  m[14] = near * far * rangeInv;
  m[15] = 0;

  return m;
}
