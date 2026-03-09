import type { ScrubbingCache } from '../texture/ScrubbingCache';

function isFirefoxBrowser(): boolean {
  return typeof navigator !== 'undefined' && /Firefox\//.test(navigator.userAgent);
}

export function getCopiedHtmlVideoPreviewFrame(
  video: HTMLVideoElement,
  scrubbingCache: ScrubbingCache | null
): { view: GPUTextureView; width: number; height: number } | null {
  if (!isFirefoxBrowser() || !scrubbingCache) {
    return null;
  }

  if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
    return null;
  }

  const previousFrame = scrubbingCache.getLastFrame(video);

  // Firefox can intermittently sample imported HTML video textures as black
  // during playback. Copying into a persistent texture is slower but stable.
  const captured = scrubbingCache.captureVideoFrame(video);
  if (captured) {
    return scrubbingCache.getLastFrame(video);
  }

  return previousFrame;
}
