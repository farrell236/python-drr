import { Box, RotateCcw } from 'lucide-react'
import { useEffect, useRef } from 'react'
import '@kitware/vtk.js/Rendering/Profiles/Geometry'
// @ts-expect-error vtk.js exposes a runtime default that is missing from its declaration file.
import vtkImageHelper from '@kitware/vtk.js/Common/Core/ImageHelper'
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor'
import vtkAxesActor from '@kitware/vtk.js/Rendering/Core/AxesActor'
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper'
import vtkTexture from '@kitware/vtk.js/Rendering/Core/Texture'
import vtkCubeSource from '@kitware/vtk.js/Filters/Sources/CubeSource'
import vtkPlaneSource from '@kitware/vtk.js/Filters/Sources/PlaneSource'
import vtkSphereSource from '@kitware/vtk.js/Filters/Sources/SphereSource'
import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow'
import vtkInteractorStyleManipulator from '@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator'
import vtkGestureCameraManipulator from '@kitware/vtk.js/Interaction/Manipulators/GestureCameraManipulator'
import vtkMouseCameraTrackballRotateManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballRotateManipulator'
import vtkMouseCameraTrackballZoomManipulator from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballZoomManipulator'
import { volumeSliceUrl } from '../api'
import type { VolumeInfo, VoxelZYX, WindowLevel } from '../types'

interface Props {
  volume: VolumeInfo
  voxel: VoxelZYX
  windowLevel: WindowLevel
}

type Point3 = [number, number, number]

function addActor(
  renderer: ReturnType<ReturnType<typeof vtkGenericRenderWindow.newInstance>['getRenderer']>,
  source: { getOutputPort: () => unknown },
  color: Point3,
  opacity = 1,
) {
  const mapper = vtkMapper.newInstance()
  mapper.setInputConnection(source.getOutputPort() as never)
  const actor = vtkActor.newInstance()
  actor.setMapper(mapper)
  actor.getProperty().setColor(...color)
  actor.getProperty().setOpacity(opacity)
  renderer.addActor(actor)
  return actor
}

function directionMatrix(direction: number[][]) {
  return [
    direction[0][0], direction[1][0], direction[2][0], 0,
    direction[0][1], direction[1][1], direction[2][1], 0,
    direction[0][2], direction[1][2], direction[2][2], 0,
    0, 0, 0, 1,
  ] as never
}

function directedPoint(direction: number[][], point: Point3): Point3 {
  return [
    direction[0][0] * point[0] + direction[0][1] * point[1] + direction[0][2] * point[2],
    direction[1][0] * point[0] + direction[1][1] * point[1] + direction[1][2] * point[2],
    direction[2][0] * point[0] + direction[2][1] * point[1] + direction[2][2] * point[2],
  ]
}

