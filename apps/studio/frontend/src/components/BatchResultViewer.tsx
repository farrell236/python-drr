import { ChevronLeft, ChevronRight, Expand, Pause, Play, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import { batchFrameUrl } from '../api'
import type { JobInfo } from '../types'
import { SweepDownloadMenu } from './SweepDownloadMenu'

interface Props {
  job: JobInfo
  onClose: () => void
}

function jobAngles(job: JobInfo): number[] {
  const angles = job.metadata?.angles_deg
  if (Array.isArray(angles) && angles.every((angle) => typeof angle === 'number')) return angles
  return Array.from({ length: job.frame_count || 0 }, (_, index) => index)
}

export function BatchResultViewer({ job, onClose }: Props) {
  const angles = jobAngles(job)
  const frameCount = angles.length || job.frame_count || 0
  const [frameIndex, setFrameIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const drag = useRef({ active: false, clientX: 0, clientY: 0, x: 0, y: 0 })

  useEffect(() => {
    if (!playing || frameCount < 2) return
    const timer = window.setInterval(() => setFrameIndex((current) => (current + 1) % frameCount), 350)
    return () => window.clearInterval(timer)
  }, [frameCount, playing])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const fit = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }
  const moveFrame = (next: number) => {
    setPlaying(false)
    setFrameIndex(Math.min(Math.max(0, next), Math.max(0, frameCount - 1)))
  }
  const zoomBy = (factor: number) => setZoom((current) => Math.min(12, Math.max(0.2, current * factor)))
  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    zoomBy(event.deltaY > 0 ? 1 / 1.15 : 1.15)
  }
  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
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
    <div className="modal-backdrop batch-viewer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="batch-result-viewer" role="dialog" aria-modal="true" aria-labelledby="batch-viewer-title">
        <header>
          <span><span className="eyebrow">Angle sweep</span><b id="batch-viewer-title">{job.metadata?.volume_filename as string || `${frameCount} projection batch`}</b></span>
          <button type="button" className="icon-button" aria-label="Close batch viewer" onClick={onClose}><X /></button>
        </header>
        <div className="batch-cine-stage" onWheel={handleWheel} onPointerDown={startPan} onPointerMove={movePan} onPointerUp={stopPan} onPointerCancel={stopPan}>
          {frameCount > 0 && <img draggable={false} src={batchFrameUrl(job.id, frameIndex)} alt={`Projection ${frameIndex + 1} of ${frameCount}`} style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} />}
          <span className="cine-frame-readout">Frame {frameIndex + 1} / {frameCount} · {(angles[frameIndex] ?? frameIndex).toFixed(1)}°</span>
        </div>
        <div className="cine-scrubber">
          <button type="button" aria-label="Previous frame" disabled={frameCount < 2} onClick={() => moveFrame(frameIndex - 1)}><ChevronLeft /></button>
          <button type="button" aria-label={playing ? 'Pause sweep' : 'Play sweep'} disabled={frameCount < 2} onClick={() => setPlaying((current) => !current)}>{playing ? <Pause /> : <Play />}</button>
          <input aria-label="Batch frame" type="range" min={0} max={Math.max(0, frameCount - 1)} step={1} value={frameIndex} onChange={(event) => moveFrame(Number(event.target.value))} />
          <button type="button" aria-label="Next frame" disabled={frameCount < 2} onClick={() => moveFrame(frameIndex + 1)}><ChevronRight /></button>
        </div>
        <footer>
          <div className="cine-zoom-controls">
            <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)}><ZoomOut /></button>
            <span>{Math.round(zoom * 100)}%</span>
            <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.2)}><ZoomIn /></button>
            <button type="button" aria-label="Fit image" onClick={fit}><Expand /></button>
          </div>
          <SweepDownloadMenu job={job} />
        </footer>
      </section>
    </div>
  )
}
