import { useEffect, useMemo, useRef, useState } from 'react'
import '@kitware/vtk.js/Rendering/Profiles/Geometry'
import '@kitware/vtk.js/Rendering/Profiles/Volume'
// @ts-expect-error vtk.js exposes a runtime default that is missing from its declaration file.
import vtkImageHelper from '@kitware/vtk.js/Common/Core/ImageHelper'
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray'
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData'
import vtkPoints from '@kitware/vtk.js/Common/Core/Points'
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData'
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction'
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor'
import vtkAxesActor from '@kitware/vtk.js/Rendering/Core/AxesActor'
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction'
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper'
import vtkPixelSpaceCallbackMapper from '@kitware/vtk.js/Rendering/Core/PixelSpaceCallbackMapper'
import vtkTexture from '@kitware/vtk.js/Rendering/Core/Texture'
import vtkVolume from '@kitware/vtk.js/Rendering/Core/Volume'
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper'
import vtkCubeSource from '@kitware/vtk.js/Filters/Sources/CubeSource'
import vtkLineSource from '@kitware/vtk.js/Filters/Sources/LineSource'
import vtkPlaneSource from '@kitware/vtk.js/Filters/Sources/PlaneSource'
import vtkRegularPolygonSource from '@kitware/vtk.js/Filters/Sources/RegularPolygonSource'
import vtkSphereSource from '@kitware/vtk.js/Filters/Sources/SphereSource'
import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow'
import vtkInteractorStyleManipulator from '@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator'
import vtkMouseCameraTrackballRotateManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballRotateManipulator'
import vtkMouseCameraTrackballZoomManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballZoomManipulator'
import vtkGestureCameraManipulator from '@kitware/vtk.js/Interaction/Manipulators/GestureCameraManipulator'
import { RotateCcw } from 'lucide-react'
import { getVolumeRenderData, volumeSliceUrl } from '../api'
import type { RenderSettings, VolumeInfo, VolumeRenderSettings, WindowLevel } from '../types'
import { clampVoxel, worldToVoxel } from '../viewerGeometry'
import { directedPoint, directionMatrix, imageDirection, TRANSFER_PRESETS, volumeRenderLabel } from '../volumeRendering'

interface Props {
  volume: VolumeInfo
  settings: RenderSettings
  windowLevel: WindowLevel
  rendering: VolumeRenderSettings
  compact?: boolean
  showOrbit?: boolean
  orbitSampleAngles?: readonly number[]
}

const EMPTY_ORBIT_SAMPLE_ANGLES: readonly number[] = []
type VolumeLoadState = 'idle' | 'loading' | 'ready' | 'error'

function tiltOrbitVector(vector: [number, number, number], tiltXDeg: number, tiltYDeg: number): [number, number, number] {
  const [x, y, z] = vector
  const rx = tiltXDeg * Math.PI / 180
  const ry = tiltYDeg * Math.PI / 180
  const [cx, sx] = [Math.cos(rx), Math.sin(rx)]
  const [cy, sy] = [Math.cos(ry), Math.sin(ry)]
  const afterX: [number, number, number] = [x, cx * y - sx * z, sx * y + cx * z]
  return [cy * afterX[0] + sy * afterX[2], afterX[1], -sy * afterX[0] + cy * afterX[2]]
}

