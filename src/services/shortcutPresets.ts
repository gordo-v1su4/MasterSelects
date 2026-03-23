// Keyboard Shortcut Presets — NLE-specific default key bindings

import type {
  ShortcutActionId,
  ShortcutActionMeta,
  ShortcutMap,
  ShortcutPreset,
  ShortcutPresetId,
  KeyCombo,
} from './shortcutTypes';

// ─── Action metadata (for Settings UI) ──────────────────────────────

export const ACTION_META: ShortcutActionMeta[] = [
  // Playback
  { id: 'playback.playPause', label: 'Play / Pause', category: 'Playback' },
  { id: 'playback.pause', label: 'Pause', category: 'Playback' },
  { id: 'playback.playForward', label: 'Play Forward', category: 'Playback' },
  { id: 'playback.playReverse', label: 'Play Reverse', category: 'Playback' },
  { id: 'playback.toggleLoop', label: 'Toggle Loop', category: 'Playback' },
  // Navigation
  { id: 'nav.frameForward', label: 'Frame Forward', category: 'Navigation' },
  { id: 'nav.frameBackward', label: 'Frame Backward', category: 'Navigation' },
  // Editing
  { id: 'edit.setIn', label: 'Set In Point', category: 'Editing' },
  { id: 'edit.setOut', label: 'Set Out Point', category: 'Editing' },
  { id: 'edit.clearInOut', label: 'Clear In/Out', category: 'Editing' },
  { id: 'edit.addMarker', label: 'Add Marker', category: 'Editing' },
  { id: 'edit.splitAtPlayhead', label: 'Split at Playhead', category: 'Editing' },
  { id: 'edit.delete', label: 'Delete', category: 'Editing' },
  { id: 'edit.copy', label: 'Copy', category: 'Editing' },
  { id: 'edit.paste', label: 'Paste', category: 'Editing' },
  { id: 'edit.blendModeNext', label: 'Next Blend Mode', category: 'Editing' },
  { id: 'edit.blendModePrev', label: 'Previous Blend Mode', category: 'Editing' },
  // Tools
  { id: 'tool.cutToggle', label: 'Cut / Razor Tool', category: 'Tools' },
  // Project
  { id: 'project.new', label: 'New Project', category: 'Project' },
  { id: 'project.open', label: 'Open Project', category: 'Project' },
  { id: 'project.save', label: 'Save', category: 'Project' },
  { id: 'project.saveAs', label: 'Save As', category: 'Project' },
  // History
  { id: 'history.undo', label: 'Undo', category: 'History' },
  { id: 'history.redo', label: 'Redo', category: 'History' },
];

// All valid action IDs (for runtime validation)
export const ALL_ACTION_IDS: ShortcutActionId[] = ACTION_META.map((m) => m.id);

// ─── Base map (shared across all NLEs) ──────────────────────────────

const BASE_MAP: ShortcutMap = {
  // Playback
  'playback.playPause': [{ code: 'Space' }],
  'playback.pause': [{ key: 'k' }],
  'playback.playForward': [{ key: 'l' }],
  'playback.playReverse': [{ key: 'j' }],
  'playback.toggleLoop': [{ key: 'l', shift: true }],
  // Navigation
  'nav.frameForward': [{ key: 'arrowright' }],
  'nav.frameBackward': [{ key: 'arrowleft' }],
  // In/Out
  'edit.setIn': [{ key: 'i' }],
  'edit.setOut': [{ key: 'o' }],
  'edit.clearInOut': [{ key: 'x' }],
  // Markers
  'edit.addMarker': [{ key: 'm' }],
  // Delete (two keys)
  'edit.delete': [{ key: 'delete' }, { key: 'backspace' }],
  // Copy/Paste
  'edit.copy': [{ key: 'c', ctrl: true }],
  'edit.paste': [{ key: 'v', ctrl: true }],
  // Blend modes
  'edit.blendModeNext': [{ code: 'NumpadAdd' }, { key: '+' }],
  'edit.blendModePrev': [{ code: 'NumpadSubtract' }, { key: '-' }],
  // Project
  'project.new': [{ key: 'n', ctrl: true }],
  'project.open': [{ key: 'o', ctrl: true }],
  'project.save': [{ key: 's', ctrl: true }],
  'project.saveAs': [{ key: 's', ctrl: true, shift: true }],
  // History
  'history.undo': [{ key: 'z', ctrl: true }],
  'history.redo': [{ key: 'z', ctrl: true, shift: true }, { key: 'y', ctrl: true }],
  // Overridden per preset:
  'tool.cutToggle': [{ key: 'c' }],
  'edit.splitAtPlayhead': [{ key: 'c', shift: true }],
};

// ─── Helper: create preset by overriding base ───────────────────────

function createPreset(
  id: ShortcutPresetId,
  label: string,
  overrides: Partial<Record<ShortcutActionId, KeyCombo[]>>,
): ShortcutPreset {
  return {
    id,
    label,
    map: { ...BASE_MAP, ...overrides },
  };
}

// ─── Presets ─────────────────────────────────────────────────────────

const masterselects = createPreset('masterselects', 'MasterSelects', {
  // Default — no overrides, uses BASE_MAP as-is
});

const premiere = createPreset('premiere', 'Premiere Pro', {
  // C = Razor tool (same as default)
  'tool.cutToggle': [{ key: 'c' }],
  // Ctrl+K = Split (Add to playhead)
  'edit.splitAtPlayhead': [{ key: 'k', ctrl: true }],
});

const davinci = createPreset('davinci', 'DaVinci Resolve', {
  // B = Blade tool
  'tool.cutToggle': [{ key: 'b' }],
  // Ctrl+B = Split at playhead
  'edit.splitAtPlayhead': [{ key: 'b', ctrl: true }],
});

const finalcut = createPreset('finalcut', 'Final Cut Pro', {
  // B = Blade tool
  'tool.cutToggle': [{ key: 'b' }],
  // Ctrl+B = Split at playhead (Cmd+B on Mac, ctrl maps to both)
  'edit.splitAtPlayhead': [{ key: 'b', ctrl: true }],
});

const aftereffects = createPreset('aftereffects', 'After Effects', {
  // C = Razor (same as default)
  'tool.cutToggle': [{ key: 'c' }],
  // Ctrl+Shift+D = Split layer
  'edit.splitAtPlayhead': [{ key: 'd', ctrl: true, shift: true }],
});

const beginner = createPreset('beginner', 'Beginner', {
  // Same as MasterSelects default — simplest layout
});

// ─── Exports ─────────────────────────────────────────────────────────

export const PRESETS: Record<ShortcutPresetId, ShortcutPreset> = {
  masterselects,
  premiere,
  davinci,
  finalcut,
  aftereffects,
  beginner,
};

export const PRESET_LIST: ShortcutPreset[] = [
  masterselects,
  premiere,
  davinci,
  finalcut,
  aftereffects,
  beginner,
];

export const DEFAULT_PRESET_ID: ShortcutPresetId = 'masterselects';
