import { AlertTriangle, Box, Layers3, Orbit, Plus, ScanLine, Settings2, Trash2, Upload, Zap } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { cancelJob, createBatch, createRender, getRuntime, uploadVolume, waitForJob } from './api'
import { AcquisitionScene } from './components/AcquisitionScene'
import { BatchWorkspace } from './components/BatchWorkspace'
import { ParameterPanel } from './components/ParameterPanel'
import { ProjectionViewer } from './components/ProjectionViewer'
import { ResultsWorkspace } from './components/ResultsWorkspace'
import { SettingsWorkspace } from './components/SettingsWorkspace'
import { UploadPanel } from './components/UploadPanel'
import { ViewerWorkspace } from './components/ViewerWorkspace'
import { applyTheme, loadStudioPreferences, saveStudioPreferences } from './preferences'
import type { BatchSettings, JobInfo, RenderSettings, RuntimeInfo, SavedView, StudioPreferences, VolumeInfo, WindowLevel, Workspace } from './types'
import { activeVolumeRenderSettings, defaultVolumeRenderState, volumeRenderLabel } from './volumeRendering'

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
  projection_model: 'raw',
  invert: true,
  p_lo: 1,
  p_hi: 99.5,
  backend: 'auto',
  cpu_workers: 1,
}

interface SavedViewDragGhost {
  name: string
  detail: string
  width: number
  height: number
  x: number
  y: number
}

function renderDefaults(preferences: StudioPreferences, volumeId = ''): RenderSettings {
  return {
    ...DEFAULT_SETTINGS,
    volume_id: volumeId,
    backend: preferences.defaultBackend,
    cpu_workers: preferences.defaultCpuWorkers,
  }
}

function defaultWindowLevel(volume: VolumeInfo): WindowLevel {
  if (volume.intensity_min <= -500 && volume.intensity_max >= 300) return { center: 40, width: 400 }
  const width = Math.max(1, volume.intensity_max - volume.intensity_min)
  return { center: volume.intensity_min + width / 2, width }
}

