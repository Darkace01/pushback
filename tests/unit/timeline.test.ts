import { describe, expect, it } from 'vitest'
import { compareToTypical, jobTimeline, runSeconds, typicalSeconds } from '../../src/shared/timeline'
import type { Job, WorkflowRun } from '../../src/shared/types'

const T0 = Date.parse('2026-01-01T00:00:00Z')
const at = (s: number) => new Date(T0 + s * 1000).toISOString()
const job = (id: number, from: number | null, to: number | null, status = 'completed', conclusion: string | null = 'success'): Job => ({
  id, name: `job ${id}`, status, conclusion, startedAt: from === null ? null : at(from), completedAt: to === null ? null : at(to), url: '', steps: []
})

describe('jobTimeline', () => {
  it('lays jobs out on one axis from the first start to the last end', () => {
    const t = jobTimeline([job(2, 50, 100), job(1, 0, 50), job(3, 0, 100)])
    expect(t.seconds).toBe(100)
    expect(t.bars.map((b) => [b.id, b.left, b.width, b.seconds])).toEqual([
      [1, 0, 50, 50],
      [3, 0, 100, 100],
      [2, 50, 50, 50]
    ])
    expect(t.queued).toEqual([])
  })
  it('runs a job still going up to now, and lists jobs that have not started', () => {
    const t = jobTimeline([job(1, 0, 30), job(2, 30, null, 'in_progress', null), job(3, null, null, 'queued', null)], T0 + 60_000)
    expect(t.seconds).toBe(60)
    expect(t.bars[1]).toMatchObject({ id: 2, running: true, seconds: 30, left: 50, width: 50 })
    expect(t.queued).toEqual([{ id: 3, name: 'job 3' }])
  })
  it('gives an instant job a visible sliver', () => {
    const t = jobTimeline([job(1, 0, 0), job(2, 0, 200)])
    expect(t.bars.find((b) => b.id === 1)!.width).toBe(0.5)
  })
  it('is empty when nothing has started', () => {
    expect(jobTimeline([job(1, null, null, 'queued', null)])).toEqual({ seconds: 0, bars: [], queued: [{ id: 1, name: 'job 1' }] })
  })
})

const run = (id: number, seconds: number, over: Partial<WorkflowRun> = {}): WorkflowRun => ({
  repo: 'o/r', id, workflowId: 1, name: 'CI', title: '', status: 'completed', conclusion: 'success', event: 'push', branch: 'main', sha: '',
  actor: '', actorAvatar: '', runNumber: id, attempt: 1, createdAt: at(0), startedAt: at(0), updatedAt: at(seconds), url: '', ...over
})

describe('typicalSeconds', () => {
  it('is the median of other successful runs of the same workflow', () => {
    const runs = [run(1, 100), run(2, 300), run(3, 200), run(4, 9999, { conclusion: 'failure' }), run(5, 5000, { workflowId: 2 }), run(6, 50)]
    expect(typicalSeconds(runs, 1, 6)).toBe(200)
    expect(typicalSeconds(runs, 1)).toBe(150)
  })
  it('needs three samples', () => {
    expect(typicalSeconds([run(1, 100), run(2, 200)], 1)).toBeUndefined()
  })
  it('measures a run from start to last update', () => {
    expect(runSeconds(run(1, 75))).toBe(75)
  })
})

describe('compareToTypical', () => {
  it('says how far off usual a run is', () => {
    expect(compareToTypical(150, 100)).toBe('50% slower than usual')
    expect(compareToTypical(80, 100)).toBe('20% faster than usual')
    expect(compareToTypical(105, 100)).toBe('about as long as usual')
    expect(compareToTypical(100, undefined)).toBeUndefined()
  })
})
