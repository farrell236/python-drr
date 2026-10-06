import type { BackendName, BatchSettings, JobInfo, RenderSettings, RuntimeInfo, RuntimeInstallInfo, VolumeInfo } from './types'

const API_STORAGE_KEY = 'pydrr-studio-api-base'
const DEFAULT_LOCAL_API = 'http://127.0.0.1:8765'

function isLoopback(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function initialApiBase() {
  const stored = window.localStorage.getItem(API_STORAGE_KEY)
  if (stored) return stored
  return isLoopback(window.location.hostname) ? '' : DEFAULT_LOCAL_API
}

let apiBase = initialApiBase()

export function getApiBase() {
  return apiBase || window.location.origin
}

export function setApiBase(value: string) {
  const parsed = new URL(value.trim())
  if (!['http:', 'https:'].includes(parsed.protocol) || !isLoopback(parsed.hostname)) {
    throw new Error('PyDRR Studio can only connect to a service on localhost or 127.0.0.1')
  }
  apiBase = parsed.origin
  window.localStorage.setItem(API_STORAGE_KEY, apiBase)
  return apiBase
}

export function apiUrl(path: string) {
  return apiBase ? new URL(path, `${apiBase}/`).toString() : path
}

function localRequestOptions(options?: RequestInit): RequestInit {
  if (!apiBase) return options || {}
  return {
    ...options,
    credentials: 'omit',
    // Newer browsers use this hint when asking permission to reach loopback
    // services from a public HTTPS page. Older browsers ignore the field.
    targetAddressSpace: 'loopback',
  } as RequestInit
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const target = apiUrl(path)
  let response: Response
  try {
    response = await fetch(target, localRequestOptions(options))
  } catch (error) {
    throw new Error(`Could not reach the local PyDRR service at ${getApiBase()}. Start pydrr-studio and try again.`, { cause: error })
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ detail: response.statusText }))
    throw new Error(payload.detail || `Request failed with status ${response.status}`)
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
  return request('/api/runtime')
}

export function selectRuntime(pythonExecutable: string): Promise<RuntimeInfo> {
  return request('/api/runtime/select', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ python_executable: pythonExecutable }),
  })
}

export function installRuntime(backend: BackendName): Promise<RuntimeInstallInfo> {
  return request('/api/runtime/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ backend }),
  })
}

export function getRuntimeInstall(id: string): Promise<RuntimeInstallInfo> {
  return request(`/api/runtime/install/${id}`)
}

export async function waitForRuntimeInstall(
  id: string,
  onUpdate: (install: RuntimeInstallInfo) => void,
): Promise<RuntimeInstallInfo> {
  for (;;) {
    const install = await getRuntimeInstall(id)
    onUpdate(install)
    if (['completed', 'failed'].includes(install.status)) return install
    await new Promise((resolve) => window.setTimeout(resolve, 700))
  }
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