export default function App() {
  const initialPreferences = useMemo(loadStudioPreferences, [])
  const [preferences, setPreferences] = useState<StudioPreferences>(initialPreferences)
  const [workspace, setWorkspace] = useState<Workspace>('viewer')
  const [volume, setVolume] = useState<VolumeInfo | null>(null)
  const [settings, setSettings] = useState<RenderSettings>(() => renderDefaults(initialPreferences))
  const [windowLevel, setWindowLevel] = useState<WindowLevel>({ center: 40, width: 400 })
  const [volumeRenderState, setVolumeRenderState] = useState(defaultVolumeRenderState)
  const [batchSettings, setBatchSettings] = useState<BatchSettings>({ render: renderDefaults(initialPreferences), start_angle_deg: 0, end_angle_deg: 355, step_deg: 5, shared_normalization: true, include_raw: true })
  const [activeRender, setActiveRender] = useState<JobInfo | null>(null)
  const [renderedSettings, setRenderedSettings] = useState<RenderSettings | null>(null)
  const [activeBatch, setActiveBatch] = useState<JobInfo | null>(null)
  const [jobs, setJobs] = useState<JobInfo[]>([])
  const [savedViews, setSavedViews] = useState<SavedView[]>([])
  const [selectedSavedViewId, setSelectedSavedViewId] = useState<string | null>(null)
  const [deletedSavedView, setDeletedSavedView] = useState<{ view: SavedView; index: number } | null>(null)
  const [draggedSavedViewId, setDraggedSavedViewId] = useState<string | null>(null)
  const [dragOverDelete, setDragOverDelete] = useState(false)
  const [savedViewDragGhost, setSavedViewDragGhost] = useState<SavedViewDragGhost | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [runtimeRefreshing, setRuntimeRefreshing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const savedViewDeckRef = useRef<HTMLDivElement>(null)
  const savedViewsRef = useRef<SavedView[]>([])
  const savedViewDragCleanupRef = useRef<(() => void) | null>(null)
  const savedViewDragGhostRef = useRef<HTMLDivElement>(null)
  const savedViewRectsRef = useRef<Map<string, DOMRect> | null>(null)
  const suppressSavedViewClickRef = useRef(false)

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

  useEffect(() => {
    applyTheme(preferences.theme)
    saveStudioPreferences(preferences)
  }, [preferences])

  useEffect(() => {
    savedViewDragCleanupRef.current?.()
  }, [workspace])

  useEffect(() => {
    savedViewsRef.current = savedViews
  }, [savedViews])

  useEffect(() => () => savedViewDragCleanupRef.current?.(), [])

  useLayoutEffect(() => {
    const previousRects = savedViewRectsRef.current
    const deck = savedViewDeckRef.current
    if (!previousRects || !deck || !draggedSavedViewId) return

    deck.querySelectorAll<HTMLElement>('[data-saved-view-id]').forEach((card) => {
      const viewId = card.dataset.savedViewId
      if (!viewId || viewId === draggedSavedViewId) return
      const previous = previousRects.get(viewId)
      if (!previous) return
      const current = card.getBoundingClientRect()
      const deltaX = previous.left - current.left
      const deltaY = previous.top - current.top
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return
      card.getAnimations().forEach((animation) => animation.cancel())
      card.animate(
        [{ transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` }, { transform: 'translate3d(0, 0, 0)' }],
        { duration: 190, easing: 'cubic-bezier(.2, .78, .22, 1)' },
      )
    })
    savedViewRectsRef.current = null
  }, [savedViews, draggedSavedViewId])

  useEffect(() => {
    if (!deletedSavedView) return
    const timer = window.setTimeout(() => setDeletedSavedView(null), 5000)
    return () => window.clearTimeout(timer)
  }, [deletedSavedView])

  const busy = !!activeRender && ['queued', 'running'].includes(activeRender.status)
  const resultCount = jobs.filter((job) => job.status === 'completed').length
  const activeSettings = useMemo(() => ({ ...settings, volume_id: volume?.id || '' }), [settings, volume])
  const volumeRendering = useMemo(() => activeVolumeRenderSettings(volumeRenderState), [volumeRenderState])
  const activeSavedViewId = useMemo(() => {
    if (!selectedSavedViewId) return null
    const selected = savedViews.find((view) => view.id === selectedSavedViewId)
    if (!selected) return null
    const matches = (Object.keys(activeSettings) as (keyof RenderSettings)[]).every((key) => activeSettings[key] === selected.settings[key])
    return matches ? selectedSavedViewId : null
  }, [activeSettings, savedViews, selectedSavedViewId])

  const handlePreferencesChange = (next: StudioPreferences) => {
    setPreferences(next)
    setSettings((current) => ({ ...current, backend: next.defaultBackend, cpu_workers: next.defaultCpuWorkers }))
    setBatchSettings((current) => ({ ...current, render: { ...current.render, backend: next.defaultBackend, cpu_workers: next.defaultCpuWorkers } }))
  }

  const refreshRuntime = async () => {
    setRuntimeRefreshing(true)
    try {
      const info = await getRuntime()
      setRuntime(info)
      setRuntimeError(null)
    } catch (runtimeFailure) {
      setRuntime(null)
      setRuntimeError(runtimeFailure instanceof Error ? runtimeFailure.message : 'Could not inspect the Python runtime')
    } finally {
      setRuntimeRefreshing(false)
    }
  }

  const addOrUpdateJob = (job: JobInfo) => {
    setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)])
  }

  const handleUpload = async (file: File) => {
    setUploading(true)
    setError(null)
    try {
      const info = await uploadVolume(file)
      setVolume(info)
      const next = renderDefaults(preferences, info.id)
      setSettings(next)
      setBatchSettings((current) => ({ ...current, render: next }))
      setActiveRender(null)
      setRenderedSettings(null)
      setActiveBatch(null)
      setSavedViews([])
      savedViewsRef.current = []
      setSelectedSavedViewId(null)
      setDeletedSavedView(null)
      setWindowLevel(defaultWindowLevel(info))
      setVolumeRenderState(defaultVolumeRenderState())
      setWorkspace('viewer')
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
      const submittedSettings = { ...activeSettings }
      const created = await createRender(submittedSettings)
      const initial: JobInfo = { id: created.id, kind: 'render', status: 'queued', progress: 0, message: 'Queued', created_at: new Date().toISOString(), started_at: null, completed_at: null, error: null, frame_count: null, current_angle_deg: submittedSettings.projection_angle_deg, image_url: null, download_url: null, metadata: null }
      setActiveRender(initial)
      setRenderedSettings(submittedSettings)
      addOrUpdateJob(initial)
      const complete = await waitForJob(created.id, (job) => { setActiveRender(job); addOrUpdateJob(job) })
      if (complete.status === 'failed') setError(complete.error || 'Projection failed')
    } catch (renderError) {
      setError(renderError instanceof Error ? renderError.message : 'Projection failed')
    }
  }

  const cancelActiveRender = async () => {
    if (!activeRender || !['queued', 'running'].includes(activeRender.status)) return
    try {
      const cancelled = await cancelJob(activeRender.id)
      setActiveRender(cancelled)
      addOrUpdateJob(cancelled)
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Could not cancel the render')
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
    const usedNames = new Set(savedViewsRef.current.map((view) => view.name))
    if (deletedSavedView) usedNames.add(deletedSavedView.view.name)
    let viewNumber = 1
    while (usedNames.has(`View ${viewNumber}`)) viewNumber += 1
    const name = `View ${viewNumber}`
    const id = crypto.randomUUID()
    const next = [{ id, name, settings: activeSettings }, ...savedViewsRef.current]
    savedViewsRef.current = next
    setSavedViews(next)
    setSelectedSavedViewId(id)
  }

  const deleteSavedView = (viewId: string) => {
    const current = savedViewsRef.current
    const index = current.findIndex((view) => view.id === viewId)
    if (index < 0) return
    setDeletedSavedView({ view: current[index], index })
    const next = current.filter((view) => view.id !== viewId)
    savedViewsRef.current = next
    setSavedViews(next)
    if (selectedSavedViewId === viewId) setSelectedSavedViewId(null)
  }

  const undoDeleteSavedView = () => {
    if (!deletedSavedView) return
    const current = savedViewsRef.current
    if (current.some((view) => view.id === deletedSavedView.view.id)) return
    const next = [...current]
    next.splice(Math.min(deletedSavedView.index, next.length), 0, deletedSavedView.view)
    savedViewsRef.current = next
    setSavedViews(next)
    setDeletedSavedView(null)
  }

  const beginSavedViewDrag = (event: ReactPointerEvent<HTMLButtonElement>, viewId: string) => {
    if (!event.isPrimary || event.button !== 0) return

    savedViewDragCleanupRef.current?.()
    const pointerId = event.pointerId
    const pointerType = event.pointerType
    const startX = event.clientX
    const startY = event.clientY
    const savedViewDeck = event.currentTarget.closest<HTMLElement>('.saved-view-deck')
    const draggedCard = event.currentTarget.closest<HTMLElement>('[data-saved-view-id]')
    const draggedCardBounds = draggedCard?.getBoundingClientRect()
    const grabOffsetX = draggedCardBounds ? startX - draggedCardBounds.left : 0
    const grabOffsetY = draggedCardBounds ? startY - draggedCardBounds.top : 0
    const initialScrollLeft = savedViewDeck?.scrollLeft || 0
    let lastX = startX
    let lastY = startY
    let active = false
    let scrolling = false
    let overDelete = false
    let cleanedUp = false

    const positionGhost = (clientX: number, clientY: number) => {
      const x = clientX - grabOffsetX
      const y = clientY - grabOffsetY
      if (savedViewDragGhostRef.current) savedViewDragGhostRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`
      return { x, y }
    }

    const captureSavedViewRects = () => {
      if (!savedViewDeck) return
      savedViewRectsRef.current = new Map(
        Array.from(savedViewDeck.querySelectorAll<HTMLElement>('[data-saved-view-id]')).map((card) => [card.dataset.savedViewId || '', card.getBoundingClientRect()]),
      )
    }

    const updateDragTarget = (clientX: number, clientY: number) => {
      const element = document.elementFromPoint(clientX, clientY)
      const isOverDelete = active && !!element?.closest('.save-view')
      if (isOverDelete !== overDelete) {
        overDelete = isOverDelete
        setDragOverDelete(isOverDelete)
      }
      if (isOverDelete) return true

      if (savedViewDeck) {
        const deckBounds = savedViewDeck.getBoundingClientRect()
        if (clientX < deckBounds.left + 24) savedViewDeck.scrollLeft -= 12
        if (clientX > deckBounds.right - 24) savedViewDeck.scrollLeft += 12
      }

      const target = element?.closest<HTMLElement>('[data-saved-view-id]')
      const targetId = target?.dataset.savedViewId
      if (!target || !targetId || targetId === viewId) return false

      const current = savedViewsRef.current
      const fromIndex = current.findIndex((view) => view.id === viewId)
      const targetIndex = current.findIndex((view) => view.id === targetId)
      if (fromIndex < 0 || targetIndex < 0) return false

      const bounds = target.getBoundingClientRect()
      let insertIndex = targetIndex + (clientX > bounds.left + bounds.width / 2 ? 1 : 0)
      if (fromIndex < insertIndex) insertIndex -= 1
      if (insertIndex === fromIndex) return false

      captureSavedViewRects()
      const next = [...current]
      const [dragged] = next.splice(fromIndex, 1)
      next.splice(insertIndex, 0, dragged)
      savedViewsRef.current = next
      setSavedViews(next)
      return false
    }

    const cleanup = () => {
      if (cleanedUp) return
      cleanedUp = true
      window.clearTimeout(holdTimer)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', finishDrag)
      window.removeEventListener('pointercancel', cancelDrag)
      document.documentElement.classList.remove('saved-view-dragging')
      savedViewDragCleanupRef.current = null
      setDraggedSavedViewId(null)
      setDragOverDelete(false)
      setSavedViewDragGhost(null)
      savedViewRectsRef.current = null
    }

    const activate = () => {
      if (active || cleanedUp) return
      active = true
      setDraggedSavedViewId(viewId)
      const view = savedViewsRef.current.find((item) => item.id === viewId)
      if (view && draggedCardBounds) {
        const position = positionGhost(lastX, lastY)
        setSavedViewDragGhost({
          name: view.name,
          detail: `${view.settings.projection_angle_deg.toFixed(1)}° · ${view.settings.detector_width_px}²`,
          width: draggedCardBounds.width,
          height: draggedCardBounds.height,
          ...position,
        })
      }
      document.documentElement.classList.add('saved-view-dragging')
      updateDragTarget(lastX, lastY)
    }

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return
      lastX = pointerEvent.clientX
      lastY = pointerEvent.clientY
      if (!active) {
        const distance = Math.hypot(lastX - startX, lastY - startY)
        if (pointerType === 'mouse' && distance > 4) {
          window.clearTimeout(holdTimer)
          activate()
          pointerEvent.preventDefault()
          updateDragTarget(lastX, lastY)
        } else if (pointerType !== 'mouse' && distance > 10) {
          window.clearTimeout(holdTimer)
          scrolling = true
          pointerEvent.preventDefault()
          if (savedViewDeck) savedViewDeck.scrollLeft = initialScrollLeft + startX - lastX
        }
        return
      }
      pointerEvent.preventDefault()
      positionGhost(lastX, lastY)
      updateDragTarget(lastX, lastY)
    }

    const finishDrag = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return
      if (active) {
        pointerEvent.preventDefault()
        suppressSavedViewClickRef.current = true
        window.setTimeout(() => { suppressSavedViewClickRef.current = false }, 0)
        if (updateDragTarget(pointerEvent.clientX, pointerEvent.clientY)) deleteSavedView(viewId)
      } else if (scrolling) {
        pointerEvent.preventDefault()
        suppressSavedViewClickRef.current = true
        window.setTimeout(() => { suppressSavedViewClickRef.current = false }, 0)
      }
      cleanup()
    }

    const cancelDrag = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId === pointerId) cleanup()
    }

    const holdTimer = window.setTimeout(activate, 180)
    window.addEventListener('pointermove', handlePointerMove, { passive: false })
    window.addEventListener('pointerup', finishDrag)
    window.addEventListener('pointercancel', cancelDrag)
    savedViewDragCleanupRef.current = cleanup
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

      {workspace === 'viewer' && (
        <ViewerWorkspace
          volume={volume}
          settings={activeSettings}
          windowLevel={windowLevel}
          volumeRenderState={volumeRenderState}
          onWindowLevelChange={setWindowLevel}
          onVolumeRenderStateChange={setVolumeRenderState}
          onIsocenterChange={([x, y, z]) => setSettings((current) => ({ ...current, translate_x_mm: x, translate_y_mm: y, translate_z_mm: z }))}
          onOpenAcquire={() => setWorkspace('acquire')}
        />
      )}

      {workspace === 'acquire' && (
        <main className="workbench">
          <div className="workbench-canvas">
            <div className="viewer-grid">
              <section className="viewer-panel scene-panel">
                <header className="panel-header"><span><Box /> Acquisition geometry</span><span className="status completed"><i />{volumeRenderLabel(volumeRendering)}</span></header>
                <AcquisitionScene volume={volume} settings={activeSettings} windowLevel={windowLevel} rendering={volumeRendering} />
              </section>
              <ProjectionViewer job={activeRender} settings={activeSettings} renderedSettings={renderedSettings} />
            </div>
            <section className="acquisition-tray">
              <div className="tray-title">
                <span className="eyebrow">Acquisition tray</span>
                {savedViews.length > 0 && <span className="tray-count">{savedViews.length} {savedViews.length === 1 ? 'view' : 'views'}</span>}
              </div>
              <div className="tray-content">
                <button
                  type="button"
                  className={`save-view${draggedSavedViewId ? ' delete-view-target' : ''}${dragOverDelete ? ' over' : ''}`}
                  data-saved-view-delete-target={draggedSavedViewId ? 'true' : undefined}
                  onClick={() => { if (!draggedSavedViewId) saveView() }}
                >
                  {draggedSavedViewId ? <><Trash2 /> Delete view</> : <>Save view <Plus /></>}
                </button>
                {savedViews.length > 0 && <div className="saved-view-deck" aria-label="Saved acquisition views" ref={savedViewDeckRef}>
                  {savedViews.map((view) => (
                    <div className={`saved-view-card${activeSavedViewId === view.id ? ' active' : ''}${draggedSavedViewId === view.id ? ' dragging' : ''}`} data-saved-view-id={view.id} key={view.id}>
                      <button
                        type="button"
                        className="saved-view"
                        title="Hold and drag to reorder; drag to Delete view to remove"
                        onPointerDown={(event) => beginSavedViewDrag(event, view.id)}
                        onContextMenu={(event) => event.preventDefault()}
                        onKeyDown={(event) => {
                          if (event.key === 'Delete' || event.key === 'Backspace') {
                            event.preventDefault()
                            deleteSavedView(view.id)
                          }
                        }}
                        onClick={() => {
                          if (suppressSavedViewClickRef.current) {
                            suppressSavedViewClickRef.current = false
                            return
                          }
                          setSettings(view.settings)
                          setSelectedSavedViewId(view.id)
                        }}
                      >
                        <span><b>{view.name}</b><small>{view.settings.projection_angle_deg.toFixed(1)}° · {view.settings.detector_width_px}²</small></span>
                      </button>
                    </div>
                  ))}
                </div>}
              </div>
            </section>
          </div>
          <ParameterPanel settings={activeSettings} busy={busy} runtime={runtime} runtimeError={runtimeError} onChange={setSettings} onRender={() => void renderProjection()} onCancel={() => void cancelActiveRender()} onValidationError={setError} onReset={() => setSettings(renderDefaults(preferences, volume.id))} volumeFilename={volume.filename} volume={volume} />
        </main>
      )}

      {workspace === 'batch' && <BatchWorkspace volume={volume} renderSettings={activeSettings} windowLevel={windowLevel} rendering={volumeRendering} batchSettings={{ ...batchSettings, render: activeSettings }} job={activeBatch} onChange={setBatchSettings} onRun={() => void runBatch()} onValidationError={setError} onCancel={() => activeBatch && void cancelJob(activeBatch.id).then(setActiveBatch)} />}
      {workspace === 'results' && <ResultsWorkspace jobs={jobs} />}
      {workspace === 'settings' && <SettingsWorkspace preferences={preferences} runtime={runtime} runtimeError={runtimeError} runtimeRefreshing={runtimeRefreshing} volume={volume} jobCount={jobs.length} onChange={handlePreferencesChange} onRefreshRuntime={() => void refreshRuntime()} />}
      {savedViewDragGhost && createPortal(
        <div
          aria-hidden="true"
          className="saved-view-drag-ghost"
          ref={savedViewDragGhostRef}
          style={{ width: savedViewDragGhost.width, height: savedViewDragGhost.height, transform: `translate3d(${savedViewDragGhost.x}px, ${savedViewDragGhost.y}px, 0)` }}
        >
          <b>{savedViewDragGhost.name}</b>
          <small>{savedViewDragGhost.detail}</small>
        </div>,
        document.body,
      )}
      {deletedSavedView && <div className="undo-toast" role="status"><span>{deletedSavedView.view.name} deleted</span><button type="button" onClick={undoDeleteSavedView}>Undo</button></div>}
    </div>
  )
}

function AppHeader({ workspace, onWorkspace, resultCount, volume, onReplace }: { workspace: Workspace; onWorkspace: (workspace: Workspace) => void; resultCount: number; volume?: VolumeInfo; onReplace?: () => void }) {
  return (
    <header className="app-header">
      <div className="brand"><span><ScanLine /></span><div><b>PyDRR Studio</b><small>{volume ? `${volume.filename} · ${volume.shape_zyx[2]} × ${volume.shape_zyx[1]} × ${volume.shape_zyx[0]}` : 'Interactive DRR acquisition'}</small></div></div>
      <nav aria-label="Workspace">
        <button type="button" className={workspace === 'viewer' ? 'active' : ''} onClick={() => onWorkspace('viewer')}><ScanLine /> Viewer</button>
        <button type="button" className={workspace === 'acquire' ? 'active' : ''} onClick={() => onWorkspace('acquire')}><Zap /> Acquire</button>
        <button type="button" className={workspace === 'batch' ? 'active' : ''} onClick={() => onWorkspace('batch')}><Orbit /> Batch</button>
        <button type="button" className={workspace === 'results' ? 'active' : ''} onClick={() => onWorkspace('results')}><Layers3 /> Results {resultCount > 0 && <i>{resultCount}</i>}</button>
        <button type="button" className={workspace === 'settings' ? 'active' : ''} onClick={() => onWorkspace('settings')}><Settings2 /> Settings</button>
      </nav>
      <div className="header-actions">
        {volume && <button type="button" className="button secondary" onClick={onReplace}><Upload /> Replace volume</button>}
      </div>
    </header>
  )
}
