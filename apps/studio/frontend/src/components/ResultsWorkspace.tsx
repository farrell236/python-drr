import { Download, Eye, Image, Layers3 } from 'lucide-react'
import { useState } from 'react'
import type { JobInfo } from '../types'
import { BatchResultViewer } from './BatchResultViewer'
import { SweepDownloadMenu } from './SweepDownloadMenu'

export function ResultsWorkspace({ jobs }: { jobs: JobInfo[] }) {
  const [openBatch, setOpenBatch] = useState<JobInfo | null>(null)
  return (
    <main className="results-workspace">
      <header className="results-heading"><span className="eyebrow">Session results</span><h1>Rendered projections and batches</h1><p>Completed jobs remain available while this local server is running.</p></header>
      {jobs.length === 0 ? (
        <div className="results-empty"><Layers3 /><b>No results yet</b><span>Render a projection or run an angle sweep to populate this workspace.</span></div>
      ) : (
        <div className="results-grid">
          {jobs.map((job) => (
            <article key={job.id} className="result-card">
              <div className="result-preview">
                {job.image_url ? <img src={`${job.image_url}?v=${job.completed_at || job.progress}`} alt="Projection preview" /> : <Image />}
                <span>{job.kind}</span>
              </div>
              <div className="result-copy"><span><b>{job.kind === 'batch' ? `${job.frame_count} view angle sweep` : 'Single projection'}</b><small>{new Date(job.created_at).toLocaleString()}</small></span><span className={`status ${job.status}`}><i />{job.status}</span></div>
              <p>{job.message}</p>
              <div className="result-actions">
                {job.kind === 'batch' && job.status === 'completed' && <button type="button" className="button secondary" onClick={() => setOpenBatch(job)}><Eye /> View sweep</button>}
                {job.kind === 'batch' && job.status === 'completed'
                  ? <SweepDownloadMenu job={job} />
                  : job.download_url && <a className="button secondary" href={job.download_url}><Download /> Download ZIP</a>}
              </div>
            </article>
          ))}
        </div>
      )}
      {openBatch && <BatchResultViewer job={openBatch} onClose={() => setOpenBatch(null)} />}
    </main>
  )
}