function addVectors(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function scaleVector(vector: [number, number, number], scale: number): [number, number, number] {
  return [vector[0] * scale, vector[1] * scale, vector[2] * scale]
}

function addActor(renderer: ReturnType<ReturnType<typeof vtkGenericRenderWindow.newInstance>['getRenderer']>, source: { getOutputPort: () => unknown }, color: [number, number, number], opacity = 1) {
  const mapper = vtkMapper.newInstance()
  mapper.setInputConnection(source.getOutputPort() as never)
  const actor = vtkActor.newInstance()
  actor.setMapper(mapper)
  actor.getProperty().setColor(...color)
  actor.getProperty().setOpacity(opacity)
  renderer.addActor(actor)
  return actor
}

export function AcquisitionScene({ volume, settings, windowLevel, rendering, compact = false, showOrbit = false, orbitSampleAngles = EMPTY_ORBIT_SAMPLE_ANGLES }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const markerOverlayRef = useRef<HTMLDivElement>(null)
  const resetCameraRef = useRef<() => void>(() => undefined)
  const updateGeometryRef = useRef<(next: RenderSettings) => void>(() => undefined)
  const updatePatientSlicesRef = useRef<(next: RenderSettings, nextWindowLevel: WindowLevel) => void>(() => undefined)
  const updatePatientRenderingRef = useRef<(next: VolumeRenderSettings) => void>(() => undefined)
  const loadVolumeRef = useRef<() => Promise<void>>(async () => undefined)
  const renderingRef = useRef(rendering)
  const [loadState, setLoadState] = useState<VolumeLoadState>('idle')
  const [loadError, setLoadError] = useState('')
  renderingRef.current = rendering
  const displayedSampleAngles = useMemo(() => {
    const markerStride = Math.max(1, Math.ceil(orbitSampleAngles.length / 140))
    return orbitSampleAngles.filter((_, index) => index % markerStride === 0 || index === orbitSampleAngles.length - 1)
  }, [orbitSampleAngles])

  useEffect(() => {
    if (!containerRef.current) return
    setLoadState('idle')
    setLoadError('')
    let disposed = false
    let volumeReady = false
    let localLoadState: VolumeLoadState = 'idle'
    const abortController = new AbortController()
    const genericWindow = vtkGenericRenderWindow.newInstance({ background: [0.76, 0.84, 0.9] })
    genericWindow.setContainer(containerRef.current)
    const renderer = genericWindow.getRenderer()
    const renderWindow = genericWindow.getRenderWindow()
    renderer.setBackground(0.72, 0.81, 0.88)
    renderer.setBackground2(0.94, 0.97, 0.99)
    renderer.setGradientBackground(true)

    const interactionStyle = vtkInteractorStyleManipulator.newInstance()
    interactionStyle.addMouseManipulator(vtkMouseCameraTrackballRotateManipulator.newInstance({ button: 1 }))
    interactionStyle.addGestureManipulator(vtkGestureCameraManipulator.newInstance())
    interactionStyle.addMouseManipulator(vtkMouseCameraTrackballZoomManipulator.newInstance({ button: 3 }))
    interactionStyle.addMouseManipulator(vtkMouseCameraTrackballZoomManipulator.newInstance({ dragEnabled: false, scrollEnabled: true }))
    renderWindow.getInteractor().setInteractorStyle(interactionStyle)

    const [nz, ny, nx] = volume.shape_zyx
    const [sz, sy, sx] = volume.spacing_zyx_mm
    const sizeX = Math.max(sx, (nx - 1) * sx)
    const sizeY = Math.max(sy, (ny - 1) * sy)
    const sizeZ = Math.max(sz, (nz - 1) * sz)
    const axesLength = Math.max(100, Math.min(150, Math.max(sizeX, sizeY, sizeZ) * 0.24))

    const transform = directionMatrix(volume.direction)
    const boundsSource = vtkCubeSource.newInstance({ xLength: sizeX, yLength: sizeY, zLength: sizeZ })
    const boundsActor = addActor(renderer, boundsSource, [0.1, 0.34, 0.58], 0.16)
    boundsActor.getProperty().setRepresentationToWireframe()
    boundsActor.getProperty().setLineWidth(1)
    boundsActor.setUserMatrix(transform)

    const axialSource = vtkPlaneSource.newInstance({ xResolution: 1, yResolution: 1 })
    const coronalSource = vtkPlaneSource.newInstance({ xResolution: 1, yResolution: 1 })
    const sagittalSource = vtkPlaneSource.newInstance({ xResolution: 1, yResolution: 1 })
    const planeActors = [
      addActor(renderer, axialSource, [1, 1, 1]),
      addActor(renderer, coronalSource, [1, 1, 1]),
      addActor(renderer, sagittalSource, [1, 1, 1]),
    ]
    planeActors.forEach((actor) => {
      actor.setUserMatrix(transform)
      actor.getProperty().setEdgeVisibility(true)
      actor.getProperty().setLineWidth(1.2)
      actor.getProperty().setLighting(false)
      actor.setForceOpaque(true)
    })
    planeActors[0].getProperty().setEdgeColor(0.94, 0.28, 0.31)
    planeActors[1].getProperty().setEdgeColor(0.29, 0.78, 0.47)
    planeActors[2].getProperty().setEdgeColor(0.96, 0.77, 0.22)
    const planeTextures = planeActors.map(() => vtkTexture.newInstance({ interpolate: true, edgeClamp: true }))

    const patientVolumeMapper = vtkVolumeMapper.newInstance()
    patientVolumeMapper.setAutoAdjustSampleDistances(true)
    patientVolumeMapper.setInteractionSampleDistanceFactor(1.7)
    const patientVolumeActor = vtkVolume.newInstance()
    patientVolumeActor.setMapper(patientVolumeMapper)
    patientVolumeActor.setVisibility(false)
    const colorTransfer = vtkColorTransferFunction.newInstance()
    const opacityTransfer = vtkPiecewiseFunction.newInstance()
    const volumeProperty = patientVolumeActor.getProperty()
    volumeProperty.setRGBTransferFunction(0, colorTransfer)
    volumeProperty.setScalarOpacity(0, opacityTransfer)
    volumeProperty.setInterpolationTypeToLinear()
    volumeProperty.setShade(true)
    volumeProperty.setAmbient(0.32)
    volumeProperty.setDiffuse(0.72)
    volumeProperty.setSpecular(0.15)
    volumeProperty.setSpecularPower(12)
    renderer.addVolume(patientVolumeActor)

    const applyPatientRendering = (next: VolumeRenderSettings) => {
      const showSlices = next.mode === 'slices' || (localLoadState === 'error' && !volumeReady)
      planeActors.forEach((actor) => actor.setVisibility(showSlices))
      patientVolumeActor.setVisibility(!showSlices && volumeReady)
      if (next.mode !== 'slices') {
        const preset = TRANSFER_PRESETS[next.mode]
        colorTransfer.removeAllPoints()
        preset.colors.forEach(([value, red, green, blue]) => colorTransfer.addRGBPoint(value + next.shift, red, green, blue))
        opacityTransfer.removeAllPoints()
        preset.opacities.forEach(([value, opacity]) => opacityTransfer.addPoint(value + next.shift, Math.min(1, opacity * next.opacity)))
      }
      renderer.resetCameraClippingRange()
      renderWindow.render()
    }
    updatePatientRenderingRef.current = applyPatientRendering

    const loadVolume = async () => {
      if (localLoadState === 'loading' || localLoadState === 'ready') return
      localLoadState = 'loading'
      setLoadState('loading')
      setLoadError('')
      try {
        const renderData = await getVolumeRenderData(volume.id, abortController.signal)
        if (disposed) return
        const [dataX, dataY, dataZ] = renderData.dimensionsXYZ
        const [spacingX, spacingY, spacingZ] = renderData.spacingXYZ
        const imageData = vtkImageData.newInstance()
        imageData.setDimensions(dataX, dataY, dataZ)
        imageData.setSpacing([spacingX, spacingY, spacingZ])
        imageData.setDirection(imageDirection(volume.direction))
        imageData.setOrigin(directedPoint(volume.direction, [
          -((dataX - 1) * spacingX) / 2,
          -((dataY - 1) * spacingY) / 2,
          -((dataZ - 1) * spacingZ) / 2,
        ]))
        imageData.getPointData().setScalars(vtkDataArray.newInstance({
          name: 'CT intensity',
          numberOfComponents: 1,
          values: renderData.values,
        }))
        patientVolumeMapper.setInputData(imageData)
        patientVolumeMapper.setSampleDistance(Math.max(0.35, Math.min(spacingX, spacingY, spacingZ) * 0.7))
        volumeProperty.setScalarOpacityUnitDistance(0, Math.max(spacingX, spacingY, spacingZ))
        volumeReady = true
        localLoadState = 'ready'
        setLoadState('ready')
        applyPatientRendering(renderingRef.current)
      } catch (error) {
        if (disposed || (error instanceof DOMException && error.name === 'AbortError')) return
        localLoadState = 'error'
        setLoadState('error')
        setLoadError(error instanceof Error ? error.message : 'Could not prepare this volume for 3D rendering.')
        applyPatientRendering(renderingRef.current)
      }
    }
    loadVolumeRef.current = loadVolume

    const textureUrls = ['', '', '']
    const textureRevisions = [0, 0, 0]
    const updatePatientSlices = (next: RenderSettings, nextWindowLevel: WindowLevel) => {
      const isocenterWorld: [number, number, number] = [
        volume.center_world_xyz_mm[0] + next.translate_x_mm,
        volume.center_world_xyz_mm[1] + next.translate_y_mm,
        volume.center_world_xyz_mm[2] + next.translate_z_mm,
      ]
      const voxel = clampVoxel(volume, worldToVoxel(volume, isocenterWorld))
      const x = (voxel[2] - (nx - 1) / 2) * sx
      const y = (voxel[1] - (ny - 1) / 2) * sy
      const z = (voxel[0] - (nz - 1) / 2) * sz

      axialSource.setOrigin(-sizeX / 2, -sizeY / 2, z)
      axialSource.setPoint1(sizeX / 2, -sizeY / 2, z)
      axialSource.setPoint2(-sizeX / 2, sizeY / 2, z)
      coronalSource.setOrigin(-sizeX / 2, y, -sizeZ / 2)
      coronalSource.setPoint1(sizeX / 2, y, -sizeZ / 2)
      coronalSource.setPoint2(-sizeX / 2, y, sizeZ / 2)
      sagittalSource.setOrigin(x, -sizeY / 2, -sizeZ / 2)
      sagittalSource.setPoint1(x, sizeY / 2, -sizeZ / 2)
      sagittalSource.setPoint2(x, -sizeY / 2, sizeZ / 2)

      const indices = [Math.round(voxel[0]), Math.round(voxel[1]), Math.round(voxel[2])]
      ;(['axial', 'coronal', 'sagittal'] as const).forEach((axis, axisIndex) => {
        const url = volumeSliceUrl(volume.id, axis, indices[axisIndex], nextWindowLevel.center, nextWindowLevel.width)
        if (url === textureUrls[axisIndex]) return
        textureUrls[axisIndex] = url
        textureRevisions[axisIndex] += 1
        const revision = textureRevisions[axisIndex]
        const image = new Image()
        image.decoding = 'async'
        image.onload = () => {
          if (disposed || revision !== textureRevisions[axisIndex]) return
          const texture = planeTextures[axisIndex]
          texture.setInputData(vtkImageHelper.imageToImageData(image))
          if (!planeActors[axisIndex].hasTexture(texture)) planeActors[axisIndex].addTexture(texture)
          renderWindow.render()
        }
        image.src = url
      })
      renderer.resetCameraClippingRange()
      renderWindow.render()
    }
    updatePatientSlicesRef.current = updatePatientSlices
    updatePatientSlices(settings, windowLevel)
    applyPatientRendering(renderingRef.current)

    const sourceSphere = vtkSphereSource.newInstance({ radius: Math.max(18, Math.min(42, sizeX * 0.08)), thetaResolution: 24, phiResolution: 16 })
    const sourceActor = addActor(renderer, sourceSphere, [1, 0.48, 0.14])

    const detectorSource = vtkCubeSource.newInstance({ xLength: 12, yLength: 1, zLength: 1 })
    const detectorActor = addActor(renderer, detectorSource, [0.15, 0.43, 0.68], 0.76)

    const centralRaySource = vtkLineSource.newInstance({ point1: [0, 0, 0], point2: [1, 0, 0] })
    const centralRayActor = addActor(renderer, centralRaySource, [0.12, 0.38, 0.62], 0.4)
    centralRayActor.getProperty().setLineWidth(1.25)
    const cornerRaySources = Array.from({ length: 4 }, () => vtkLineSource.newInstance({ point1: [0, 0, 0], point2: [1, 0, 0] }))
    cornerRaySources.forEach((ray) => {
      const actor = addActor(renderer, ray, [0.18, 0.48, 0.7], 0.09)
      actor.getProperty().setLineWidth(1)
    })

    const orbitSource = showOrbit ? vtkRegularPolygonSource.newInstance({
      numberOfSides: 160,
      center: [0, 0, 0],
      normal: [0, 0, 1],
      radius: settings.sid_mm,
      generatePolygon: false,
      generatePolyline: true,
    }) : null
    if (orbitSource) {
      const orbitOuterGlow = addActor(renderer, orbitSource, [0.38, 0.7, 0.9], 0.035)
      orbitOuterGlow.getProperty().setLineWidth(11)
      const orbitInnerGlow = addActor(renderer, orbitSource, [0.34, 0.66, 0.87], 0.09)
      orbitInnerGlow.getProperty().setLineWidth(5)
      const orbitActor = addActor(renderer, orbitSource, [0.22, 0.51, 0.73], 0.4)
      orbitActor.getProperty().setLineWidth(1)
    }

    const visibleSampleAngles = showOrbit ? displayedSampleAngles : EMPTY_ORBIT_SAMPLE_ANGLES
    const snapshotPoints = vtkPoints.newInstance()
    const snapshotData = vtkPolyData.newInstance()
    let activeSnapshotIndex = -1
    {
      snapshotPoints.setNumberOfPoints(visibleSampleAngles.length + 4, 3)
      snapshotData.setPoints(snapshotPoints)
      const snapshotMapper = vtkPixelSpaceCallbackMapper.newInstance()
      snapshotMapper.setInputData(snapshotData)
      snapshotMapper.setCallback((coords) => {
        const overlay = markerOverlayRef.current
        if (!overlay) return
        const renderSize = genericWindow.getApiSpecificRenderWindow().getSize()
        const scaleX = overlay.clientWidth / renderSize[0]
        const scaleY = overlay.clientHeight / renderSize[1]
        const markers = Array.from(overlay.children) as HTMLElement[]
        const isocenterCoord = coords[visibleSampleAngles.length]
        if (!isocenterCoord) return
        const isocenterX = isocenterCoord[0] * scaleX
        const isocenterY = (renderSize[1] - isocenterCoord[1]) * scaleY
        coords.slice(0, visibleSampleAngles.length).forEach((coord, index) => {
          const marker = markers[index]
          if (!marker) return
          const x = coord[0] * scaleX
          const y = (renderSize[1] - coord[1]) * scaleY
          const direction = Math.atan2(isocenterY - y, isocenterX - x) * 180 / Math.PI
          marker.style.left = `${x}px`
          marker.style.top = `${y}px`
          marker.style.transform = `translate(-50%, -50%) rotate(${direction}deg)`
          const onScreen = x >= -24 && x <= overlay.clientWidth + 24 && y >= -24 && y <= overlay.clientHeight + 24
          marker.style.opacity = onScreen && index !== activeSnapshotIndex ? '1' : '0'
        })
        const axisLabels = Array.from(overlay.querySelectorAll<HTMLElement>('.isocenter-axis-label'))
        coords.slice(visibleSampleAngles.length + 1, visibleSampleAngles.length + 4).forEach((coord, index) => {
          const label = axisLabels[index]
          if (!label) return
          const x = coord[0] * scaleX
          const y = (renderSize[1] - coord[1]) * scaleY
          const dx = x - isocenterX
          const dy = y - isocenterY
          const length = Math.hypot(dx, dy) || 1
          label.style.left = `${x + dx / length * 7}px`
          label.style.top = `${y + dy / length * 7}px`
        })
      })
      const snapshotActor = vtkActor.newInstance()
      snapshotActor.setMapper(snapshotMapper)
      renderer.addActor(snapshotActor)
    }

    const isoSource = vtkSphereSource.newInstance({ radius: Math.max(8, sizeX * 0.025), thetaResolution: 18, phiResolution: 12 })
    const isoActor = addActor(renderer, isoSource, [0.22, 0.82, 0.58])
    const isoAxesActor = vtkAxesActor.newInstance({
      config: { recenter: false, tipResolution: 20, tipRadius: 0.11, tipLength: 0.24, shaftResolution: 16, shaftRadius: 0.024 },
      xConfig: { color: [219, 72, 69] },
      yConfig: { color: [42, 157, 103] },
      zConfig: { color: [56, 118, 210] },
    } as never)
    isoAxesActor.setScale(axesLength, axesLength, axesLength)
    renderer.addActor(isoAxesActor)

    const updateGeometry = (next: RenderSettings) => {
      const theta = next.projection_angle_deg * Math.PI / 180
      const isocenter: [number, number, number] = [next.translate_x_mm, next.translate_y_mm, next.translate_z_mm]
      const radial = tiltOrbitVector([Math.cos(theta), Math.sin(theta), 0], next.orbit_tilt_x_deg, next.orbit_tilt_y_deg)
      const tangent = tiltOrbitVector([-Math.sin(theta), Math.cos(theta), 0], next.orbit_tilt_x_deg, next.orbit_tilt_y_deg)
      const orbitNormal = tiltOrbitVector([0, 0, 1], next.orbit_tilt_x_deg, next.orbit_tilt_y_deg)
      const roll = next.detector_roll_deg * Math.PI / 180
      const detectorU = addVectors(scaleVector(tangent, Math.cos(roll)), scaleVector(orbitNormal, Math.sin(roll)))
      const detectorV = addVectors(scaleVector(tangent, -Math.sin(roll)), scaleVector(orbitNormal, Math.cos(roll)))
      const sourcePosition = addVectors(isocenter, scaleVector(radial, next.sid_mm))
      const detectorPosition = addVectors(
        addVectors(isocenter, scaleVector(radial, -next.idd_mm)),
        addVectors(scaleVector(detectorU, next.detector_offset_u_mm), scaleVector(detectorV, next.detector_offset_v_mm)),
      )
      const detectorWidth = next.detector_width_px * next.detector_col_spacing_mm
      const detectorHeight = next.detector_height_px * next.detector_row_spacing_mm

      isoActor.setPosition(...isocenter)
      isoAxesActor.setPosition(...isocenter)
      sourceActor.setPosition(...sourcePosition)
      detectorSource.setYLength(detectorWidth)
      detectorSource.setZLength(detectorHeight)
      detectorActor.setUserMatrix([
        radial[0], radial[1], radial[2], 0,
        detectorU[0], detectorU[1], detectorU[2], 0,
        detectorV[0], detectorV[1], detectorV[2], 0,
        detectorPosition[0], detectorPosition[1], detectorPosition[2], 1,
      ] as never)
      centralRaySource.setPoint1(...sourcePosition)
      centralRaySource.setPoint2(...detectorPosition)
      const corners: Array<[number, number, number]> = [[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]].map(([uSign, vSign]) => [
        detectorPosition[0] + uSign * detectorWidth * 0.5 * detectorU[0] + vSign * detectorHeight * 0.5 * detectorV[0],
        detectorPosition[1] + uSign * detectorWidth * 0.5 * detectorU[1] + vSign * detectorHeight * 0.5 * detectorV[1],
        detectorPosition[2] + uSign * detectorWidth * 0.5 * detectorU[2] + vSign * detectorHeight * 0.5 * detectorV[2],
      ])
      cornerRaySources.forEach((ray, index) => {
        ray.setPoint1(...sourcePosition)
        ray.setPoint2(...corners[index])
      })
      orbitSource?.setRadius(next.sid_mm)
      orbitSource?.setCenter(isocenter)
      orbitSource?.setNormal(orbitNormal)
      {
        let closestDistance = Number.POSITIVE_INFINITY
        activeSnapshotIndex = -1
        visibleSampleAngles.forEach((sampleAngle, index) => {
          const angularDistance = Math.abs(((sampleAngle - next.projection_angle_deg + 540) % 360) - 180)
          if (angularDistance < closestDistance) {
            closestDistance = angularDistance
            activeSnapshotIndex = index
          }
          const sampleTheta = sampleAngle * Math.PI / 180
          const sampleRadial = tiltOrbitVector(
            [Math.cos(sampleTheta), Math.sin(sampleTheta), 0],
            next.orbit_tilt_x_deg,
            next.orbit_tilt_y_deg,
          )
          const point = addVectors(isocenter, scaleVector(sampleRadial, next.sid_mm))
          snapshotPoints.setPoint(index, ...point)
        })
        const axisPointIndex = visibleSampleAngles.length
        snapshotPoints.setPoint(axisPointIndex, ...isocenter)
        snapshotPoints.setPoint(axisPointIndex + 1, isocenter[0] + axesLength, isocenter[1], isocenter[2])
        snapshotPoints.setPoint(axisPointIndex + 2, isocenter[0], isocenter[1] + axesLength, isocenter[2])
        snapshotPoints.setPoint(axisPointIndex + 3, isocenter[0], isocenter[1], isocenter[2] + axesLength)
        if (closestDistance > 2.5) activeSnapshotIndex = -1
        snapshotPoints.modified()
        snapshotData.modified()
      }
      renderer.resetCameraClippingRange()
      renderWindow.render()
    }
    updateGeometryRef.current = updateGeometry
    updateGeometry(settings)

    const resetCamera = () => {
      const camera = renderer.getActiveCamera()
      camera.setFocalPoint(0, 0, 0)
      camera.setPosition(1.35, -1.7, 1.15)
      camera.setViewUp(0, 0, 1)
      renderer.resetCamera()
      renderer.resetCameraClippingRange()
      renderWindow.render()
    }
    resetCameraRef.current = resetCamera
    resetCamera()

    const observer = new ResizeObserver(() => genericWindow.resize())
    observer.observe(containerRef.current)
    genericWindow.resize()
    return () => {
      disposed = true
      abortController.abort()
      observer.disconnect()
      resetCameraRef.current = () => undefined
      updateGeometryRef.current = () => undefined
      updatePatientSlicesRef.current = () => undefined
      updatePatientRenderingRef.current = () => undefined
      loadVolumeRef.current = async () => undefined
      interactionStyle.delete()
      genericWindow.delete()
    }
  }, [compact, displayedSampleAngles, showOrbit, volume])

  useEffect(() => {
    updateGeometryRef.current(settings)
  }, [settings])

  useEffect(() => {
    updatePatientSlicesRef.current(settings, windowLevel)
  }, [settings, windowLevel])

  useEffect(() => {
    updatePatientRenderingRef.current(rendering)
    if (rendering.mode !== 'slices') void loadVolumeRef.current()
  }, [rendering, volume.id])

  const resetScene = () => {
    resetCameraRef.current()
  }

  return (
    <div className="scene-shell">
      <div ref={containerRef} className="vtk-scene" aria-label={`Interactive three-dimensional acquisition geometry with ${volumeRenderLabel(rendering).toLowerCase()}`} />
      <div ref={markerOverlayRef} className="orbit-marker-overlay" aria-hidden="true">
        {showOrbit && displayedSampleAngles.map((angle, index) => <i className="orbit-direction-marker" key={`${angle}-${index}`} />)}
        <span className="isocenter-axis-label axis-x">X</span>
        <span className="isocenter-axis-label axis-y">Y</span>
        <span className="isocenter-axis-label axis-z">Z</span>
      </div>
      <div className="scene-label source-label">Source</div>
      <div className="scene-label detector-label">Detector</div>
      {rendering.mode !== 'slices' && loadState === 'loading' && (
        <div className="scene-volume-status"><span className="spinner" />Preparing {volumeRenderLabel(rendering).toLowerCase()}…</div>
      )}
      {rendering.mode !== 'slices' && loadState === 'error' && (
        <div className="scene-volume-status error-message">{loadError}</div>
      )}
      <div className="scene-toolbar" role="toolbar" aria-label="Acquisition geometry camera controls">
        <button type="button" onClick={resetScene} title="Reset to the default three-quarter view">
          <RotateCcw aria-hidden="true" />
          Reset
        </button>
      </div>
      <div className="scene-hint">Left drag: orbit scene in 3D · Right drag or wheel: zoom</div>
    </div>
  )
}
