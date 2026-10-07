export type Workspace = 'viewer' | 'acquire' | 'batch' | 'results' | 'settings'
export type BackendName = 'auto' | 'cpu' | 'cuda' | 'mps'
export type ThemePreference = 'system' | 'light' | 'dark'
export type SliceAxis = 'axial' | 'coronal' | 'sagittal'
export type VoxelZYX = [number, number, number]
export type VolumeRenderMode = 'slices' | 'bone' | 'soft-tissue' | 'skin'
export type AdjustableVolumeRenderMode = Exclude<VolumeRenderMode, 'slices'>

export interface VolumeRenderControl {
  shift: number
  opacity: number
}

export interface VolumeRenderState {
  mode: VolumeRenderMode
  controls: Record<AdjustableVolumeRenderMode, VolumeRenderControl>
}

export interface VolumeRenderSettings {
  mode: VolumeRenderMode
  shift: number
  opacity: number
}

export interface VolumeRenderData {
  values: Float32Array
  dimensionsXYZ: [number, number, number]
  spacingXYZ: [number, number, number]
}

export interface WindowLevel {
  center: number
  width: number
}

export interface StudioPreferences {
  theme: ThemePreference
  defaultBackend: BackendName
  defaultCpuWorkers: number
}

export interface VolumeInfo {
  id: string
  filename: string
  shape_zyx: [number, number, number]
  spacing_zyx_mm: [number, number, number]
  origin_zyx_mm: [number, number, number]
  direction: number[][]
  intensity_min: number
  intensity_max: number
  center_world_xyz_mm: [number, number, number]
  orientation_warning: string | null
}

export interface RenderSettings {
  volume_id: string
  projection_angle_deg: number
  sid_mm: number
  idd_mm: number
  detector_height_px: number
  detector_width_px: number
  detector_row_spacing_mm: number
  detector_col_spacing_mm: number
  translate_x_mm: number
  translate_y_mm: number
  translate_z_mm: number
  orbit_tilt_x_deg: number
  orbit_tilt_y_deg: number
  detector_roll_deg: number
  detector_offset_u_mm: number
  detector_offset_v_mm: number
  hu_air_threshold: number | null
  clamp_negative_to_zero: boolean
  invert: boolean
  p_lo: number
  p_hi: number
  backend: BackendName
  cpu_workers: number
}

export interface BatchSettings {
  render: RenderSettings
  start_angle_deg: number
  end_angle_deg: number
  step_deg: number
  shared_normalization: boolean
  include_raw: boolean
}

export interface JobInfo {
  id: string
  kind: 'render' | 'batch'
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number
  message: string
  created_at: string
  started_at: string | null
  completed_at: string | null
  error: string | null
  frame_count: number | null
  current_angle_deg: number | null
  image_url: string | null
  download_url: string | null
  metadata: Record<string, unknown> | null
}

export interface SavedView {
  id: string
  name: string
  settings: RenderSettings
  imageUrl?: string
}

export interface BackendInfo {
  id: Exclude<BackendName, 'auto'>
  label: string
  available: boolean
  detail: string
  package: string | null
  version: string | null
}

export interface PackageInfo {
  name: string
  distribution: string
  installed: boolean
  version: string | null
  required: boolean
}

export interface RuntimeInfo {
  python_executable: string
  python_version: string
  architecture: string
  platform: string
  ready: boolean
  status: string
  resolved_backend: Exclude<BackendName, 'auto'>
  backends: BackendInfo[]
  packages: PackageInfo[]
}
