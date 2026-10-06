import { AlertTriangle, Box, Layers3, Orbit, Plus, ScanLine, Upload, Zap } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { cancelJob, createBatch, createRender, getRuntime, uploadVolume, waitForJob } from './api'
import { AcquisitionScene } from './components/AcquisitionScene'
import { BatchWorkspace } from './components/BatchWorkspace'
import { ParameterPanel } from './components/ParameterPanel'
import { ProjectionViewer } from './components/ProjectionViewer'
import { ResultsWorkspace } from './components/ResultsWorkspace'
import { UploadPanel } from './components/UploadPanel'
import type { BatchSettings, JobInfo, RenderSettings, RuntimeInfo, SavedView, VolumeInfo, Workspace } from './types'

const DEFAULT_SETTINGS: RenderSettings = {
  volume_id: '',
  projection_angle_deg: 0,
  sid_mm: 1000,
  idd_mm: 500,
  detector_height_px: 512,
  detector_width_px: 512,
  detector_row_spacing_mm: 0.51,
  detector_col_spacing_mm: 0.51,
  translate_x_mm: 0,
  translate_y_mm: 0,
  translate_z_mm: 0,
  orbit_tilt_x_deg: 0,
  orbit_tilt_y_deg: 0,
  detector_roll_deg: 0,
  detector_offset_u_mm: 0,
  detector_offset_v_mm: 0,
  hu_air_threshold: -900,
  clamp_negative_to_zero: true,
  invert: true,
  p_lo: 1,
  p_hi: 99.5,
  backend: 'auto',
  cpu_workers: 1,
}

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>('acquire')
  const [volume, setVolume] = useState<VolumeInfo | null>(null)
  const [settings, setSettings] = useState<RenderSettings>(DEFAULT_SETTINGS)
  const [batchSettings, setBatchSettings] = useState<BatchSettings>({ render: DEFAULT_SETTINGS, start_angle_deg: 0, end_angle_deg: 355, step_deg: 5, shared_normalization: true, include_raw: true })
  const [activeRender, setActiveRender] = useState<JobInfo | null>(null)
  const [activeBatch, setActiveBatch] = useState<JobInfo | null>(null)
  const [jobs, setJobs] = useState<JobInfo[]>([])
  const [savedViews, setSavedViews] = useState<SavedView[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    getRuntime()
      .then((info) => {
        if (active) {
          setRuntime(info)
          setRuntimeError(null)
        }
      })
      .catch((runtimeFailure) => {
        if (active) {
          setRuntime(null)
          setRuntimeError(runtimeFailure instanceof Error ? runtimeFailure.message : 'Could not inspect the Python runtime')
        }
      })
    return () => { active = false }
  }, [])

  const busy = !!activeRender && ['queued', 'running'].includes(activeRender.status)
  const resultCount = jobs.filter((job) => job.status === 'completed').length
  const activeSettings = useMemo(() => ({ ...settings, volume_id: volume?.id || '' }), [settings, volume])

  const addOrUpdateJob = (job: JobInfo) => {
    setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)])
  }

  const handleUpload = async (file: File) => {
    setUploading(true)
    setError(null)
    try {
      const info = await uploadVolume(file)
      setVolume(info)
      const next = { ...DEFAULT_SETTINGS, volume_id: info.id }
      setSettings(next)
      setBatchSettings((current) => ({ ...current, render: next }))
      setActiveRender(null)
      setActiveBatch(null)
      setSavedViews([])
      setWorkspace('acquire')
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Could not load the volume')
    } finally {
      setUploading(false)
    }
  }

  const renderProjection = async () => {
    if (!volume) return
    setError(null)
    try {
      const created = await createRender(activeSettings)
      const initial: JobInfo = { id: created.id, kind: 'render', status: 'queued', progress: 0, message: 'Queued', created_at: new Date().toISOString(), started_at: null, completed_at: null, error: null, frame_count: null, current_angle_deg: settings.projection_angle_deg, image_url: null, download_url: null, metadata: null }
      setActiveRender(initial)
      addOrUpdateJob(initial)
      const complete = await waitForJob(created.id, (job) => { setActiveRender(job); addOrUpdateJob(job) })
      if (complete.status === 'failed') setError(complete.error || 'Projection failed')
    } catch (renderError) {
      setError(renderError instanceof Error ? renderError.message : 'Projection failed')
    }
  }

  const runBatch = async () => {
    if (!volume) return
    setError(null)
    try {
      const request = { ...batchSettings, render: activeSettings }
      const created = await createBatch(request)
      const frameCount = Math.floor((request.end_angle_deg - request.start_angle_deg) / request.step_deg) + 1
      const initial: JobInfo = { id: created.id, kind: 'batch', status: 'queued', progress: 0, message: 'Queued', created_at: new Date().toISOString(), started_at: null, completed_at: null, error: null, frame_count: frameCount, current_angle_deg: request.start_angle_deg, image_url: null, download_url: null, metadata: null }
      setActiveBatch(initial)
      addOrUpdateJob(initial)
      const complete = await waitForJob(created.id, (job) => { setActiveBatch(job); addOrUpdateJob(job) })
      if (complete.status === 'failed') setError(complete.error || 'Batch acquisition failed')
    } catch (batchError) {
      setError(batchError instanceof Error ? batchError.message : 'Batch acquisition failed')
    }
  }

  const saveView = () => {
    const name = `View ${savedViews.length + 1}`
    setSavedViews((current) => [...current, { id: crypto.randomUUID(), name, settings: activeSettings, imageUrl: activeRender?.image_url || undefined }])
  }

  if (!volume) return <div className="app-shell"><UploadPanel busy={uploading} error={error} runtime={runtime} runtimeError={runtimeError} onUpload={handleUpload} /></div>

  return (
    <div className="app-shell">
      <input
        ref={inputRef}
        hidden
        type="file"
        accept=".nii,.nii.gz,.gz,application/gzip,application/x-gzip,application/octet-stream"
        onChange={(event) => event.target.files?.[0] && void handleUpload(event.target.files[0])}
      />
      <AppHeader workspace={workspace} onWorkspace={setWorkspace} resultCount={resultCount} volume={volume} onReplace={() => inputRef.current?.click()} />
      {volume.orientation_warning && <div className="warning-banner"><AlertTriangle /> <span>{volume.orientation_warning}</span></div>}
      {error && <div className="global-error" role="alert"><AlertTriangle />{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div>}

      {workspace === 'acquire' && (
        <main className="workbench">
          <div className="workbench-canvas">
            <div className="viewer-grid">
              <section className="viewer-panel scene-panel">
                <header className="panel-header"><span><Box /> Acquisition geometry</span><span className="status completed"><i />Volume ready</span></header>
                <AcquisitionScene volume={volume} settings={activeSettings} />
              </section>
              <ProjectionViewer job={activeRender} settings={activeSettings} />
            </div>
            <section className="acquisition-tray">
              <div className="tray-title"><span className="eyebrow">Acquisition tray</span><b>{savedViews.length ? `${savedViews.length} saved views` : 'Single view'}</b></div>
              {savedViews.map((view) => <button type="button" key={view.id} className="saved-view" onClick={() => setSettings(view.settings)}><span className="saved-thumb">{view.imageUrl ? <img src={view.imageUrl} alt="" /> : <ScanLine />}</span><span><b>{view.name}</b><small>{view.settings.projection_angle_deg.toFixed(1)}° · {view.settings.detector_width_px}²</small></span></button>)}
              <button type="button" className="save-view" onClick={saveView}><Plus /> Save view</button>
              <button type="button" className="button secondary tray-batch" onClick={() => setWorkspace('batch')}><Orbit /> Build angle sweep</button>
            </section>
          </div>
          <ParameterPanel settings={activeSettings} busy={busy} runtime={runtime} runtimeError={runtimeError} onChange={setSettings} onRender={() => void renderProjection()} onReset={() => setSettings({ ...DEFAULT_SETTINGS, volume_id: volume.id })} volumeFilename={volume.filename} />
        </main>
      )}

      {workspace === 'batch' && <BatchWorkspace volume={volume} renderSettings={activeSettings} batchSettings={{ ...batchSettings, render: activeSettings }} job={activeBatch} onChange={setBatchSettings} onRun={() => void runBatch()} onCancel={() => activeBatch && void cancelJob(activeBatch.id).then(setActiveBatch)} />}
      {workspace === 'results' && <ResultsWorkspace jobs={jobs} />}
    </div>
  )
}

function AppHeader({ workspace, onWorkspace, resultCount, volume, onReplace }: { workspace: Workspace; onWorkspace: (workspace: Workspace) => void; resultCount: number; volume?: VolumeInfo; onReplace?: () => void }) {
  return (
    <header className="app-header">
      <div className="brand"><span><ScanLine /></span><div><b>PyDRR Studio</b><small>{volume ? `${volume.filename} · ${volume.shape_zyx.join(' × ')}` : 'Interactive DRR acquisition'}</small></div></div>
      <nav aria-label="Workspace">
        <button type="button" className={workspace === 'acquire' ? 'active' : ''} onClick={() => onWorkspace('acquire')}><Zap /> Acquire</button>
        <button type="button" className={workspace === 'batch' ? 'active' : ''} onClick={() => onWorkspace('batch')}><Orbit /> Batch</button>
        <button type="button" className={workspace === 'results' ? 'active' : ''} onClick={() => onWorkspace('results')}><Layers3 /> Results {resultCount > 0 && <i>{resultCount}</i>}</button>
      </nav>
      <div className="header-actions">
        {volume && <button type="button" className="button secondary" onClick={onReplace}><Upload /> Replace volume</button>}
      </div>
    </header>
  )
}
