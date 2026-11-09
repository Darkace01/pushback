import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

// A tiny stand-in for api.github.com, so the end-to-end tests drive the real app against fixed data and never
// touch GitHub. It answers the REST and GraphQL calls Pushback makes for two repos, acme/api and acme/web, and
// records every request so tests can check the app never writes anything it wasn't asked to.

const now = Date.now()
const ago = (min: number) => new Date(now - min * 60_000).toISOString()
const user = (login: string) => ({ login, avatar_url: '', avatarUrl: '' })

const run = (repo: string, id: number, over: object) => ({
  id,
  workflow_id: 1,
  name: 'CI',
  display_title: 'Update docs',
  status: 'completed',
  conclusion: 'success',
  event: 'push',
  head_branch: 'main',
  head_sha: 'a'.repeat(40),
  run_number: id,
  run_attempt: 1,
  created_at: ago(30),
  updated_at: ago(28),
  run_started_at: ago(30),
  html_url: `https://github.com/${repo}/actions/runs/${id}`,
  actor: user('octo'),
  triggering_actor: user('octo'),
  ...over
})

export const RUNS: Record<string, object[]> = {
  'acme/api': [
    run('acme/api', 101, {}),
    run('acme/api', 102, { workflow_id: 2, name: 'Deploy', display_title: 'Deploy', event: 'workflow_dispatch', created_at: ago(20), run_started_at: ago(20), updated_at: ago(18) }),
    run('acme/api', 103, { conclusion: 'failure', event: 'pull_request', head_branch: 'feat/login', display_title: 'Add login page', created_at: ago(10), run_started_at: ago(10), updated_at: ago(9) })
  ],
  'corp/tools': [run('corp/tools', 501, { name: 'Enterprise CI', display_title: 'Ship it', html_url: 'https://ghe.test/corp/tools/actions/runs/501' })],
  'acme/web': [run('acme/web', 201, { status: 'in_progress', conclusion: null, display_title: 'Build site', created_at: ago(2), run_started_at: ago(2), updated_at: ago(1) })]
}

/** With `waiting`, a Deploy run paused for approval to prod-acme, which the signed-in user can approve. */
export const WAITING_RUN_ID = 106
const waitingRun = () =>
  run('acme/api', WAITING_RUN_ID, { workflow_id: 2, name: 'Deploy', display_title: 'Deploy', status: 'waiting', conclusion: null, event: 'push', created_at: ago(4), run_started_at: ago(4), updated_at: ago(3) })

/** GitHub's notification threads for the signed-in user. */
const NOTIFICATIONS = [
  {
    id: '5001',
    unread: true,
    reason: 'mention',
    updated_at: ago(12),
    subject: { title: 'Release checklist for v2', type: 'Discussion', url: null },
    repository: { full_name: 'globex/web', html_url: 'https://github.com/globex/web' }
  },
  {
    id: '5002',
    unread: false,
    reason: 'review_requested',
    updated_at: ago(40),
    subject: { title: 'Add login page', type: 'PullRequest', url: 'https://api.github.com/repos/acme/api/pulls/7' },
    repository: { full_name: 'acme/api', html_url: 'https://github.com/acme/api' }
  }
]

/** The run the fake creates when the Deploy workflow is dispatched. */
export const DISPATCHED_RUN_ID = 9001

const DEPLOY_YAML = `name: Deploy
on:
  workflow_dispatch:
    inputs:
      environment:
        type: choice
        options: [dev, prod-acme]
`

const pr = (number: number, over: object) => ({
  number,
  title: 'Add login page',
  url: `https://github.com/acme/api/pull/${number}`,
  isDraft: false,
  createdAt: ago(600),
  updatedAt: ago(15),
  headRefName: 'feat/login',
  additions: 42,
  deletions: 3,
  reviewDecision: null,
  author: { login: 'alice', avatarUrl: '' },
  comments: { totalCount: 1 },
  labels: { nodes: [{ name: 'ui', color: '0e8a16' }] },
  reviewRequests: { nodes: [{ requestedReviewer: { login: 'octo' } }] },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
  ...over
})

const PRS: Record<string, object[]> = {
  'acme/api': [pr(7, {}), pr(8, { title: 'WIP: tidy config', isDraft: true, author: { login: 'octo', avatarUrl: '' }, headRefName: 'chore/tidy', labels: { nodes: [] }, reviewRequests: { nodes: [] } })],
  'corp/tools': [pr(21, { title: 'Enterprise PR', url: 'https://ghe.test/corp/tools/pull/21', headRefName: 'feat/ent' })],
  'acme/web': [pr(9, { title: 'Bump lodash from 4.17.20 to 4.17.21', url: 'https://github.com/acme/web/pull/9', headRefName: 'dependabot/npm_and_yarn/lodash', author: { login: 'dependabot', avatarUrl: '' }, labels: { nodes: [] }, reviewRequests: { nodes: [] } })]
}

