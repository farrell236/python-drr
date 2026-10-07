import { Crosshair, LocateFixed, RotateCcw, ScanLine, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import { volumeSliceUrl } from '../api'
import type { RenderSettings, SliceAxis, VolumeInfo, VoxelZYX, WindowLevel } from '../types'
import { clampVoxel, orientationLabels, planeGeometry, planePointToVoxel, voxelToPlanePoint, voxelToWorld, worldToVoxel } from '../viewerGeometry'
import { Volume3DViewport } from './Volume3DViewport'

interface ViewerProps {
  volume: VolumeInfo
  settings: RenderSettings
  windowLevel: WindowLevel
  onWindowLevelChange: (windowLevel: WindowLevel) => void
  onIsocenterChange: (translationXYZ: [number, number, number]) => void
  onOpenAcquire: () => void
}

interface SliceViewportProps {
  axis: SliceAxis
  volume: VolumeInfo
  voxel: VoxelZYX
  windowLevel: WindowLevel
  onVoxelChange: (voxel: VoxelZYX) => void
}

interface DragState {
  clientX: number
  clientY: number
  panX: number
  panY: number
  moved: boolean
}

const AXIS_NAMES: Record<SliceAxis, string> = {
  axial: 'Axial',
  coronal: 'Coronal',
  sagittal: 'Sagittal',
}

function rounded(value: number, digits = 2) {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function SliceViewport({ axis, volume, voxel, windowLevel, onVoxelChange }: SliceViewportProps) {
  const geometry = planeGeometry(volume, axis)
  const index = Math.round(voxel[geometry.indexAxis])
  const point = voxelToPlanePoint(volume, axis, voxel)
  const labels = orientationLabels(volume, axis)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [loading, setLoading] = useState(true)
  const [imageError, setImageError] = useState(false)
  const drag = useRef<DragState | null>(null)
  const imageUrl = volumeSliceUrl(volume.id, axis, index, windowLevel.center, windowLevel.width)

  useEffect(() => {
    setLoading(true)
    setImageError(false)
  }, [imageUrl])

  const resetView = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const setSlice = (nextIndex: number) => {
    const next = [...voxel] as VoxelZYX
    next[geometry.indexAxis] = Math.min(geometry.maxIndex, Math.max(0, nextIndex))
    onVoxelChange(next)
  }

  const pointFromPointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    const transform = event.currentTarget.getScreenCTM()
    if (!transform) return
    const screenPoint = event.currentTarget.createSVGPoint()
    screenPoint.x = event.clientX
    screenPoint.y = event.clientY
    const localPoint = screenPoint.matrixTransform(transform.inverse())
    onVoxelChange(planePointToVoxel(
      volume,
      axis,
      voxel,
      localPoint.x / geometry.width,
      localPoint.y / geometry.height,
    ))
  }

  const endPointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    const state = drag.current
    if (!state) return
    if (!state.moved) pointFromPointer(event)
    drag.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const handleWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault()
    setSlice(index + (event.deltaY > 0 ? 1 : -1))
  }

  const style = {
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
  } as CSSProperties

  return (
    <section className="mpr-panel">
      <header>
        <span><ScanLine /> {AXIS_NAMES[axis]}</span>
      </header>
      <div className="slice-stage">
        <svg
          className={`slice-content ${drag.current?.moved ? 'panning' : ''}`}
          viewBox={`0 0 ${geometry.width} ${geometry.height}`}
          width={geometry.width}
          height={geometry.height}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`${AXIS_NAMES[axis]} CT slice ${index + 1}`}
          style={style}
          onWheel={handleWheel}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.currentTarget.setPointerCapture(event.pointerId)
            drag.current = { clientX: event.clientX, clientY: event.clientY, panX: pan.x, panY: pan.y, moved: false }
          }}
          onPointerMove={(event) => {
            const state = drag.current
            if (!state) return
            const dx = event.clientX - state.clientX
            const dy = event.clientY - state.clientY
            if (Math.hypot(dx, dy) > 3) state.moved = true
            if (state.moved) setPan({ x: state.panX + dx, y: state.panY + dy })
          }}
          onPointerUp={endPointer}
          onPointerCancel={() => { drag.current = null }}
        >
          <image
            href={imageUrl}
            width={geometry.width}
            height={geometry.height}
            preserveAspectRatio="none"
            onLoad={() => setLoading(false)}
            onError={() => { setLoading(false); setImageError(true) }}
          />
          <line className="crosshair-line crosshair-vertical" x1={point.x * geometry.width} x2={point.x * geometry.width} y1="0" y2={geometry.height} vectorEffect="non-scaling-stroke" />
          <line className="crosshair-line crosshair-horizontal" x1="0" x2={geometry.width} y1={point.y * geometry.height} y2={point.y * geometry.height} vectorEffect="non-scaling-stroke" />
          <circle className="crosshair-center" cx={point.x * geometry.width} cy={point.y * geometry.height} r={Math.max(1.5, Math.min(geometry.width, geometry.height) * 0.012)} vectorEffect="non-scaling-stroke" />
        </svg>
        {loading && <div className="slice-loading"><span className="spinner" />Loading slice…</div>}
        {imageError && <div className="slice-loading error-message">Could not load this slice</div>}
        <span className="orientation-label orientation-left">{labels.left}</span>
        <span className="orientation-label orientation-right">{labels.right}</span>
        <span className="orientation-label orientation-top">{labels.top}</span>
        <span className="orientation-label orientation-bottom">{labels.bottom}</span>
        <div className="slice-toolbar">
          <button type="button" aria-label={`Zoom out ${axis} view`} title="Zoom out" onClick={() => setZoom((value) => Math.max(0.5, value / 1.2))}><ZoomOut /></button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label={`Zoom in ${axis} view`} title="Zoom in" onClick={() => setZoom((value) => Math.min(4, value * 1.2))}><ZoomIn /></button>
          <button type="button" aria-label={`Reset ${axis} view`} title="Fit image" onClick={resetView}><RotateCcw /></button>
        </div>
      </div>
    </section>
  )
}

