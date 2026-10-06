import { Download, Expand, Image as ImageIcon, ZoomIn } from 'lucide-react'
import type { JobInfo, RenderSettings } from '../types'

interface Props {
  job: JobInfo | null
  settings: RenderSettings
}

export function ProjectionViewer({ job, settings }: Props) {
  const imageUrl = job?.image_url ? `${job.image_url}?v=${job.completed_at || job.progress}` : null
  return (
    <section className="viewer-panel projection-panel">
      <header className="panel-header">
        <span><ImageIcon /> Projection preview</span>
        <span className={`status ${job?.status || 'idle'}`}><i />{job?.message || 'Ready to render'}</span>
      </header>
      <div className="projection-stage">
        {imageUrl ? (
          <img src={imageUrl} alt={`DRR projection at ${settings.projection_angle_deg} degrees`} />
        ) : (
          <div className="projection-empty">
            <ImageIcon />
            <b>No projection yet</b>
            <span>Adjust the geometry and render a preview.</span>
          </div>
        )}
        <span className="orientation-marker">R</span>
        {job && ['queued', 'running'].includes(job.status) && (
          <div className="render-overlay">
            <div className="spinner" />
            <span>{job.message}</span>
          </div>
        )}
      </div>
      <footer className="image-toolbar">
        <button type="button" aria-label="Zoom in"><ZoomIn /></button>
        <button type="button" aria-label="Fit image"><Expand /></button>
        <span>{settings.detector_width_px} × {settings.detector_height_px} · {settings.projection_angle_deg.toFixed(1)}°</span>
        {job?.download_url && <a className="tool-link" href={job.download_url}><Download /> Download</a>}
      </footer>
    </section>
  )
}
