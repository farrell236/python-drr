import { describe, expect, it } from 'vitest'
import { acquisitionReadiness } from './acquisitionGeometry'
import type { RenderSettings, RuntimeInfo, VolumeInfo } from './types'

const settings: RenderSettings = {
  volume_id: 'volume',
  projection_angle_deg: 0,
  sid_mm: 1000,
  idd_mm: 500,
  detector_height_px: 512,
  detector_width_px: 512,
  detector_row_spacing_mm: 0.51,
  detector_col_spacing_mm: 0.51,
  translate_x_mm: 0,
  translate_y_mm: 0,
  translate_z_mm: 0,
  orbit_tilt_x_deg: 0,
  orbit_tilt_y_deg: 0,
  detector_roll_deg: 0,
  detector_offset_u_mm: 0,
  detector_offset_v_mm: 0,
  hu_air_threshold: -900,
  clamp_negative_to_zero: true,
  projection_model: 'raw',
  invert: true,
  p_lo: 1,
  p_hi: 99.5,
  backend: 'auto',
  cpu_workers: 1,
}

const volume: VolumeInfo = {
  id: 'volume',
  filename: 'scan.nii.gz',
  shape_zyx: [32, 32, 32],
  spacing_zyx_mm: [1, 1, 1],
  origin_zyx_mm: [0, 0, 0],
  direction: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  intensity_min: -1000,
  intensity_max: 1800,
  center_world_xyz_mm: [15.5, 15.5, 15.5],
  geometry_valid: true,
  orientation_warning: null,
  session_id: 'session',
}

const runtime: RuntimeInfo = {
  python_executable: '/python',
  python_version: '3.14',
  architecture: 'arm64',
  platform: 'macOS',
  ready: true,
  status: 'Ready',
  resolved_backend: 'cpu',
  backends: [{ id: 'cpu', label: 'CPU', available: true, detail: 'Ready', package: null, version: null }],
  packages: [],
}

describe('acquisitionReadiness', () => {
  it('accepts valid geometry on an available backend', () => {
    expect(acquisitionReadiness(volume, settings, runtime).ready).toBe(true)
  })

  it('blocks both acquisition workflows when runtime or volume geometry is invalid', () => {
    expect(acquisitionReadiness(volume, settings, { ...runtime, ready: false, status: 'Missing packages' })).toMatchObject({ ready: false, message: 'Missing packages' })
    expect(acquisitionReadiness({ ...volume, geometry_valid: false }, settings, runtime)).toMatchObject({ ready: false, message: 'Volume geometry is not valid for acquisition' })
  })
})
