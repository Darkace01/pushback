import { describe, expect, it } from 'vitest'
import { describeTrigger, eventChoices, explainTrigger, globToRegExp, matchesPatterns, parseTriggers, type TriggerQuery } from '../../src/shared/workflowTriggers'

const explain = (yaml: string, q: TriggerQuery) => explainTrigger(parseTriggers(yaml), q)

describe('parseTriggers', () => {
  it('reads a single event, a list and a map', () => {
    expect(parseTriggers('on: push\n').events).toEqual([{ event: 'push' }])
    expect(parseTriggers('on: [push, pull_request]\n').events.map((e) => e.event)).toEqual(['push', 'pull_request'])
    const t = parseTriggers(`on:
  push:
    branches: [main, 'release/**']
    paths-ignore: ['docs/**']
  pull_request:
    types: [opened, labeled]
    branches-ignore: [wip]
    paths: [src/**]
  workflow_dispatch:
    inputs:
      env: { type: string }
      dry: { type: boolean }
`)
    expect(t.error).toBeUndefined()
    expect(t.events).toEqual([
      { event: 'push', branches: ['main', 'release/**'], pathsIgnore: ['docs/**'] },
      { event: 'pull_request', types: ['opened', 'labeled'], branchesIgnore: ['wip'], paths: ['src/**'] },
      { event: 'workflow_dispatch', inputs: ['env', 'dry'] }
    ])
  })

  it('reads tags, schedules and workflow_run', () => {
    const t = parseTriggers(`on:
  push:
    tags: ['v*']
    tags-ignore: ['v0.*']
  schedule:
    - cron: '0 3 * * *'
    - cron: '30 12 * * 1'
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: main
`)
    expect(t.events).toEqual([
      { event: 'push', tags: ['v*'], tagsIgnore: ['v0.*'] },
      { event: 'schedule', crons: ['0 3 * * *', '30 12 * * 1'] },
      { event: 'workflow_run', workflows: ['CI'], types: ['completed'], branches: ['main'] }
    ])
  })

  it('accepts an `on` key read as `true` by YAML 1.1 parsers, and null event specs', () => {
    expect(parseTriggers('true: push\n').events).toEqual([{ event: 'push' }])
    expect(parseTriggers('on:\n  push:\n  workflow_dispatch:\n').events).toEqual([{ event: 'push' }, { event: 'workflow_dispatch' }])
  })

  it('reports broken files instead of throwing', () => {
    expect(parseTriggers('on: [push\n').error).toMatch(/isn't valid YAML/)
    expect(parseTriggers('').error).toMatch(/empty/)
    expect(parseTriggers('name: x\njobs: {}\n').error).toMatch(/no `on:` block/)
    expect(parseTriggers('on: 3\n').error).toMatch(/not a list/)
    expect(parseTriggers('on: true\n').error).toMatch(/not a list/)
  })

  it('ignores schedule entries without a cron', () => {
    expect(parseTriggers('on:\n  schedule:\n    - nope: 1\n').events).toEqual([{ event: 'schedule', crons: [] }])
    expect(parseTriggers('on:\n  schedule:\n').events).toEqual([{ event: 'schedule', crons: [] }])
  })
})

describe('glob patterns', () => {
  const m = (pattern: string, value: string) => globToRegExp(pattern).test(value)

  it('* stops at slashes and ** does not', () => {
    expect(m('feature/*', 'feature/login')).toBe(true)
    expect(m('feature/*', 'feature/a/b')).toBe(false)
    expect(m('feature/**', 'feature/a/b')).toBe(true)
    expect(m('*', 'main')).toBe(true)
    expect(m('*', 'a/b')).toBe(false)
    expect(m('**', 'a/b/c')).toBe(true)
  })

  it('**/ also matches no folder', () => {
    expect(m('docs/**/*.md', 'docs/a.md')).toBe(true)
    expect(m('docs/**/*.md', 'docs/x/y/a.md')).toBe(true)
    expect(m('**/*.js', 'index.js')).toBe(true)
    expect(m('**/*.js', 'src/lib/index.js')).toBe(true)
    expect(m('**/*.js', 'src/index.ts')).toBe(false)
  })

  it('? and + repeat the previous character, [] is a class, \\ escapes', () => {
    expect(m('v1.?0', 'v1.0')).toBe(true)
    expect(m('ab?c', 'ac')).toBe(true)
    expect(m('ab?c', 'abc')).toBe(true)
    expect(m('ab+c', 'abbbc')).toBe(true)
    expect(m('ab+c', 'ac')).toBe(false)
    expect(m('v[12].*', 'v2.5')).toBe(true)
    expect(m('v[12].*', 'v3.5')).toBe(false)
    expect(m('v[0-9]', 'v7')).toBe(true)
    expect(m('a\\*b', 'a*b')).toBe(true)
    expect(m('a\\*b', 'axb')).toBe(false)
    // Dots are literal.
    expect(m('v1.0', 'v1x0')).toBe(false)
  })

  it('treats odd patterns literally instead of throwing', () => {
    expect(m('+x', '+x')).toBe(true)
    expect(m('*+', 'a+')).toBe(true)
    expect(m('[', '[')).toBe(true)
    expect(m('[]', '[]')).toBe(true)
    expect(m('[z-a]', '[z-a]')).toBe(true)
  })

  it('later ! patterns exclude and later positives include again', () => {
    expect(matchesPatterns('release/beta', ['release/**', '!release/**-alpha'])).toBe(true)
    expect(matchesPatterns('release/1-alpha', ['release/**', '!release/**-alpha'])).toBe(false)
    expect(matchesPatterns('release/1-alpha', ['release/**', '!release/**-alpha', 'release/1-*'])).toBe(true)
    expect(matchesPatterns('main', ['!main'])).toBe(false)
    expect(matchesPatterns('main', [])).toBe(false)
  })
})

describe('explainTrigger', () => {
  it('runs when the event matches and nothing filters it out', () => {
    expect(explain('on: push\n', { event: 'push', branch: 'main' })).toEqual({ runs: true, reasons: [], notes: [] })
  })

  it('explains an event that is not listed', () => {
    const v = explain('on: [push, pull_request]\n', { event: 'release' })
    expect(v.runs).toBe(false)
    expect(v.reasons[0]).toBe("release isn't one of its triggers (push, pull_request).")
  })

  it('explains workflow_dispatch-only and workflow_call-only workflows', () => {
    expect(explain('on: workflow_dispatch\n', { event: 'push', branch: 'main' }).reasons[0]).toMatch(/only runs when started by hand/)
    expect(explain('on:\n  workflow_call:\n', { event: 'push' }).reasons[0]).toMatch(/another workflow calls it/)
    expect(explain('on: workflow_dispatch\n', { event: 'workflow_dispatch' }).runs).toBe(true)
  })

  it('explains disabled and otherwise inactive workflows', () => {
    expect(explain('on: push\n', { event: 'push', state: 'disabled_manually' }).reasons).toEqual(['The workflow is disabled (someone turned it off in the Actions tab).'])
    expect(explain('on: push\n', { event: 'push', state: 'disabled_inactivity' }).reasons[0]).toMatch(/60 days/)
    expect(explain('on: push\n', { event: 'push', state: 'disabled_fork' }).reasons[0]).toMatch(/fork/)
    expect(explain('on: push\n', { event: 'push', state: 'deleted' }).reasons[0]).toMatch(/deleted/)
    expect(explain('on: push\n', { event: 'push', state: 'weird' }).reasons[0]).toMatch(/weird/)
    expect(explain('on: push\n', { event: 'push', state: 'active' }).runs).toBe(true)
    expect(explain('on: push\n', { event: 'push', state: null }).runs).toBe(true)
  })

  it('reports a broken file as the reason', () => {
    const v = explain('jobs: {}\n', { event: 'push', state: 'disabled_manually' })
    expect(v.reasons).toHaveLength(2)
    expect(v.reasons[1]).toMatch(/no `on:` block/)
  })

  describe('branch filters', () => {
    const yaml = "on:\n  push:\n    branches: [main, 'release/**', '!release/old']\n"
    it('matches and rejects branches', () => {
      expect(explain(yaml, { event: 'push', branch: 'main' }).runs).toBe(true)
      expect(explain(yaml, { event: 'push', branch: 'release/2.0' }).runs).toBe(true)
      expect(explain(yaml, { event: 'push', branch: 'release/old' }).reasons).toEqual(["The branch release/old doesn't match its branches filter (main, release/**, !release/old)."])
      expect(explain(yaml, { event: 'push', branch: 'feat/x' }).runs).toBe(false)
    })

    it('applies branches-ignore', () => {
      const v = explain("on:\n  push:\n    branches-ignore: ['dependabot/**']\n", { event: 'push', branch: 'dependabot/npm/x' })
      expect(v.reasons).toEqual(['The branch dependabot/npm/x matches branches-ignore (dependabot/**).'])
      expect(explain("on:\n  push:\n    branches-ignore: ['dependabot/**']\n", { event: 'push', branch: 'main' }).runs).toBe(true)
    })

    it('checks the base branch of pull requests', () => {
      const v = explain('on:\n  pull_request:\n    branches: [main]\n', { event: 'pull_request', branch: 'develop' })
      expect(v.reasons).toEqual(["The base branch develop doesn't match its branches filter (main)."])
    })

    it('notes when no branch was given', () => {
      const v = explain(yaml, { event: 'push' })
      expect(v.runs).toBe(true)
      expect(v.notes).toEqual(['No branch given, so the branch filters were not checked.'])
    })

    it('flags filters GitHub rejects', () => {
      const v = explain('on:\n  push:\n    branches: [main]\n    branches-ignore: [x]\n    tags: [v*]\n    tags-ignore: [v0]\n    paths: [a]\n    paths-ignore: [b]\n', {
        event: 'push'
      })
      expect(v.reasons).toHaveLength(3)
      expect(v.reasons.join(' ')).toMatch(/branches and branches-ignore.*tags and tags-ignore.*paths and paths-ignore/)
    })

    it('a tags-only push filter never runs for branches', () => {
      expect(explain("on:\n  push:\n    tags: ['v*']\n", { event: 'push', branch: 'main' }).reasons).toEqual(['It filters on tags only, so pushing to a branch never starts it.'])
    })
  })

  describe('tag filters', () => {
    it('matches tags and tags-ignore', () => {
      const yaml = "on:\n  push:\n    tags: ['v*', '!v*-rc*']\n"
      expect(explain(yaml, { event: 'push', tag: 'v1.2.0' }).runs).toBe(true)
      expect(explain(yaml, { event: 'push', tag: 'v1.2.0-rc1' }).reasons[0]).toMatch(/doesn't match its tags filter/)
      expect(explain("on:\n  push:\n    tags-ignore: ['nightly*']\n", { event: 'push', tag: 'nightly-3' }).reasons[0]).toMatch(/matches tags-ignore/)
    })

    it('a branches-only push filter never runs for tags', () => {
      expect(explain('on:\n  push:\n    branches: [main]\n', { event: 'push', tag: 'v1' }).reasons).toEqual(['It filters on branches only, so pushing a tag never starts it.'])
    })

    it('path filters are not applied to tag pushes', () => {
      const v = explain("on:\n  push:\n    paths: ['src/**']\n", { event: 'push', tag: 'v1', paths: ['README.md'] })
      expect(v).toEqual({ runs: true, reasons: [], notes: [] })
    })
  })

  describe('path filters', () => {
    it('needs at least one changed file to match paths', () => {
      const yaml = "on:\n  push:\n    paths: ['src/**', '!src/**/*.md']\n"
      expect(explain(yaml, { event: 'push', branch: 'main', paths: ['src/a.ts', 'README.md'] }).runs).toBe(true)
      expect(explain(yaml, { event: 'push', branch: 'main', paths: ['src/docs/a.md', 'README.md'] }).reasons).toEqual([
        "None of the changed files match its paths filter (src/**, !src/**/*.md)."
      ])
    })

    it('skips only when every changed file matches paths-ignore', () => {
      const yaml = "on:\n  pull_request:\n    paths-ignore: ['docs/**', '**/*.md']\n"
      expect(explain(yaml, { event: 'pull_request', paths: ['docs/x.txt', 'README.md'] }).reasons).toEqual(['Every changed file matches paths-ignore (docs/**, **/*.md).'])
      expect(explain(yaml, { event: 'pull_request', paths: ['docs/x.txt', 'src/a.ts'] }).runs).toBe(true)
    })

    it('notes when no changed files were given, and ignores blank lines', () => {
      const v = explain("on:\n  push:\n    paths: ['src/**']\n", { event: 'push', branch: 'main', paths: ['  ', ''] })
      expect(v.runs).toBe(true)
      expect(v.notes).toEqual(['No changed files given, so the paths filters were not checked.'])
    })
  })

  describe('activity types', () => {
    it('pull_request defaults to opened, synchronize and reopened', () => {
      expect(explain('on: pull_request\n', { event: 'pull_request', action: 'synchronize' }).runs).toBe(true)
      expect(explain('on: pull_request\n', { event: 'pull_request', action: 'labeled' }).reasons).toEqual([
        'Without a `types:` list, pull_request only runs for opened, synchronize, reopened, not labeled.'
      ])
    })

    it('uses the listed types', () => {
      const yaml = 'on:\n  release:\n    types: [published]\n'
      expect(explain(yaml, { event: 'release', action: 'published' }).runs).toBe(true)
      expect(explain(yaml, { event: 'release', action: 'created' }).reasons).toEqual(['It only runs for release activity published, not created.'])
      // Other events without types accept any activity.
      expect(explain('on: issues\n', { event: 'issues', action: 'labeled' }).runs).toBe(true)
    })
  })

  it('scheduled runs only come from the default branch', () => {
    const yaml = "on:\n  schedule:\n    - cron: '0 0 * * *'\n"
    expect(explain(yaml, { event: 'schedule', branch: 'dev', defaultBranch: 'main' }).reasons[0]).toMatch(/only run from the default branch \(main\)/)
    expect(explain(yaml, { event: 'schedule', branch: 'main', defaultBranch: 'main' }).runs).toBe(true)
  })

  it('applies workflow_run branch filters', () => {
    const yaml = 'on:\n  workflow_run:\n    workflows: [CI]\n    branches: [main]\n'
    expect(explain(yaml, { event: 'workflow_run', branch: 'feat' }).runs).toBe(false)
  })

  it('honours skip markers in the commit message', () => {
    expect(explain('on: push\n', { event: 'push', message: 'Fix typo [skip ci]' }).reasons[0]).toMatch(/\[skip ci\]/)
    expect(explain('on: push\n', { event: 'push', message: 'Docs [CI SKIP]' }).reasons[0]).toMatch(/\[ci skip\]/)
    expect(explain('on: push\n', { event: 'push', message: 'Docs\n\nskip-checks: true' }).reasons[0]).toMatch(/skip-checks/)
    expect(explain('on: push\n', { event: 'push', message: 'Normal commit' }).runs).toBe(true)
    // Markers don't affect other events.
    expect(explain('on: workflow_dispatch\n', { event: 'workflow_dispatch', message: '[skip ci]' }).runs).toBe(true)
  })

  it('collects every reason at once', () => {
    const yaml = "on:\n  push:\n    branches: [main]\n    paths: ['src/**']\n"
    const v = explain(yaml, { event: 'push', branch: 'dev', paths: ['README.md'], message: '[skip ci]', state: 'disabled_manually' })
    expect(v.reasons).toHaveLength(4)
  })
})

describe('describeTrigger', () => {
  it('summarises each kind of trigger', () => {
    const [push, pr, dispatch, schedule, run, call] = parseTriggers(`on:
  push:
    branches: [main]
    branches-ignore: [x]
    tags: ['v*']
    tags-ignore: [v0]
    paths: ['src/**']
    paths-ignore: ['docs/**']
  pull_request:
    types: [opened]
    branches: [main]
  workflow_dispatch:
    inputs:
      env: {}
  schedule:
    - cron: '0 3 * * *'
  workflow_run:
    workflows: [CI]
    branches: [main]
  workflow_call:
    inputs:
      a: {}
      b: {}
`).events
    expect(describeTrigger(push)).toBe('push · to main · not to x · tags v* · not tags v0 · only when src/** change · not when only docs/** change')
    expect(describeTrigger(pr)).toBe('pull_request (opened) · into main')
    expect(describeTrigger(dispatch)).toBe('Run by hand (workflow_dispatch) · 1 input')
    expect(describeTrigger(schedule)).toBe('On a schedule: 0 3 * * *')
    expect(describeTrigger(run)).toBe('After CI runs (workflow_run) · on main')
    expect(describeTrigger(call)).toBe('Called by other workflows (workflow_call) · 2 inputs')
    expect(describeTrigger({ event: 'schedule' })).toBe('On a schedule')
    expect(describeTrigger({ event: 'workflow_run' })).toBe('After another workflow runs (workflow_run)')
  })
})

describe('eventChoices', () => {
  it('lists the workflow events first, then common ones, without duplicates', () => {
    expect(eventChoices(parseTriggers('on: [release, push]\n'))).toEqual(['release', 'push', 'pull_request', 'workflow_dispatch', 'schedule'])
  })
})
