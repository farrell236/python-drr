import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Archive, ChevronDown, Download, FileJson, FileTerminal, Film, Image, Square, X } from 'lucide-react'
import {
  batchManifestUrl,
  batchScriptUrl,
  cancelMediaExport,
  createMediaExport,
  getMediaExport,
  listMediaExports,
  waitForMediaExport,
} from '../api'
import type { JobInfo, MediaExportFormat, MediaExportInfo, MediaExportSettings } from '../types'

interface Props {
  job: JobInfo
  full?: boolean
}

function volumeStem(job: JobInfo) {
  const filename = typeof job.metadata?.volume_filename === 'string' ? job.metadata.volume_filename : 'pydrr'
  return filename.toLowerCase().endsWith('.nii.gz') ? filename.slice(0, -7) : filename.replace(/\.[^.]+$/, '')
}

function defaultSettings(job: JobInfo, format: MediaExportFormat): MediaExportSettings {
  return {
    format,
    filename: `${volumeStem(job)}_sweep.${format}`,
    fps: 12,
    start_frame: 0,
    end_frame: Math.max(0, (job.frame_count || 1) - 1),
    direction: 'forward',
    max_dimension_px: 1024,
    overlay: 'none',
    loop: true,
    gif_quality: 'standard',
    dither: true,
    mp4_quality: 'high',
  }
}

