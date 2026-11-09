import { EventEmitter } from 'node:events'
import type { GitHub } from './github'
import { toRun, type GhRun } from './poller'
import type { WatchedRun, WorkflowRun } from '../shared/types'
import { currentStep, justFinished, watchKey } from '../shared/watch'

interface Events {
  change: [WatchedRun[]]
  /** A watched run finished: notify whatever the notification settings say, since the user asked to watch it. */
  finished: [WorkflowRun]
}

interface GhJob {
  name: string
  status: string
  steps?: { name: string; status: string; number: number }[]
}

/**
 * Runs the user pinned with "Watch". Run status comes from the poller's snapshot when the repo is tracked (it already
 * polls at the active rate while anything runs); the watcher itself only fetches the jobs, for the current step, and
 * the run for repos the poller doesn't cover. It polls only while a watched run is still going.
 */
export class Watcher extends EventEmitter<Events> {
  private runs = new Map<string, WatchedRun>()
  private timer?: NodeJS.Timeout

  constructor(
    private readonly client: (repo: string) => GitHub,
    /** The run as the poller last saw it, if its repo is polled. */
    private readonly polled: (repo: string, id: number) => WorkflowRun | undefined,
    /** Milliseconds between checks: the active poll rate, slowed down when the API budget runs low. */
    private readonly interval: () => number
  ) {
    super()
  }

  list(): WatchedRun[] {
    return [...this.runs.values()].sort((a, b) => a.addedAt - b.addedAt)
  }

  async add(repo: string, id: number): Promise<void> {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !Number.isSafeInteger(id) || id <= 0) throw new Error('Not a workflow run')
    const key = watchKey(repo, id)
    if (this.runs.has(key)) return
    const run = this.polled(repo, id) ?? toRun(repo, await this.client(repo).get<GhRun>(`/repos/${repo}/actions/runs/${id}`))
    this.runs.set(key, { run, job: null, step: null, addedAt: Date.now() })
    this.changed()
    if (run.status !== 'completed') void this.tick()
  }

  /** Stops watching one run, or all of them. */
  remove(repo?: string, id?: number): void {
    if (repo === undefined || id === undefined) this.runs.clear()
    else this.runs.delete(watchKey(repo, id))
    if (![...this.runs.values()].some((w) => w.run.status !== 'completed')) clearTimeout(this.timer)
    this.changed()
  }

  /** Takes newer run data from the poller after each of its polls. */
  fromSnapshot(): void {
    let changed = false
    for (const w of this.runs.values()) {
      const run = this.polled(w.run.repo, w.run.id)
      if (!run || run === w.run || (run.updatedAt === w.run.updatedAt && run.status === w.run.status)) continue
      this.apply(w, run)
      changed = true
    }
    if (changed) this.changed()
  }

  stop(): void {
    clearTimeout(this.timer)
  }

  private apply(w: WatchedRun, run: WorkflowRun): void {
    const prev = w.run
    w.run = run
    if (run.status === 'completed') {
      w.job = null
      w.step = null
    }
    if (justFinished(prev, run)) this.emit('finished', run)
  }

  private changed(): void {
    this.emit('change', this.list())
  }

  private async tick(): Promise<void> {
    clearTimeout(this.timer)
    const live = [...this.runs.values()].filter((w) => w.run.status !== 'completed')
    await Promise.all(live.map((w) => this.refresh(w)))
    if (live.length) this.changed()
    if ([...this.runs.values()].some((w) => w.run.status !== 'completed')) this.timer = setTimeout(() => void this.tick(), this.interval())
  }

  private async refresh(w: WatchedRun): Promise<void> {
    const { repo, id } = w.run
    try {
      const gh = this.client(repo)
      const [run, jobs] = await Promise.all([
        this.polled(repo, id) ?? gh.get<GhRun>(`/repos/${repo}/actions/runs/${id}`).then((r) => toRun(repo, r)),
        gh.get<{ jobs: GhJob[] }>(`/repos/${repo}/actions/runs/${id}/jobs?per_page=100`).then((d) => d.jobs)
      ])
      if (!this.runs.has(watchKey(repo, id))) return // unwatched while we were asking
      const step = currentStep(jobs.map((j) => ({ ...j, steps: j.steps ?? [] })))
      w.job = step.job
      w.step = step.step
      w.error = undefined
      this.apply(w, run)
    } catch (err) {
      w.error = (err as Error).message
    }
  }
}
