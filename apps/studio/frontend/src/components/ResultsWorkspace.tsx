import { Download, Image, Layers3 } from 'lucide-react'
import type { JobInfo } from '../types'

export function ResultsWorkspace({ jobs }: { jobs: JobInfo[] }) {
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
              {job.download_url && <a className="button secondary full" href={job.download_url}><Download /> Download ZIP</a>}
            </article>
          ))}
        </div>
      )}
    </main>
  )
}
