# MediaBunny Migration Plan

## Executive Summary

This plan proposes adopting MediaBunny for the browser-side media container and parsing stack in MasterSelects.

For this codebase, "replace FFmpeg with MediaBunny" is too broad. The practical first step is:

- Replace `mp4-muxer` and `webm-muxer` in the WebCodecs export path.
- Replace as much `mp4box` usage as is practical for metadata, track inspection, and browser-side extraction helpers.
- Keep the FFmpeg WASM path for professional codecs in place.
- Keep the native helper out of scope for the initial migration.

This keeps the migration grounded in the part of the architecture where MediaBunny is the strongest fit and avoids conflating it with the existing professional-codec and native-runtime responsibilities.

## Why Do This

### Primary benefits

- `mp4-muxer` and `webm-muxer` are deprecated in favor of MediaBunny.
- The current browser media stack is fragmented across `mp4-muxer`, `webm-muxer`, and `mp4box`.
- MediaBunny unifies muxing, demuxing, metadata access, and WebCodecs-oriented media workflows under one API.
- MediaBunny supports more output and input container formats than the current custom stack.
- MediaBunny has built-in streaming and backpressure concepts that align with future large-export work.

### Expected repo-level benefits

- Fewer media-specific dependencies in `package.json`.
- Less glue code around muxer-specific APIs.
- Easier future support for `.mov` and `.mkv` in browser-native paths.
- Better long-term maintainability than continuing to build on deprecated muxers.

## Current State In MasterSelects

### Browser export

Current production export is:

`FrameExporter -> VideoEncoderWrapper -> WebCodecs -> mp4-muxer/webm-muxer`

Relevant files:

- `src/engine/export/FrameExporter.ts`
- `src/engine/export/VideoEncoderWrapper.ts`
- `src/engine/audio/AudioEncoder.ts`

### Browser parsing and metadata

`mp4box` is currently used in multiple areas:

- `src/engine/WebCodecsPlayer.ts`
- `src/services/audioExtractor.ts`
- `src/stores/mediaStore/helpers/mediaInfoHelpers.ts`
- `src/stores/timeline/helpers/mp4MetadataHelper.ts`
- `src/stores/timeline/helpers/audioDetection.ts`
- `src/engine/ParallelDecodeManager.ts`
- `src/services/proxyGenerator.ts`

### FFmpeg responsibilities

FFmpeg is not only used as a generic media library here. It has separate roles:

- Browser-side FFmpeg WASM export for ProRes, DNxHR, FFV1, UTVideo, and MJPEG.
- Audio extraction helper paths in the FFmpeg bridge.
- Native helper packaging and runtime prerequisites.

Relevant files:

- `src/engine/ffmpeg/FFmpegBridge.ts`
- `src/components/export/ExportPanel.tsx`
- `tools/native-helper/README.md`

## Target State

### Phase 1 target

Adopt MediaBunny only where it cleanly replaces the current browser container and parsing layer:

- WebCodecs export writes files through MediaBunny instead of `mp4-muxer` and `webm-muxer`.
- Metadata and track inspection helpers migrate away from `mp4box` where parity is proven.
- FFmpeg WASM stays as the professional-codec escape hatch.
- Native helper remains unchanged.

### Phase 2 target

After Phase 1 is stable:

- Evaluate MediaBunny for additional parsing and extraction flows.
- Evaluate streaming outputs for large exports.
- Revisit whether any FFmpeg browser-side helper functionality can be reduced.

## Non-Goals

The following are explicitly out of scope for the first migration:

- Replacing `src/engine/ffmpeg/FFmpegBridge.ts`.
- Replacing the native helper runtime or its FFmpeg-linked packaging.
- Removing professional codec export support.
- Rewriting decode architecture just to "use MediaBunny everywhere".
- Changing user-facing export UX unless needed for correctness.

## Official Constraints And Opportunities

The plan is based on the current official MediaBunny documentation and migration guides:

- MediaBunny is positioned as a unified toolkit for reading, writing, and converting media files in the browser.
- It supports reading and writing multiple container formats including `.mp4`, `.mov`, `.webm`, `.mkv`, `.wav`, `.mp3`, `.ogg`, `.aac`, `.flac`, and `.ts`.
- The official `mp4-muxer` and `webm-muxer` docs state that both libraries are deprecated in favor of MediaBunny.
- MediaBunny exposes output targets for in-memory and streamed output.
- MediaBunny warns that some multi-track outputs may buffer packets if tracks are not added in a reasonably interleaved way.

