// Helpers for watched runs (the always-on-top mini window and the tray). Pure, so they're unit-tested.

import type { Job, JobStep, WorkflowRun } from './types'

type JobLike = Pick<Job, 'name' | 'status'> & { steps: Pick<JobStep, 'name' | 'status'>[] }

export const watchKey = (repo: string, id: number) => `${repo}#${id}`

/** The job and step running now: the first job in progress and its first unfinished step. */
export function currentStep(jobs: JobLike[]): { job: string | null; step: string | null } {
  const job = jobs.find((j) => j.status === 'in_progress') ?? jobs.find((j) => j.status !== 'completed')
  if (!job) return { job: null, step: null }
  const step = job.steps.find((s) => s.status === 'in_progress') ?? job.steps.find((s) => s.status !== 'completed')
  return { job: job.name, step: step?.name ?? null }
}

/** True when a run went from not finished to finished between two looks at it. */
export function justFinished(prev: Pick<WorkflowRun, 'status'> | undefined, next: Pick<WorkflowRun, 'status'>): boolean {
  return !!prev && prev.status !== 'completed' && next.status === 'completed'
}

/** The run's outcome in a word: running, queued, succeeded, failed, cancelled… */
export function outcome(run: Pick<WorkflowRun, 'status' | 'conclusion'>): string {
  if (run.status === 'in_progress') return 'running'
  if (run.status !== 'completed') return run.status
  if (run.conclusion === 'success') return 'succeeded'
  if (run.conclusion === 'failure') return 'failed'
  return run.conclusion ?? 'finished'
}

/** "3m 12s" between two times. */
export function elapsed(fromIso: string, to: number): string {
  const s = Math.max(0, Math.round((to - Date.parse(fromIso)) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

/** One line for the tray menu: "CI #12 · acme/api · running 3m 5s". */
export function trayLabel(run: WorkflowRun, now: number): string {
  const end = run.status === 'completed' ? Date.parse(run.updatedAt) : now
  return `${run.name} #${run.runNumber} · ${run.repo} · ${outcome(run)} ${elapsed(run.startedAt, end)}`
}
