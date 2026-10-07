import type { BatchSettings, JobInfo, RenderSettings, RuntimeInfo, VolumeInfo, VolumeRenderData } from './types'

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

export function volumeSliceUrl(volumeId: string, axis: string, index: number, windowCenter: number, windowWidth: number) {
  const query = new URLSearchParams({
    index: String(index),
    window_center: String(windowCenter),
    window_width: String(windowWidth),
  })
  return apiUrl(`/api/volumes/${encodeURIComponent(volumeId)}/slices/${axis}?${query}`)
}

function parseNumberTuple(value: string | null, label: string): [number, number, number] {
  const parsed = value?.split(',').map(Number)
  if (!parsed || parsed.length !== 3 || parsed.some((item) => !Number.isFinite(item))) {
    throw new Error(`The local PyDRR service returned invalid ${label} metadata.`)
  }
  return parsed as [number, number, number]
}

const volumeRenderDataCache = new Map<string, VolumeRenderData>()

export async function getVolumeRenderData(volumeId: string, signal?: AbortSignal): Promise<VolumeRenderData> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const cached = volumeRenderDataCache.get(volumeId)
  if (cached) return cached
  let response: Response
  try {
    response = await fetch(apiUrl(`/api/volumes/${encodeURIComponent(volumeId)}/render-data`), { signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new Error('Could not load the volume rendering data from the local PyDRR service.', { cause: error })
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ detail: response.statusText }))
    throw new Error(errorDetail(payload.detail, `Volume data request failed with status ${response.status}`))
  }
  const dimensionsXYZ = parseNumberTuple(response.headers.get('X-PyDRR-Dimensions'), 'dimension')
  const spacingXYZ = parseNumberTuple(response.headers.get('X-PyDRR-Spacing'), 'spacing')
  const buffer = await response.arrayBuffer()
  const expectedBytes = dimensionsXYZ.reduce((product, value) => product * value, 1) * Float32Array.BYTES_PER_ELEMENT
  if (buffer.byteLength !== expectedBytes) {
    throw new Error('The local PyDRR service returned incomplete volume rendering data.')
  }
  const renderData = { values: new Float32Array(buffer), dimensionsXYZ, spacingXYZ }
  volumeRenderDataCache.set(volumeId, renderData)
  if (volumeRenderDataCache.size > 2) {
    const oldestKey = volumeRenderDataCache.keys().next().value
    if (typeof oldestKey === 'string') volumeRenderDataCache.delete(oldestKey)
  }
  return renderData
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