That last point matters for this repo because the current export pipeline is mostly "video first, audio later".

## Main Technical Risk

### Multi-track buffering

Current export flow:

1. Render and encode all video frames.
2. Export audio.
3. Mux and finalize.

MediaBunny supports this kind of workflow, but its docs explicitly warn that some format configurations will buffer packets for multi-track outputs if media is not added in an interleaved order.

Practical implication:

- A direct migration may work functionally but still carry memory pressure on long exports.
- To fully benefit from MediaBunny's pipelined design, MasterSelects should eventually move toward chunked or interleaved audio/video submission.

This should be treated as a known architectural follow-up, not as a reason to block the first migration.

## Migration Strategy

Use an incremental adapter-based migration, not a hard rewrite.

### Principles

- Keep the public export workflow stable.
- Preserve current output behavior before expanding feature scope.
- Migrate by seam, not by library.
- Remove old dependencies only after parity is verified.

## Workstreams

## 1. Export Adapter Spike

### Goal

Prove that MediaBunny can replace the current muxer layer without forcing a rewrite of the render and encode pipeline.

### Deliverables

- Install `mediabunny`.
- Create a small adapter that accepts the same encoded video and audio chunk flow currently used by `VideoEncoderWrapper`.
- Validate `mp4` and `webm` file creation from WebCodecs chunks.
- Confirm output download behavior using in-memory targets.

### Likely touched files

- `package.json`
- `src/engine/export/VideoEncoderWrapper.ts`
- New adapter file under `src/engine/export/`

### Exit criteria

- H.264/AAC MP4 export works.
- VP9 or AV1 WebM export works.
- Existing download flow still works.

## 2. Export Path Migration

### Goal

Replace direct `mp4-muxer` and `webm-muxer` usage in the production export path.

### Tasks

- Introduce a `MediaBunnyMuxerAdapter` or similarly named wrapper.
- Keep `VideoEncoderWrapper` as the stable orchestration layer.
- Preserve current codec selection behavior.
- Preserve current file naming and MIME handling.
- Preserve stacked-alpha output semantics.
- Keep existing progress reporting unchanged where possible.

### Notes

The best outcome is to contain MediaBunny-specific code inside a small adapter instead of scattering it across the export pipeline.

### Exit criteria

- Existing WebCodecs export modes still function.
- No regression in range export, audio inclusion, or file download.
- `mp4-muxer` and `webm-muxer` imports are removed from runtime code.

## 3. Export Memory And Streaming Follow-Up

### Goal

Decide whether to stop at parity or improve the export architecture to better match MediaBunny's pipelined model.

### Tasks

- Measure memory behavior on longer exports.
- Evaluate switching from in-memory targets to streaming targets where appropriate.
- Prototype chunked submission:
  - Encode a chunk of video.
  - Submit matching audio range.
  - Repeat until finalize.
- Determine whether the current "video first, audio later" flow is acceptable for initial rollout.

### Exit criteria

One of the following is documented and accepted:

- Keep current behavior temporarily with known limits.
- Ship a new interleaved export path for lower memory usage.

## 4. Metadata And Track Inspection Migration

### Goal

Start reducing `mp4box` usage in lower-risk helper code before touching deeper playback logic.

### Best first candidates

- `src/stores/mediaStore/helpers/mediaInfoHelpers.ts`
- `src/stores/timeline/helpers/mp4MetadataHelper.ts`
- `src/stores/timeline/helpers/audioDetection.ts`
- `src/services/audioExtractor.ts`

### Tasks

- Replace MP4/MOV metadata parsing helpers with MediaBunny input APIs where feature parity exists.
- Compare codec labeling and duration/fps extraction against current behavior.
- Revalidate audio-track presence detection.
- Revalidate browser-side extraction helpers for supported file types.

### Exit criteria

- Basic media info remains correct for common MP4 and MOV inputs.
- Audio-track detection parity is maintained.
- One or more `mp4box` helper sites are removed cleanly.

## 5. Playback And Advanced Parsing Evaluation

### Goal

Evaluate the harder `mp4box` sites separately instead of forcing them into the first migration.

### Higher-risk candidates

- `src/engine/WebCodecsPlayer.ts`
- `src/engine/ParallelDecodeManager.ts`
- `src/services/proxyGenerator.ts`

### Why this is separate

These areas are closer to sample-level playback and decoding control. They may need a more careful migration or may justify temporarily retaining `mp4box` even after export has moved to MediaBunny.

