// Scene Describer Service
// Uses local Ollama (Qwen3.5) to describe video content with timestamps

import { Logger } from './logger';
import { useTimelineStore } from '../stores/timeline';
import type { SceneSegment, SceneDescriptionStatus } from '../types';

const log = Logger.create('SceneDescriber');

const OLLAMA_URL = 'http://localhost:11434';
const MODEL = 'qwen3-vl:8b';
// Sample every N seconds for frame extraction
const SAMPLE_INTERVAL_SEC = 2;
// Canvas size for frame capture (smaller = faster, less VRAM)
const CAPTURE_WIDTH = 512;
const CAPTURE_HEIGHT = 288;

// Cancellation state
let isDescribing = false;
let shouldCancel = false;

/**
 * Check if Ollama is available and the model is loaded
 */
export async function checkOllamaStatus(): Promise<{ available: boolean; modelLoaded: boolean; error?: string }> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return { available: false, modelLoaded: false, error: 'Ollama not responding' };

    const data = await response.json();
    const models = data.models || [];
    const hasModel = models.some((m: { name: string }) => m.name.startsWith('qwen3-vl'));

    return { available: true, modelLoaded: hasModel };
  } catch {
    return { available: false, modelLoaded: false, error: 'Ollama not running. Install from ollama.com and run: ollama pull qwen3.5:9b' };
  }
}

/**
 * Extract a single frame from video as base64 JPEG
 */
function extractFrameAsBase64(
  video: HTMLVideoElement,
  timestampSec: number,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D
): Promise<string> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      // Get as JPEG base64 (smaller than PNG)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      // Strip the data:image/jpeg;base64, prefix
      resolve(dataUrl.split(',')[1]);
    };

    video.addEventListener('seeked', onSeeked);
    video.currentTime = timestampSec;

    // Timeout fallback
    setTimeout(() => {
      video.removeEventListener('seeked', onSeeked);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      resolve(dataUrl.split(',')[1]);
    }, 2000);
  });
}

/**
 * Send a single frame to Ollama and get scene description
 * Qwen3-VL works best with one image per request for reliable output
 */
