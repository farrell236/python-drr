import { useEffect, useMemo, useRef } from 'react'
import '@kitware/vtk.js/Rendering/Profiles/Geometry'
import vtkPoints from '@kitware/vtk.js/Common/Core/Points'
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData'
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor'
import vtkAxesActor from '@kitware/vtk.js/Rendering/Core/AxesActor'
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper'
import vtkPixelSpaceCallbackMapper from '@kitware/vtk.js/Rendering/Core/PixelSpaceCallbackMapper'
import vtkCubeSource from '@kitware/vtk.js/Filters/Sources/CubeSource'
import vtkLineSource from '@kitware/vtk.js/Filters/Sources/LineSource'
import vtkRegularPolygonSource from '@kitware/vtk.js/Filters/Sources/RegularPolygonSource'
import vtkSphereSource from '@kitware/vtk.js/Filters/Sources/SphereSource'
import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow'
import vtkInteractorStyleManipulator from '@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator'
import vtkMouseCameraTrackballRotateManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballRotateManipulator'
import vtkMouseCameraTrackballZoomManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballZoomManipulator'
import vtkGestureCameraManipulator from '@kitware/vtk.js/Interaction/Manipulators/GestureCameraManipulator'
import { RotateCcw } from 'lucide-react'
import type { RenderSettings, VolumeInfo } from '../types'

interface Props {
  volume: VolumeInfo
  settings: RenderSettings
  compact?: boolean
  showOrbit?: boolean
  orbitSampleAngles?: readonly number[]
}

const EMPTY_ORBIT_SAMPLE_ANGLES: readonly number[] = []

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

export function AcquisitionScene({ volume, settings, compact = false, showOrbit = false, orbitSampleAngles = EMPTY_ORBIT_SAMPLE_ANGLES }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const markerOverlayRef = useRef<HTMLDivElement>(null)
  const resetCameraRef = useRef<() => void>(() => undefined)
  const updateGeometryRef = useRef<(next: RenderSettings) => void>(() => undefined)
  const displayedSampleAngles = useMemo(() => {
    const markerStride = Math.max(1, Math.ceil(orbitSampleAngles.length / 140))
    return orbitSampleAngles.filter((_, index) => index % markerStride === 0 || index === orbitSampleAngles.length - 1)
  }, [orbitSampleAngles])

  useEffect(() => {
    if (!containerRef.current) return
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
    const sizeX = nx * sx
    const sizeY = ny * sy
    const sizeZ = nz * sz
    const axesLength = Math.max(100, Math.min(150, Math.max(sizeX, sizeY, sizeZ) * 0.24))

    const volumeSource = vtkCubeSource.newInstance({ xLength: sizeX, yLength: sizeY, zLength: sizeZ })
    const volumeActor = addActor(renderer, volumeSource, [0.1, 0.34, 0.58], 0.16)
    volumeActor.getProperty().setRepresentationToWireframe()
    volumeActor.getProperty().setLineWidth(1)
    const direction = volume.direction
    volumeActor.setUserMatrix([
      direction[0][0], direction[1][0], direction[2][0], 0,
      direction[0][1], direction[1][1], direction[2][1], 0,
      direction[0][2], direction[1][2], direction[2][2], 0,
      0, 0, 0, 1,
    ] as never)

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
      observer.disconnect()
      resetCameraRef.current = () => undefined
      updateGeometryRef.current = () => undefined
      interactionStyle.delete()
      genericWindow.delete()
    }
  }, [compact, displayedSampleAngles, showOrbit, volume])

  useEffect(() => {
    updateGeometryRef.current(settings)
  }, [settings])

  const resetScene = () => {
    resetCameraRef.current()
  }

  return (
    <div className="scene-shell">
      <div ref={containerRef} className="vtk-scene" aria-label="Interactive three-dimensional acquisition geometry" />
      <div ref={markerOverlayRef} className="orbit-marker-overlay" aria-hidden="true">
        {showOrbit && displayedSampleAngles.map((angle, index) => <i className="orbit-direction-marker" key={`${angle}-${index}`} />)}
        <span className="isocenter-axis-label axis-x">X</span>
        <span className="isocenter-axis-label axis-y">Y</span>
        <span className="isocenter-axis-label axis-z">Z</span>
      </div>
      <div className="scene-label source-label">Source</div>
      <div className="scene-label detector-label">Detector</div>
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
