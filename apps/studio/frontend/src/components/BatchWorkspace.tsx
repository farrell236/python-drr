import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Box, Orbit, Pause, Play, Square, Timer } from 'lucide-react'
import type { BatchSettings, JobInfo, RenderSettings, VolumeInfo, VolumeRenderSettings, WindowLevel } from '../types'
import type { RuntimeInfo } from '../types'
import { acquisitionReadiness } from '../acquisitionGeometry'
import { AcquisitionScene } from './AcquisitionScene'
import { blankFieldWarning, NumericInput } from './NumericInput'
import { SweepDownloadMenu } from './SweepDownloadMenu'

interface Props {
  volume: VolumeInfo
  renderSettings: RenderSettings
  windowLevel: WindowLevel
  rendering: VolumeRenderSettings
  batchSettings: BatchSettings
  job: JobInfo | null
  onChange: (settings: BatchSettings) => void
  onRun: () => void
  onValidationError: (message: string) => void
  onCancel: () => void
  runtime: RuntimeInfo | null
  runtimeError: string | null
}

function formatBytes(value: number) {
  if (value < 1024 ** 2) return `${Math.max(1, Math.round(value / 1024))} KB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(value < 10 * 1024 ** 2 ? 1 : 0)} MB`
  return `${(value / 1024 ** 3).toFixed(1)} GB`
}

