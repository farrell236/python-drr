import type { BatchSettings, JobInfo, RenderSettings, RuntimeInfo, VolumeInfo } from './types'

export function apiUrl(path: string) {
  return path
}

function fieldLabel(location: unknown): string {
  if (!Array.isArray(location)) return ''
  const field = location.filter((part) => part !== 'body').at(-1)
  if (typeof field !== 'string') return ''
  return field
    .replace(/_px$/, '')
    .replaceAll('_', ' ')
    .replace(/^./, (letter) => letter.toUpperCase())
}

function errorDetail(detail: unknown, fallback: string): string {
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail)) {
    const messages = detail.flatMap((item) => {
      if (typeof item === 'string') return item
      if (!item || typeof item !== 'object') return []
      const issue = item as { loc?: unknown; msg?: unknown }
      if (typeof issue.msg !== 'string') return []
      const label = fieldLabel(issue.loc)
      return label ? `${label}: ${issue.msg}` : issue.msg
    })
    if (messages.length) return messages.join('; ')
  }
  if (detail && typeof detail === 'object' && 'msg' in detail) {
    const message = (detail as { msg?: unknown }).msg
    if (typeof message === 'string') return message
  }
  return fallback
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const target = apiUrl(path)
  let response: Response
  try {
    response = await fetch(target, options)
  } catch (error) {
    throw new Error('Could not reach the local PyDRR service. Restart pydrr-studio and try again.', { cause: error })
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ detail: response.statusText }))
    throw new Error(errorDetail(payload.detail, `Request failed with status ${response.status}`))
  }
  return response.json() as Promise<T>
}

function withResourceUrls(job: JobInfo): JobInfo {
  return {
    ...job,
    image_url: job.image_url ? apiUrl(job.image_url) : null,
    download_url: job.download_url ? apiUrl(job.download_url) : null,
  }
}

export async function uploadVolume(file: File): Promise<VolumeInfo> {
  const body = new FormData()
  body.append('file', file)
  return request<VolumeInfo>('/api/volumes', { method: 'POST', body })
}

export function getRuntime(): Promise<RuntimeInfo> {
  return request('/api/runtime', { signal: AbortSignal.timeout(15000) })
}

export async function createRender(settings: RenderSettings): Promise<{ id: string }> {
  return request('/api/renders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
}

export async function createBatch(settings: BatchSettings): Promise<{ id: string }> {
  return request('/api/batches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
}

export async function getJob(id: string): Promise<JobInfo> {
  return withResourceUrls(await request(`/api/jobs/${id}`))
}

export async function cancelJob(id: string): Promise<JobInfo> {
  return withResourceUrls(await request(`/api/jobs/${id}/cancel`, { method: 'POST' }))
}

export function acquisitionExportUrl(settings: RenderSettings) {
  return apiUrl(`/api/exports/acquisition.sh?config=${encodeURIComponent(JSON.stringify(settings))}`)
}

export async function waitForJob(
  id: string,
  onUpdate: (job: JobInfo) => void,
  signal?: AbortSignal,
): Promise<JobInfo> {
  for (;;) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const job = await getJob(id)
    onUpdate(job)
    if (['completed', 'failed', 'cancelled'].includes(job.status)) return job
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(resolve, 700)
      signal?.addEventListener('abort', () => {
        window.clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      }, { once: true })
    })
  }
}
