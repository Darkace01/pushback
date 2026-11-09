import sodium from 'libsodium-wrappers'
import { describe, expect, it } from 'vitest'
import { actionsAdmin, actionsAdminAct, mapCaches, mapRunners, sealSecret, unavailableReason } from '../../src/main/actionsAdmin'
import { GitHubError, type GitHub } from '../../src/main/github'
import { actionsNameError, cachesByRef, formatBytes } from '../../src/shared/actionsAdmin'
import type { ActionsCache } from '../../src/shared/types'

/** A fake client: `answer` serves GETs, and every write is recorded (or fails, when `fail` says so). */
function fakeGh(answer: (path: string) => unknown, fail?: (path: string) => Error | undefined) {
  const sent: { method: string; path: string; body?: unknown }[] = []
  const gh = {
    get: async (path: string) => answer(path),
    send: async (method: string, path: string, body?: unknown) => {
      const err = fail?.(path)
      if (err) throw err
      sent.push({ method, path, body })
      return null
    }
  } as unknown as GitHub
  return { gh, sent }
}

const throws = (err: Error) => () => {
  throw err
}

const cache = (id: number, ref: string, size: number): ActionsCache => ({ id, key: `k${id}`, ref, size, lastUsedAt: 'l', createdAt: 'c' })
const b64 = (bytes: Uint8Array) => sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL)
const unb64 = (text: string) => sodium.from_base64(text, sodium.base64_variants.ORIGINAL)

describe('actionsNameError', () => {
  it('accepts GitHub-style names', () => {
    for (const n of ['NPM_TOKEN', '_X', 'a1', 'Deploy_Key_2']) expect(actionsNameError(n)).toBeUndefined()
  })
  it('explains what is wrong with a name', () => {
    expect(actionsNameError('')).toMatch(/Enter a name/)
    expect(actionsNameError('MY-TOKEN')).toMatch(/letters, digits and underscores/)
    expect(actionsNameError('../x')).toMatch(/letters/)
    expect(actionsNameError('1ST')).toMatch(/digit/)
    expect(actionsNameError('github_token')).toMatch(/GITHUB_/)
    expect(actionsNameError('A'.repeat(256))).toMatch(/255/)
  })
})

describe('cachesByRef and formatBytes', () => {
  it('groups caches by ref, biggest first', () => {
    expect(cachesByRef([cache(1, 'main', 10), cache(2, 'pr', 30), cache(3, 'main', 5), cache(4, 'pr', 1)])).toEqual([
      { ref: 'pr', count: 2, size: 31 },
      { ref: 'main', count: 2, size: 15 }
    ])
  })
  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(20 * 1024 * 1024)).toBe('20 MB')
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB')
  })
})

describe('mapping', () => {
  it('maps runners, treating anything but online as offline', () => {
    expect(
      mapRunners([
        { id: 1, name: 'r', os: 'Linux', status: 'online', busy: true, labels: [{ name: 'gpu' }] },
        { id: 2, name: 's', os: 'macOS', status: 'idle', busy: false, labels: [] }
      ])
    ).toEqual([
      { id: 1, name: 'r', os: 'Linux', status: 'online', busy: true, labels: ['gpu'] },
      { id: 2, name: 's', os: 'macOS', status: 'offline', busy: false, labels: [] }
    ])
  })
  it('maps caches', () => {
    expect(mapCaches([{ id: 9, key: 'k9', ref: 'refs/heads/main', size_in_bytes: 4, last_accessed_at: 'l', created_at: 'c' }])).toEqual([cache(9, 'refs/heads/main', 4)])
  })
})

