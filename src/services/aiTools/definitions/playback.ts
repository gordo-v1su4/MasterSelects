import type { ToolDefinition } from '../types';

export const playbackToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'play',
      description: 'Start playback from the current playhead position.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pause',
      description: 'Pause playback.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'setClipSpeed',
      description: 'Set the playback speed of a clip. Also supports reversing.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The clip ID' },
          speed: { type: 'number', description: 'Speed multiplier (0.1 = 10% slow-mo, 1 = normal, 2 = 2x fast, etc.)' },
          reverse: { type: 'boolean', description: 'Play the clip in reverse' },
          preservePitch: { type: 'boolean', description: 'Keep original pitch when changing speed (default: true)' },
        },
        required: ['clipId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'undo',
      description: 'Undo the last action.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'redo',
      description: 'Redo the last undone action.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'addMarker',
      description: 'Add a marker at a specific time on the timeline.',
      parameters: {
        type: 'object',
        properties: {
          time: { type: 'number', description: 'Time in seconds' },
          label: { type: 'string', description: 'Marker label text' },
          color: { type: 'string', description: 'Marker color (CSS color, e.g. "#ff0000", "red")' },
        },
        required: ['time'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getMarkers',
      description: 'Get all timeline markers.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'removeMarker',
      description: 'Remove a timeline marker.',
      parameters: {
        type: 'object',
        properties: {
          markerId: { type: 'string', description: 'The marker ID (from getMarkers)' },
        },
        required: ['markerId'],
      },
    },
  },
];
