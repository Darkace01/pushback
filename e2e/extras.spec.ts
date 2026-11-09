import { expect, test } from '@playwright/test'
import { close, launch, savedSettings, type Ctx } from './launch'

// Tray, release helper, shareable dashboards and saved searches. Same rules as app.spec.ts: a fresh profile and
// fake GitHub per test, no uncaught errors, and no writes to GitHub except the ones a test expects and removes.

const WATCHING = { repos: ['acme/api', 'acme/web'], uiVersion: 1, tourDone: true }

let ctx: Ctx
test.afterEach(async ({}, info) => {
  if (!ctx) return
  if (info.status !== info.expectedStatus) await ctx.page.screenshot({ path: info.outputPath('failure.png') }).catch(() => {})
  expect(ctx.gh.writes(), 'requests that would change GitHub').toEqual([])
  expect(ctx.errors, 'uncaught errors in the app').toEqual([])
  await close(ctx)
})

test('settings: launch at login and start in the tray are saved', async () => {
  ctx = await launch({ settings: WATCHING })
  const { page } = ctx
  await page.getByTitle(/Settings/).click()
  await page.getByRole('tab', { name: 'Advanced' }).click()
  const login = page.getByLabel('Start Pushback when I sign in to my computer')
  await expect(login).not.toBeChecked()
  await expect(page.getByLabel('Start in the tray without opening the window')).toHaveCount(0)
  await login.check()
  await expect(page.getByLabel('Start in the tray without opening the window')).toBeChecked()
  await expect.poll(() => savedSettings(ctx).launchAtLogin).toBe(true)
})