describe('actionsAdmin (listing)', () => {
  it('lists secret names and asks for nothing else', async () => {
    const paths: string[] = []
    const { gh } = fakeGh((p) => (paths.push(p), { total_count: 1, secrets: [{ name: 'NPM_TOKEN', created_at: 'c', updated_at: 'u' }] }))
    expect(await actionsAdmin(gh, 'o/r', 'secrets')).toEqual({ items: [{ name: 'NPM_TOKEN', createdAt: 'c', updatedAt: 'u' }], total: 1 })
    expect(paths).toEqual(['/repos/o/r/actions/secrets?per_page=100&page=1'])
  })
  it('pages through variables 30 at a time', async () => {
    const vars = Array.from({ length: 45 }, (_, i) => ({ name: `V${i}`, value: String(i), created_at: 'c', updated_at: 'u' }))
    const { gh } = fakeGh((p) => {
      const page = Number(p.match(/page=(\d+)$/)![1])
      return { total_count: 45, variables: vars.slice((page - 1) * 30, page * 30) }
    })
    const r = await actionsAdmin(gh, 'o/r', 'variables')
    expect(r.items).toHaveLength(45)
    expect(r.items[44]).toEqual({ name: 'V44', value: '44', createdAt: 'c', updatedAt: 'u' })
  })
  it('turns a 403 or 404 into an explanation, and lets other errors through', async () => {
    const refused = await actionsAdmin(fakeGh(throws(new GitHubError('Forbidden', 403))).gh, 'o/r', 'runners')
    expect(refused).toMatchObject({ items: [], total: 0 })
    expect(refused.unavailable).toMatch(/Administration permission/)
    const caches = await actionsAdmin(fakeGh(throws(new GitHubError('Not Found', 404))).gh, 'o/r', 'caches')
    expect(caches).toMatchObject({ items: [], usageBytes: 0, usageCount: 0 })
    expect(caches.unavailable).toMatch(/Actions permission/)
    await expect(actionsAdmin(fakeGh(throws(new GitHubError('Server error', 500))).gh, 'o/r', 'secrets')).rejects.toThrow('Server error')
    expect(unavailableReason('secrets', new Error('network'))).toBeUndefined()
  })
  it('takes cache totals from the usage endpoint, falling back to the list', async () => {
    const list = { total_count: 1, actions_caches: [{ id: 1, key: 'k', ref: 'main', size_in_bytes: 100, last_accessed_at: 'l', created_at: 'c' }] }
    const withUsage = fakeGh((p) => (p.includes('/cache/usage') ? { active_caches_size_in_bytes: 5000, active_caches_count: 7 } : list))
    expect(await actionsAdmin(withUsage.gh, 'o/r', 'caches')).toMatchObject({ usageBytes: 5000, usageCount: 7, total: 1 })
    const without = fakeGh((p) => (p.includes('/cache/usage') ? throws(new Error('nope'))() : list))
    expect(await actionsAdmin(without.gh, 'o/r', 'caches')).toMatchObject({ usageBytes: 100, usageCount: 1 })
  })
})

describe('sealSecret', () => {
  it('makes a sealed box only the repo key can open, different every time', async () => {
    await sodium.ready
    const pair = sodium.crypto_box_keypair()
    const sealed = await sealSecret('hunter2', b64(pair.publicKey))
    expect(sodium.to_string(sodium.crypto_box_seal_open(unb64(sealed), pair.publicKey, pair.privateKey))).toBe('hunter2')
    // A fresh ephemeral key each time: the same value never encrypts the same way twice.
    expect(await sealSecret('hunter2', b64(pair.publicKey))).not.toBe(sealed)
  })
})

