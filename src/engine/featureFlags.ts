// Feature flags for engine subsystems still in development.
// Scene Graph, Dirty Tracking, Structural Sharing are always-on (no flag needed).
// Toggle at runtime via: window.__ENGINE_FLAGS__

export const flags = {
  useRenderGraph: false,  // Render Graph executor (stubs - not ready)
  useDecoderPool: false,  // Shared decoder pool (not wired yet)
  useFullWebCodecsPlayback: true,  // Default to full WebCodecs preview/playback; HTMLVideo stays audio/fallback only
  disableHtmlPreviewFallback: true,  // Debug WebCodecs without HTML preview recovery paths; HTMLVideo still stays available for audio
  useLiveSlotTrigger: false,  // Slot Grid click triggers live layers without forcing editor switching
  useWarmSlotDecks: false,  // Prepare reusable slot-owned live decks for low-latency triggering
};

// Expose for runtime toggling from devtools
if (typeof window !== 'undefined') {
  (window as any).__ENGINE_FLAGS__ = flags;
}