test('a release can be drafted from merged PRs, edited, and saved as a draft', async () => {
  ctx = await launch({ settings: WATCHING })
  const { page } = ctx
  await page.locator('.repo-sidebar').getByText('acme/api').click()
  await page.locator('.ws-link', { hasText: 'Releases' }).click()
  await page.getByRole('button', { name: 'New release' }).click()
  const dialog = page.getByRole('dialog')
  // Starts as a draft, never as a publish.
  await expect(dialog.getByLabel(/Save as a draft/)).toBeChecked()
  await dialog.getByRole('button', { name: /Draft from merged PRs/ }).click()
  const notes = dialog.locator('textarea')
  await expect(notes).toHaveValue(/## Features[\s\S]*tray badge[\s\S]*## Fixes[\s\S]*Fix the login crash/)
  // Only PRs merged after v1.2.0 and actually merged.
  await expect(notes).not.toHaveValue(/Old change|Closed without/)
  await notes.fill((await notes.inputValue()) + '\n\nEdited by hand.')
  await dialog.getByRole('button', { name: 'Save draft' }).click()
  await expect.poll(() => ctx.gh.bodies.length).toBe(1)
  const { body } = ctx.gh.bodies[0] as { body: { draft: boolean; body: string; tag_name: string } }
  expect(body.draft).toBe(true)
  expect(body.body).toContain('Edited by hand.')
  expect(body.body).toContain('Fix the login crash')
  expect(body.tag_name).toBe('v1.2.1')
  // The one expected write: creating the draft. Nothing else may have changed GitHub.
  const writes = ctx.gh.writes()
  expect(writes.map(({ method, path }) => ({ method, path }))).toEqual([{ method: 'POST', path: '/repos/acme/api/releases' }])
  ctx.gh.requests.splice(0, ctx.gh.requests.length, ...ctx.gh.requests.filter((r) => !writes.includes(r)))
})

test('a dashboard can be shared as text and imported as a new dashboard without local folders', async () => {
  ctx = await launch({ settings: { ...WATCHING, localPaths: { 'acme/api': '/home/me/api' } } })
  const { page } = ctx
  await page.locator('.dash-tab.more').click()
  await page.getByRole('menuitem', { name: /Manage dashboards/ }).click()
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  const payload = await page.getByLabel('Dashboard payload').inputValue()
  expect(JSON.parse(payload).kind).toBe('pushback-dashboard')
  expect(payload).not.toContain('/home/me')
  await page.keyboard.press('Escape')

  // Import it back, with a hand-edited name and a smuggled local folder.
  await page.getByRole('button', { name: /Import/ }).click()
  const edited = { ...JSON.parse(payload), name: 'From a teammate', localPaths: { 'acme/api': '/evil' } }
  await page.getByLabel('Dashboard JSON').fill(JSON.stringify(edited))
  await page.getByRole('dialog').getByRole('button', { name: 'Import', exact: true }).click()
  await expect.poll(() => savedSettings(ctx).dashboards.length).toBe(2)
  const saved = savedSettings(ctx)
  expect(saved.dashboards[1].name).toBe('From a teammate')
  expect(saved.activeDashboard).toBe(saved.dashboards[1].id)
  expect(saved.localPaths).toEqual({ 'acme/api': '/home/me/api' })
})

test('a saved search is pinned as a widget, shows PRs from untracked orgs, filters, and is saved', async () => {
  ctx = await launch({ settings: WATCHING })
  const { page } = ctx
  await page.locator('.search-trigger').click()
  await page.getByPlaceholder(/Search/).fill('saved searches')
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Saved searches' })
  await dialog.locator('.row', { hasText: 'My open PRs' }).getByRole('button', { name: 'Pin to dashboard' }).click()

  const widget = page.locator('.widget', { has: page.getByRole('heading', { name: 'My open PRs' }) })
  // Results come from GitHub search, so repos nobody tracks still appear.
  await expect(widget.getByText('Fix the build')).toBeVisible()
  await expect(widget.locator('.chip', { hasText: 'initech/tool' })).toBeVisible()
  await expect(widget.locator('.row')).toHaveCount(3)
  await expect(widget).toContainText('3 matches')
  const searches = ctx.gh.requests.filter((r) => r.path.startsWith('/search/issues'))
  expect(searches).toHaveLength(1)
  expect(decodeURIComponent(searches[0].path)).toContain('author:@me')
  expect(decodeURIComponent(searches[0].path)).toContain('is:pr')

  // Filters from lib/filters.ts apply to the results without searching again.
  await widget.getByRole('button', { name: 'Filters' }).click()
  await widget.getByPlaceholder('any repo').fill('globex')
  await expect(widget.locator('.row')).toHaveCount(1)
  await expect(widget.getByText('Upgrade the router')).toBeVisible()
  await widget.getByPlaceholder('any repo').fill('')
  await widget.getByRole('button', { name: 'Hide drafts' }).click()
  await expect(widget.locator('.row')).toHaveCount(2)
  expect(ctx.gh.requests.filter((r) => r.path.startsWith('/search/issues'))).toHaveLength(1)

  await expect
    .poll(() => savedSettings(ctx).widgets.find((w: { type: string }) => w.type === 'search')?.options)
    .toMatchObject({ query: 'is:open author:@me archived:false', kind: 'pr', hideDrafts: true })

  // Save a custom search for later.
  await page.locator('.search-trigger').click()
  await page.getByPlaceholder(/Search/).fill('saved searches')
  await page.keyboard.press('Enter')
  await dialog.getByPlaceholder('e.g. Open bugs in acme').fill('Globex issues')
  await dialog.getByLabel('Look for').selectOption('issue')
  await dialog.getByPlaceholder('is:open org:acme label:bug').fill('is:open org:globex')
  await dialog.getByRole('button', { name: 'Save search' }).click()
  await expect.poll(() => savedSettings(ctx).savedSearches).toEqual([expect.objectContaining({ name: 'Globex issues', kind: 'issue', query: 'is:open org:globex' })])
})

test('watching a run opens an always-on-top mini window with its current step, and closing it stops watching', async () => {
  ctx = await launch({ settings: WATCHING })
  const { app, page } = ctx
  const runs = page.locator('.widget', { has: page.getByRole('heading', { name: 'Workflow runs' }) })
  await runs.getByText('Build site').click()
  const opened = app.waitForEvent('window')
  await page.getByRole('button', { name: 'Watch', exact: true }).click()
  const mini = await opened

  await expect(mini.getByText('Watching 1 run')).toBeVisible()
  // The run's current job and step, from its jobs.
  await expect(mini.locator('.mini-run')).toContainText('build › Compile site')
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.isAlwaysOnTop()).length)).toBe(1)
  await expect(page.getByRole('button', { name: 'Watching' })).toBeVisible()

  await mini.getByRole('button', { name: 'Stop watching and close' }).click()
  await expect.poll(() => app.windows().length).toBe(1)
  await expect(page.getByRole('button', { name: 'Watch', exact: true })).toBeVisible()
})