describe('actionsAdminAct (writes)', () => {
  it('encrypts a secret with the repo key before sending it', async () => {
    await sodium.ready
    const pair = sodium.crypto_box_keypair()
    const { gh, sent } = fakeGh(() => ({ key_id: 'kid', key: b64(pair.publicKey) }))
    expect(await actionsAdminAct(gh, 'o/r', { kind: 'set-secret', name: 'NPM_TOKEN', value: 'abc-plain' })).toEqual({ ok: true })
    expect(sent).toHaveLength(1)
    const { method, path, body } = sent[0] as { method: string; path: string; body: { encrypted_value: string; key_id: string } }
    expect([method, path, body.key_id]).toEqual(['PUT', '/repos/o/r/actions/secrets/NPM_TOKEN', 'kid'])
    expect(JSON.stringify(body)).not.toContain('abc-plain')
    expect(sodium.to_string(sodium.crypto_box_seal_open(unb64(body.encrypted_value), pair.publicKey, pair.privateKey))).toBe('abc-plain')
  })
  it('creates, renames and deletes variables, and deletes secrets and caches', async () => {
    const { gh, sent } = fakeGh(() => ({}))
    await actionsAdminAct(gh, 'o/r', { kind: 'set-variable', name: 'A', value: '1' })
    await actionsAdminAct(gh, 'o/r', { kind: 'set-variable', name: 'B', value: '2', existing: 'A' })
    await actionsAdminAct(gh, 'o/r', { kind: 'delete-variable', name: 'B' })
    await actionsAdminAct(gh, 'o/r', { kind: 'delete-secret', name: 'S' })
    await actionsAdminAct(gh, 'o/r', { kind: 'delete-cache', id: 42 })
    expect(sent).toEqual([
      { method: 'POST', path: '/repos/o/r/actions/variables', body: { name: 'A', value: '1' } },
      { method: 'PATCH', path: '/repos/o/r/actions/variables/A', body: { name: 'B', value: '2' } },
      { method: 'DELETE', path: '/repos/o/r/actions/variables/B', body: undefined },
      { method: 'DELETE', path: '/repos/o/r/actions/secrets/S', body: undefined },
      { method: 'DELETE', path: '/repos/o/r/actions/caches/42', body: undefined }
    ])
  })
  it('refuses bad names, cache ids and refs before anything reaches a URL', async () => {
    const { gh, sent } = fakeGh(() => ({}))
    await expect(actionsAdminAct(gh, 'o/r', { kind: 'delete-secret', name: '../../hooks' })).rejects.toThrow(/letters/)
    await expect(actionsAdminAct(gh, 'o/r', { kind: 'set-variable', name: 'OK', value: '', existing: 'a/b' })).rejects.toThrow(/letters/)
    await expect(actionsAdminAct(gh, 'o/r', { kind: 'delete-cache', id: -1 })).rejects.toThrow(/cache id/)
    await expect(actionsAdminAct(gh, 'o/r', { kind: 'delete-caches-for-ref', ref: 'a b' })).rejects.toThrow(/ref/)
    expect(sent).toEqual([])
  })
  it('deletes every cache of a ref and reports partial failures', async () => {
    const list = (ref: string) => ({ total_count: 2, actions_caches: [1, 2].map((id) => ({ id, key: 'k', ref, size_in_bytes: 1, last_accessed_at: 'l', created_at: 'c' })) })
    const paths: string[] = []
    const ok = fakeGh((p) => (paths.push(p), list('refs/pull/7/merge')))
    expect(await actionsAdminAct(ok.gh, 'o/r', { kind: 'delete-caches-for-ref', ref: 'refs/pull/7/merge' })).toEqual({ ok: true, number: 2 })
    expect(paths[0]).toContain('ref=refs%2Fpull%2F7%2Fmerge')
    expect(ok.sent.map((s) => s.path).sort()).toEqual(['/repos/o/r/actions/caches/1', '/repos/o/r/actions/caches/2'])
    const partly = fakeGh(() => list('main'), (p) => (p.endsWith('/2') ? new GitHubError('Gone', 404) : undefined))
    const r = await actionsAdminAct(partly.gh, 'o/r', { kind: 'delete-caches-for-ref', ref: 'main' })
    expect(r).toMatchObject({ ok: false, number: 1 })
    expect(r.error).toMatch(/Deleted 1 of 2 caches: Gone/)
  })
})
