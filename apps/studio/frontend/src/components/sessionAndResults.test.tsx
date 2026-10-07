import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JobInfo, SessionSnapshot } from '../types'
import { ResultsWorkspace } from './ResultsWorkspace'
import { SessionRestoreDialog } from './SessionRestoreDialog'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const batchJob: JobInfo = {
  id: 'batch-job',
  kind: 'batch',
  status: 'completed',
  progress: 1,
  message: 'Completed 3 projections',
  created_at: '2026-10-07T12:00:00Z',
  started_at: '2026-10-07T12:00:01Z',
  completed_at: '2026-10-07T12:00:05Z',
  error: null,
  frame_count: 3,
  current_angle_deg: 20,
  image_url: '/api/jobs/batch-job/image',
  download_url: '/api/jobs/batch-job/download',
  metadata: { angles_deg: [0, 10, 20], volume_filename: 'scan.nii.gz' },
}

const session: SessionSnapshot = {
  active: true,
  session_id: 'session',
  updated_at: '2026-10-07T12:00:00Z',
  volume: {
    id: 'volume', filename: 'scan.nii.gz', shape_zyx: [3, 4, 5], spacing_zyx_mm: [1, 1, 1], origin_zyx_mm: [0, 0, 0],
    direction: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], intensity_min: -1000, intensity_max: 1000, center_world_xyz_mm: [2, 1.5, 1],
    geometry_valid: true, orientation_warning: null, session_id: 'session',
  },
  jobs: [batchJob],
  state: {},
}

describe('session recovery workflow', () => {
  it('requires an explicit restore or start-new choice', async () => {
    const restore = vi.fn()
    const startNew = vi.fn()
    const user = userEvent.setup()
    render(<SessionRestoreDialog session={session} busy={false} error={null} onRestore={restore} onStartNew={startNew} />)

    expect(screen.getByRole('heading', { name: 'Restore previous session?' })).toBeTruthy()
    expect(screen.getByText('scan.nii.gz')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /Restore session/i }))
    expect(restore).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: /Start new/i }))
    expect(startNew).toHaveBeenCalledOnce()
  })
})

describe('batch result workflow', () => {
  it('opens the cine viewer and navigates projection frames', async () => {
    const user = userEvent.setup()
    render(<ResultsWorkspace jobs={[batchJob]} />)

    await user.click(screen.getByRole('button', { name: /View sweep/i }))
    expect(screen.getByRole('dialog', { name: 'scan.nii.gz' })).toBeTruthy()
    const slider = screen.getByRole('slider', { name: 'Batch frame' })
    fireEvent.change(slider, { target: { value: '1' } })
    expect(screen.getByText('Frame 2 / 3 · 10.0°')).toBeTruthy()
    expect(screen.getByAltText('Projection 2 of 3').getAttribute('src')).toBe('/api/jobs/batch-job/frames/1')
  })

  it('offers direct scientific exports and opens media settings', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))
    render(<ResultsWorkspace jobs={[batchJob]} />)

    await user.click(screen.getByRole('button', { name: /Download sweep/i }))
    expect(screen.getByRole('menuitem', { name: /ZIP package/i }).getAttribute('href')).toBe('/api/jobs/batch-job/download')
    expect(screen.getByRole('menuitem', { name: /Manifest JSON/i }).getAttribute('href')).toBe('/api/jobs/batch-job/manifest')
    expect(screen.getByRole('menuitem', { name: /Reproduction script/i }).getAttribute('href')).toBe('/api/jobs/batch-job/script')

    await user.click(screen.getByRole('menuitem', { name: /GIF animation/i }))
    expect(await screen.findByRole('dialog', { name: 'Export GIF animation' })).toBeTruthy()
    expect(screen.getByLabelText('First frame').getAttribute('value')).toBe('1')
    expect(screen.getByLabelText('Last frame').getAttribute('value')).toBe('3')
    expect(screen.getByText('3 encoded frames')).toBeTruthy()
  })
})