async function describeSingleFrame(
  frame: { base64: string; timestamp: number },
  prevDescription: string,
  totalDuration: number,
): Promise<string> {
  const mins = Math.floor(frame.timestamp / 60);
  const secs = Math.floor(frame.timestamp % 60);
  const timeLabel = `${mins}:${secs.toString().padStart(2, '0')}`;

  const contextHint = prevDescription
    ? `Previous scene was: "${prevDescription}". `
    : '';

  const prompt = `/no_think\nThis is a frame from a video (${Math.round(totalDuration)}s total) at timestamp ${timeLabel}. ` +
    `${contextHint}` +
    `Describe what is happening in this frame in ONE concise sentence (max 20 words). ` +
    `Focus on actions, subjects, camera angle, and any motion you can infer. ` +
    `Output ONLY the description, nothing else.`;

  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [{
        role: 'user',
        content: prompt,
        images: [frame.base64],
      }],
      stream: false,
      options: {
        num_predict: 512,
        temperature: 0.3,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama API error: ${response.status} - ${text}`);
  }

  const data = await response.json();
  let content = data.message?.content || '';

  // Fallback: if content empty but thinking has useful text, extract it
  if (!content.trim() && data.message?.thinking) {
    const thinking = data.message.thinking as string;
    // Try to find a descriptive sentence in the thinking
    const sentences = thinking.split(/[.!]\s/).filter(s => s.trim().length > 10);
    if (sentences.length > 0) {
      content = sentences[sentences.length - 1].trim();
      if (!content.endsWith('.')) content += '.';
    }
  }

  return content.trim();
}

/**
 * Update clip scene description data in the timeline store
 */
function updateClipSceneDescription(
  clipId: string,
  data: {
    status?: SceneDescriptionStatus;
    progress?: number;
    segments?: SceneSegment[];
    message?: string;
  }
): void {
  const store = useTimelineStore.getState();
  const clips = store.clips.map(clip => {
    if (clip.id !== clipId) return clip;

    return {
      ...clip,
      sceneDescriptionStatus: data.status ?? clip.sceneDescriptionStatus,
      sceneDescriptionProgress: data.progress ?? clip.sceneDescriptionProgress,
      sceneDescriptions: data.segments ?? clip.sceneDescriptions,
      sceneDescriptionMessage: data.message,
    };
  });

  useTimelineStore.setState({ clips });
}

/**
 * Describe a video clip using Ollama AI
 */
export async function describeClip(clipId: string): Promise<void> {
  if (isDescribing) {
    log.warn('Already describing a clip');
    return;
  }

  // Check Ollama availability
  const status = await checkOllamaStatus();
  if (!status.available) {
    updateClipSceneDescription(clipId, {
      status: 'error',
      progress: 0,
      message: status.error || 'Ollama not available',
    });
    return;
  }
  if (!status.modelLoaded) {
    updateClipSceneDescription(clipId, {
      status: 'error',
      progress: 0,
      message: `Model ${MODEL} not found. Run: ollama pull ${MODEL}`,
    });
    return;
  }

  const store = useTimelineStore.getState();
  const clip = store.clips.find(c => c.id === clipId);

  if (!clip || !clip.file) {
    log.warn('Clip not found or has no file', { clipId });
    return;
  }

  const isVideo = clip.file.type.startsWith('video/') ||
    /\.(mp4|webm|mov|avi|mkv|m4v|mxf)$/i.test(clip.file.name);
  if (!isVideo) {
    log.warn('Not a video file');
    return;
  }

  isDescribing = true;
  shouldCancel = false;
  updateClipSceneDescription(clipId, {
    status: 'describing',
    progress: 0,
    message: 'Loading video...',
  });

  let videoUrl: string | null = null;

  try {
    // Create video element for frame extraction
    const video = document.createElement('video');
    videoUrl = URL.createObjectURL(clip.file);
    video.src = videoUrl;
    video.muted = true;
    video.preload = 'auto';

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Failed to load video'));
      setTimeout(() => reject(new Error('Video load timeout')), 30000);
    });

    const canvas = document.createElement('canvas');
    canvas.width = CAPTURE_WIDTH;
    canvas.height = CAPTURE_HEIGHT;
    const ctx = canvas.getContext('2d')!;

    const inPoint = clip.inPoint ?? 0;
    const outPoint = clip.outPoint ?? clip.duration;
    const clipDuration = outPoint - inPoint;

    // Calculate sample timestamps
    const timestamps: number[] = [];
    for (let t = inPoint; t < outPoint; t += SAMPLE_INTERVAL_SEC) {
      timestamps.push(t);
    }
    // Always include last frame if not already close
    if (timestamps.length > 0 && outPoint - timestamps[timestamps.length - 1] > 1) {
      timestamps.push(outPoint - 0.1);
    }

    const totalFrames = timestamps.length;
    log.info(`Extracting ${totalFrames} frames from ${clip.name} (${clipDuration.toFixed(1)}s)`);

    updateClipSceneDescription(clipId, {
      progress: 5,
      message: `Extracting ${totalFrames} frames...`,
    });

    // Extract all frames
    const frames: { base64: string; timestamp: number }[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (shouldCancel) throw new Error('Cancelled');

      const base64 = await extractFrameAsBase64(video, timestamps[i], canvas, ctx);
      frames.push({ base64, timestamp: timestamps[i] });

      const extractProgress = 5 + (35 * (i + 1) / totalFrames);
      updateClipSceneDescription(clipId, {
        progress: Math.round(extractProgress),
        message: `Extracted frame ${i + 1}/${totalFrames}`,
      });
    }

    // Process frame by frame (Qwen3-VL works best with single images)
    const allSegments: SceneSegment[] = [];
    let prevDescription = '';

    for (let i = 0; i < frames.length; i++) {
      if (shouldCancel) throw new Error('Cancelled');

      updateClipSceneDescription(clipId, {
        progress: Math.round(40 + (50 * (i + 1) / frames.length)),
        message: `AI analyzing frame ${i + 1}/${frames.length}...`,
      });

      log.info(`Describing frame ${i + 1}/${frames.length} at ${frames[i].timestamp.toFixed(1)}s`);

      const description = await describeSingleFrame(frames[i], prevDescription, clipDuration);

      if (description) {
        allSegments.push({
          id: `scene-${allSegments.length}`,
          text: description,
          start: frames[i].timestamp,
          end: frames[i].timestamp + SAMPLE_INTERVAL_SEC,
        });
        prevDescription = description;

        // Update with partial results
        updateClipSceneDescription(clipId, {
          segments: [...allSegments],
        });
      }
    }

    // Finalize: adjust end times so segments don't overlap
    const finalSegments = allSegments.map((seg, i, arr) => ({
      ...seg,
      id: `scene-${i}`,
      end: i < arr.length - 1 ? arr[i + 1].start : outPoint,
    }));

    updateClipSceneDescription(clipId, {
      status: 'ready',
      progress: 100,
      segments: finalSegments,
      message: undefined,
    });

    log.info(`Scene description complete: ${finalSegments.length} segments`);

  } catch (error) {
    if (shouldCancel) {
      updateClipSceneDescription(clipId, {
        status: 'none',
        progress: 0,
        message: undefined,
        segments: undefined,
      });
      log.info('Scene description cancelled');
    } else {
      log.error('Scene description failed', error);
      updateClipSceneDescription(clipId, {
        status: 'error',
        progress: 0,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  } finally {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    isDescribing = false;
  }
}

/**
 * Cancel ongoing scene description
 */
export function cancelDescription(): void {
  if (isDescribing) {
    shouldCancel = true;
    log.info('Cancel requested');
  }
}

/**
 * Clear scene descriptions from a clip
 */
export function clearSceneDescriptions(clipId: string): void {
  updateClipSceneDescription(clipId, {
    status: 'none',
    progress: 0,
    segments: undefined,
    message: undefined,
  });
}
