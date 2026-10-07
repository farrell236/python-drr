import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Database,
  Laptop,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
} from 'lucide-react'
import type { BackendName, RuntimeInfo, StudioPreferences, ThemePreference, VolumeInfo } from '../types'

interface Props {
  preferences: StudioPreferences
  runtime: RuntimeInfo | null
  runtimeError: string | null
  runtimeRefreshing: boolean
  volume: VolumeInfo
  jobCount: number
  onChange: (preferences: StudioPreferences) => void
  onRefreshRuntime: () => void
}

const THEME_OPTIONS: { id: ThemePreference; label: string; detail: string; icon: typeof Laptop }[] = [
  { id: 'system', label: 'System', detail: 'Follow this device', icon: Laptop },
  { id: 'light', label: 'Light', detail: 'Always use light', icon: Sun },
  { id: 'dark', label: 'Dark', detail: 'Always use dark', icon: Moon },
]

export function SettingsWorkspace({ preferences, runtime, runtimeError, runtimeRefreshing, volume, jobCount, onChange, onRefreshRuntime }: Props) {
  const patch = (values: Partial<StudioPreferences>) => onChange({ ...preferences, ...values })
  const selectedBackend = preferences.defaultBackend === 'auto'
    ? runtime?.backends.find((backend) => backend.id === runtime.resolved_backend)
    : runtime?.backends.find((backend) => backend.id === preferences.defaultBackend)
  const usesCpu = preferences.defaultBackend === 'cpu' || (preferences.defaultBackend === 'auto' && runtime?.resolved_backend === 'cpu')

  return (
    <main className="settings-workspace">
      <header className="settings-heading">
        <span className="eyebrow">Studio preferences</span>
        <h1>Settings</h1>
        <p>Application-wide preferences are saved in this browser and apply to new volumes and acquisition resets.</p>
      </header>

      <div className="settings-grid">
        <div className="settings-column">
          <section className="settings-card">
            <header><span className="settings-card-icon"><Sun /></span><span><b>Appearance</b><small>Choose how Studio is displayed</small></span></header>
            <div className="theme-options" role="group" aria-label="Color theme">
              {THEME_OPTIONS.map((option) => {
                const Icon = option.icon
                return (
                  <button type="button" key={option.id} className={preferences.theme === option.id ? 'active' : ''} aria-pressed={preferences.theme === option.id} onClick={() => patch({ theme: option.id })}>
                    <Icon />
                    <span><b>{option.label}</b><small>{option.detail}</small></span>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="settings-card">
            <header><span className="settings-card-icon"><Cpu /></span><span><b>Compute defaults</b><small>Used for new volumes and acquisition resets</small></span></header>
            <label className="settings-field">
              <span><b>Preferred compute device</b><small>Automatic chooses the fastest available backend</small></span>
              <select value={preferences.defaultBackend} disabled={!runtime} onChange={(event) => patch({ defaultBackend: event.target.value as BackendName })}>
                <option value="auto">Automatic{runtime ? ` — ${runtime.resolved_backend.toUpperCase()}` : ''}</option>
                {runtime?.backends.map((backend) => <option key={backend.id} value={backend.id} disabled={!backend.available}>{backend.label}{backend.available ? '' : ' — unavailable'}</option>)}
              </select>
            </label>
            <label className="settings-field">
              <span><b>Default CPU workers</b><small>Used when CPU rendering is selected</small></span>
              <input type="number" min={1} max={64} step={1} value={preferences.defaultCpuWorkers} disabled={!usesCpu} onChange={(event) => patch({ defaultCpuWorkers: Math.min(64, Math.max(1, Number(event.target.value) || 1)) })} />
            </label>
            <p className="settings-note"><CheckCircle2 />Changes also update the current acquisition. Individual acquisitions can still override them in Performance.</p>
            {selectedBackend && <div className={`selected-backend ${selectedBackend.available ? '' : 'warning'}`}><i /><span><b>{selectedBackend.label}</b><small>{selectedBackend.detail}</small></span></div>}
          </section>

          <section className="settings-card local-session-card">
            <header><span className="settings-card-icon"><ShieldCheck /></span><span><b>Local session</b><small>Medical images stay on this machine</small></span></header>
            <dl className="settings-facts">
              <div><dt>Loaded volume</dt><dd title={volume.filename}>{volume.filename}</dd></div>
              <div><dt>Volume dimensions</dt><dd>{volume.shape_zyx[2]} × {volume.shape_zyx[1]} × {volume.shape_zyx[0]}</dd></div>
              <div><dt>Session results</dt><dd>{jobCount}</dd></div>
            </dl>
            <p className="settings-note"><Database />Uploads and generated results use a temporary local session. Download result archives you want to retain.</p>
          </section>
        </div>

        <section className={`settings-card runtime-settings-card ${runtimeError ? 'warning' : ''}`}>
          <header>
            <span className="settings-card-icon"><Laptop /></span>
            <span><b>Python runtime</b><small>The environment that started PyDRR Studio</small></span>
            <button type="button" className="button secondary" disabled={runtimeRefreshing} onClick={onRefreshRuntime}><RefreshCw className={runtimeRefreshing ? 'spin' : ''} /> Refresh</button>
          </header>

          {runtimeError && <div className="settings-runtime-alert"><AlertTriangle /><span><b>Runtime inspection failed</b><small>{runtimeError}</small></span></div>}
          {runtime && <>
            <div className="runtime-overview">
              <span className={`runtime-state ${runtime.ready ? '' : 'warning'}`}><i /><b>{runtime.status}</b></span>
              <dl>
                <div><dt>Python</dt><dd>{runtime.python_version}</dd></div>
                <div><dt>Architecture</dt><dd>{runtime.architecture}</dd></div>
                <div><dt>Automatic backend</dt><dd>{runtime.resolved_backend.toUpperCase()}</dd></div>
                <div><dt>Platform</dt><dd>{runtime.platform}</dd></div>
              </dl>
              <div className="runtime-path"><span>Executable</span><code>{runtime.python_executable}</code></div>
            </div>

            <div className="settings-subsection">
              <span className="eyebrow">Compute devices</span>
              <div className="backend-status-grid">
                {runtime.backends.map((backend) => (
                  <article key={backend.id} className={backend.available ? 'available' : 'unavailable'}>
                    <span><Cpu /><b>{backend.label}</b><i /></span>
                    <p>{backend.detail}</p>
                    <small>{backend.package ? `${backend.package}${backend.version ? ` ${backend.version}` : ''}` : 'Built in'}</small>
                  </article>
                ))}
              </div>
            </div>

            <div className="settings-subsection">
              <span className="eyebrow">Python packages</span>
              <div className="package-list">
                {runtime.packages.map((item) => (
                  <div key={item.distribution} className={item.installed ? '' : 'missing'}>
                    <span>{item.installed ? <CheckCircle2 /> : <AlertTriangle />}<b>{item.name}</b>{item.required && <em>Required</em>}</span>
                    <code>{item.installed ? item.version : 'Not installed'}</code>
                  </div>
                ))}
              </div>
            </div>
          </>}
        </section>
      </div>
    </main>
  )
}
