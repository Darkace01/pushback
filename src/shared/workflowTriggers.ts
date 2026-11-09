import { parse as parseYaml } from 'yaml'

// Reads a workflow file's `on:` block and answers "why didn't this workflow run?" for an event, branch or tag,
// and the paths a push changed. It follows GitHub's filter rules: ordered glob patterns with `!` negation,
// branch filters on the base branch for pull requests, path filters that tag pushes skip, and activity types.
// Pure (no Node or DOM), so the main process parses and the renderer explains.

export interface EventTrigger {
  event: string
  branches?: string[]
  branchesIgnore?: string[]
  tags?: string[]
  tagsIgnore?: string[]
  paths?: string[]
  pathsIgnore?: string[]
  /** Activity types (`types:`), e.g. opened, labeled. */
  types?: string[]
  /** `schedule` crons. */
  crons?: string[]
  /** `workflow_run`: the workflows it follows. */
  workflows?: string[]
  /** `workflow_dispatch` / `workflow_call` input names. */
  inputs?: string[]
}

export interface WorkflowTriggers {
  events: EventTrigger[]
  /** Set when the file isn't valid YAML or has no `on:` block. */
  error?: string
}

export interface TriggerQuery {
  event: string
  /** The pushed branch, or the base branch of a pull request. */
  branch?: string
  /** A pushed tag (instead of a branch). */
  tag?: string
  /** Changed files; when empty, path filters can't be checked. */
  paths?: string[]
  /** The activity type, e.g. `opened` for pull_request or `published` for release. */
  action?: string
  /** The head commit message, for `[skip ci]`. */
  message?: string
  defaultBranch?: string
  /** The workflow's state from the API: active, disabled_manually, disabled_inactivity, disabled_fork, deleted. */
  state?: string | null
}

export interface TriggerVerdict {
  runs: boolean
  /** Why it wouldn't run (empty when it would). */
  reasons: string[]
  /** Things the answer couldn't check, e.g. path filters when no changed paths were given. */
  notes: string[]
}

const list = (v: unknown): string[] | undefined => {
  if (v === undefined || v === null) return undefined
  return (Array.isArray(v) ? v : [v]).map(String)
}

const KEYS: [keyof EventTrigger, string][] = [
  ['branches', 'branches'],
  ['branchesIgnore', 'branches-ignore'],
  ['tags', 'tags'],
  ['tagsIgnore', 'tags-ignore'],
  ['paths', 'paths'],
  ['pathsIgnore', 'paths-ignore'],
  ['types', 'types'],
  ['workflows', 'workflows']
]

function toTrigger(event: string, spec: unknown): EventTrigger {
  const t: EventTrigger = { event }
  if (event === 'schedule') {
    const crons = (Array.isArray(spec) ? spec : []).map((s) => (s && typeof s === 'object' ? (s as { cron?: unknown }).cron : undefined)).filter((c) => c !== undefined)
    t.crons = crons.map(String)
    return t
  }
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return t
  const s = spec as Record<string, unknown>
  for (const [key, yamlKey] of KEYS) {
    const v = list(s[yamlKey])
    if (v) (t[key] as string[]) = v
  }
  if ((event === 'workflow_dispatch' || event === 'workflow_call') && s.inputs && typeof s.inputs === 'object') t.inputs = Object.keys(s.inputs)
  return t
}

/** Parses the `on:` block of a workflow file. Never throws: a broken file comes back with `error` set. */
export function parseTriggers(source: string): WorkflowTriggers {
  let doc: unknown
  try {
    doc = parseYaml(source)
  } catch (e) {
    return { events: [], error: `The workflow file isn't valid YAML: ${(e as Error).message.split('\n')[0]}` }
  }
  if (!doc || typeof doc !== 'object') return { events: [], error: 'The workflow file is empty.' }
  // YAML 1.1 readers turn a bare `on` key into `true`; accept both.
  const d = doc as Record<string, unknown>
  const on = d.on ?? d.true
  if (on === undefined || on === null) return { events: [], error: 'The workflow has no `on:` block, so nothing triggers it.' }
  if (typeof on === 'string') return { events: [toTrigger(on, null)] }
  if (Array.isArray(on)) return { events: on.map((e) => toTrigger(String(e), null)) }
  if (typeof on === 'object') return { events: Object.entries(on as Record<string, unknown>).map(([e, spec]) => toTrigger(e, spec)) }
  return { events: [], error: 'The `on:` block is not a list of events.' }
}

// --- glob patterns ---

const escape = (c: string) => c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

/**
 * GitHub's filter globs as a regex: `*` matches anything but `/`, `**` matches anything, `?` and `+` make the
 * previous character optional or repeatable, `[...]` is a character class and `\` escapes.
 */
