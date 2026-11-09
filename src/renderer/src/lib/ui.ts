import { useSyncExternalStore } from 'react'
import type { PullRequest, Workflow, WorkflowRun } from '../../../shared/types'

export type ModalState =
  | { kind: 'settings' }
  | { kind: 'palette' }
  | { kind: 'widget'; id: string }
  | { kind: 'add-widget' }
  | { kind: 'dispatch'; workflow: Workflow }
  | { kind: 'run'; run: WorkflowRun }
  | { kind: 'merge'; pr: Pick<PullRequest, 'repo' | 'number' | 'title' | 'url'> }
  | { kind: 'review'; pr: Pick<PullRequest, 'repo' | 'number' | 'title' | 'url'> }
  | { kind: 'pr'; repo: string; number: number }
  | { kind: 'issue'; repo: string; number: number }
  | { kind: 'new-pr'; repo: string; head?: string }
  | { kind: 'new-issue'; repo: string }
  | { kind: 'new-release'; repo: string }
  | { kind: 'new-dashboard' }
  | { kind: 'dashboards' }
  /** `id` is a saved dashboard's id, or `template:<id>` for a built-in template. */
  | { kind: 'share-dashboard'; id: string }
  | { kind: 'import-dashboard' }
  | { kind: 'saved-searches' }
  | { kind: 'find-clones' }
  /** A branch's merge queue; the default branch when `branch` is omitted. */
  | { kind: 'merge-queue'; repo: string; branch?: string }
  /** A workflow's YAML at `ref` (the default branch when omitted). */
  | { kind: 'workflow-file'; repo: string; path: string; ref?: string; name?: string }
  | { kind: 'discussion'; repo: string; number: number }
  | null

let modal: ModalState = null
// Views opened from inside another view (a PR from a run, merge from the PR) stack, so closing one goes
// back to where you came from. The whole stack is the trail shown as breadcrumbs.
let stack: ModalState[] = []
let trail: NonNullable<ModalState>[] = []
let editing = false
const listeners = new Set<() => void>()
const emit = () => {
  trail = (modal ? [...stack, modal] : []).filter((m): m is NonNullable<ModalState> => !!m)
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export const openModal = (m: ModalState) => {
  stack = []
  modal = m
  emit()
}
/** Opens `m` on top of the current modal; closing it returns to the one underneath. */
export const pushModal = (m: ModalState) => {
  if (modal) stack.push(modal)
  modal = m
  emit()
}
export const closeModal = () => {
  modal = stack.pop() ?? null
  emit()
}
export const useModal = () => useSyncExternalStore(subscribe, () => modal)

/** Views that open as a sub-page in the main area (with breadcrumbs) rather than as a dialog. */
const PAGES = new Set(['pr', 'issue', 'run', 'merge-queue', 'workflow-file', 'discussion'])
export const isPage = (m: ModalState): boolean => !!m && PAGES.has(m.kind)

/** Every open view, root first. */
export const useTrail = () => useSyncExternalStore(subscribe, () => trail)

/** Goes back up the trail to entry `index` (closing everything opened after it); -1 closes them all. */
export const popTo = (index: number) => {
  const all = [...trail]
  modal = all[index] ?? null
  stack = index > 0 ? all.slice(0, index) : []
  emit()
}

export const setEditing = (v: boolean) => {
  editing = v
  emit()
}
export const useEditing = () => useSyncExternalStore(subscribe, () => editing)
