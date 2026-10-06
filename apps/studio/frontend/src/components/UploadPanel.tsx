import { Cable, CheckCircle2, LoaderCircle, ScanLine, Terminal, Upload } from 'lucide-react'
import { FormEvent, useEffect, useRef, useState } from 'react'
import type { RuntimeInfo } from '../types'

interface Props {
  busy: boolean
  error: string | null
  runtime: RuntimeInfo | null
  runtimeError: string | null
  apiBase: string
  connecting: boolean
  onConnect: (apiBase: string) => Promise<void>
  onChangeConnection: () => void
  onUpload: (file: File) => Promise<void>
}

export function UploadPanel({ busy, error, runtime, runtimeError, apiBase, connecting, onConnect, onChangeConnection, onUpload }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [endpoint, setEndpoint] = useState(apiBase)

  useEffect(() => setEndpoint(apiBase), [apiBase])

  const accept = (files: FileList | null) => {
    const file = files?.[0]
    if (file && runtime) void onUpload(file)
  }

  const connect = (event: FormEvent) => {
    event.preventDefault()
    void onConnect(endpoint)
  }

  return (
    <main className="welcome">
      <section
        className={`upload-card ${runtime ? 'connected' : 'connection-card'} ${dragging ? 'dragging' : ''}`}
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

        {!runtime ? (
          <div className="connection-panel">
            <div className="connection-intro">
              <Cable />
              <span><b>Connect to local PyDRR</b><small>The hosted interface needs the PyDRR service running on this computer.</small></span>
            </div>
            <form className="connection-form" onSubmit={connect}>
              <label htmlFor="service-endpoint">Local service</label>
              <div className="connection-field">
                <input id="service-endpoint" type="url" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} spellCheck={false} required />
                <button className="button primary" type="submit" disabled={connecting}>
                  {connecting ? <LoaderCircle className="spin" /> : <Cable />}
                  {connecting ? 'Connecting' : 'Connect'}
                </button>
              </div>
            </form>
            {runtimeError && <div className="error-message connection-error" role="alert">{runtimeError}<small>If prompted, allow this page to access devices on your local network.</small></div>}
            <div className="local-setup">
              <span><Terminal /><b>Start the local service</b></span>
              <code>python -m pip install &quot;python-drr[studio] @ git+https://github.com/farrell236/python-drr.git&quot;</code>
              <code>pydrr-studio --port 8765</code>
            </div>
            <small className="privacy-note">The browser sends volumes directly to your loopback service. Files and projections stay on this machine.</small>
          </div>
        ) : (
          <>
            <div className="connection-status">
              <CheckCircle2 />
              <span><b>Local PyDRR connected</b><small>{runtime.python_version} · {runtime.resolved_backend.toUpperCase()} · {apiBase}</small></span>
              <button className="button secondary compact" type="button" onClick={onChangeConnection}>Change</button>
            </div>
            <p>{busy ? 'Loading volume…' : 'Open a NIfTI volume to begin.'}</p>
            <div className="upload-formats">Drop a <code>.nii</code> or <code>.nii.gz</code> file here</div>
            <input
              ref={inputRef}
              hidden
              type="file"
              accept=".nii,.nii.gz,.gz,application/gzip,application/x-gzip,application/octet-stream"
              onChange={(event) => accept(event.target.files)}
            />
            <button className="button primary" type="button" disabled={busy} onClick={() => inputRef.current?.click()}>
              <Upload /> Choose NIfTI volume
            </button>
            <small>Files stay on this machine.</small>
            {error && <div className="error-message" role="alert">{error}</div>}
          </>
        )}
      </section>
    </main>
  )
}
