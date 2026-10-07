import { AlertTriangle, ChevronDown, RotateCcw, Share2, Square, Zap } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { acquisitionExportUrl } from '../api'
import { acquisitionMetrics } from '../acquisitionGeometry'
import type { BackendName, ProjectionModelName, RenderSettings, RuntimeInfo, VolumeInfo } from '../types'
import { blankFieldWarning, NumericInput } from './NumericInput'

interface Props {
  settings: RenderSettings
  busy: boolean
  onChange: (settings: RenderSettings) => void
  onRender: () => void
  onCancel: () => void
  onValidationError: (message: string) => void
  onReset: () => void
  volumeFilename: string
  runtime: RuntimeInfo | null
  runtimeError: string | null
  volume: VolumeInfo
}

type NumericKey = {
  [K in keyof RenderSettings]: RenderSettings[K] extends number ? K : never
}[keyof RenderSettings]

interface SliderProps {
  label: string
  field: NumericKey
  value: number
  min: number
  max: number
  step?: number
  unit: string
  onChange: (field: NumericKey, value: number) => void
  resetKey: number
  onBlankChange: (fieldId: string, label: string, blank: boolean) => void
}

function Slider({ label, field, value, min, max, step = 1, unit, onChange, resetKey, onBlankChange }: SliderProps) {
  return (
    <div className="slider-field">
      <div className="slider-input-row">
        <label className="slider-track">
          <span>{label}</span>
          <input aria-label={`${label} slider`} type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(field, Number(event.target.value))} />
        </label>
        <NumericInput fieldId={`${String(field)}_exact`} label={label} hideLabel value={value} min={min} max={max} step={step} unit={unit} resetKey={resetKey} onBlankChange={onBlankChange} onChange={(next) => onChange(field, next)} />
      </div>
    </div>
  )
}

function filenameStem(filename: string) {
  return filename.replace(/\.nii(?:\.gz)?$/i, '').replace(/[^a-z0-9._-]+/gi, '_') || 'volume'
}

