import type {
  AdjustableVolumeRenderMode,
  VolumeRenderSettings,
  VolumeRenderState,
} from './types'

export interface TransferPreset {
  label: string
  colors: Array<[number, number, number, number]>
  opacities: Array<[number, number]>
}

export const VOLUME_RENDER_OPTIONS: Array<{ mode: VolumeRenderState['mode']; label: string }> = [
  { mode: 'slices', label: 'Slices' },
  { mode: 'bone', label: 'Bone' },
  { mode: 'soft-tissue', label: 'Soft tissue' },
  { mode: 'skin', label: 'Skin' },
]

export const DEFAULT_RENDER_CONTROLS: VolumeRenderState['controls'] = {
  bone: { shift: 0, opacity: 1 },
  'soft-tissue': { shift: 0, opacity: 1 },
  skin: { shift: 0, opacity: 1 },
}

// Slice PNGs are flipped vertically by the local API for browser top-left image
// coordinates. vtkImageData uses its first pixel row at texture Y=0, so undo
// that display flip before mapping the same pixels into physical 3D space.
export const VTK_SLICE_TEXTURE_TRANSFORM = {
  flipX: false,
  flipY: true,
  rotate: 0,
}

export const TRANSFER_PRESETS: Record<AdjustableVolumeRenderMode, TransferPreset> = {
  bone: {
    label: 'Bone',
    colors: [
      [-1000, 0.08, 0.06, 0.05],
      [150, 0.32, 0.20, 0.14],
      [450, 0.78, 0.66, 0.50],
      [900, 0.95, 0.91, 0.80],
      [2500, 1.0, 1.0, 0.98],
    ],
    opacities: [[-1000, 0], [150, 0], [300, 0.035], [700, 0.22], [1400, 0.52], [3000, 0.82]],
  },
  'soft-tissue': {
    label: 'Soft tissue',
    colors: [
      [-1000, 0.14, 0.04, 0.03],
      [-120, 0.35, 0.10, 0.08],
      [20, 0.72, 0.34, 0.27],
      [90, 0.95, 0.64, 0.52],
      [350, 0.96, 0.83, 0.67],
      [1200, 1.0, 0.98, 0.91],
    ],
    opacities: [[-1000, 0], [-180, 0], [-80, 0.018], [25, 0.075], [100, 0.15], [350, 0.12], [1000, 0.08], [2500, 0.04]],
  },
  skin: {
    label: 'Skin',
    colors: [
      [-1000, 0.16, 0.03, 0.03],
      [-220, 0.52, 0.14, 0.12],
      [-80, 0.88, 0.42, 0.33],
      [80, 1.0, 0.70, 0.58],
      [450, 0.98, 0.82, 0.70],
    ],
    opacities: [[-1000, 0], [-280, 0], [-160, 0.012], [-70, 0.095], [80, 0.14], [300, 0.08], [900, 0.025], [2500, 0.01]],
  },
}

export function defaultVolumeRenderState(): VolumeRenderState {
  return {
    mode: 'slices',
    controls: {
      bone: { ...DEFAULT_RENDER_CONTROLS.bone },
      'soft-tissue': { ...DEFAULT_RENDER_CONTROLS['soft-tissue'] },
      skin: { ...DEFAULT_RENDER_CONTROLS.skin },
    },
  }
}

export function activeVolumeRenderSettings(state: VolumeRenderState): VolumeRenderSettings {
  if (state.mode === 'slices') return { mode: 'slices', shift: 0, opacity: 1 }
  return { mode: state.mode, ...state.controls[state.mode] }
}

export function volumeRenderLabel(rendering: VolumeRenderSettings) {
  return rendering.mode === 'slices' ? 'Slice planes' : TRANSFER_PRESETS[rendering.mode].label
}

export type Point3 = [number, number, number]

export function directionMatrix(direction: number[][]) {
  return [
    direction[0][0], direction[1][0], direction[2][0], 0,
    direction[0][1], direction[1][1], direction[2][1], 0,
    direction[0][2], direction[1][2], direction[2][2], 0,
    0, 0, 0, 1,
  ] as never
}

export function imageDirection(direction: number[][]) {
  return [
    direction[0][0], direction[1][0], direction[2][0],
    direction[0][1], direction[1][1], direction[2][1],
    direction[0][2], direction[1][2], direction[2][2],
  ] as never
}

export function directedPoint(direction: number[][], point: Point3): Point3 {
  return [
    direction[0][0] * point[0] + direction[0][1] * point[1] + direction[0][2] * point[2],
    direction[1][0] * point[0] + direction[1][1] * point[1] + direction[1][2] * point[2],
    direction[2][0] * point[0] + direction[2][1] * point[1] + direction[2][2] * point[2],
  ]
}
