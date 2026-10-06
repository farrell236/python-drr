import { ChevronDown, RotateCcw, Share2, Zap } from 'lucide-react'
import { acquisitionExportUrl } from '../api'
import type { BackendName, RenderSettings, RuntimeInfo } from '../types'

interface Props {
  settings: RenderSettings
  busy: boolean
  onChange: (settings: RenderSettings) => void
  onRender: () => void
  onReset: () => void
  volumeFilename: string
  runtime: RuntimeInfo | null
  runtimeError: string | null
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
}

function Slider({ label, field, value, min, max, step = 1, unit, onChange }: SliderProps) {
  return (
    <label className="slider-field">
      <span>{label}<output>{value.toFixed(step < 1 ? 2 : 0)} {unit}</output></span>
      <input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(field, Number(event.target.value))} />
    </label>
  )
}

function NumberInput({ label, value, unit, min, max, step = 1, onChange }: { label: string; value: number; unit: string; min?: number; max?: number; step?: number; onChange: (value: number) => void }) {
  return (
    <label className="number-field">
      <span>{label}</span>
      <div><input type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} /><em>{unit}</em></div>
    </label>
  )
}

function filenameStem(filename: string) {
  return filename.replace(/\.nii(?:\.gz)?$/i, '').replace(/[^a-z0-9._-]+/gi, '_') || 'volume'
}

export function ParameterPanel({ settings, busy, onChange, onRender, onReset, volumeFilename, runtime, runtimeError }: Props) {
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
  const renderReady = runtime?.ready === true && selectedBackendReady

  return (
    <aside className="parameter-panel">
      <header className="parameter-header">
        <span><b>Acquisition</b><small>Exact values are stored with every result</small></span>
        <div className="parameter-actions">
          <a className="icon-button" title="Download runnable shell script" aria-label="Download current acquisition as shell script" href={exportHref} download={exportFilename}><Share2 /></a>
          <button type="button" className="icon-button" title="Reset parameters" aria-label="Reset acquisition parameters" onClick={onReset}><RotateCcw /></button>
        </div>
      </header>
      <div className="preset-row">
        <button type="button" className={presetPlane && settings.projection_angle_deg === 0 ? 'active' : ''} onClick={() => preset(0)}>AP</button>
        <button type="button" className={presetPlane && settings.projection_angle_deg === 180 ? 'active' : ''} onClick={() => preset(180)}>PA</button>
        <button type="button" className={presetPlane && Math.abs(settings.projection_angle_deg) === 90 ? 'active' : ''} onClick={() => preset(90)}>Lateral</button>
      </div>

      <details open>
        <summary>Geometry <ChevronDown /></summary>
        <Slider label="Projection angle" field="projection_angle_deg" value={settings.projection_angle_deg} min={-180} max={180} step={1} unit="°" onChange={numeric} />
        <Slider label="Orbit tilt X" field="orbit_tilt_x_deg" value={settings.orbit_tilt_x_deg} min={-180} max={180} step={1} unit="°" onChange={numeric} />
        <Slider label="Orbit tilt Y" field="orbit_tilt_y_deg" value={settings.orbit_tilt_y_deg} min={-180} max={180} step={1} unit="°" onChange={numeric} />
        <Slider label="Source–isocenter" field="sid_mm" value={settings.sid_mm} min={300} max={2000} step={10} unit="mm" onChange={numeric} />
        <Slider label="Isocenter–detector" field="idd_mm" value={settings.idd_mm} min={0} max={1500} step={10} unit="mm" onChange={numeric} />
        <div className="field-grid">
          <NumberInput label="Detector width" value={settings.detector_width_px} min={16} max={1024} unit="px" onChange={(value) => numeric('detector_width_px', value)} />
          <NumberInput label="Detector height" value={settings.detector_height_px} min={16} max={1024} unit="px" onChange={(value) => numeric('detector_height_px', value)} />
          <NumberInput label="Column spacing" value={settings.detector_col_spacing_mm} min={0.01} max={20} step={0.01} unit="mm" onChange={(value) => numeric('detector_col_spacing_mm', value)} />
          <NumberInput label="Row spacing" value={settings.detector_row_spacing_mm} min={0.01} max={20} step={0.01} unit="mm" onChange={(value) => numeric('detector_row_spacing_mm', value)} />
        </div>
      </details>

      <details>
        <summary>Detector alignment <ChevronDown /></summary>
        <Slider label="Detector roll" field="detector_roll_deg" value={settings.detector_roll_deg} min={-180} max={180} step={1} unit="°" onChange={numeric} />
        <div className="field-grid">
          <NumberInput label="Offset U" value={settings.detector_offset_u_mm} step={0.5} unit="mm" onChange={(value) => numeric('detector_offset_u_mm', value)} />
          <NumberInput label="Offset V" value={settings.detector_offset_v_mm} step={0.5} unit="mm" onChange={(value) => numeric('detector_offset_v_mm', value)} />
        </div>
      </details>

      <details>
        <summary>Isocenter translation <ChevronDown /></summary>
        <div className="field-grid three">
          <NumberInput label="X" value={settings.translate_x_mm} step={0.5} unit="mm" onChange={(value) => numeric('translate_x_mm', value)} />
          <NumberInput label="Y" value={settings.translate_y_mm} step={0.5} unit="mm" onChange={(value) => numeric('translate_y_mm', value)} />
          <NumberInput label="Z" value={settings.translate_z_mm} step={0.5} unit="mm" onChange={(value) => numeric('translate_z_mm', value)} />
        </div>
      </details>

      <details>
        <summary>Projection model <ChevronDown /></summary>
        <NumberInput label="Air threshold" value={settings.hu_air_threshold ?? -900} step={10} unit="HU" onChange={(value) => patch({ hu_air_threshold: value })} />
        <div className="toggle-list">
          <label><span><b>Clamp negative values</b><small>Treat remaining negative values as zero</small></span><input type="checkbox" checked={settings.clamp_negative_to_zero} onChange={(event) => patch({ clamp_negative_to_zero: event.target.checked })} /></label>
          <label><span><b>Invert display</b><small>Dark anatomy on a light background</small></span><input type="checkbox" checked={settings.invert} onChange={(event) => patch({ invert: event.target.checked })} /></label>
        </div>
        <div className="field-grid">
          <NumberInput label="Low percentile" value={settings.p_lo} min={0} max={100} step={0.1} unit="%" onChange={(value) => numeric('p_lo', value)} />
          <NumberInput label="High percentile" value={settings.p_hi} min={0} max={100} step={0.1} unit="%" onChange={(value) => numeric('p_hi', value)} />
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
        {(settings.backend === 'cpu' || (settings.backend === 'auto' && runtime?.resolved_backend === 'cpu')) && <NumberInput label="CPU workers" value={settings.cpu_workers} min={1} max={64} unit="" onChange={(value) => numeric('cpu_workers', value)} />}
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
        <span className={renderReady ? '' : 'not-ready'}><i />{busy ? 'Rendering…' : renderReady ? `${resolvedLabel} ready` : 'Python or device packages required'}</span>
        <button type="button" className="button primary full" disabled={busy || !renderReady} onClick={onRender}><Zap /> Render projection</button>
      </div>
    </aside>
  )
}
