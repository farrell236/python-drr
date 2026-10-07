import { Crosshair, LocateFixed, RotateCcw, ScanLine, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import { volumeSliceUrl } from '../api'
import type { RenderSettings, SliceAxis, VolumeInfo, VolumeRenderMode, VolumeRenderSettings, VoxelZYX, WindowLevel } from '../types'
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

const AXIS_NAMES: Record<SliceAxis, string> = {
  axial: 'Axial',
  coronal: 'Coronal',
  sagittal: 'Sagittal',
}

type AdjustableRenderMode = Exclude<VolumeRenderMode, 'slices'>

const VOLUME_RENDER_OPTIONS: Array<{ mode: VolumeRenderMode; label: string }> = [
  { mode: 'slices', label: 'Slices' },
  { mode: 'bone', label: 'Bone' },
  { mode: 'soft-tissue', label: 'Soft tissue' },
  { mode: 'skin', label: 'Skin' },
]

const DEFAULT_RENDER_CONTROLS: Record<AdjustableRenderMode, { shift: number; opacity: number }> = {
  bone: { shift: 0, opacity: 1 },
  'soft-tissue': { shift: 0, opacity: 1 },
  skin: { shift: 0, opacity: 1 },
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
  const [loading, setLoading] = useState(true)
  const [imageError, setImageError] = useState(false)
  const dragging = useRef(false)
  const imageUrl = volumeSliceUrl(volume.id, axis, index, windowLevel.center, windowLevel.width)

  useEffect(() => {
    setLoading(true)
    setImageError(false)
  }, [imageUrl])

  const resetView = () => {
    setZoom(1)
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

  const handleWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault()
    setSlice(index + (event.deltaY > 0 ? 1 : -1))
  }

  return (
    <section className="mpr-panel">
      <div className="slice-stage">
        <span className={`viewport-label ${axis}`}><ScanLine /> {AXIS_NAMES[axis]}</span>
        <svg
          className="slice-content"
          viewBox={`0 0 ${geometry.width} ${geometry.height}`}
          width={geometry.width}
          height={geometry.height}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`${AXIS_NAMES[axis]} CT slice ${index + 1}`}
          style={{ transform: `scale(${zoom})` }}
          onWheel={handleWheel}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.currentTarget.setPointerCapture(event.pointerId)
            dragging.current = true
            pointFromPointer(event)
          }}
          onPointerMove={(event) => {
            if (dragging.current) pointFromPointer(event)
          }}
          onPointerUp={(event) => {
            dragging.current = false
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onPointerCancel={() => { dragging.current = false }}
          onLostPointerCapture={() => { dragging.current = false }}
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
  const [volumeRenderMode, setVolumeRenderMode] = useState<VolumeRenderMode>('slices')
  const [volumeRenderControls, setVolumeRenderControls] = useState(DEFAULT_RENDER_CONTROLS)
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
  const adjustableRenderMode = volumeRenderMode === 'slices' ? null : volumeRenderMode
  const volumeRendering: VolumeRenderSettings = adjustableRenderMode
    ? { mode: adjustableRenderMode, ...volumeRenderControls[adjustableRenderMode] }
    : { mode: 'slices', shift: 0, opacity: 1 }
  const shiftLimit = Math.max(500, Math.min(3000, Math.ceil(intensityRange / 2 / 100) * 100))

  useEffect(() => {
    setVolumeRenderMode('slices')
    setVolumeRenderControls(DEFAULT_RENDER_CONTROLS)
  }, [volume.id])

  const setVolumeRenderControl = (field: 'shift' | 'opacity', value: number) => {
    if (!adjustableRenderMode) return
    setVolumeRenderControls((current) => ({
      ...current,
      [adjustableRenderMode]: { ...current[adjustableRenderMode], [field]: value },
    }))
  }

  const resetVolumeRenderControls = () => {
    if (!adjustableRenderMode) return
    setVolumeRenderControls((current) => ({
      ...current,
      [adjustableRenderMode]: DEFAULT_RENDER_CONTROLS[adjustableRenderMode],
    }))
  }

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
        <Volume3DViewport volume={volume} voxel={voxel} windowLevel={windowLevel} rendering={volumeRendering} />
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

        <section className="volume-render-controls">
          <span className="eyebrow">Volume render</span>
          <div className="volume-render-modes" role="group" aria-label="Three-dimensional rendering mode">
            {VOLUME_RENDER_OPTIONS.map((option) => (
              <button
                type="button"
                className={volumeRenderMode === option.mode ? 'active' : ''}
                key={option.mode}
                aria-pressed={volumeRenderMode === option.mode}
                onClick={() => setVolumeRenderMode(option.mode)}
              >
                {option.label}
              </button>
            ))}
          </div>
          {adjustableRenderMode ? (
            <>
              <label className="viewer-slider">
                <span>Intensity shift <output>{volumeRenderControls[adjustableRenderMode].shift > 0 ? '+' : ''}{volumeRenderControls[adjustableRenderMode].shift} HU</output></span>
                <input
                  aria-label="Volume rendering intensity shift"
                  type="range"
                  min={-shiftLimit}
                  max={shiftLimit}
                  step={10}
                  value={volumeRenderControls[adjustableRenderMode].shift}
                  onChange={(event) => setVolumeRenderControl('shift', Number(event.target.value))}
                />
              </label>
              <label className="viewer-slider">
                <span>Opacity <output>{Math.round(volumeRenderControls[adjustableRenderMode].opacity * 100)}%</output></span>
                <input
                  aria-label="Volume rendering opacity"
                  type="range"
                  min={0.1}
                  max={2}
                  step={0.05}
                  value={volumeRenderControls[adjustableRenderMode].opacity}
                  onChange={(event) => setVolumeRenderControl('opacity', Number(event.target.value))}
                />
              </label>
              <button type="button" className="render-reset" onClick={resetVolumeRenderControls}><RotateCcw /> Reset preset</button>
            </>
          ) : <small className="volume-render-hint">Shows the three linked textured slice planes.</small>}
        </section>

        <section className="isocenter-section">
          <span className="eyebrow">Acquisition isocenter</span>
          <div className="isocenter-compact">
            <LocateFixed />
            <dl>
              <div><dt>World</dt><dd>{rounded(isocenterWorld[0])} · {rounded(isocenterWorld[1])} · {rounded(isocenterWorld[2])} mm</dd></div>
              <div><dt>Voxel</dt><dd>{rounded(voxel[2], 1)} · {rounded(voxel[1], 1)} · {rounded(voxel[0], 1)}</dd></div>
            </dl>
          </div>
          <small className="isocenter-hint">Values are X · Y · Z. Click or drag a slice to reposition.</small>
          <div className="isocenter-actions">
            <button type="button" className="button secondary" onClick={centerIsocenter}><RotateCcw /> Center</button>
            <button type="button" className="button primary" onClick={onOpenAcquire}><Crosshair /> Use in Acquire</button>
          </div>
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
          <small>Scroll changes that plane; dragging navigates the other two.</small>
        </section>

        <section className="volume-facts">
          <span className="eyebrow">Volume</span>
          <dl>
            <div><dt>Dimensions</dt><dd>{volume.shape_zyx[2]} × {volume.shape_zyx[1]} × {volume.shape_zyx[0]}</dd></div>
            <div><dt>Spacing</dt><dd>{volume.spacing_zyx_mm[2].toFixed(2)} × {volume.spacing_zyx_mm[1].toFixed(2)} × {volume.spacing_zyx_mm[0].toFixed(2)} mm</dd></div>
            <div><dt>Intensity</dt><dd>{rounded(volume.intensity_min)} to {rounded(volume.intensity_max)}</dd></div>
          </dl>
        </section>

        <div className="viewer-controls-spacer" />
      </aside>
    </main>
  )
}
