import type { SliceAxis, VolumeInfo, VoxelZYX } from './types'

type Vector3 = [number, number, number]

function matrixVector(matrix: number[][], vector: Vector3): Vector3 {
  return [
    matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
    matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
    matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2],
  ]
}

function invert3x3(matrix: number[][]): number[][] {
  const [a, b, c] = matrix[0]
  const [d, e, f] = matrix[1]
  const [g, h, i] = matrix[2]
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
  if (Math.abs(determinant) < 1e-10) throw new Error('The volume direction matrix is not invertible')
  const scale = 1 / determinant
  return [
    [(e * i - f * h) * scale, (c * h - b * i) * scale, (b * f - c * e) * scale],
    [(f * g - d * i) * scale, (a * i - c * g) * scale, (c * d - a * f) * scale],
    [(d * h - e * g) * scale, (b * g - a * h) * scale, (a * e - b * d) * scale],
  ]
}

export function voxelToWorld(volume: VolumeInfo, voxelZYX: VoxelZYX): Vector3 {
  const spacingXYZ: Vector3 = [volume.spacing_zyx_mm[2], volume.spacing_zyx_mm[1], volume.spacing_zyx_mm[0]]
  const originXYZ: Vector3 = [volume.origin_zyx_mm[2], volume.origin_zyx_mm[1], volume.origin_zyx_mm[0]]
  const imagePhysicalXYZ: Vector3 = [
    voxelZYX[2] * spacingXYZ[0],
    voxelZYX[1] * spacingXYZ[1],
    voxelZYX[0] * spacingXYZ[2],
  ]
  const directed = matrixVector(volume.direction, imagePhysicalXYZ)
  return [directed[0] + originXYZ[0], directed[1] + originXYZ[1], directed[2] + originXYZ[2]]
}

export function worldToVoxel(volume: VolumeInfo, worldXYZ: Vector3): VoxelZYX {
  const spacingXYZ: Vector3 = [volume.spacing_zyx_mm[2], volume.spacing_zyx_mm[1], volume.spacing_zyx_mm[0]]
  const originXYZ: Vector3 = [volume.origin_zyx_mm[2], volume.origin_zyx_mm[1], volume.origin_zyx_mm[0]]
  const relative: Vector3 = [worldXYZ[0] - originXYZ[0], worldXYZ[1] - originXYZ[1], worldXYZ[2] - originXYZ[2]]
  const imagePhysical = matrixVector(invert3x3(volume.direction), relative)
  return [imagePhysical[2] / spacingXYZ[2], imagePhysical[1] / spacingXYZ[1], imagePhysical[0] / spacingXYZ[0]]
}

export function clampVoxel(volume: VolumeInfo, voxelZYX: VoxelZYX): VoxelZYX {
  return voxelZYX.map((value, axis) => Math.min(volume.shape_zyx[axis] - 1, Math.max(0, value))) as VoxelZYX
}

function dominantOrientation(vector: Vector3): string {
  let axis = 0
  if (Math.abs(vector[1]) > Math.abs(vector[axis])) axis = 1
  if (Math.abs(vector[2]) > Math.abs(vector[axis])) axis = 2
  const positive = ['L', 'P', 'S']
  const negative = ['R', 'A', 'I']
  return vector[axis] >= 0 ? positive[axis] : negative[axis]
}

function negate(vector: Vector3): Vector3 {
  return [-vector[0], -vector[1], -vector[2]]
}

export function orientationLabels(volume: VolumeInfo, axis: SliceAxis) {
  const column = (index: number): Vector3 => [volume.direction[0][index], volume.direction[1][index], volume.direction[2][index]]
  const horizontal = axis === 'sagittal' ? column(1) : column(0)
  const vertical = axis === 'axial' ? column(1) : column(2)
  return {
    left: dominantOrientation(negate(horizontal)),
    right: dominantOrientation(horizontal),
    top: dominantOrientation(vertical),
    bottom: dominantOrientation(negate(vertical)),
  }
}

export function planeGeometry(volume: VolumeInfo, axis: SliceAxis) {
  const [nz, ny, nx] = volume.shape_zyx
  const [sz, sy, sx] = volume.spacing_zyx_mm
  if (axis === 'axial') return { width: nx * sx, height: ny * sy, maxIndex: nz - 1, indexAxis: 0 as const }
  if (axis === 'coronal') return { width: nx * sx, height: nz * sz, maxIndex: ny - 1, indexAxis: 1 as const }
  return { width: ny * sy, height: nz * sz, maxIndex: nx - 1, indexAxis: 2 as const }
}

export function planePointToVoxel(volume: VolumeInfo, axis: SliceAxis, current: VoxelZYX, xFraction: number, yFraction: number): VoxelZYX {
  const x = Math.min(1, Math.max(0, xFraction))
  const y = Math.min(1, Math.max(0, yFraction))
  const [nz, ny, nx] = volume.shape_zyx
  if (axis === 'axial') return [current[0], (1 - y) * (ny - 1), x * (nx - 1)]
  if (axis === 'coronal') return [(1 - y) * (nz - 1), current[1], x * (nx - 1)]
  return [(1 - y) * (nz - 1), x * (ny - 1), current[2]]
}

export function voxelToPlanePoint(volume: VolumeInfo, axis: SliceAxis, voxel: VoxelZYX) {
  const [nz, ny, nx] = volume.shape_zyx
  if (axis === 'axial') return { x: voxel[2] / Math.max(1, nx - 1), y: 1 - voxel[1] / Math.max(1, ny - 1) }
  if (axis === 'coronal') return { x: voxel[2] / Math.max(1, nx - 1), y: 1 - voxel[0] / Math.max(1, nz - 1) }
  return { x: voxel[1] / Math.max(1, ny - 1), y: 1 - voxel[0] / Math.max(1, nz - 1) }
}
