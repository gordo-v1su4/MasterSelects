import type { ToolDefinition } from '../types';

export const transformToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'setTransform',
      description: 'Set transform properties of a clip: position, scale, rotation, opacity, blend mode. Only provided properties are changed, others remain unchanged.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The clip ID' },
          x: { type: 'number', description: 'Horizontal position (pixels, 0 = center)' },
          y: { type: 'number', description: 'Vertical position (pixels, 0 = center)' },
          scaleX: { type: 'number', description: 'Horizontal scale (1 = 100%)' },
          scaleY: { type: 'number', description: 'Vertical scale (1 = 100%)' },
          rotation: { type: 'number', description: 'Z-axis rotation in degrees' },
          opacity: { type: 'number', description: 'Opacity (0 = transparent, 1 = fully visible)' },
          blendMode: { type: 'string', description: 'Blend mode: normal, multiply, screen, overlay, darken, lighten, colorDodge, colorBurn, hardLight, softLight, difference, exclusion' },
        },
        required: ['clipId'],
      },
    },
  },
];