// Screenshot mode adds more repos, runs, PRs and deployments so the website shows a lived-in dashboard.
const RICH_RUNS: Record<string, object[]> = {
  'acme/api': [
    run('acme/api', 104, { name: 'Release', display_title: 'v1.2.0', event: 'push', head_branch: 'v1.2.0', created_at: ago(45), run_started_at: ago(45), updated_at: ago(41) }),
    run('acme/api', 105, { name: 'CodeQL', display_title: 'Scheduled scan', event: 'schedule', created_at: ago(70), run_started_at: ago(70), updated_at: ago(64) })
  ],
  'acme/web': [
    run('acme/web', 202, { name: 'Deploy', display_title: 'Deploy preview', event: 'workflow_dispatch', head_branch: 'main', created_at: ago(35), run_started_at: ago(35), updated_at: ago(31) }),
    run('acme/web', 203, { name: 'E2E', display_title: 'Checkout flow', conclusion: 'failure', event: 'pull_request', head_branch: 'feat/checkout', created_at: ago(50), run_started_at: ago(50), updated_at: ago(44) })
  ],
  'acme/mobile': [
    run('acme/mobile', 301, { name: 'Build iOS', display_title: 'Bump version', created_at: ago(5), run_started_at: ago(5), updated_at: ago(3), status: 'in_progress', conclusion: null }),
    run('acme/mobile', 302, { name: 'Build Android', display_title: 'Bump version', created_at: ago(6), run_started_at: ago(6), updated_at: ago(2) })
  ],
  'acme/infra': [run('acme/infra', 401, { name: 'Terraform plan', display_title: 'Add cache cluster', event: 'pull_request', head_branch: 'infra/cache', created_at: ago(25), run_started_at: ago(25), updated_at: ago(22) })]
}

const RICH_PRS: Record<string, object[]> = {
  'acme/web': [
    pr(31, { title: 'Redesign checkout flow', url: 'https://github.com/acme/web/pull/31', headRefName: 'feat/checkout', author: { login: 'maria', avatarUrl: '' }, commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] } }),
    pr(32, { title: 'Dark mode for the docs site', url: 'https://github.com/acme/web/pull/32', headRefName: 'feat/dark-docs', author: { login: 'sam', avatarUrl: '' }, reviewDecision: 'APPROVED', labels: { nodes: [{ name: 'docs', color: '0075ca' }] } })
  ],
  'acme/mobile': [pr(12, { title: 'Offline sync for drafts', url: 'https://github.com/acme/mobile/pull/12', headRefName: 'feat/offline', author: { login: 'lee', avatarUrl: '' }, commits: { nodes: [{ commit: { statusCheckRollup: { state: 'PENDING' } } }] } })],
  'acme/infra': [pr(4, { title: 'Add a Redis cache cluster', url: 'https://github.com/acme/infra/pull/4', headRefName: 'infra/cache', author: { login: 'priya', avatarUrl: '' }, labels: { nodes: [{ name: 'infra', color: 'd93f0b' }] } })]
}

const deployment = (id: number, environment: string, runId: number, sha: string, minutes: number, state = 'ACTIVE') => ({
  databaseId: id,
  environment,
  task: 'deploy',
  description: null,
  state,
  createdAt: ago(minutes),
  commitOid: sha,
  ref: { name: 'main' },
  creator: { login: 'octo', avatarUrl: '' },
  latestStatus: { state: state === 'FAILURE' ? 'FAILURE' : 'SUCCESS', createdAt: ago(minutes - 1), logUrl: `https://github.com/acme/api/actions/runs/${runId}/job/1`, environmentUrl: '', description: '' }
})

