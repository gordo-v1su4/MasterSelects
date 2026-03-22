import {
  calculateHostedKlingCost,
  createHostedKlingTask,
  getHostedKlingTask,
  type HostedVideoParams,
  type HostedVideoTask,
} from '../kieai';

export interface HostedKlingCapabilities {
  byoExplicit: true;
  provider: 'kling-3.0';
  pollingSupported: true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function normalizeHostedKlingParams(value: unknown): HostedVideoParams | null {
  if (!isRecord(value)) {
    return null;
  }

  const prompt = typeof value.prompt === 'string' ? value.prompt.trim() : '';
  const duration = Number(value.duration);

  if (!prompt || !Number.isFinite(duration)) {
    return null;
  }

  return {
    aspectRatio: typeof value.aspectRatio === 'string' && value.aspectRatio.trim() ? value.aspectRatio.trim() : '16:9',
    duration: Math.max(3, Math.min(15, Math.floor(duration))),
    endImageUrl: typeof value.endImageUrl === 'string' && value.endImageUrl.trim() ? value.endImageUrl.trim() : undefined,
    mode: value.mode === 'pro' ? 'pro' : 'std',
    prompt,
    provider: 'kling-3.0',
    sound: value.sound === true,
    startImageUrl: typeof value.startImageUrl === 'string' && value.startImageUrl.trim() ? value.startImageUrl.trim() : undefined,
  };
}

export { calculateHostedKlingCost, createHostedKlingTask, getHostedKlingTask };
export type { HostedVideoParams, HostedVideoTask };

export function buildHostedKlingCapabilities(): HostedKlingCapabilities {
  return {
    byoExplicit: true,
    provider: 'kling-3.0',
    pollingSupported: true,
  };
}