export function SweepDownloadMenu({ job, full = false }: Props) {
  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState<MediaExportFormat | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  if (job.kind !== 'batch' || job.status !== 'completed' || !job.download_url) return null

  const chooseMedia = (nextFormat: MediaExportFormat) => {
    setOpen(false)
    setFormat(nextFormat)
  }

  return (
    <div className={`sweep-download${full ? ' full' : ''}`} ref={menuRef}>
      <button
        type="button"
        className={`button secondary sweep-download-trigger${full ? ' full' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Download /> Download sweep <ChevronDown className="menu-chevron" />
      </button>
      {open && (
        <div className="sweep-download-menu" role="menu">
          <a href={job.download_url} role="menuitem"><Archive /><span><b>ZIP package</b><small>Frames, raw arrays, and geometry</small></span></a>
          <a href={batchManifestUrl(job.id)} role="menuitem"><FileJson /><span><b>Manifest JSON</b><small>Acquisition settings and provenance</small></span></a>
          <a href={batchScriptUrl(job.id)} role="menuitem"><FileTerminal /><span><b>Reproduction script</b><small>Ready-to-run shell command</small></span></a>
          <button type="button" role="menuitem" onClick={() => chooseMedia('gif')}><Image /><span><b>GIF animation…</b><small>Loopable presentation export</small></span></button>
          <button type="button" role="menuitem" onClick={() => chooseMedia('mp4')}><Film /><span><b>MP4 video…</b><small>H.264 presentation export</small></span></button>
        </div>
      )}
      {format && createPortal(
        <SweepExportDialog job={job} format={format} onClose={() => setFormat(null)} />,
        document.body,
      )}
    </div>
  )
}

interface DialogProps {
  job: JobInfo
  format: MediaExportFormat
  onClose: () => void
}

function SweepExportDialog({ job, format, onClose }: DialogProps) {
  const frameCount = Math.max(1, job.frame_count || 1)
  const [settings, setSettings] = useState(() => defaultSettings(job, format))
  const [mediaExport, setMediaExport] = useState<MediaExportInfo | null>(null)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const waitController = useRef<AbortController | null>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const running = submitting || (!!mediaExport && ['queued', 'running'].includes(mediaExport.status))
  const selectedFrames = (settings.end_frame ?? frameCount - 1) - settings.start_frame + 1
  const sequenceFrames = settings.direction === 'ping-pong' && selectedFrames > 1
    ? selectedFrames * 2 - 2
    : selectedFrames
  const duration = sequenceFrames / settings.fps

  const monitor = (id: string) => {
    waitController.current?.abort()
    const controller = new AbortController()
    waitController.current = controller
    waitForMediaExport(id, setMediaExport, controller.signal).catch((reason) => {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
        setError(reason instanceof Error ? reason.message : 'Could not monitor the export')
      }
    })
  }

  useEffect(() => {
    dialogRef.current?.focus()
    let active = true
    listMediaExports(job.id)
      .then((exports) => {
        if (!active) return
        const recent = exports.find((item) => item.format === format)
        if (recent) {
          setSettings(recent.settings)
          setMediaExport(recent)
          if (['queued', 'running'].includes(recent.status)) monitor(recent.id)
        }
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not inspect earlier exports')
      })
      .finally(() => { if (active) setLoadingHistory(false) })
    return () => {
      active = false
      waitController.current?.abort()
    }
  }, [format, job.id])

  const update = <Key extends keyof MediaExportSettings>(key: Key, value: MediaExportSettings[Key]) => {
    if (!running) setMediaExport(null)
    setSettings((current) => ({ ...current, [key]: value }))
  }
  const submit = async () => {
    setError(null)
    setMediaExport(null)
    setSubmitting(true)
    try {
      const created = await createMediaExport(job.id, settings)
      const initial = await getMediaExport(created.id)
      setMediaExport(initial)
      setSubmitting(false)
      if (['queued', 'running'].includes(initial.status)) monitor(created.id)
    } catch (reason) {
      setSubmitting(false)
      setError(reason instanceof Error ? reason.message : `Could not start the ${format.toUpperCase()} export`)
    }
  }
  const cancel = async () => {
    if (!mediaExport) return
    try {
      setMediaExport(await cancelMediaExport(mediaExport.id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not cancel the export')
    }
  }

  const title = format === 'gif' ? 'Export GIF animation' : 'Export MP4 video'
  const statusLabel = loadingHistory ? 'Checking previous exports…' : submitting ? `Starting ${format.toUpperCase()} export…` : mediaExport?.message

  return (
    <div className="modal-backdrop sweep-export-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section
        className="sweep-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sweep-export-title"
        ref={dialogRef}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          }
        }}
      >
        <header>
          <span className="export-dialog-icon">{format === 'gif' ? <Image /> : <Film />}</span>
          <span><span className="eyebrow">Presentation export</span><b id="sweep-export-title">{title}</b></span>
          <button type="button" className="icon-button" aria-label="Close export settings" onClick={onClose}><X /></button>
        </header>

        <div className="sweep-export-form">
          <label className="export-field wide"><span>Filename</span><input type="text" maxLength={120} value={settings.filename || ''} disabled={running} onChange={(event) => update('filename', event.target.value)} /></label>
          <label className="export-field"><span>Frame rate</span><select value={settings.fps} disabled={running} onChange={(event) => update('fps', Number(event.target.value))}><option value={6}>6 fps</option><option value={12}>12 fps</option><option value={24}>24 fps</option><option value={30}>30 fps</option><option value={60}>60 fps</option></select></label>
          <label className="export-field"><span>Direction</span><select value={settings.direction} disabled={running} onChange={(event) => update('direction', event.target.value as MediaExportSettings['direction'])}><option value="forward">Forward</option><option value="reverse">Reverse</option><option value="ping-pong">Ping-pong</option></select></label>
          <div className="export-field frame-range wide"><span>Frame range</span><div><input aria-label="First frame" type="number" min={1} max={frameCount} value={settings.start_frame + 1} disabled={running} onChange={(event) => update('start_frame', Math.min((settings.end_frame ?? frameCount - 1), Math.max(0, Number(event.target.value) - 1)))} /><i>to</i><input aria-label="Last frame" type="number" min={1} max={frameCount} value={(settings.end_frame ?? frameCount - 1) + 1} disabled={running} onChange={(event) => update('end_frame', Math.max(settings.start_frame, Math.min(frameCount - 1, Number(event.target.value) - 1)))} /><small>of {frameCount}</small></div></div>
          <label className="export-field"><span>Resolution</span><select value={settings.max_dimension_px ?? 0} disabled={running} onChange={(event) => update('max_dimension_px', Number(event.target.value) || null)}><option value={0}>Original</option><option value={1024}>Up to 1024 px</option><option value={512}>Up to 512 px</option></select></label>
          <label className="export-field"><span>Overlay</span><select value={settings.overlay} disabled={running} onChange={(event) => update('overlay', event.target.value as MediaExportSettings['overlay'])}><option value="none">None</option><option value="angle">Projection angle</option><option value="angle_and_frame">Angle and frame</option></select></label>

          {format === 'gif' ? (
            <>
              <label className="export-field"><span>GIF quality</span><select value={settings.gif_quality} disabled={running} onChange={(event) => update('gif_quality', event.target.value as MediaExportSettings['gif_quality'])}><option value="standard">Standard</option><option value="high">High</option></select></label>
              <div className="export-checks"><label><input type="checkbox" checked={settings.loop} disabled={running} onChange={(event) => update('loop', event.target.checked)} />Loop continuously</label><label><input type="checkbox" checked={settings.dither} disabled={running} onChange={(event) => update('dither', event.target.checked)} />Dither gradients</label></div>
            </>
          ) : (
            <label className="export-field wide"><span>H.264 quality</span><select value={settings.mp4_quality} disabled={running} onChange={(event) => update('mp4_quality', event.target.value as MediaExportSettings['mp4_quality'])}><option value="standard">Standard</option><option value="high">High</option><option value="maximum">Maximum</option></select></label>
          )}
        </div>

        <div className="export-summary"><span>{sequenceFrames} encoded frames</span><span>{duration.toFixed(duration < 10 ? 1 : 0)} seconds</span><span>{settings.max_dimension_px ? `≤ ${settings.max_dimension_px} px` : 'Original resolution'}</span></div>

        {(statusLabel || mediaExport) && (
          <div className={`media-export-status ${mediaExport?.status || ''}`}>
            <div><span><b>{statusLabel}</b>{mediaExport?.error && <small>{mediaExport.error}</small>}</span>{mediaExport && <em>{Math.round(mediaExport.progress * 100)}%</em>}</div>
            {mediaExport && <div className="progress-track"><i style={{ width: `${mediaExport.progress * 100}%` }} /></div>}
          </div>
        )}
        {error && <div className="error-message" role="alert">{error}</div>}

        <p className="export-note">GIF and MP4 are display-ready derivatives. Use the ZIP package for scientific data and full acquisition metadata.</p>
        <footer>
          {running && mediaExport ? <button type="button" className="button danger" onClick={() => void cancel()}><Square /> Cancel export</button> : <button type="button" className="button secondary" onClick={onClose}>Close</button>}
          {mediaExport?.status === 'completed' && mediaExport.download_url && <a className="button secondary" href={mediaExport.download_url}><Download /> Download {format.toUpperCase()}</a>}
          <button type="button" className="button primary" disabled={running || loadingHistory} onClick={() => void submit()}>{mediaExport?.status === 'completed' ? 'Export again' : `Export ${format.toUpperCase()}`}</button>
        </footer>
      </section>
    </div>
  )
}