### Exit criteria

Document one of:

- Full migration path to MediaBunny.
- Hybrid approach with `mp4box` retained temporarily.
- Decision to keep existing parsing in these areas for now.

## 6. Cleanup

### Goal

Remove dead dependencies and update documentation once migration decisions are stable.

### Tasks

- Remove `mp4-muxer` and `webm-muxer` from `package.json`.
- Remove `mp4box` only after all required sites are migrated or intentionally retained elsewhere.
- Update README export and architecture descriptions.
- Update internal docs that still describe the old muxing stack.
- Add tests for the final supported matrix.

## Proposed PR Breakdown

### PR 1

MediaBunny dependency and export adapter spike

### PR 2

Production WebCodecs export migration from `mp4-muxer` and `webm-muxer` to MediaBunny

### PR 3

Export memory and streaming follow-up, if needed

### PR 4

Metadata and audio helper migration away from `mp4box`

### PR 5

Advanced playback/parsing evaluation and decision record

### PR 6

Dependency cleanup and documentation updates

## Testing Plan

### Export regression matrix

Validate at minimum:

- MP4 + H.264 + AAC
- MP4 + H.265 + AAC
- WebM + VP9 + Opus
- WebM + AV1 + Opus, if supported by browser and current app matrix
- Range export with in/out markers
- Export without audio
- Export with audio
- Stacked alpha export
- Custom resolution and custom FPS export

### Metadata and import matrix

Validate at minimum:

- MP4 metadata
- MOV metadata
- Presence or absence of audio tracks
- Codec label extraction
- Duration and FPS extraction

### Stress tests

- Long export memory usage
- Large file metadata reads
- Browser compatibility for current supported export browsers

## Acceptance Criteria

The migration is successful when all of the following are true:

- The production WebCodecs export path no longer depends on `mp4-muxer` or `webm-muxer`.
- Export behavior remains functionally equivalent for currently supported browser formats.
- At least the low-risk `mp4box` helper sites are migrated or intentionally documented as deferred.
- No regression is introduced to the FFmpeg professional-codec path.
- No regression is introduced to the native helper.

## Decision Gates

### Gate 1

Can MediaBunny replace the current muxers without changing export UX or export correctness?

### Gate 2

Is current memory behavior acceptable for initial rollout, or must export become more interleaved first?

### Gate 3

Which `mp4box` sites should migrate now, and which should stay temporarily?

### Gate 4

Can old dependencies be removed immediately, or does the repo need a hybrid period?

## File Impact Overview

### High probability

- `package.json`
- `src/engine/export/VideoEncoderWrapper.ts`
- `src/engine/export/FrameExporter.ts`
- `src/engine/audio/AudioEncoder.ts`

### Medium probability

- `src/services/audioExtractor.ts`
- `src/stores/mediaStore/helpers/mediaInfoHelpers.ts`
- `src/stores/timeline/helpers/mp4MetadataHelper.ts`
- `src/stores/timeline/helpers/audioDetection.ts`

### Deferred / evaluate carefully

- `src/engine/WebCodecsPlayer.ts`
- `src/engine/ParallelDecodeManager.ts`
- `src/services/proxyGenerator.ts`
- `src/engine/ffmpeg/FFmpegBridge.ts`

## Recommendation

The recommended first implementation target is narrow:

1. Migrate the WebCodecs export muxing layer to MediaBunny.
2. Keep FFmpeg WASM untouched.
3. Migrate low-risk `mp4box` helper sites next.
4. Defer deeper playback parsing changes until export parity is stable.

That sequencing delivers real maintenance value quickly without destabilizing the professional-codec or native-helper parts of the product.

## References

- MediaBunny introduction: https://mediabunny.dev/guide/introduction
- MediaBunny writing media files: https://mediabunny.dev/guide/writing-media-files
- MediaBunny output formats: https://mediabunny.dev/guide/output-formats
- MediaBunny supported formats and codecs: https://mediabunny.dev/guide/supported-formats-and-codecs
- `mp4-muxer` deprecation and migration guide:
  - https://vanilagy.github.io/mp4-muxer/
  - https://vanilagy.github.io/mp4-muxer/MIGRATION-GUIDE.html
- `webm-muxer` deprecation and migration guide:
  - https://vanilagy.github.io/webm-muxer/
  - https://vanilagy.github.io/webm-muxer/MIGRATION-GUIDE.html
- MediaBunny repository and license: https://github.com/Vanilagy/mediabunny