export function globToRegExp(pattern: string): RegExp {
  let re = ''
  // Whether the last token is a single character (or class) that `?` / `+` can apply to.
  let atom = false
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '*') {
      atom = false
      if (pattern[i + 1] === '*') {
        i++
        // `**/` also matches no folder at all, so `docs/**/*.md` covers docs/a.md.
        if (pattern[i + 1] === '/') {
          i++
          re += '(?:.*/)?'
        } else re += '.*'
      } else re += '[^/]*'
    } else if (c === '?' || c === '+') {
      re += atom ? c : escape(c)
      atom = false
    } else if (c === '\\' && i + 1 < pattern.length) {
      re += escape(pattern[++i])
      atom = true
    } else if (c === '[') {
      const end = pattern.indexOf(']', i + 1)
      if (end > i + 1) {
        re += `[${pattern.slice(i + 1, end).replace(/[\\\]^]/g, '\\$&')}]`
        i = end
      } else re += '\\['
      atom = true
    } else {
      re += escape(c)
      atom = true
    }
  }
  try {
    return new RegExp(`^${re}$`)
  } catch {
    // A class like [z-a] is invalid; treat the pattern as literal text rather than failing the whole check.
    return new RegExp(`^${escape(pattern)}$`)
  }
}

/** Whether `value` is selected by an ordered list of patterns, where a later `!pattern` can exclude it again. */
export function matchesPatterns(value: string, patterns: string[]): boolean {
  let hit = false
  for (const p of patterns) {
    if (p.startsWith('!')) {
      if (hit && globToRegExp(p.slice(1)).test(value)) hit = false
    } else if (!hit && globToRegExp(p).test(value)) hit = true
  }
  return hit
}

// --- describing ---

const quote = (xs: string[]) => xs.join(', ')