export function BatchWorkspace({ volume, renderSettings, windowLevel, rendering, batchSettings, job, onChange, onRun, onValidationError, onCancel, runtime, runtimeError }: Props) {
  const [blankFields, setBlankFields] = useState<Record<string, string>>({})
  const trackBlankField = useCallback((fieldId: string, label: string, blank: boolean) => {
    setBlankFields((current) => {
      if (blank && current[fieldId] === label) return current
      if (!blank && !(fieldId in current)) return current
      const next = { ...current }
      if (blank) next[fieldId] = label
      else delete next[fieldId]
      return next
    })
  }, [])
  const frameCount = Math.max(0, Math.floor((batchSettings.end_angle_deg - batchSettings.start_angle_deg) / batchSettings.step_deg) + 1)
  const rangeValid = batchSettings.end_angle_deg >= batchSettings.start_angle_deg && batchSettings.step_deg > 0
  const readiness = useMemo(() => acquisitionReadiness(volume, renderSettings, runtime), [renderSettings, runtime, volume])
  const batchReady = readiness.ready && rangeValid && frameCount >= 1 && frameCount <= 720
  const estimatedBytes = frameCount * renderSettings.detector_width_px * renderSettings.detector_height_px * (batchSettings.include_raw ? 5 : 1)
  const running = !!job && ['queued', 'running'].includes(job.status)
  const update = (values: Partial<BatchSettings>) => onChange({ ...batchSettings, ...values })
  const [previewAngle, setPreviewAngle] = useState(batchSettings.start_angle_deg)
  const [previewPlaying, setPreviewPlaying] = useState(false)
  const rangeEnd = Math.max(batchSettings.start_angle_deg, batchSettings.end_angle_deg)
  const displayAngle = running ? (job?.current_angle_deg ?? batchSettings.start_angle_deg) : previewAngle
  const snapshotAngles = useMemo(
    () => Array.from({ length: frameCount }, (_, index) => batchSettings.start_angle_deg + index * batchSettings.step_deg),
    [batchSettings.start_angle_deg, batchSettings.step_deg, frameCount],
  )
  const run = () => {
    const labels = Object.values(blankFields)
    if (labels.length) {
      onValidationError(blankFieldWarning(labels, 'running the batch'))
      return
    }
    onRun()
  }

  useEffect(() => {
    setPreviewAngle((angle) => angle < batchSettings.start_angle_deg || angle > rangeEnd ? batchSettings.start_angle_deg : angle)
  }, [batchSettings.start_angle_deg, rangeEnd])

  useEffect(() => {
    if (running || !previewPlaying || rangeEnd <= batchSettings.start_angle_deg) return
    const range = rangeEnd - batchSettings.start_angle_deg
    const degreesPerTick = range / 120
    const timer = window.setInterval(() => {
      setPreviewAngle((angle) => {
        const next = angle + degreesPerTick
        return next > rangeEnd ? batchSettings.start_angle_deg : next
      })
    }, 80)
    return () => window.clearInterval(timer)
  }, [batchSettings.start_angle_deg, previewPlaying, rangeEnd, running])

  return (
    <main className="batch-workspace">
      <aside className="batch-recipe">
        <header><span><b>Acquisition recipe</b><small>Configure a reproducible sweep</small></span><Orbit /></header>
        <div className="recipe-type active"><Orbit /><span><b>Angle sweep</b><small>One projection angle changes per frame</small></span></div>
        <div className="field-grid">
          <NumericInput fieldId="start_angle_deg" label="Start" value={batchSettings.start_angle_deg} unit="°" onBlankChange={trackBlankField} onChange={(value) => update({ start_angle_deg: value })} />
          <NumericInput fieldId="end_angle_deg" label="End" value={batchSettings.end_angle_deg} unit="°" onBlankChange={trackBlankField} onChange={(value) => update({ end_angle_deg: value })} />
          <NumericInput fieldId="step_deg" label="Step" value={batchSettings.step_deg} min={0.1} step={0.5} unit="°" onBlankChange={trackBlankField} onChange={(value) => update({ step_deg: Math.max(0.1, value) })} />
          <NumericInput fieldId="view_count" label="Views" value={frameCount} unit="" readOnly onChange={() => undefined} />
        </div>
        <div className="batch-fixed">
          <span>Fixed geometry</span>
          <dl><div><dt>SID</dt><dd>{renderSettings.sid_mm} mm</dd></div><div><dt>Detector</dt><dd>{renderSettings.detector_width_px} × {renderSettings.detector_height_px}</dd></div><div><dt>Spacing</dt><dd>{renderSettings.detector_col_spacing_mm} mm</dd></div><div><dt>Backend</dt><dd>{renderSettings.backend.toUpperCase()}</dd></div></dl>
        </div>
        <div className="toggle-list">
          <label><span><b>Shared normalization</b><small>Keep brightness comparable across views</small></span><input type="checkbox" checked={batchSettings.shared_normalization} onChange={(event) => update({ shared_normalization: event.target.checked })} /></label>
          <label><span><b>Include raw arrays</b><small>Save a Float32 NPY for every projection</small></span><input type="checkbox" checked={batchSettings.include_raw} onChange={(event) => update({ include_raw: event.target.checked })} /></label>
        </div>
        <div className="batch-estimates">
          <div className="batch-estimate"><Timer /><span><small>Projection count</small><b>{frameCount} views</b></span></div>
          <div className="batch-estimate"><Box /><span><small>Estimated output</small><b>about {formatBytes(estimatedBytes)}</b></span></div>
        </div>
        {!rangeValid && <div className="geometry-warning"><AlertTriangle />End angle must be greater than or equal to start angle.</div>}
        {!readiness.ready && <div className="geometry-warning"><AlertTriangle />{runtimeError || readiness.message}</div>}
        {readiness.metrics.warnings.map((warning) => <div className="geometry-warning" key={warning}><AlertTriangle />{warning}</div>)}
      </aside>

      <section className="trajectory-panel">
        <header className="workspace-heading"><div><span className="eyebrow">Trajectory preview</span><h2>{frameCount} projections along the configured orbit</h2></div><span className="angle-readout">{displayAngle.toFixed(1)}°</span></header>
        <div className="trajectory-scene">
          <AcquisitionScene
            volume={volume}
            settings={{ ...renderSettings, projection_angle_deg: displayAngle }}
            windowLevel={windowLevel}
            rendering={rendering}
            compact
            showOrbit
            orbitSampleAngles={snapshotAngles}
          />
          <div className="trajectory-legend" aria-hidden="true"><span><i className="patient-key" />Patient reference</span><span><i className="gantry-key" />Active fixture</span><span><i className="snapshot-key" />Acquisition views</span></div>
        </div>
        <div className="trajectory-controls">
          <button type="button" className="icon-button" disabled={running || rangeEnd <= batchSettings.start_angle_deg} aria-label={previewPlaying ? 'Pause trajectory preview' : 'Play trajectory preview'} title={previewPlaying ? 'Pause preview' : 'Play preview'} onClick={() => setPreviewPlaying((playing) => !playing)}>
            {previewPlaying ? <Pause /> : <Play />}
          </button>
          <input
            aria-label="Preview angle"
            type="range"
            min={batchSettings.start_angle_deg}
            max={rangeEnd}
            step={Math.max(0.1, batchSettings.step_deg / 5)}
            value={Math.min(rangeEnd, Math.max(batchSettings.start_angle_deg, displayAngle))}
            disabled={running || rangeEnd <= batchSettings.start_angle_deg}
            onChange={(event) => { setPreviewPlaying(false); setPreviewAngle(Number(event.target.value)) }}
          />
          <span>{running ? 'Following acquisition' : previewPlaying ? 'Previewing gantry motion' : 'Preview paused'}</span>
        </div>
        {job && (
          <div className={`job-progress ${job.status}`}>
            <div className="progress-copy"><span><b>{job.message}</b><small>{Math.round(job.progress * 100)}% complete</small></span><span>{job.status}</span></div>
            <div className="progress-track"><i style={{ width: `${job.progress * 100}%` }} /></div>
            {job.error && <div className="error-message" role="alert">{job.error}</div>}
          </div>
        )}
      </section>

      <aside className="batch-summary">
        <div><span className="eyebrow">Ready to acquire</span><h2>Angle sweep</h2><p>The export includes display PNGs, optional raw projections, and one JSON manifest with the geometry of every frame.</p></div>
        <dl><div><dt>Volume</dt><dd>{volume.filename}</dd></div><div><dt>Range</dt><dd>{batchSettings.start_angle_deg}° → {batchSettings.end_angle_deg}°</dd></div><div><dt>Step</dt><dd>{batchSettings.step_deg}°</dd></div><div><dt>Orbit plane</dt><dd>X {renderSettings.orbit_tilt_x_deg.toFixed(1)}° · Y {renderSettings.orbit_tilt_y_deg.toFixed(1)}°</dd></div><div><dt>Detector roll</dt><dd>{renderSettings.detector_roll_deg.toFixed(1)}°</dd></div><div><dt>Resolution</dt><dd>{renderSettings.detector_width_px} × {renderSettings.detector_height_px}</dd></div><div><dt>Frames</dt><dd>{frameCount}</dd></div></dl>
        <div className="batch-summary-spacer" />
        {job?.status === 'completed' && <SweepDownloadMenu job={job} full />}
        {running ? (
          <button type="button" className="button danger full" onClick={onCancel}><Square /> Cancel batch</button>
        ) : (
          <button type="button" className="button primary full" disabled={!batchReady} onClick={run}><Play /> Run {frameCount} projections</button>
        )}
        <span className="local-note"><Box /> Results stay on this machine until downloaded.</span>
      </aside>
    </main>
  )
}
