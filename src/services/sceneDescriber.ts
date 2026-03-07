// Scene Describer Service
// Uses local Qwen3-VL Python server for native video understanding with timestamps

import { Logger } from './logger';
import { useTimelineStore } from '../stores/timeline';
import { useMediaStore } from '../stores/mediaStore';
import type { SceneSegment, SceneDescriptionStatus } from '../types';

const log = Logger.create('SceneDescriber');

const SERVER_URL = 'http://localhost:5555';

// Cancellation state
let isDescribing = false;
let abortController: AbortController | null = null;

/**
 * Check if the Qwen3-VL Python server is available
 */
export async function checkServerStatus(): Promise<{
  available: boolean;
  modelLoaded: boolean;
  error?: string;
}> {
  try {
    const response = await fetch(`${SERVER_URL}/api/status`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { available: false, modelLoaded: false, error: 'Server not responding' };

    const data = await response.json();
    return {
      available: data.available,
      modelLoaded: data.model_loaded,
      error: data.model_loaded ? undefined : 'Model not loaded yet (will load on first request)',
    };
  } catch {
    return {
      available: false,
      modelLoaded: false,
      error: 'Qwen3-VL server not running. Start it with: python tools/qwen3vl-server/server.py',
    };
  }
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
 * Describe a video clip using the Qwen3-VL Python server (native video input)
 */
export async function describeClip(clipId: string): Promise<void> {
  if (isDescribing) {
    log.warn('Already describing a clip');
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

  // Resolve file path: source.filePath > mediaStore.absolutePath > File.path
  let filePath = clip.source?.filePath || (clip.file as any).path;
  if (!filePath) {
    // Try mediaStore absolutePath
    const mediaFileId = clip.source?.mediaFileId || clip.mediaFileId;
    if (mediaFileId) {
      const mediaFile = useMediaStore.getState().files.find(f => f.id === mediaFileId);
      filePath = mediaFile?.absolutePath;
    }
  }
  if (!filePath) {
    updateClipSceneDescription(clipId, {
      status: 'error',
      progress: 0,
      message: 'No file path available. Drag the video from your file explorer onto the timeline.',
    });
    return;
  }

  isDescribing = true;
  abortController = new AbortController();

  updateClipSceneDescription(clipId, {
    status: 'describing',
    progress: 10,
    message: 'Connecting to Qwen3-VL server...',
  });

  try {
    // Check server availability
    const status = await checkServerStatus();
    if (!status.available) {
      updateClipSceneDescription(clipId, {
        status: 'error',
        progress: 0,
        message: status.error || 'Server not available',
      });
      return;
    }

    const inPoint = clip.inPoint ?? 0;
    const outPoint = clip.outPoint ?? clip.duration;
    const clipDuration = outPoint - inPoint;

    // Adjust frame count based on clip duration
    let numFrames = 12;
    if (clipDuration < 5) numFrames = 6;
    else if (clipDuration < 15) numFrames = 8;
    else if (clipDuration > 60) numFrames = 16;
    else if (clipDuration > 120) numFrames = 20;

    updateClipSceneDescription(clipId, {
      progress: 20,
      message: 'Analyzing video with AI...',
    });

    log.info(`Describing clip ${clip.name}: ${filePath} (${clipDuration.toFixed(1)}s, ${numFrames} frames)`);

    // Send video to Python server (extracts frames + sends to Ollama)
    const response = await fetch(`${SERVER_URL}/api/describe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video_path: filePath.replace(/\\/g, '/'),
        duration: clipDuration,
        num_frames: numFrames,
      }),
      signal: abortController.signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(errorData.error || `Server error: ${response.status}`);
    }

    const result = await response.json();
    log.info(`AI analysis complete: ${result.segments?.length} segments in ${result.elapsed_seconds}s`);

    const segments: SceneSegment[] = (result.segments || []).map((seg: any, i: number) => ({
      id: `scene-${i}`,
      text: seg.text,
      start: seg.start + inPoint, // Offset by clip in-point
      end: Math.min(seg.end + inPoint, outPoint),
    }));

    updateClipSceneDescription(clipId, {
      status: 'ready',
      progress: 100,
      segments,
      message: undefined,
    });

    log.info(`Scene description complete: ${segments.length} segments`);

  } catch (error) {
    if (abortController?.signal.aborted) {
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
    isDescribing = false;
    abortController = null;
  }
}

/**
 * Cancel ongoing scene description
 */
export function cancelDescription(): void {
  if (isDescribing && abortController) {
    abortController.abort();
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
