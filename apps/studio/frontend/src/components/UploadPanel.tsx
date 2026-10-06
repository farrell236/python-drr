import { AlertTriangle, CheckCircle2, LoaderCircle, ScanLine, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import type { RuntimeInfo } from '../types'

interface Props {
  busy: boolean
  error: string | null
  runtime: RuntimeInfo | null
  runtimeError: string | null
  onUpload: (file: File) => Promise<void>
}

export function UploadPanel({ busy, error, runtime, runtimeError, onUpload }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const accept = (files: FileList | null) => {
    const file = files?.[0]
    if (file && runtime) void onUpload(file)
  }

  return (
    <main className="welcome">
      <section
        className={`upload-card ${dragging ? 'dragging' : ''}`}
        onDragEnter={(event) => { if (runtime) { event.preventDefault(); setDragging(true) } }}
        onDragOver={(event) => { if (runtime) event.preventDefault() }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          if (!runtime) return
          event.preventDefault()
          setDragging(false)
          accept(event.dataTransfer.files)
        }}
      >
        <div className="upload-icon"><ScanLine /></div>
        <h1>PyDRR Studio</h1>
        <p>{busy ? 'Loading volume…' : 'Open a NIfTI volume to begin.'}</p>

        <div className={`connection-status ${runtimeError ? 'warning' : ''}`}>
          {runtimeError ? <AlertTriangle /> : runtime ? <CheckCircle2 /> : <LoaderCircle className="spin" />}
          <span>
            <b>{runtimeError ? 'Compute runtime unavailable' : runtime ? `${runtime.resolved_backend.toUpperCase()} ready` : 'Detecting compute devices…'}</b>
            <small>{runtime ? `Python ${runtime.python_version} · ${runtime.architecture}` : runtimeError || 'Using the environment that started Studio'}</small>
          </span>
        </div>

        <div className="upload-formats">Drop a <code>.nii</code> or <code>.nii.gz</code> file here</div>
        <input
          ref={inputRef}
          hidden
          type="file"
          accept=".nii,.nii.gz,.gz,application/gzip,application/x-gzip,application/octet-stream"
          onChange={(event) => accept(event.target.files)}
        />
        <button className="button primary" type="button" disabled={busy || !runtime} onClick={() => inputRef.current?.click()}>
          <Upload /> Choose NIfTI volume
        </button>
        <small>Files and projections stay on this machine.</small>
        {error && <div className="error-message" role="alert">{error}</div>}
      </section>
    </main>
  )
}
