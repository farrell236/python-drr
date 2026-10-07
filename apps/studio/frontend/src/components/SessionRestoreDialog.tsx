import { FolderClock, RotateCcw, Sparkles } from 'lucide-react'
import type { SessionSnapshot } from '../types'

interface Props {
  session: SessionSnapshot
  busy: boolean
  error: string | null
  onRestore: () => void
  onStartNew: () => void
}

function sessionAge(updatedAt: string | null) {
  if (!updatedAt) return 'Recently used'
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - new Date(updatedAt).getTime()) / 60_000))
  if (elapsedMinutes < 1) return 'Used just now'
  if (elapsedMinutes < 60) return `Last used ${elapsedMinutes} minute${elapsedMinutes === 1 ? '' : 's'} ago`
  const elapsedHours = Math.floor(elapsedMinutes / 60)
  return `Last used ${elapsedHours} hour${elapsedHours === 1 ? '' : 's'} ago`
}

export function SessionRestoreDialog({ session, busy, error, onRestore, onStartNew }: Props) {
  const completed = session.jobs.filter((job) => job.status === 'completed').length
  const active = session.jobs.filter((job) => ['queued', 'running'].includes(job.status)).length
  return (
    <div className="modal-backdrop session-restore-backdrop" role="presentation">
      <section className="session-restore-dialog" role="dialog" aria-modal="true" aria-labelledby="restore-session-title">
        <span className="session-dialog-icon"><FolderClock /></span>
        <div>
          <span className="eyebrow">Local session found</span>
          <h1 id="restore-session-title">Restore previous session?</h1>
          <p>Continue with the volume, controls, saved views, and results kept by this running PyDRR Studio server.</p>
        </div>
        <div className="session-summary">
          <b>{session.volume?.filename || 'Previous volume'}</b>
          <span>{completed} completed result{completed === 1 ? '' : 's'}{active > 0 ? ` · ${active} active job${active === 1 ? '' : 's'}` : ''}</span>
          <small>{sessionAge(session.updated_at)}</small>
        </div>
        {error && <div className="error-message" role="alert">{error}</div>}
        <div className="session-dialog-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={onStartNew}><Sparkles /> Start new</button>
          <button type="button" className="button primary" disabled={busy} onClick={onRestore}><RotateCcw /> {busy ? 'Restoring…' : 'Restore session'}</button>
        </div>
        <small className="session-privacy">This recovery is local and disappears when the Studio server stops.</small>
      </section>
    </div>
  )
}