function graphql(query: string, vars: Record<string, string>, rich: boolean) {
  if (query.includes('reviewRequests: search')) {
    const node = { ...pr(7, {}), repository: { nameWithOwner: 'acme/api' } }
    return { viewer: { login: 'octo', avatarUrl: '' }, reviewRequests: { nodes: [node] }, myPrs: { nodes: [] }, assigned: { nodes: [] } }
  }
  const repo = `${vars.owner}/${vars.name}`
  if (query.includes('refs/heads/')) {
    const days = (n: number) => ago(n * 1440)
    const branch = (name: string, age: number, aheadBy: number, behindBy: number, pr?: number) => ({
      name,
      target: { oid: name.length.toString(16).padStart(40, '0'), committedDate: days(age), messageHeadline: `Work on ${name}`, author: { name: 'alice', user: { login: 'alice', avatarUrl: '' } } },
      compare: { aheadBy, behindBy },
      associatedPullRequests: { nodes: pr ? [{ number: pr }] : [] }
    })
    return {
      repository: {
        refs: {
          nodes: [
            branch('main', 0, 0, 0),
            branch('feat/login', 1, 0, 3, 7),
            branch('old/merged-feature', 40, 12, 0),
            branch('experiments/abandoned', 200, 4, 30),
            branch('fresh-empty', 1, 0, 0)
          ]
        }
      }
    }
  }
  // Inline review threads on PR 7's only file: one open conversation on line 1.
  if (query.includes('reviewThreads(first: 100)') && !query.includes('mergeStateStatus'))
    return {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: [
              {
                id: 'THREAD_1',
                isResolved: false,
                isOutdated: false,
                path: 'src/login.ts',
                line: 1,
                originalLine: 1,
                diffSide: 'RIGHT',
                comments: { nodes: [{ databaseId: 801, bodyHTML: '<p>Should this be a function?</p>', createdAt: ago(20), url: '', author: { login: 'bob', avatarUrl: '' } }] }
              }
            ]
          }
        }
      }
    }
  if (query.includes('mergeStateStatus')) {
    const ctx = (name: string, conclusion: string, isRequired: boolean) => ({ __typename: 'CheckRun', name, status: 'COMPLETED', conclusion, isRequired })
    const base = { isDraft: false, mergeable: 'MERGEABLE', isInMergeQueue: false, mergeQueueEntry: null, autoMergeRequest: null, reviewThreads: { nodes: [] } }
    const rollup = (nodes: object[]) => ({ nodes: [{ commit: { statusCheckRollup: { contexts: { nodes } } } }] })
    // acme/web PRs are already in the merge queue; every other PR is blocked by protection rules.
    if (repo === 'acme/web')
      return {
        repository: {
          pullRequest: {
            ...base,
            mergeStateStatus: 'CLEAN',
            reviewDecision: 'APPROVED',
            isInMergeQueue: true,
            mergeQueueEntry: { position: 2, state: 'AWAITING_CHECKS', estimatedTimeToMerge: 300 },
            baseRef: { name: 'main', branchProtectionRule: null },
            latestOpinionatedReviews: { nodes: [{ author: { login: 'bob' }, state: 'APPROVED' }] },
            commits: rollup([ctx('build', 'SUCCESS', true)])
          }
        }
      }
    return {
      repository: {
        pullRequest: {
          ...base,
          mergeStateStatus: 'BLOCKED',
          reviewDecision: 'REVIEW_REQUIRED',
          baseRef: {
            name: 'main',
            branchProtectionRule: {
              requiresApprovingReviews: true,
              requiredApprovingReviewCount: 2,
              requiresCodeOwnerReviews: false,
              requiresConversationResolution: false,
              requiresStrictStatusChecks: false,
              requiredStatusCheckContexts: ['build', 'lint', 'e2e']
            }
          },
          latestOpinionatedReviews: { nodes: [] },
          commits: rollup([ctx('build', 'SUCCESS', true), ctx('lint', 'FAILURE', true), ctx('docs', 'FAILURE', false)])
        }
      }
    }
  }
  if (query.includes('deployments(') && rich && repo !== 'acme/api') {
    // Every rich repo deploys to dev, staging and two clients in prod.
    const envs = ['dev', 'staging', 'prod-acme', 'prod-globex', 'prod-initech']
    return {
      repository: {
        environments: { nodes: envs.map((name) => ({ name })) },
        deployments: { nodes: envs.map((e, i) => deployment(900 + i + repo.length * 10, e, 202, i < 2 ? 'r2' : 'r1', 20 + i * 90, e === 'prod-initech' && repo === 'acme/web' ? 'FAILURE' : 'ACTIVE')) },
        refs: { nodes: [{ name: 'v2.4.0', target: { oid: 'r2' } }, { name: 'v2.3.1', target: { oid: 'r1' } }] }
      }
    }
  }
  if (query.includes('deployments(')) {
    const api = repo === 'acme/api'
    return {
      repository: {
        environments: { nodes: api ? [{ name: 'dev' }, { name: 'prod-acme' }, { name: 'prod-globex' }] : [] },
        deployments: {
          nodes: api
            ? [deployment(3, 'prod-globex', 102, 'c2', 25, 'FAILURE'), deployment(2, 'prod-acme', 102, 'c1', 19), deployment(1, 'dev', 101, 'c1', 29)]
            : []
        },
        refs: { nodes: [{ name: 'v1.2.0', target: { oid: 'tag', target: { oid: 'c1' } } }] }
      }
    }
  }
  if (query.includes('refPrefix: "refs/heads/"'))
    return {
      repository: {
        refs: {
          nodes: [
            {
              name: 'main',
              target: { oid: 'c1', committedDate: ago(10), messageHeadline: 'Latest change', author: { name: 'octo', user: { login: 'octo', avatarUrl: '' } } },
              compare: { aheadBy: 0, behindBy: 0 },
              associatedPullRequests: { nodes: [] }
            }
          ]
        }
      }
    }
  if (query.includes('pullRequests(')) return { repository: { defaultBranchRef: { name: 'main' }, pullRequests: { nodes: [...(PRS[repo] ?? []), ...(rich ? (RICH_PRS[repo] ?? []) : [])] } } }
  return { repository: null }
}

