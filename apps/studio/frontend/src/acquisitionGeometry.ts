import type { RenderSettings, VolumeInfo } from './types'

export type Vector3 = [number, number, number]

function tilt(vector: Vector3, tiltXDeg: number, tiltYDeg: number): Vector3 {
  const [x, y, z] = vector
  const rx = tiltXDeg * Math.PI / 180
  const ry = tiltYDeg * Math.PI / 180
  const [cx, sx] = [Math.cos(rx), Math.sin(rx)]
  const [cy, sy] = [Math.cos(ry), Math.sin(ry)]
  const afterX: Vector3 = [x, cx * y - sx * z, sx * y + cx * z]
  return [cy * afterX[0] + sy * afterX[2], afterX[1], -sy * afterX[0] + cy * afterX[2]]
}

const add = (a: Vector3, b: Vector3): Vector3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const subtract = (a: Vector3, b: Vector3): Vector3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (v: Vector3, amount: number): Vector3 => [v[0] * amount, v[1] * amount, v[2] * amount]
const dot = (a: Vector3, b: Vector3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

export function orbitGeometry(settings: RenderSettings) {
  const theta = settings.projection_angle_deg * Math.PI / 180
  const radial = tilt([Math.cos(theta), Math.sin(theta), 0], settings.orbit_tilt_x_deg, settings.orbit_tilt_y_deg)
  const tangent = tilt([-Math.sin(theta), Math.cos(theta), 0], settings.orbit_tilt_x_deg, settings.orbit_tilt_y_deg)
  const normal = tilt([0, 0, 1], settings.orbit_tilt_x_deg, settings.orbit_tilt_y_deg)
  const roll = settings.detector_roll_deg * Math.PI / 180
  const detectorU = add(scale(tangent, Math.cos(roll)), scale(normal, Math.sin(roll)))
  const detectorV = add(scale(tangent, -Math.sin(roll)), scale(normal, Math.cos(roll)))
  const isocenter: Vector3 = [settings.translate_x_mm, settings.translate_y_mm, settings.translate_z_mm]
  const source = add(isocenter, scale(radial, settings.sid_mm))
  const detector = add(
    add(isocenter, scale(radial, -settings.idd_mm)),
    add(scale(detectorU, settings.detector_offset_u_mm), scale(detectorV, settings.detector_offset_v_mm)),
  )
  return { radial, detectorU, detectorV, isocenter, source, detector }
}

export function orientationLetter(vector: Vector3): string {
  let axis = 0
  if (Math.abs(vector[1]) > Math.abs(vector[axis])) axis = 1
  if (Math.abs(vector[2]) > Math.abs(vector[axis])) axis = 2
  return vector[axis] >= 0 ? ['L', 'P', 'S'][axis] : ['R', 'A', 'I'][axis]
}

export function projectionOrientation(settings: RenderSettings) {
  const { detectorU, detectorV } = orbitGeometry(settings)
  return {
    left: orientationLetter(scale(detectorU, -1)),
    right: orientationLetter(detectorU),
    top: orientationLetter(detectorV),
    bottom: orientationLetter(scale(detectorV, -1)),
  }
}

function directed(volume: VolumeInfo, imagePhysical: Vector3): Vector3 {
  const matrix = volume.direction
  return [
    matrix[0][0] * imagePhysical[0] + matrix[0][1] * imagePhysical[1] + matrix[0][2] * imagePhysical[2],
    matrix[1][0] * imagePhysical[0] + matrix[1][1] * imagePhysical[1] + matrix[1][2] * imagePhysical[2],
    matrix[2][0] * imagePhysical[0] + matrix[2][1] * imagePhysical[1] + matrix[2][2] * imagePhysical[2],
  ]
}

export interface AcquisitionMetrics {
  sddMm: number
  magnification: number
  fovAtIsocenterMm: [number, number]
  warnings: string[]
  blockingError: string | null
}

export function acquisitionMetrics(volume: VolumeInfo, settings: RenderSettings): AcquisitionMetrics {
  const sddMm = settings.sid_mm + settings.idd_mm
  const magnification = sddMm / settings.sid_mm
  const detectorWidthMm = settings.detector_width_px * settings.detector_col_spacing_mm
  const detectorHeightMm = settings.detector_height_px * settings.detector_row_spacing_mm
  const fovAtIsocenterMm: [number, number] = [detectorWidthMm / magnification, detectorHeightMm / magnification]
  const { radial, detectorU, detectorV, source, detector } = orbitGeometry(settings)
  const [nz, ny, nx] = volume.shape_zyx
  const [sz, sy, sx] = volume.spacing_zyx_mm
  const extents: Vector3 = [(nx - 1) * sx / 2, (ny - 1) * sy / 2, (nz - 1) * sz / 2]
  const corners: Vector3[] = []
  for (const x of [-extents[0], extents[0]]) for (const y of [-extents[1], extents[1]]) for (const z of [-extents[2], extents[2]]) {
    corners.push(directed(volume, [x, y, z]))
  }
  const detectorHalfWidth = detectorWidthMm / 2
  const detectorHalfHeight = detectorHeightMm / 2
  let clipped = false
  let behindSource = false
  for (const corner of corners) {
    const ray = subtract(corner, source)
    const denominator = dot(ray, radial)
    if (denominator >= -1e-6) {
      behindSource = true
      continue
    }
    const t = -sddMm / denominator
    const hit = add(source, scale(ray, t))
    const relative = subtract(hit, detector)
    if (Math.abs(dot(relative, detectorU)) > detectorHalfWidth || Math.abs(dot(relative, detectorV)) > detectorHalfHeight) clipped = true
  }
  const warnings: string[] = []
  if (clipped) warnings.push('The detector does not cover every volume corner at this geometry; anatomy may be clipped.')
  const blockingError = behindSource ? 'The source lies within or beyond the volume extent. Increase SID or move the isocenter.' : null
  return { sddMm, magnification, fovAtIsocenterMm, warnings, blockingError }
}
