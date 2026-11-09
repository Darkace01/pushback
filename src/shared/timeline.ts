import type { Job, WorkflowRun } from './types'

export interface TimelineBar {
  id: number
  name: string
  status: string
  conclusion: string | null
  /** Offset from the first job's start and width, as percentages of the whole run. */
  left: number
  width: number
  /** Seconds the job took (or has taken so far). */
  seconds: number
  running: boolean
}

export interface Timeline {
  /** Seconds from the first job starting to the last one ending (or now). */
  seconds: number
  bars: TimelineBar[]
  /** Jobs that haven't started yet. */
  queued: { id: number; name: string }[]
}

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN)

/** Lays the jobs out on one time axis, so parallel jobs and the critical path are visible at a glance. */
export function jobTimeline(jobs: Job[], now = Date.now()): Timeline {
  const started = jobs.filter((j) => !Number.isNaN(ms(j.startedAt)))
  const queued = jobs.filter((j) => Number.isNaN(ms(j.startedAt))).map((j) => ({ id: j.id, name: j.name }))
  if (!started.length) return { seconds: 0, bars: [], queued }
  const endOf = (j: Job) => {
    const end = ms(j.completedAt)
    return Number.isNaN(end) || j.status !== 'completed' ? now : end
  }
  const start = Math.min(...started.map((j) => ms(j.startedAt)))
  const end = Math.max(start + 1000, ...started.map(endOf))
  const span = end - start
  const bars = [...started]
    .sort((a, b) => ms(a.startedAt) - ms(b.startedAt) || a.id - b.id)
    .map((j) => {
      const from = ms(j.startedAt)
      const to = Math.max(from, endOf(j))
      return {
        id: j.id,
        name: j.name,
        status: j.status,
        conclusion: j.conclusion,
        left: ((from - start) / span) * 100,
        // A job that took no time still gets a visible sliver.
        width: Math.max(0.5, ((to - from) / span) * 100),
        seconds: Math.round((to - from) / 1000),
        running: j.status !== 'completed'
      }
    })
  return { seconds: Math.round(span / 1000), bars, queued }
}

/** Seconds a completed run took, start to last update. */
export const runSeconds = (r: Pick<WorkflowRun, 'startedAt' | 'updatedAt'>): number => Math.max(0, Math.round((ms(r.updatedAt) - ms(r.startedAt)) / 1000))

/**
 * How long this workflow usually takes: the median of its recent successful runs (not this one). Needs at least
 * three to mean anything, so a first or second run gets no comparison rather than a misleading one.
 */
export function typicalSeconds(runs: WorkflowRun[], workflowId: number, excludeId?: number): number | undefined {
  const samples = runs
    .filter((r) => r.workflowId === workflowId && r.id !== excludeId && r.status === 'completed' && r.conclusion === 'success')
    .map(runSeconds)
    .filter((s) => s > 0)
    .sort((a, b) => a - b)
  if (samples.length < 3) return undefined
  const mid = samples.length >> 1
  return samples.length % 2 ? samples[mid] : Math.round((samples[mid - 1] + samples[mid]) / 2)
}

/** "+25% slower than usual" / "10% faster than usual" / "about as long as usual" (within 10%). */
export function compareToTypical(seconds: number, typical: number | undefined): string | undefined {
  if (!typical || seconds <= 0) return undefined
  const pct = Math.round(((seconds - typical) / typical) * 100)
  if (Math.abs(pct) < 10) return 'about as long as usual'
  return pct > 0 ? `${pct}% slower than usual` : `${-pct}% faster than usual`
}
