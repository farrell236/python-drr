import { AlertTriangle, Download, Expand, Image as ImageIcon, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import { projectionOrientation } from '../acquisitionGeometry'
import type { JobInfo, RenderSettings } from '../types'

interface Props {
  job: JobInfo | null
  settings: RenderSettings
  renderedSettings: RenderSettings | null
}

function sameSettings(first: RenderSettings | null, second: RenderSettings): boolean {
  if (!first) return true
  return (Object.keys(second) as (keyof RenderSettings)[]).every((key) => first[key] === second[key])
}

export function ProjectionViewer({ job, settings, renderedSettings }: Props) {
  const imageUrl = job?.image_url ? `${job.image_url}?v=${job.completed_at || job.progress}` : null
  const provenance = renderedSettings || settings
  const labels = projectionOrientation(provenance)
  const stale = !!imageUrl && !sameSettings(renderedSettings, settings)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const drag = useRef({ active: false, clientX: 0, clientY: 0, x: 0, y: 0 })

  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [imageUrl])

  const fit = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }
  const zoomBy = (factor: number) => setZoom((current) => Math.min(12, Math.max(0.2, current * factor)))
  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!imageUrl) return
    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    const cursor = { x: event.clientX - bounds.left - bounds.width / 2, y: event.clientY - bounds.top - bounds.height / 2 }
    const nextZoom = Math.min(12, Math.max(0.2, zoom * (event.deltaY > 0 ? 1 / 1.15 : 1.15)))
    const factor = nextZoom / zoom
    setPan({ x: cursor.x - factor * (cursor.x - pan.x), y: cursor.y - factor * (cursor.y - pan.y) })
    setZoom(nextZoom)
  }
  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!imageUrl || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { active: true, clientX: event.clientX, clientY: event.clientY, x: pan.x, y: pan.y }
  }
  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current.active) return
    setPan({ x: drag.current.x + event.clientX - drag.current.clientX, y: drag.current.y + event.clientY - drag.current.clientY })
  }
  const stopPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    drag.current.active = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <section className="viewer-panel projection-panel">
      <header className="panel-header">
        <span><ImageIcon /> Projection preview</span>
        <span className={`status ${job?.status || 'idle'}`}><i />{job?.message || 'Ready to render'}</span>
      </header>
      <div className="projection-stage" onWheel={handleWheel} onPointerDown={startPan} onPointerMove={movePan} onPointerUp={stopPan} onPointerCancel={stopPan}>
        {imageUrl ? (
          <img draggable={false} src={imageUrl} alt={`DRR projection at ${provenance.projection_angle_deg} degrees`} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} />
        ) : (
          <div className="projection-empty">
            <ImageIcon />
            <b>No projection yet</b>
            <span>Adjust the geometry and render a preview.</span>
          </div>
        )}
        {imageUrl && <>
          <span className="projection-orientation left">{labels.left}</span>
          <span className="projection-orientation right">{labels.right}</span>
          <span className="projection-orientation top">{labels.top}</span>
          <span className="projection-orientation bottom">{labels.bottom}</span>
        </>}
        {stale && <span className="stale-preview"><AlertTriangle /> Settings changed — render to update</span>}
        {job && ['queued', 'running'].includes(job.status) && (
          <div className="render-overlay">
            <div className="spinner" />
            <span>{job.message}</span>
          </div>
        )}
      </div>
      <footer className="image-toolbar">
        <button type="button" aria-label="Zoom out" disabled={!imageUrl} onClick={() => zoomBy(1 / 1.2)}><ZoomOut /></button>
        <span className="zoom-readout">{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="Zoom in" disabled={!imageUrl} onClick={() => zoomBy(1.2)}><ZoomIn /></button>
        <button type="button" aria-label="Fit image" disabled={!imageUrl} onClick={fit}><Expand /></button>
        <span>{provenance.detector_width_px} × {provenance.detector_height_px} · {provenance.projection_angle_deg.toFixed(1)}° · {provenance.projection_model === 'raw' ? 'raw' : 'HU-relative'}</span>
        {job?.download_url && <a className="tool-link" href={job.download_url}><Download /> Download</a>}
      </footer>
    </section>
  )
}
