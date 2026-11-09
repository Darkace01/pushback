import { expect, test } from '@playwright/test'
import { close, launch, type Ctx } from './launch'

// The repo tab's Actions settings: secrets, variables, runners and caches. Same rules as app.spec.ts: a fresh
// profile and fake GitHub per test, no uncaught errors, and no writes to GitHub except the ones a test expects and removes.

const WATCHING = { repos: ['acme/api', 'acme/web'], uiVersion: 1, tourDone: true }

let ctx: Ctx
test.afterEach(async ({}, info) => {
  if (!ctx) return
  if (info.status !== info.expectedStatus) await ctx.page.screenshot({ path: info.outputPath('failure.png') }).catch(() => {})
  expect(ctx.gh.writes(), 'requests that would change GitHub').toEqual([])
  expect(ctx.errors, 'uncaught errors in the app').toEqual([])
  await close(ctx)
})

async function openSettings(repo: string) {
  const { page } = ctx
  await page.locator('.repo-sidebar').getByText(repo).click()
  await page.locator('.ws-link', { hasText: 'Actions settings' }).click()
}

/** Drops the writes a test expected, after checking they are exactly these, so afterEach still catches any others. */
function expectWrites(expected: { method: string; path: string }[]) {
  const writes = ctx.gh.writes()
  // Parallel deletes can land in any order.
  expect(writes.map(({ method, path }) => ({ method, path })).sort((a, b) => a.path.localeCompare(b.path))).toEqual(expected)
  ctx.gh.requests.splice(0, ctx.gh.requests.length, ...ctx.gh.requests.filter((r) => !writes.includes(r)))
}

test('lists secret names, variables, runners and caches, each only once its tab is opened', async () => {
  ctx = await launch({ settings: WATCHING })
  const { page, gh } = ctx
  await openSettings('acme/api')
  const main = page.locator('.actions-admin')
  await expect(main.getByText('NPM_TOKEN')).toBeVisible()
  await expect(main.getByText('DEPLOY_KEY')).toBeVisible()
  // Only the open tab was fetched.
  const asked = (what: string) => gh.requests.some((r) => r.path.startsWith(`/repos/acme/api/actions/${what}`))
  expect(asked('variables') || asked('runners') || asked('caches')).toBe(false)

  await main.getByRole('tab', { name: 'Variables' }).click()
  await expect(main.getByText('NODE_VERSION')).toBeVisible()
  await expect(main.getByText('22', { exact: true })).toBeVisible()

  await main.getByRole('tab', { name: 'Runners' }).click()
  await expect(main.getByText('build-box')).toBeVisible()
  await expect(main.locator('.badge', { hasText: 'online' })).toBeVisible()
  await expect(main.locator('.badge', { hasText: 'busy' })).toBeVisible()
  await expect(main.locator('.chip', { hasText: 'gpu' })).toBeVisible()

  await main.getByRole('tab', { name: 'Caches' }).click()
  await expect(main.getByText('3.0 GB in 3 caches')).toBeVisible()
  await expect(main.getByText('playwright-linux')).toBeVisible()
  await expect(main.getByText('2 caches · 2.0 GB')).toBeVisible()
})

test('a token without admin access gets an explanation instead of an error', async () => {
  ctx = await launch({ settings: WATCHING })
  const { page } = ctx
  await openSettings('acme/web')
  await expect(page.locator('.actions-admin').getByText(/won't show this repo's secrets to this token/)).toBeVisible()
  await expect(page.locator('.actions-admin .del')).toHaveCount(0)
})

test('a secret is sent encrypted, never as the value typed', async () => {
  ctx = await launch({ settings: WATCHING })
  const { page, gh } = ctx
  await openSettings('acme/api')
  const main = page.locator('.actions-admin')
  await main.getByRole('button', { name: 'New secret' }).click()
  await main.getByLabel('Name').fill('sentry dsn')
  await expect(main.getByLabel('Name')).toHaveValue('SENTRY_DSN')
  await main.getByLabel('Value').fill('super-secret-value')
  await main.getByRole('button', { name: 'Save' }).click()
  await expect.poll(() => gh.bodies.length).toBe(1)
  const { body } = gh.bodies[0] as { body: { encrypted_value: string; key_id: string } }
  expect(body.key_id).toBe('key-1')
  expect(JSON.stringify(gh.bodies)).not.toContain('super-secret-value')
  // A sealed box is the 32-byte ephemeral key, the message and a 16-byte tag.
  expect(Buffer.from(body.encrypted_value, 'base64')).toHaveLength(32 + 'super-secret-value'.length + 16)
  expectWrites([{ method: 'PUT', path: '/repos/acme/api/actions/secrets/SENTRY_DSN' }])
})

test('clearing the caches for a ref asks first, then deletes each of them', async () => {
  ctx = await launch({ settings: WATCHING })
  const { page } = ctx
  await openSettings('acme/api')
  const main = page.locator('.actions-admin')
  await main.getByRole('tab', { name: 'Caches' }).click()
  const row = main.locator('.row', { hasText: 'refs/pull/7/merge' }).filter({ hasText: '2 caches' })

  // Declining the confirmation changes nothing.
  page.once('dialog', (d) => void d.dismiss())
  await row.getByRole('button', { name: 'Delete all' }).click()
  await page.waitForTimeout(300)
  expect(ctx.gh.writes()).toEqual([])

  page.once('dialog', (d) => void d.accept())
  await row.getByRole('button', { name: 'Delete all' }).click()
  await expect(page.getByText('Deleted the caches for refs/pull/7/merge')).toBeVisible()
  expectWrites([
    { method: 'DELETE', path: '/repos/acme/api/actions/caches/2' },
    { method: 'DELETE', path: '/repos/acme/api/actions/caches/3' }
  ])
})