function rest(path: string, rich: boolean, enterprise = false, waiting = false): unknown {
  const [p] = path.split('?')
  let m: RegExpMatchArray | null
  if (p === '/notifications') return NOTIFICATIONS
  if ((m = p.match(/^\/repos\/acme\/api\/actions\/runs\/(\d+)\/pending_deployments$/)))
    return Number(m[1]) === WAITING_RUN_ID && waiting
      ? [{ environment: { id: 77, name: 'prod-acme', html_url: '' }, wait_timer: 0, current_user_can_approve: true, reviewers: [{ type: 'User', reviewer: { login: 'octo' } }] }]
      : []
  // Run 103 uploaded a build and a coverage report that has since expired.
  if ((m = p.match(/^\/repos\/[^/]+\/[^/]+\/actions\/runs\/(\d+)\/artifacts$/)))
    return {
      artifacts:
        m[1] === '103'
          ? [
              { id: 61, name: 'dist', size_in_bytes: 1_572_864, expired: false, created_at: ago(9), expires_at: new Date(now + 80 * 86_400_000).toISOString() },
              { id: 62, name: 'coverage', size_in_bytes: 4096, expired: true, created_at: ago(9), expires_at: ago(1) }
            ]
          : []
    }
  if (p === '/user') return { login: enterprise ? 'octo-ent' : 'octo', avatar_url: '' }
  if (p === '/user/repos') return path.includes('page=1') ? [{ full_name: 'acme/api', description: 'The API', private: true, pushed_at: ago(5) }, { full_name: 'acme/web', description: 'The website', private: false, pushed_at: ago(60) }] : []
  // GitHub Packages: octo publishes an npm package and a container image; the acme org publishes a private npm package.
  // The package_type parameter is required by the real API, so a request without it fails here too.
  if ((m = p.match(/^\/(user|orgs\/acme)\/packages$/))) {
    const type = new URLSearchParams(path.split('?')[1] ?? '').get('package_type')
    if (!type) return { status: 400, body: { message: 'package_type is required' } }
    const pkg = (name: string, package_type: string, over: object) => ({ name, package_type, visibility: 'public', version_count: 2, html_url: `https://github.com/orgs/x/packages/${package_type}/package/${name}`, created_at: ago(5000), updated_at: ago(60), repository: null, ...over })
    if (m[1] === 'user') return type === 'npm' ? [pkg('octo-cli', 'npm', { repository: { full_name: 'octo/octo-cli' } })] : type === 'container' ? [pkg('octo-image', 'container', { version_count: 1, updated_at: ago(600) })] : []
    return type === 'npm' ? [pkg('acme-sdk', 'npm', { visibility: 'private', version_count: 3 })] : []
  }
  if ((m = p.match(/^\/(user|orgs\/acme)\/packages\/(npm|container)\/([^/]+)\/versions$/))) {
    const name = decodeURIComponent(m[3])
    if (m[2] === 'container') return [{ id: 31, name: 'sha256:' + 'a'.repeat(64), html_url: 'https://github.com/x/container/31', created_at: ago(600), metadata: { container: { tags: ['latest', '1.0.0'] } } }]
    return [
      { id: 21, name: name === 'acme-sdk' ? '3.1.0' : '2.0.1', html_url: 'https://github.com/x/npm/21', created_at: ago(60) },
      { id: 22, name: name === 'acme-sdk' ? '3.0.0' : '2.0.0', html_url: 'https://github.com/x/npm/22', created_at: ago(900) }
    ]
  }
  if (p === '/user/orgs') return [{ login: 'acme' }]
  // Actions settings: acme/api has secrets, variables, a runner and caches; acme/web's token isn't an admin (403).
  if ((m = p.match(/^\/repos\/([^/]+\/[^/]+)\/actions\/(secrets|secrets\/public-key|variables|runners|caches|cache\/usage)$/))) {
    if (m[1] !== 'acme/api') return { status: 403, body: { message: 'Resource not accessible by personal access token' } }
    if (m[2] === 'secrets') return { total_count: 2, secrets: [{ name: 'NPM_TOKEN', created_at: ago(9000), updated_at: ago(120) }, { name: 'DEPLOY_KEY', created_at: ago(9000), updated_at: ago(4000) }] }
    // Any 32 bytes make a usable X25519 public key for sealing.
    if (m[2] === 'secrets/public-key') return { key_id: 'key-1', key: Buffer.alloc(32, 7).toString('base64') }
    if (m[2] === 'variables') return { total_count: 1, variables: [{ name: 'NODE_VERSION', value: '22', created_at: ago(9000), updated_at: ago(300) }] }
    if (m[2] === 'runners') return { total_count: 1, runners: [{ id: 1, name: 'build-box', os: 'Linux', status: 'online', busy: true, labels: [{ name: 'self-hosted' }, { name: 'gpu' }] }] }
    if (m[2] === 'cache/usage') return { full_name: m[1], active_caches_size_in_bytes: 3 * 1024 * 1024 * 1024, active_caches_count: 3 }
    const ref = new URLSearchParams(path.split('?')[1] ?? '').get('ref')
    const cache = (id: number, key: string, cref: string, gb: number) => ({ id, key, ref: cref, size_in_bytes: gb * 1024 * 1024 * 1024, last_accessed_at: ago(id * 10), created_at: ago(id * 100) })
    const caches = [cache(1, 'node-modules-linux-abc', 'refs/heads/main', 1), cache(2, 'node-modules-linux-def', 'refs/pull/7/merge', 1), cache(3, 'playwright-linux', 'refs/pull/7/merge', 1)].filter((c) => !ref || c.ref === ref)
    return { total_count: caches.length, actions_caches: caches }
  }
  // Security alerts: acme/api has some, secret scanning is off there; acme/web has the features switched off.
  if ((m = p.match(/^\/repos\/([^/]+\/[^/]+)\/(dependabot|code-scanning|secret-scanning)\/alerts$/))) {
    if (m[1] !== 'acme/api' || m[2] === 'secret-scanning') return { status: 404, body: { message: 'Not Found' } }
    if (m[2] === 'dependabot')
      return [
        { number: 1, html_url: 'https://github.com/acme/api/security/dependabot/1', created_at: ago(300), dependency: { package: { name: 'lodash' } }, security_advisory: { summary: 'Prototype pollution in lodash', severity: 'high' } },
        { number: 2, html_url: 'https://github.com/acme/api/security/dependabot/2', created_at: ago(900), dependency: { package: { name: 'minimist' } }, security_advisory: { summary: 'ReDoS in minimist', severity: 'low' } }
      ]
    return [{ number: 5, html_url: 'https://github.com/acme/api/security/code-scanning/5', created_at: ago(100), rule: { id: 'js/sql-injection', description: 'SQL injection', severity: 'error', security_severity_level: 'critical' }, most_recent_instance: { location: { path: 'src/db.ts' } } }]
  }
  // Open PRs for the cleanup view (and the "does this branch have a PR" check before deleting it).
  // (Closed PRs, asked for by the release-notes draft, are served further down.)
  if ((m = p.match(/^\/repos\/([^/]+\/[^/]+)\/pulls$/)) && !/[?&]state=closed(&|$)/.test(path)) {
    const prsOf = (n: number, title: string, updated: number, head: string) => ({ number: n, title, html_url: `https://github.com/${m![1]}/pull/${n}`, user: user('alice'), created_at: ago(updated + 60), updated_at: ago(updated), draft: false, head: { ref: head } })
    const all = m[1] === 'acme/api' ? [prsOf(3, 'Old experiment', 200 * 1440, 'experiments/abandoned-pr'), prsOf(7, 'Add login page', 15, 'feat/login')] : []
    const head = new URLSearchParams(path.split('?')[1] ?? '').get('head')
    return head ? all.filter((x) => head.endsWith(':' + x.head.ref)) : all
  }
  if ((m = p.match(/^\/repos\/([^/]+\/[^/]+)\/actions\/runs$/)))
    return { workflow_runs: [...(waiting && m[1] === 'acme/api' ? [waitingRun()] : []), ...(RUNS[m[1]] ?? []), ...(rich ? (RICH_RUNS[m[1]] ?? []) : [])] }
  if ((m = p.match(/^\/repos\/([^/]+\/[^/]+)\/actions\/workflows$/)))
    return {
      workflows:
        m[1] === 'acme/api'
          ? [
              { id: 1, name: 'CI', path: '.github/workflows/ci.yml', state: 'active', html_url: '' },
              { id: 2, name: 'Deploy', path: '.github/workflows/deploy.yml', state: 'active', html_url: '' }
            ]
          : []
    }
  if (p.endsWith('/contents/.github/workflows/deploy.yml')) return { content: Buffer.from(DEPLOY_YAML).toString('base64') }
  if (p.endsWith('/contents/.github/workflows/ci.yml')) return { content: Buffer.from('on: push\n').toString('base64') }
  // Run 103 ran build and test in parallel, then deploy; the rest have one job.
  if ((m = p.match(/^\/repos\/[^/]+\/[^/]+\/actions\/runs\/103\/jobs$/))) {
    const j = (id: number, name: string, from: number, to: number, conclusion: string) => ({
      id, name, status: 'completed', conclusion, started_at: ago(from), completed_at: ago(to), html_url: '', steps: [{ name: 'Run', status: 'completed', conclusion, number: 1 }]
    })
    return { jobs: [j(1031, 'build', 10, 9.5, 'success'), j(1032, 'test', 10, 9, 'failure'), j(1033, 'lint', 10, 9.8, 'success')] }
  }
  if ((m = p.match(/^\/repos\/[^/]+\/[^/]+\/actions\/runs\/(\d+)\/jobs$/)))
    return {
      jobs: [
        {
          id: Number(m[1]) * 10,
          name: 'build',
          status: 'completed',
          conclusion: 'success',
          started_at: ago(20),
          completed_at: ago(19),
          html_url: '',
          steps: [{ name: 'Checkout', status: 'completed', conclusion: 'success', number: 1 }]
        }
      ]
    }
  if ((m = p.match(/^\/repos\/([^/]+\/[^/]+)\/readme$/))) return `<h1>${m[1]}</h1><p>Readme for the fixture repo.</p>`
  if ((m = p.match(/^\/repos\/([^/]+\/[^/]+)$/)))
    return {
      full_name: m[1],
      description: `Fixture repo ${m[1]}`,
      html_url: `https://github.com/${m[1]}`,
      homepage: null,
      private: false,
      archived: false,
      default_branch: 'main',
      language: 'TypeScript',
      stargazers_count: 5,
      forks_count: 1,
      open_issues_count: 2,
      topics: ['demo'],
      pushed_at: ago(5)
    }
  if ((m = p.match(/^\/repos\/[^/]+\/[^/]+\/pulls\/(\d+)$/)))
    return {
      number: Number(m[1]),
      node_id: `PR_node_${m[1]}`,
      title: 'Add login page',
      state: 'open',
      draft: false,
      merged: false,
      mergeable: true,
      mergeable_state: 'clean',
      body_html: '<p>Adds the <strong>login</strong> page.</p>',
      html_url: `https://github.com/acme/api/pull/${m[1]}`,
      user: user('alice'),
      created_at: ago(600),
      updated_at: ago(15),
      head: { ref: 'feat/login', sha: 'b'.repeat(40) },
      base: { ref: 'main' },
      additions: 42,
      deletions: 3,
      changed_files: 1,
      requested_reviewers: [user('octo')],
      labels: [{ name: 'ui', color: '0e8a16' }]
    }
  if (p === '/search/issues') {
    const q = decodeURIComponent(path.split('q=')[1]?.split('&')[0] ?? '')
    const found = (repo: string, number: number, title: string, login: string, extra: object = {}) => ({
      number,
      title,
      html_url: `https://github.com/${repo}/pull/${number}`,
      state: 'open',
      repository_url: `https://api.github.com/repos/${repo}`,
      user: user(login),
      created_at: ago(900),
      updated_at: ago(number),
      comments: 0,
      draft: false,
      labels: [],
      pull_request: {},
      ...extra
    })
    // One PR in a tracked repo and two in orgs that aren't tracked: the point of a cross-org search.
    const items = q.includes('is:issue')
      ? [found('globex/web', 40, 'Slow page load', 'dana', { pull_request: undefined })]
      : [found('acme/api', 7, 'Add login page', 'octo'), found('globex/web', 31, 'Upgrade the router', 'octo', { draft: true }), found('initech/tool', 9, 'Fix the build', 'octo', { labels: [{ name: 'bug', color: 'd73a4a' }] })]
    return { total_count: items.length, incomplete_results: false, items }
  }
  if (p.match(/^\/repos\/[^/]+\/[^/]+\/releases$/))
    return [{ id: 1, tag_name: 'v1.2.0', name: 'v1.2.0', html_url: '', draft: false, prerelease: false, published_at: ago(3000), created_at: ago(3000), author: user('octo'), assets: [] }]
  if (p.match(/^\/repos\/[^/]+\/[^/]+\/pulls$/))
    return [
      { number: 20, title: 'feat: tray badge', html_url: 'https://github.com/acme/api/pull/20', merged_at: ago(200), updated_at: ago(200), user: user('alice'), labels: [] },
      { number: 21, title: 'Fix the login crash', html_url: 'https://github.com/acme/api/pull/21', merged_at: ago(100), updated_at: ago(100), user: user('bob'), labels: [{ name: 'bug' }] },
      { number: 22, title: 'Closed without merging', html_url: '', merged_at: null, updated_at: ago(90), user: user('bob'), labels: [] },
      { number: 3, title: 'Old change before the release', html_url: '', merged_at: ago(5000), updated_at: ago(5000), user: user('carol'), labels: [] }
    ]
  if (p.match(/\/issues\/\d+\/comments$/)) return [{ id: 1, user: user('bob'), body_html: '<p>Looks good to me!</p>', created_at: ago(30), html_url: '' }]
  if (p.match(/\/pulls\/\d+\/reviews$/)) return []
  if (p.match(/\/pulls\/\d+\/commits$/)) return [{ sha: 'b'.repeat(40), commit: { message: 'Add login page', author: { name: 'alice', date: ago(600) } }, author: user('alice') }]
  if (p.match(/\/pulls\/\d+\/files$/)) return [{ filename: 'src/login.ts', status: 'added', additions: 2, deletions: 0, patch: '@@ -0,0 +1,2 @@\n+export const login = true\n+// done' }]
  if (p.match(/\/check-runs$/)) return { check_runs: [{ name: 'build', status: 'completed', conclusion: 'success', html_url: '' }] }
  return undefined
}