export function ViewerWorkspace({ volume, settings, windowLevel, onWindowLevelChange, onIsocenterChange, onOpenAcquire }: ViewerProps) {
  const isocenterWorld = useMemo<[number, number, number]>(() => [
    volume.center_world_xyz_mm[0] + settings.translate_x_mm,
    volume.center_world_xyz_mm[1] + settings.translate_y_mm,
    volume.center_world_xyz_mm[2] + settings.translate_z_mm,
  ], [settings.translate_x_mm, settings.translate_y_mm, settings.translate_z_mm, volume.center_world_xyz_mm])
  const voxel = clampVoxel(volume, worldToVoxel(volume, isocenterWorld))
  const intensityRange = Math.max(1, volume.intensity_max - volume.intensity_min)
  const windowWidthMax = Math.max(4000, Math.ceil(intensityRange))
  const presets = [
    { name: 'Soft tissue', center: 40, width: 400 },
    { name: 'Lung', center: -600, width: 1500 },
    { name: 'Bone', center: 500, width: 2000 },
    { name: 'Full', center: (volume.intensity_min + volume.intensity_max) / 2, width: intensityRange },
  ]

  const setVoxel = (nextVoxel: VoxelZYX) => {
    const clamped = clampVoxel(volume, nextVoxel)
    const world = voxelToWorld(volume, clamped)
    onIsocenterChange([
      rounded(world[0] - volume.center_world_xyz_mm[0], 3),
      rounded(world[1] - volume.center_world_xyz_mm[1], 3),
      rounded(world[2] - volume.center_world_xyz_mm[2], 3),
    ])
  }

  const centerIsocenter = () => setVoxel(volume.shape_zyx.map((size) => (size - 1) / 2) as VoxelZYX)

  const setSlice = (axis: SliceAxis, nextIndex: number) => {
    const geometry = planeGeometry(volume, axis)
    const next = [...voxel] as VoxelZYX
    next[geometry.indexAxis] = Math.min(geometry.maxIndex, Math.max(0, nextIndex))
    setVoxel(next)
  }

  return (
    <main className="viewer-workspace">
      <div className="mpr-grid">
        {(['axial', 'coronal', 'sagittal'] as SliceAxis[]).map((axis) => (
          <SliceViewport key={axis} axis={axis} volume={volume} voxel={voxel} windowLevel={windowLevel} onVoxelChange={setVoxel} />
        ))}
        <Volume3DViewport volume={volume} voxel={voxel} windowLevel={windowLevel} />
      </div>

      <aside className="viewer-controls">
        <header>
          <span><b>Volume viewer</b><small>Linked multiplanar reconstruction</small></span>
          <Crosshair />
        </header>

        <section>
          <span className="eyebrow">CT window</span>
          <div className="window-presets">
            {presets.map((preset) => {
              const active = Math.abs(windowLevel.center - preset.center) < 0.01 && Math.abs(windowLevel.width - preset.width) < 0.01
              return <button type="button" className={active ? 'active' : ''} key={preset.name} onClick={() => onWindowLevelChange({ center: rounded(preset.center), width: rounded(preset.width) })}>{preset.name}</button>
            })}
          </div>
          <label className="viewer-slider">
            <span>Window center <output>{rounded(windowLevel.center)} HU</output></span>
            <input type="range" min={Math.floor(volume.intensity_min)} max={Math.ceil(volume.intensity_max)} step={1} value={windowLevel.center} onChange={(event) => onWindowLevelChange({ ...windowLevel, center: Number(event.target.value) })} />
          </label>
          <label className="viewer-slider">
            <span>Window width <output>{rounded(windowLevel.width)} HU</output></span>
            <input type="range" min={1} max={windowWidthMax} step={1} value={Math.min(windowWidthMax, windowLevel.width)} onChange={(event) => onWindowLevelChange({ ...windowLevel, width: Number(event.target.value) })} />
          </label>
        </section>

        <section>
          <span className="eyebrow">Acquisition isocenter</span>
          <div className="isocenter-card">
            <LocateFixed />
            <span><b>Voxel Z {rounded(voxel[0], 1)} · Y {rounded(voxel[1], 1)} · X {rounded(voxel[2], 1)}</b><small>Click any plane to update all three views.</small></span>
          </div>
          <dl className="coordinate-list">
            <div><dt>X</dt><dd>{rounded(isocenterWorld[0])} mm</dd></div>
            <div><dt>Y</dt><dd>{rounded(isocenterWorld[1])} mm</dd></div>
            <div><dt>Z</dt><dd>{rounded(isocenterWorld[2])} mm</dd></div>
          </dl>
          <button type="button" className="button secondary full" onClick={centerIsocenter}><RotateCcw /> Center in volume</button>
        </section>

        <section className="volume-facts">
          <span className="eyebrow">Volume</span>
          <dl>
            <div><dt>Dimensions</dt><dd>{volume.shape_zyx[2]} × {volume.shape_zyx[1]} × {volume.shape_zyx[0]}</dd></div>
            <div><dt>Spacing</dt><dd>{volume.spacing_zyx_mm[2].toFixed(2)} × {volume.spacing_zyx_mm[1].toFixed(2)} × {volume.spacing_zyx_mm[0].toFixed(2)} mm</dd></div>
            <div><dt>Intensity</dt><dd>{rounded(volume.intensity_min)} to {rounded(volume.intensity_max)}</dd></div>
          </dl>
        </section>

        <section className="slice-navigation">
          <span className="eyebrow">Slice position</span>
          {(['axial', 'coronal', 'sagittal'] as SliceAxis[]).map((axis) => {
            const geometry = planeGeometry(volume, axis)
            const index = Math.round(voxel[geometry.indexAxis])
            return (
              <label className={`slice-navigation-row ${axis}`} key={axis}>
                <span>{AXIS_NAMES[axis]}</span>
                <input
                  aria-label={`${AXIS_NAMES[axis]} slice`}
                  type="range"
                  min={0}
                  max={geometry.maxIndex}
                  step={1}
                  value={index}
                  onChange={(event) => setSlice(axis, Number(event.target.value))}
                />
                <output>{index + 1} / {geometry.maxIndex + 1}</output>
              </label>
            )
          })}
          <small>Scroll over a 2D view or use these linked controls.</small>
        </section>

        <div className="viewer-controls-spacer" />
        <button type="button" className="button primary full" onClick={onOpenAcquire}><Crosshair /> Use isocenter in Acquire</button>
      </aside>
    </main>
  )
}