export function Volume3DViewport({ volume, voxel, windowLevel }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const resetCameraRef = useRef<() => void>(() => undefined)
  const updateSlicesRef = useRef<(next: VoxelZYX, nextWindowLevel: WindowLevel) => void>(() => undefined)

  useEffect(() => {
    if (!containerRef.current) return

    const genericWindow = vtkGenericRenderWindow.newInstance({ background: [0.025, 0.04, 0.055] })
    genericWindow.setContainer(containerRef.current)
    const renderer = genericWindow.getRenderer()
    const renderWindow = genericWindow.getRenderWindow()
    renderer.setBackground(0.025, 0.04, 0.055)
    renderer.setBackground2(0.11, 0.16, 0.2)
    renderer.setGradientBackground(true)

    const interactionStyle = vtkInteractorStyleManipulator.newInstance()
    interactionStyle.addMouseManipulator(vtkMouseCameraTrackballRotateManipulator.newInstance({ button: 1 }))
    interactionStyle.addMouseManipulator(vtkMouseCameraTrackballZoomManipulator.newInstance({ button: 3 }))
    interactionStyle.addMouseManipulator(vtkMouseCameraTrackballZoomManipulator.newInstance({ dragEnabled: false, scrollEnabled: true }))
    interactionStyle.addGestureManipulator(vtkGestureCameraManipulator.newInstance())
    renderWindow.getInteractor().setInteractorStyle(interactionStyle)

    const [nz, ny, nx] = volume.shape_zyx
    const [sz, sy, sx] = volume.spacing_zyx_mm
    const sizeX = Math.max(sx, (nx - 1) * sx)
    const sizeY = Math.max(sy, (ny - 1) * sy)
    const sizeZ = Math.max(sz, (nz - 1) * sz)
    const transform = directionMatrix(volume.direction)

    const boundsSource = vtkCubeSource.newInstance({ xLength: sizeX, yLength: sizeY, zLength: sizeZ })
    const boundsActor = addActor(renderer, boundsSource, [0.63, 0.75, 0.83], 0.46)
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
      actor.getProperty().setLineWidth(1.4)
      actor.getProperty().setLighting(false)
      actor.setForceOpaque(true)
    })
    planeActors[0].getProperty().setEdgeColor(0.94, 0.28, 0.31)
    planeActors[1].getProperty().setEdgeColor(0.29, 0.78, 0.47)
    planeActors[2].getProperty().setEdgeColor(0.96, 0.77, 0.22)
    const planeTextures = planeActors.map(() => vtkTexture.newInstance({ interpolate: true, edgeClamp: true }))

    const isoRadius = Math.max(1.8, Math.min(sizeX, sizeY, sizeZ) * 0.018)
    const isoSource = vtkSphereSource.newInstance({ radius: isoRadius, thetaResolution: 20, phiResolution: 14 })
    const isoActor = addActor(renderer, isoSource, [0.93, 0.97, 1])

    const axesLength = Math.max(18, Math.min(55, Math.max(sizeX, sizeY, sizeZ) * 0.18))
    const axesActor = vtkAxesActor.newInstance({
      config: { recenter: false, tipResolution: 18, tipRadius: 0.1, tipLength: 0.24, shaftResolution: 14, shaftRadius: 0.022 },
      xConfig: { color: [219, 72, 69] },
      yConfig: { color: [42, 157, 103] },
      zConfig: { color: [56, 118, 210] },
    } as never)
    axesActor.setScale(axesLength, axesLength, axesLength)
    renderer.addActor(axesActor)

    const textureUrls = ['', '', '']
    const textureRevisions = [0, 0, 0]
    const updateSlices = (next: VoxelZYX, nextWindowLevel: WindowLevel) => {
      const x = (next[2] - (nx - 1) / 2) * sx
      const y = (next[1] - (ny - 1) / 2) * sy
      const z = (next[0] - (nz - 1) / 2) * sz

      axialSource.setOrigin(-sizeX / 2, -sizeY / 2, z)
      axialSource.setPoint1(sizeX / 2, -sizeY / 2, z)
      axialSource.setPoint2(-sizeX / 2, sizeY / 2, z)
      coronalSource.setOrigin(-sizeX / 2, y, -sizeZ / 2)
      coronalSource.setPoint1(sizeX / 2, y, -sizeZ / 2)
      coronalSource.setPoint2(-sizeX / 2, y, sizeZ / 2)
      sagittalSource.setOrigin(x, -sizeY / 2, -sizeZ / 2)
      sagittalSource.setPoint1(x, sizeY / 2, -sizeZ / 2)
      sagittalSource.setPoint2(x, -sizeY / 2, sizeZ / 2)

      const center = directedPoint(volume.direction, [x, y, z])
      isoActor.setPosition(...center)
      axesActor.setPosition(...center)

      const indices = [Math.round(next[0]), Math.round(next[1]), Math.round(next[2])]
      ;(['axial', 'coronal', 'sagittal'] as const).forEach((axis, axisIndex) => {
        const url = volumeSliceUrl(volume.id, axis, indices[axisIndex], nextWindowLevel.center, nextWindowLevel.width)
        if (url === textureUrls[axisIndex]) return
        textureUrls[axisIndex] = url
        textureRevisions[axisIndex] += 1
        const revision = textureRevisions[axisIndex]
        const image = new Image()
        image.decoding = 'async'
        image.onload = () => {
          if (revision !== textureRevisions[axisIndex]) return
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
    updateSlicesRef.current = updateSlices
    updateSlices(voxel, windowLevel)

    const resetCamera = () => {
      const camera = renderer.getActiveCamera()
      camera.setFocalPoint(0, 0, 0)
      camera.setPosition(1.4, -1.65, 1.15)
      camera.setViewUp(0, 0, 1)
      camera.setParallelProjection(true)
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
      updateSlicesRef.current = () => undefined
      interactionStyle.delete()
      genericWindow.delete()
    }
  }, [volume])

  useEffect(() => {
    updateSlicesRef.current(voxel, windowLevel)
  }, [voxel, windowLevel])

  return (
    <section className="mpr-panel viewer-3d-panel">
      <header>
        <span><Box /> 3D</span>
        <small>Linked slice context</small>
      </header>
      <div className="viewer-3d-stage">
        <div ref={containerRef} className="viewer-3d-canvas" aria-label="Interactive three-dimensional volume and slice plane context" />
        <div className="viewer-3d-toolbar" role="toolbar" aria-label="Three-dimensional viewer controls">
          <button type="button" onClick={() => resetCameraRef.current()} title="Reset to the default three-quarter view"><RotateCcw /> Reset</button>
        </div>
        <div className="viewer-3d-axis-key" aria-hidden="true">
          <span className="axis-x">X · L</span>
          <span className="axis-y">Y · P</span>
          <span className="axis-z">Z · S</span>
        </div>
        <div className="viewer-3d-legend viewer-3d-overlay-legend" aria-label="Slice plane colors">
          <span className="axial">Axial</span>
          <span className="coronal">Coronal</span>
          <span className="sagittal">Sagittal</span>
        </div>
        <span className="viewer-3d-hint">Drag to orbit · scroll to zoom</span>
      </div>
    </section>
  )
}
