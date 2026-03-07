import { useTimelineStore } from '../../../stores/timeline';
import type { ToolResult } from '../types';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

export async function handleSetTransform(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) {
    return { success: false, error: `Clip not found: ${clipId}` };
  }

  const updates: Record<string, unknown> = {};
  if (args.x !== undefined) updates.x = args.x as number;
  if (args.y !== undefined) updates.y = args.y as number;
  if (args.scaleX !== undefined) updates.scaleX = args.scaleX as number;
  if (args.scaleY !== undefined) updates.scaleY = args.scaleY as number;
  if (args.opacity !== undefined) updates.opacity = args.opacity as number;
  if (args.blendMode !== undefined) updates.blendMode = args.blendMode as string;
  if (args.anchorX !== undefined) updates.anchorX = args.anchorX as number;
  if (args.anchorY !== undefined) updates.anchorY = args.anchorY as number;
  if (args.rotation !== undefined) {
    updates.rotation = { ...(clip.transform?.rotation || { x: 0, y: 0, z: 0 }), z: args.rotation as number };
  }

  if (Object.keys(updates).length === 0) {
    return { success: false, error: 'No transform properties provided' };
  }

  const { updateClipTransform, invalidateCache } = useTimelineStore.getState();
  updateClipTransform(clipId, updates);
  invalidateCache();

  return {
    success: true,
    data: {
      clipId,
      updatedProperties: Object.keys(updates),
    },
  };
}
