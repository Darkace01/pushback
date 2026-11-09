import { useSyncExternalStore } from 'react'
import type { WatchedRun, WorkflowRun } from '../../../shared/types'
import { api, toast } from './store'

// Watched runs live in the main process (they outlast any one view, and drive the mini window and tray);
// this mirrors the list for the Watch buttons.

let watched: WatchedRun[] = []
let started = false
const listeners = new Set<() => void>()

function start(): void {
  if (started) return
  started = true
  const set = (runs: WatchedRun[]) => {
    watched = runs
    listeners.forEach((l) => l())
  }
  api.onWatched(set)
  void api.listWatched().then(set)
}

const subscribe = (l: () => void) => {
  start()
  listeners.add(l)
  return () => listeners.delete(l)
}

export const useWatched = () => useSyncExternalStore(subscribe, () => watched)

export const isWatched = (runs: WatchedRun[], run: Pick<WorkflowRun, 'repo' | 'id'>) => runs.some((w) => w.run.repo === run.repo && w.run.id === run.id)

export async function toggleWatch(run: WorkflowRun, on: boolean): Promise<void> {
  if (!on) return api.unwatchRun(run.repo, run.id)
  const r = await api.watchRun(run.repo, run.id)
  if (!r.ok) toast(`Couldn't watch the run: ${r.error}`, 'error')
}