export function ParameterPanel({ settings, busy, onChange, onRender, onCancel, onValidationError, onReset, volumeFilename, runtime, runtimeError, volume }: Props) {
  const [blankFields, setBlankFields] = useState<Record<string, string>>({})
  const [resetKey, setResetKey] = useState(0)
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
  const numeric = (field: NumericKey, value: number) => onChange({ ...settings, [field]: value })
  const patch = (values: Partial<RenderSettings>) => onChange({ ...settings, ...values })
  const preset = (angle: number) => patch({ projection_angle_deg: angle, orbit_tilt_x_deg: 0, orbit_tilt_y_deg: 0, detector_roll_deg: 0 })
  const presetPlane = settings.orbit_tilt_x_deg === 0 && settings.orbit_tilt_y_deg === 0 && settings.detector_roll_deg === 0
  const exportFilename = `${filenameStem(volumeFilename)}_acquisition.sh`
  const exportHref = acquisitionExportUrl(settings)
  const selectedBackend = settings.backend === 'auto'
    ? runtime?.backends.find((backend) => backend.id === runtime.resolved_backend)
    : runtime?.backends.find((backend) => backend.id === settings.backend)
  const resolvedLabel = selectedBackend?.label || (settings.backend === 'auto' ? 'detecting backend' : settings.backend.toUpperCase())
  const acceleratorPackages = runtime?.packages.filter((item) => ['torch', 'cupy'].includes(item.distribution) && item.installed) || []
  const selectedBackendReady = settings.backend === 'auto' || selectedBackend?.available === true
  const metrics = useMemo(() => acquisitionMetrics(volume, settings), [settings, volume])
  const renderReady = runtime?.ready === true && selectedBackendReady && volume.geometry_valid && !metrics.blockingError
  const render = () => {
    const labels = Object.values(blankFields)
    if (labels.length) {
      onValidationError(blankFieldWarning(labels, 'rendering'))
      return
    }
    onRender()
  }
  const reset = () => {
    setBlankFields({})
    setResetKey((current) => current + 1)
    onReset()
  }

  return (
    <aside className="parameter-panel">
      <header className="parameter-header">
        <span><b>Acquisition</b><small>Exact values are stored with every result</small></span>
        <div className="parameter-actions">
          <a className="icon-button" title="Download runnable shell script" aria-label="Download current acquisition as shell script" href={exportHref} download={exportFilename}><Share2 /></a>
          <button type="button" className="icon-button" title="Reset parameters" aria-label="Reset acquisition parameters" onClick={reset}><RotateCcw /></button>
        </div>
      </header>
      <div className="preset-row">
        <button type="button" className={presetPlane && settings.projection_angle_deg === -90 ? 'active' : ''} onClick={() => preset(-90)}>AP</button>
        <button type="button" className={presetPlane && settings.projection_angle_deg === 90 ? 'active' : ''} onClick={() => preset(90)}>PA</button>
        <button type="button" className={presetPlane && Math.abs(settings.projection_angle_deg) === 180 ? 'active' : ''} onClick={() => preset(180)}>Left lat.</button>
        <button type="button" className={presetPlane && settings.projection_angle_deg === 0 ? 'active' : ''} onClick={() => preset(0)}>Right lat.</button>
      </div>

      <details open>
        <summary>Geometry <ChevronDown /></summary>
        <Slider label="Projection angle" field="projection_angle_deg" value={settings.projection_angle_deg} min={-180} max={180} step={1} unit="°" onChange={numeric} resetKey={resetKey} onBlankChange={trackBlankField} />
        <Slider label="Orbit tilt X" field="orbit_tilt_x_deg" value={settings.orbit_tilt_x_deg} min={-180} max={180} step={1} unit="°" onChange={numeric} resetKey={resetKey} onBlankChange={trackBlankField} />
        <Slider label="Orbit tilt Y" field="orbit_tilt_y_deg" value={settings.orbit_tilt_y_deg} min={-180} max={180} step={1} unit="°" onChange={numeric} resetKey={resetKey} onBlankChange={trackBlankField} />
        <Slider label="Source–isocenter" field="sid_mm" value={settings.sid_mm} min={300} max={2000} step={10} unit="mm" onChange={numeric} resetKey={resetKey} onBlankChange={trackBlankField} />
        <Slider label="Isocenter–detector" field="idd_mm" value={settings.idd_mm} min={0} max={1500} step={10} unit="mm" onChange={numeric} resetKey={resetKey} onBlankChange={trackBlankField} />
        <div className="field-grid">
          <NumericInput fieldId="detector_width_px" label="Detector width" value={settings.detector_width_px} min={16} max={2048} unit="px" resetKey={resetKey} onBlankChange={trackBlankField} onChange={(value) => numeric('detector_width_px', value)} />
          <NumericInput fieldId="detector_height_px" label="Detector height" value={settings.detector_height_px} min={16} max={2048} unit="px" resetKey={resetKey} onBlankChange={trackBlankField} onChange={(value) => numeric('detector_height_px', value)} />
          <NumericInput fieldId="detector_col_spacing_mm" label="Column spacing" value={settings.detector_col_spacing_mm} min={0.01} max={20} step={0.01} unit="mm" resetKey={resetKey} onBlankChange={trackBlankField} onChange={(value) => numeric('detector_col_spacing_mm', value)} />
          <NumericInput fieldId="detector_row_spacing_mm" label="Row spacing" value={settings.detector_row_spacing_mm} min={0.01} max={20} step={0.01} unit="mm" resetKey={resetKey} onBlankChange={trackBlankField} onChange={(value) => numeric('detector_row_spacing_mm', value)} />
        </div>
        <div className="geometry-metrics">
          <div><span>SDD</span><b>{metrics.sddMm.toFixed(1)} mm</b></div>
          <div><span>Magnification</span><b>{metrics.magnification.toFixed(3)}×</b></div>
          <div><span>FOV at isocenter</span><b>{metrics.fovAtIsocenterMm[0].toFixed(1)} × {metrics.fovAtIsocenterMm[1].toFixed(1)} mm</b></div>
        </div>
        {[metrics.blockingError, ...metrics.warnings].filter(Boolean).map((warning) => <div className="geometry-warning" key={warning}><AlertTriangle />{warning}</div>)}
      </details>

      <details>
        <summary>Detector alignment <ChevronDown /></summary>
        <Slider label="Detector roll" field="detector_roll_deg" value={settings.detector_roll_deg} min={-180} max={180} step={1} unit="°" onChange={numeric} resetKey={resetKey} onBlankChange={trackBlankField} />
        <div className="field-grid">
          <NumericInput fieldId="detector_offset_u_mm" label="Offset U" value={settings.detector_offset_u_mm} step={0.5} unit="mm" resetKey={resetKey} onBlankChange={trackBlankField} onChange={(value) => numeric('detector_offset_u_mm', value)} />
          <NumericInput fieldId="detector_offset_v_mm" label="Offset V" value={settings.detector_offset_v_mm} step={0.5} unit="mm" resetKey={resetKey} onBlankChange={trackBlankField} onChange={(value) => numeric('detector_offset_v_mm', value)} />
        </div>
      </details>

      <details>
        <summary>Isocenter translation <ChevronDown /></summary>
        <div className="field-grid three">
          <NumericInput fieldId="translate_x_mm" label="X" value={settings.translate_x_mm} step={0.5} unit="mm" resetKey={resetKey} onBlankChange={trackBlankField} onChange={(value) => numeric('translate_x_mm', value)} />
          <NumericInput fieldId="translate_y_mm" label="Y" value={settings.translate_y_mm} step={0.5} unit="mm" resetKey={resetKey} onBlankChange={trackBlankField} onChange={(value) => numeric('translate_y_mm', value)} />
          <NumericInput fieldId="translate_z_mm" label="Z" value={settings.translate_z_mm} step={0.5} unit="mm" resetKey={resetKey} onBlankChange={trackBlankField} onChange={(value) => numeric('translate_z_mm', value)} />
        </div>
      </details>

      <details>
        <summary>Projection model <ChevronDown /></summary>
        <label className="select-field">
          <span>Attenuation model</span>
          <select value={settings.projection_model} onChange={(event) => patch({ projection_model: event.target.value as ProjectionModelName })}>
            <option value="raw">Raw CT sum — qualitative</option>
            <option value="relative_attenuation">HU-relative attenuation</option>
          </select>
        </label>
        <p className="field-note">HU-relative maps each voxel to max(0, 1 + HU/1000). It is water-relative and does not assume a specific X-ray energy.</p>
        <NumericInput fieldId="hu_air_threshold" label="Air threshold" value={settings.hu_air_threshold ?? -900} step={10} unit="HU" resetKey={resetKey} onBlankChange={trackBlankField} onChange={(value) => patch({ hu_air_threshold: value })} />
        <div className="toggle-list">
          <label><span><b>Clamp negative values</b><small>Treat remaining negative values as zero</small></span><input type="checkbox" checked={settings.clamp_negative_to_zero} onChange={(event) => patch({ clamp_negative_to_zero: event.target.checked })} /></label>
          <label><span><b>Invert display</b><small>Dark anatomy on a light background</small></span><input type="checkbox" checked={settings.invert} onChange={(event) => patch({ invert: event.target.checked })} /></label>
        </div>
        <div className="field-grid">
          <NumericInput fieldId="p_lo" label="Low percentile" value={settings.p_lo} min={0} max={100} step={0.1} unit="%" resetKey={resetKey} onBlankChange={trackBlankField} onChange={(value) => numeric('p_lo', value)} />
          <NumericInput fieldId="p_hi" label="High percentile" value={settings.p_hi} min={0} max={100} step={0.1} unit="%" resetKey={resetKey} onBlankChange={trackBlankField} onChange={(value) => numeric('p_hi', value)} />
        </div>
      </details>

      <details>
        <summary>Performance <ChevronDown /></summary>
        <label className="select-field">
          <span>Compute device</span>
          <select value={settings.backend} disabled={busy || !runtime} onChange={(event) => patch({ backend: event.target.value as BackendName })}>
            <option value="auto">Automatic{runtime ? ` — ${runtime.resolved_backend.toUpperCase()}` : ''}</option>
            {runtime?.backends.map((backend) => (
              <option key={backend.id} value={backend.id} disabled={!backend.available}>
                {backend.label}{backend.available ? '' : ' — unavailable'}
              </option>
            )) || <>
              <option value="mps">Apple GPU (MPS)</option>
              <option value="cuda">NVIDIA GPU (CUDA)</option>
              <option value="cpu">CPU</option>
            </>}
          </select>
        </label>
        {(settings.backend === 'cpu' || (settings.backend === 'auto' && runtime?.resolved_backend === 'cpu')) && <NumericInput fieldId="cpu_workers" label="CPU workers" value={settings.cpu_workers} min={1} max={64} unit="" resetKey={resetKey} onBlankChange={trackBlankField} onChange={(value) => numeric('cpu_workers', value)} />}
        <div className={`runtime-card ${runtime?.ready === false || runtimeError ? 'warning' : ''}`}>
          <div className="runtime-heading">
            <span><b>{runtime?.status || (runtimeError ? 'Runtime check failed' : 'Checking Python runtime…')}</b>{runtime && <small>Python {runtime.python_version} · {runtime.architecture}</small>}</span>
            <i aria-hidden="true" />
          </div>
          {runtime && <code title={runtime.python_executable}>{runtime.python_executable}</code>}
          {runtimeError && <p>{runtimeError}</p>}
          {runtime && <div className="runtime-packages" aria-label="Python package status">
            {runtime.backends.map((backend) => <span key={backend.id} className={backend.available ? '' : 'missing'}>{backend.label} · {backend.available ? 'ready' : 'unavailable'}</span>)}
            {acceleratorPackages.map((item) => (
              <span key={item.distribution}>
                {item.name} {item.version}
              </span>
            ))}
          </div>}
        </div>
        <p className="field-note">{selectedBackend?.detail || 'Automatic prefers NVIDIA CUDA, then Apple Metal, then CPU.'} Use smaller previews while positioning; 512 px CPU projections can take substantially longer.</p>
      </details>

      <div className="parameter-footer">
        <span className={renderReady ? '' : 'not-ready'}><i />{busy ? 'Rendering…' : renderReady ? `${resolvedLabel} ready` : !volume.geometry_valid ? 'Volume geometry is not valid for acquisition' : metrics.blockingError || 'Python or device packages required'}</span>
        {busy
          ? <button type="button" className="button secondary full" onClick={onCancel}><Square /> Cancel render</button>
          : <button type="button" className="button primary full" disabled={!renderReady} onClick={render}><Zap /> Render projection</button>}
      </div>
    </aside>
  )
}