export interface FakeGitHub {
  url: string
  requests: { method: string; path: string; body?: string }[]
  /** Every distinct Authorization token the server was called with. */
  tokens: Set<string>
  /** Requests that would change something on GitHub (anything but reads and GraphQL queries; mutations count). */
  writes: () => { method: string; path: string; body?: string }[]
  /** JSON bodies of the writes the app made, in order, for tests that expect one. */
  bodies: { method: string; path: string; body: unknown }[]
  close: () => Promise<void>
}

const body = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
  })

/**
 * `rich` adds more repos and history, for screenshots. `enterprise` makes it a GitHub Enterprise Server: the API lives under
 * /api/v3 (GraphQL at /api/graphql) and only the token `ghes-token` is accepted.
 */
export async function startFakeGitHub(opts: { rich?: boolean; enterprise?: boolean; waiting?: boolean } = {}): Promise<FakeGitHub> {
  const rich = !!opts.rich
  const waiting = !!opts.waiting
  const enterprise = !!opts.enterprise
  const requests: { method: string; path: string; body?: string }[] = []
  const tokens = new Set<string>()
  let dispatched = false
  const bodies: { method: string; path: string; body: unknown }[] = []
  const server: Server = createServer(async (req, res) => {
    let path = req.url ?? '/'
    if (enterprise) path = path.replace(/^\/api\/graphql/, '/graphql').replace(/^\/api\/v3/, '')
    tokens.add((req.headers.authorization ?? '').replace(/^(Bearer|token) /, ''))
    const text = req.method === 'GET' ? '' : await body(req)
    requests.push({ method: req.method ?? 'GET', path, ...(text && { body: text }) })
    const headers = { 'Content-Type': 'application/json', 'x-ratelimit-resource': 'core', 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': String(Math.floor(now / 1000) + 3600) }
    if (!/^Bearer |^token /.test(req.headers.authorization ?? '') || (enterprise && req.headers.authorization !== 'Bearer ghes-token')) {
      res.writeHead(401, headers).end(JSON.stringify({ message: 'Bad credentials' }))
      return
    }
    if (path === '/graphql' && req.method === 'POST') {
      const { query, variables } = JSON.parse(text) as { query: string; variables: Record<string, string> }
      if (/^\s*mutation/.test(query)) {
        res.writeHead(200, headers).end(JSON.stringify({ data: { ok: { clientMutationId: null } } }))
        return
      }
      res.writeHead(200, headers).end(JSON.stringify({ data: graphql(query, variables ?? {}, rich) }))
      return
    }
    // Dispatching the Deploy workflow queues a new run, which then shows up in that workflow's run list.
    if (req.method === 'POST' && /^\/repos\/acme\/api\/actions\/workflows\/2\/dispatches$/.test(path)) {
      dispatched = true
      res.writeHead(204, headers).end()
      return
    }
    if (req.method === 'GET' && /^\/repos\/acme\/api\/actions\/workflows\/2\/runs(\?|$)/.test(path)) {
      const older = (RUNS['acme/api'] as { workflow_id: number }[]).filter((r) => r.workflow_id === 2)
      const queued = run('acme/api', DISPATCHED_RUN_ID, { workflow_id: 2, name: 'Deploy', display_title: 'Deploy', status: 'in_progress', conclusion: null, event: 'workflow_dispatch', created_at: ago(0), run_started_at: ago(0), updated_at: ago(0) })
      res.writeHead(200, headers).end(JSON.stringify({ workflow_runs: dispatched ? [queued, ...older] : older }))
      return
    }
    // Submitting a review is the one REST write the app is allowed to make in tests that ask for it.
    if (req.method === 'POST' && /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/reviews$/.test(path)) {
      res.writeHead(200, headers).end(JSON.stringify({ id: 1 }))
      return
    }
    if (req.method === 'POST' && /^\/repos\/[^/]+\/[^/]+\/releases$/.test(path)) {
      bodies.push({ method: 'POST', path, body: JSON.parse(text || '{}') })
      res.writeHead(201, headers).end(JSON.stringify({ html_url: 'https://github.com/acme/api/releases/tag/v1.3.0' }))
      return
    }
    // Approving a deployment, line comments and replies, and marking every notification read.
    if (
      (req.method === 'POST' && /^\/repos\/[^/]+\/[^/]+\/(actions\/runs\/\d+\/pending_deployments|pulls\/\d+\/comments(\/\d+\/replies)?)$/.test(path)) ||
      (req.method === 'PUT' && path === '/notifications')
    ) {
      bodies.push({ method: req.method, path, body: JSON.parse(text || '{}') })
      res.writeHead(req.method === 'PUT' ? 205 : 201, headers).end(req.method === 'PUT' ? '' : '{}')
      return
    }
    // An artifact download: a few bytes standing in for the zip.
    if (req.method === 'GET' && /^\/repos\/[^/]+\/[^/]+\/actions\/artifacts\/\d+\/zip$/.test(path)) {
      res.writeHead(200, { ...headers, 'Content-Type': 'application/zip' }).end(Buffer.from('PK fake zip'))
      return
    }
    if (req.method === 'PUT' && /^\/repos\/[^/]+\/[^/]+\/actions\/secrets\/\w+$/.test(path)) {
      bodies.push({ method: 'PUT', path, body: JSON.parse(text || '{}') })
      return void res.writeHead(201, headers).end('{}')
    }
    // Writes (cleanup) are accepted and recorded; tests assert on exactly which ones happened.
    if (req.method === 'DELETE') return void res.writeHead(204, headers).end()
    if (req.method === 'PATCH') return void res.writeHead(200, headers).end('{}')
    const data = req.method === 'GET' ? rest(path, rich, enterprise, waiting) : undefined
    if (data && typeof data === 'object' && 'status' in data && 'body' in data) res.writeHead(data.status as number, headers).end(JSON.stringify(data.body))
    else if (data === undefined) res.writeHead(404, headers).end(JSON.stringify({ message: 'Not Found' }))
    else if (typeof data === 'string') res.writeHead(200, { ...headers, 'Content-Type': 'text/html' }).end(data)
    else res.writeHead(200, headers).end(JSON.stringify(data))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    tokens,
    bodies,
    writes: () => requests.filter((r) => r.method !== 'GET' && !(r.method === 'POST' && r.path === '/graphql' && !/^\s*mutation/.test(JSON.parse(r.body ?? '{}').query ?? ''))),
    close: () => new Promise((resolve) => server.close(() => resolve()))
  }
}
