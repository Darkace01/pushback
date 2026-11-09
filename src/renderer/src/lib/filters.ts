import type { Snapshot, WidgetType } from '../../../shared/types'

// Each widget's options: shown in its settings dialog and, for the ones marked `filter`, in the inline filter
// bar above its content. Text filters can suggest values seen in the data (`suggest`).

export type Suggest = 'branches' | 'workflows' | 'authors' | 'labels' | 'actors'

export type OptionSpec = { key: string; label: string; filter?: boolean } & (
  | { kind: 'select'; choices: [string, string][] }
  | { kind: 'bool' }
  | { kind: 'text'; placeholder?: string; suggest?: Suggest }
  | { kind: 'number'; min: number; max: number }
)

const EVENTS: [string, string][] = [
  ['', 'Any trigger'],
  ['push', 'Push'],
  ['pull_request', 'Pull request'],
  ['workflow_dispatch', 'Manual'],
  ['schedule', 'Schedule'],
  ['release', 'Release']
]

export const OPTIONS: Partial<Record<WidgetType, OptionSpec[]>> = {
  runs: [
    { key: 'filter', label: 'Show', kind: 'select', filter: true, choices: [['all', 'All runs'], ['active', 'Queued / in progress'], ['failed', 'Failed'], ['mine', 'Triggered by me']] },
    { key: 'branch', label: 'Branch', kind: 'text', filter: true, placeholder: 'any branch', suggest: 'branches' },
    { key: 'workflow', label: 'Workflow', kind: 'text', filter: true, placeholder: 'any workflow', suggest: 'workflows' },
    { key: 'event', label: 'Trigger', kind: 'select', filter: true, choices: EVENTS },
    { key: 'actor', label: 'Started by', kind: 'text', filter: true, placeholder: 'anyone', suggest: 'actors' },
    { key: 'latestOnly', label: 'Latest per workflow and branch', kind: 'bool', filter: true },
    { key: 'limit', label: 'Max rows', kind: 'number', min: 5, max: 200 }
  ],
  prs: [
    { key: 'filter', label: 'Show', kind: 'select', filter: true, choices: [['all', 'All open PRs'], ['mine', 'Authored by me'], ['review', 'Awaiting my review'], ['failing', 'Failing checks']] },
    { key: 'branch', label: 'Branch', kind: 'text', filter: true, placeholder: 'any branch', suggest: 'branches' },
    { key: 'author', label: 'Author', kind: 'text', filter: true, placeholder: 'anyone', suggest: 'authors' },
    { key: 'label', label: 'Label', kind: 'text', filter: true, placeholder: 'any label', suggest: 'labels' },
    { key: 'hideDrafts', label: 'Hide drafts', kind: 'bool', filter: true }
  ],
  workflows: [{ key: 'dispatchableOnly', label: 'Only workflows that can be run manually', kind: 'bool', filter: true }],
  events: [
    {
      key: 'kind',
      label: 'Type',
      kind: 'select',
      filter: true,
      choices: [['', 'All activity'], ['run', 'Workflow runs'], ['failure', 'Failures only'], ['pr', 'Pull requests'], ['review', 'Review requests']]
    },
    { key: 'unreadOnly', label: 'Only unread', kind: 'bool', filter: true }
  ],
  insights: [
    { key: 'branch', label: 'Branch', kind: 'text', filter: true, placeholder: 'any branch', suggest: 'branches' },
    { key: 'workflow', label: 'Workflow', kind: 'text', filter: true, placeholder: 'any workflow', suggest: 'workflows' }
  ],
  cihealth: [
    { key: 'view', label: 'Show', kind: 'select', filter: true, choices: [['failing', 'Failure rate'], ['flaky', 'Flaky workflows'], ['slowest', 'Slowest workflows'], ['minutes', 'Actions minutes']] },
    { key: 'branch', label: 'Branch', kind: 'text', filter: true, placeholder: 'any branch', suggest: 'branches' },
    { key: 'days', label: 'Look back (days)', kind: 'number', min: 1, max: 90 }
  ],
  security: [
    { key: 'view', label: 'Show', kind: 'select', filter: true, choices: [['alerts', 'Security alerts'], ['dependabot-prs', 'Dependabot pull requests']] },
    { key: 'kind', label: 'Source', kind: 'select', filter: true, choices: [['', 'All sources'], ['dependabot', 'Dependabot'], ['code-scanning', 'Code scanning'], ['secret-scanning', 'Secret scanning']] },
    { key: 'severity', label: 'Severity', kind: 'select', filter: true, choices: [['', 'Any severity'], ['critical', 'Critical'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']] }
  ],
  packages: [
    { key: 'scope', label: 'Published by', kind: 'select', filter: true, choices: [['user', 'Me'], ['org', 'Organisations']] },
    { key: 'org', label: 'Organisation (blank for all of yours)', kind: 'text', filter: true, placeholder: 'all my organisations' },
    { key: 'type', label: 'Type', kind: 'select', filter: true, choices: [['', 'Any type'], ['npm', 'npm'], ['container', 'Container'], ['nuget', 'NuGet'], ['maven', 'Maven'], ['rubygems', 'RubyGems']] },
    { key: 'visibility', label: 'Visibility', kind: 'select', filter: true, choices: [['', 'Any visibility'], ['public', 'Public'], ['private', 'Private'], ['internal', 'Internal']] }
  ],
  search: [
    { key: 'query', label: 'Search (GitHub qualifiers)', kind: 'text', placeholder: 'is:open author:@me' },
    { key: 'kind', label: 'Look for', kind: 'select', choices: [['pr', 'Pull requests'], ['issue', 'Issues']] },
    { key: 'repo', label: 'Repo or org', kind: 'text', filter: true, placeholder: 'any repo' },
    { key: 'author', label: 'Author', kind: 'text', filter: true, placeholder: 'anyone' },
    { key: 'label', label: 'Label', kind: 'text', filter: true, placeholder: 'any label' },
    { key: 'milestone', label: 'Milestone', kind: 'text', filter: true, placeholder: 'any milestone' },
    { key: 'hideDrafts', label: 'Hide drafts', kind: 'bool', filter: true }
  ],
  deployments: [
    { key: 'view', label: 'Show', kind: 'select', filter: true, choices: [['environments', 'Projects × environments'], ['clients', 'Clients × stages'], ['history', 'Deployment history']] },
    { key: 'environment', label: 'Environment', kind: 'text', filter: true, placeholder: 'any environment' },
    {
      key: 'state',
      label: 'Outcome',
      kind: 'select',
      filter: true,
      choices: [['', 'Any outcome'], ['success', 'Deployed'], ['failure', 'Failed'], ['in_progress', 'Deploying'], ['waiting', 'Waiting']]
    }
  ]
}

/** Values to suggest for a text filter, from what's in the snapshot for these repos. */
export function suggestions(kind: Suggest, snapshot: Snapshot, repos: string[]): string[] {
  const runs = repos.flatMap((r) => snapshot.repos[r]?.runs ?? [])
  const prs = repos.flatMap((r) => snapshot.repos[r]?.prs ?? [])
  const values =
    kind === 'branches'
      ? [...runs.map((r) => r.branch), ...prs.map((p) => p.branch)]
      : kind === 'workflows'
        ? runs.map((r) => r.name)
        : kind === 'actors'
          ? runs.map((r) => r.actor)
          : kind === 'authors'
            ? prs.map((p) => p.author)
            : prs.flatMap((p) => p.labels.map((l) => l.name))
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

/** How many filters differ from the widget's defaults (repos count as one). */
export function activeFilters(type: WidgetType, repos: string[], options: Record<string, unknown>, defaults: Record<string, unknown>): number {
  const specs = (OPTIONS[type] ?? []).filter((o) => o.filter && o.key !== 'view')
  return (repos.length ? 1 : 0) + specs.filter((o) => valueOf(o, options) !== valueOf(o, defaults)).length
}

/** An option's value, with unset meaning the spec's neutral value (off, the first choice, or empty). */
export const valueOf = (o: OptionSpec, options: Record<string, unknown>) =>
  options[o.key] ?? (o.kind === 'bool' ? false : o.kind === 'select' ? o.choices[0][0] : '')