/** One line about a trigger, e.g. "push to main, release/** · only when src/** changes". */
export function describeTrigger(t: EventTrigger): string {
  const parts: string[] = []
  const pr = t.event === 'pull_request' || t.event === 'pull_request_target'
  let head = t.event
  if (t.event === 'workflow_dispatch') head = 'Run by hand (workflow_dispatch)'
  else if (t.event === 'workflow_call') head = 'Called by other workflows (workflow_call)'
  else if (t.event === 'schedule') head = `On a schedule${t.crons?.length ? `: ${quote(t.crons)}` : ''}`
  else if (t.event === 'workflow_run') head = `After ${t.workflows?.length ? quote(t.workflows) : 'another workflow'} runs (workflow_run)`
  if (t.types?.length) head += ` (${quote(t.types)})`
  parts.push(head)
  const into = pr ? 'into' : t.event === 'workflow_run' ? 'on' : 'to'
  if (t.branches) parts.push(`${into} ${quote(t.branches)}`)
  if (t.branchesIgnore) parts.push(`not ${into} ${quote(t.branchesIgnore)}`)
  if (t.tags) parts.push(`tags ${quote(t.tags)}`)
  if (t.tagsIgnore) parts.push(`not tags ${quote(t.tagsIgnore)}`)
  if (t.paths) parts.push(`only when ${quote(t.paths)} change`)
  if (t.pathsIgnore) parts.push(`not when only ${quote(t.pathsIgnore)} change`)
  if (t.inputs?.length) parts.push(`${t.inputs.length} input${t.inputs.length === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

// --- explaining ---

/** Activity types a pull request event uses when the workflow lists none. */
const PR_DEFAULT_TYPES = ['opened', 'synchronize', 'reopened']
const SKIP_MARKERS = ['[skip ci]', '[ci skip]', '[no ci]', '[skip actions]', '[actions skip]']
const DISABLED: Record<string, string> = {
  disabled_manually: 'The workflow is disabled (someone turned it off in the Actions tab).',
  disabled_inactivity: 'The workflow was disabled automatically because the repository had no activity for 60 days.',
  disabled_fork: 'Workflows are disabled on this fork until someone enables them.',
  deleted: 'The workflow file has been deleted.'
}

/**
 * Whether the workflow runs for an event, and if not, every reason why. Checks are the ones GitHub applies
 * before it creates a run; job-level `if:` conditions aren't considered.
 */
export function explainTrigger(triggers: WorkflowTriggers, q: TriggerQuery): TriggerVerdict {
  const reasons: string[] = []
  const notes: string[] = []
  const done = () => ({ runs: !reasons.length, reasons, notes })

  if (q.state && DISABLED[q.state]) reasons.push(DISABLED[q.state])
  else if (q.state && q.state !== 'active') reasons.push(`The workflow's state is ${q.state}, not active.`)
  if (triggers.error) {
    reasons.push(triggers.error)
    return done()
  }

  const trigger = triggers.events.find((t) => t.event === q.event)
  if (!trigger) {
    const names = triggers.events.map((t) => t.event)
    if (names.length === 1 && names[0] === 'workflow_dispatch') reasons.push('It only runs when started by hand (workflow_dispatch); no event starts it on its own.')
    else if (names.length === 1 && names[0] === 'workflow_call') reasons.push('It only runs when another workflow calls it (workflow_call).')
    else reasons.push(`${q.event} isn't one of its triggers (${names.join(', ') || 'none'}).`)
    return done()
  }

  const pr = q.event === 'pull_request' || q.event === 'pull_request_target'
  const refEvent = q.event === 'push' || pr || q.event === 'workflow_run'

  if (q.event === 'schedule' && q.defaultBranch && q.branch && q.branch !== q.defaultBranch)
    reasons.push(`Scheduled workflows only run from the default branch (${q.defaultBranch}), not ${q.branch}.`)

  const types = trigger.types ?? (pr ? PR_DEFAULT_TYPES : undefined)
  if (q.action && types && !types.includes(q.action))
    reasons.push(
      trigger.types
        ? `It only runs for ${q.event} activity ${quote(types)}, not ${q.action}.`
        : `Without a \`types:\` list, ${q.event} only runs for ${quote(types)}, not ${q.action}.`
    )

  if (refEvent) {
    if (trigger.branches && trigger.branchesIgnore) reasons.push(`${q.event} sets both branches and branches-ignore, which GitHub rejects, so the workflow never runs for it.`)
    if (trigger.tags && trigger.tagsIgnore) reasons.push(`${q.event} sets both tags and tags-ignore, which GitHub rejects.`)
    if (trigger.paths && trigger.pathsIgnore) reasons.push(`${q.event} sets both paths and paths-ignore, which GitHub rejects.`)
  }

  const hasBranchFilter = !!(trigger.branches || trigger.branchesIgnore)
  const hasTagFilter = !!(trigger.tags || trigger.tagsIgnore)
  const what = pr ? 'base branch' : 'branch'

  if (refEvent && q.tag && q.event === 'push') {
    if (hasBranchFilter && !hasTagFilter) reasons.push('It filters on branches only, so pushing a tag never starts it.')
    if (trigger.tags && !matchesPatterns(q.tag, trigger.tags)) reasons.push(`The tag ${q.tag} doesn't match its tags filter (${quote(trigger.tags)}).`)
    if (trigger.tagsIgnore && matchesPatterns(q.tag, trigger.tagsIgnore)) reasons.push(`The tag ${q.tag} matches tags-ignore (${quote(trigger.tagsIgnore)}).`)
  } else if (refEvent && q.branch) {
    if (q.event === 'push' && hasTagFilter && !hasBranchFilter) reasons.push('It filters on tags only, so pushing to a branch never starts it.')
    if (trigger.branches && !matchesPatterns(q.branch, trigger.branches)) reasons.push(`The ${what} ${q.branch} doesn't match its branches filter (${quote(trigger.branches)}).`)
    if (trigger.branchesIgnore && matchesPatterns(q.branch, trigger.branchesIgnore))
      reasons.push(`The ${what} ${q.branch} matches branches-ignore (${quote(trigger.branchesIgnore)}).`)
  } else if (refEvent && hasBranchFilter) notes.push('No branch given, so the branch filters were not checked.')

  // Path filters don't apply to tag pushes.
  const pathFiltered = (q.event === 'push' || pr) && !(q.tag && q.event === 'push') && (trigger.paths || trigger.pathsIgnore)
  if (pathFiltered) {
    const changed = (q.paths ?? []).map((p) => p.trim()).filter(Boolean)
    if (!changed.length) notes.push('No changed files given, so the paths filters were not checked.')
    else {
      if (trigger.paths && !changed.some((f) => matchesPatterns(f, trigger.paths!)))
        reasons.push(`None of the changed files match its paths filter (${quote(trigger.paths)}).`)
      if (trigger.pathsIgnore && changed.every((f) => matchesPatterns(f, trigger.pathsIgnore!)))
        reasons.push(`Every changed file matches paths-ignore (${quote(trigger.pathsIgnore)}).`)
    }
  }

  if ((q.event === 'push' || pr) && q.message) {
    const lower = q.message.toLowerCase()
    const marker = SKIP_MARKERS.find((m) => lower.includes(m))
    if (marker) reasons.push(`The commit message contains ${marker}, which skips push and pull_request workflows.`)
    else if (/^skip-checks:\s*true\s*$/im.test(q.message)) reasons.push('The commit message has a `skip-checks: true` trailer.')
  }

  return done()
}

/** Events worth offering in a "why didn't it run?" picker: the workflow's own triggers, then the common ones. */
export function eventChoices(triggers: WorkflowTriggers): string[] {
  return [...new Set([...triggers.events.map((t) => t.event), 'push', 'pull_request', 'workflow_dispatch', 'schedule'])]
}
