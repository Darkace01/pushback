import { useEffect, useState } from 'react'
import { COLOR_LABELS, findTheme, FONT_CHOICES, THEMES, type ThemeColors, type ThemePreset } from '../../../shared/themes'
import { parseRepoInput } from '../../../shared/accounts'
import type { AccountInfo, NotifyRules, NotifySettings, RepoOption, UpdateStatus } from '../../../shared/types'
import { isSnoozed } from '../../../shared/notifyRules'
import { resolveEditor } from '../../../shared/defaults'
import { applyTemplate } from '../lib/dashboards'
import { useEditors } from '../lib/editors'
import { favoritesFirst } from '../../../shared/repos'
import { pinTab, setTabLayout } from '../lib/tabs'
import { api, toast, updateSettings, useSettings, useSnapshot, useUpdate } from '../lib/store'
import { useAppearance } from '../lib/theme'
import { closeModal, pushModal } from '../lib/ui'
import { Avatar, IconButton, Modal, Segmented } from './ui'

type Tab = 'account' | 'repos' | 'notify' | 'look' | 'advanced'

const NOTIFY_LABELS: [keyof NotifySettings, string][] = [
  ['runFailure', 'Workflow run failed or was cancelled'],
  ['runSuccess', 'Workflow run succeeded'],
  ['runStarted', 'Workflow run started'],
  ['prOpened', 'Pull request opened'],
  ['prClosed', 'Pull request merged or closed'],
  ['prReady', 'Draft marked ready for review'],
  ['reviewRequested', 'Review requested from me'],
  ['checksFailed', 'Checks failed on my pull request'],
  ['approvalRequested', 'A deployment is waiting for my approval'],
  ['onlyMine', 'Only notify about runs and PRs that are mine']
]

export function AccountSection() {
  const snapshot = useSnapshot()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async (value: string | null) => {
    setBusy(true)
    const r = await api.setToken(value)
    setBusy(false)
    if (r.ok) {
      setToken('')
      toast(value ? 'Signed in' : 'Token removed', 'ok')
    } else toast(`Sign-in failed: ${r.error}`, 'error')
  }
  return (
    <div className="stack">
      {snapshot.auth === 'ok' && snapshot.viewer ? (
        <div className="account">
          <Avatar src={snapshot.viewer.avatarUrl} login={snapshot.viewer.login} size={36} />
          <div>
            <div className="strong">{snapshot.viewer.login}</div>
            <div className="dim small">{snapshot.authSource === 'gh' ? 'Using your GitHub CLI login (gh auth token)' : 'Using a saved personal access token'}</div>
          </div>
          {snapshot.authSource === 'pat' && (
            <button className="btn btn-sm" disabled={busy} onClick={() => void save(null)}>
              Remove token
            </button>
          )}
        </div>
      ) : (
        <p className="dim">{snapshot.authError ?? 'Not signed in.'}</p>
      )}
      <p className="dim small">
        Pushback uses your <code>gh</code> CLI login automatically. To use a different account, paste a token with <code>repo</code> and <code>workflow</code>{' '}
        scopes (or a fine-grained token with Actions, Contents and Pull requests read/write). It's stored encrypted with your OS keychain.
      </p>
      <div className="inline">
        <input type="password" placeholder="ghp_… or github_pat_…" value={token} onChange={(e) => setToken(e.target.value)} />
        <button className="btn btn-primary" disabled={!token.trim() || busy} onClick={() => void save(token)}>
          {busy ? 'Checking…' : 'Save token'}
        </button>
      </div>
      <button className="link" onClick={() => void api.openExternal('https://github.com/settings/tokens/new?scopes=repo,workflow&description=Pushback')}>
        Create a token on GitHub →
      </button>
      <OtherAccounts />
    </div>
  )
}

/** GitHub Enterprise Server (and other) accounts. Their tokens go straight to the main process and are never shown again. */
function OtherAccounts() {
  const settings = useSettings()
  const [accounts, setAccounts] = useState<AccountInfo[]>([])
  const [form, setForm] = useState({ name: '', host: '', token: '' })
  const [busy, setBusy] = useState(false)
  // The settings change when an account is added or removed, which is when to ask again.
  useEffect(() => {
    api.listAccounts().then((a) => setAccounts(a), () => setAccounts([]))
  }, [settings.accounts, settings.activeAccount])

  const add = async () => {
    setBusy(true)
    const r = await api.addAccount(form)
    setBusy(false)
    if (r.ok) {
      setForm({ name: '', host: '', token: '' })
      toast(`Added ${form.name || form.host}`, 'ok')
    } else toast(`Couldn't add the account: ${r.error}`, 'error')
  }
  const remove = async (a: AccountInfo) => {
    const uses = Object.values(settings.repoAccounts).filter((id) => id === a.id).length
    if (!confirm(`Remove ${a.name} (${a.host})? Its saved token is deleted.${uses ? ` ${uses} tracked repo${uses === 1 ? '' : 's'} will stop updating.` : ''}`)) return
    const r = await api.removeAccount(a.id)
    if (!r.ok) toast(`Couldn't remove it: ${r.error}`, 'error')
  }

  return (
    <section className="stack" aria-label="Other accounts">
      <h3>Accounts</h3>
      <p className="dim small">
        Add another github.com login or a GitHub Enterprise Server host, then switch between accounts from the top bar. The dashboard shows the active account's
        repositories and inbox. Each account has its own token, stored encrypted with your OS keychain and never sent to the app's
        window. Use a token with <code>repo</code> and <code>workflow</code> scopes.
      </p>
      {accounts.map((a) => (
        <div key={a.id} className="account">
          <div>
            <div className="strong">
              {a.name} <span className="dim small mono">{a.host}</span>
            </div>
            <div className={`small ${a.status === 'ok' ? 'dim' : 'del'}`}>{a.status === 'ok' ? `Signed in as ${a.login}` : (a.error ?? 'Not signed in')}</div>
          </div>
          <span className="spacer" />
          {a.active ? (
            <span className="badge badge-ok">Active</span>
          ) : (
            <button className="btn btn-sm" disabled={a.status !== 'ok'} onClick={() => void api.setActiveAccount(a.primary ? 'primary' : a.id)}>
              Switch to
            </button>
          )}
          {!a.primary && (
            <button className="btn btn-sm" onClick={() => void remove(a)}>
              Remove
            </button>
          )}
        </div>
      ))}
      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
      >
        <input placeholder="Name (optional)" aria-label="Account name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="github.com or ghe.example.com" aria-label="Host" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
        <input type="password" placeholder="Token" aria-label="Token" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} />
        <button className="btn btn-primary" disabled={busy || !form.host.trim() || !form.token.trim()}>
          {busy ? 'Checking…' : 'Add account'}
        </button>
      </form>
    </section>
  )
}

export function ReposSection() {
  const settings = useSettings()
  const snapshot = useSnapshot()
  const [input, setInput] = useState('')
  const [mine, setMine] = useState<RepoOption[]>([])
  // Which account a plain owner/name belongs to and whose repos are suggested ('' is github.com).
  const [accountId, setAccountId] = useState(settings.activeAccount === 'primary' ? '' : settings.activeAccount)
  useEffect(() => {
    if (snapshot.auth === 'ok') api.listMyRepos(accountId || 'primary').then(setMine, () => setMine([]))
  }, [snapshot.auth, accountId, settings.accounts])

  const add = async (text: string) => {
    const parsed = parseRepoInput(text, settings.accounts, accountId || undefined)
    if ('error' in parsed) return toast(parsed.error, 'error')
    const name = parsed.repo
    if (settings.repos.includes(name)) return toast(`${name} is already tracked`)
    // The repo has to be routed to its account before it is tracked, so the first poll uses the right one.
    const r = await api.setRepoAccount(name, parsed.accountId ?? null)
    if (!r.ok) return toast(r.error ?? "Couldn't set the account", 'error')
    void updateSettings({ repos: [...settings.repos, name] })
    setInput('')
  }
  const accountName = (repo: string) => settings.accounts.find((a) => a.id === settings.repoAccounts[repo])?.name
  const remove = (repo: string) =>
    void updateSettings({ repos: settings.repos.filter((r) => r !== repo), favoriteRepos: settings.favoriteRepos.filter((r) => r !== repo) })
  // Starring lists a repo first everywhere (dashboard widgets and polling follow the repo order) and pins its tab.
  const toggleFavorite = (repo: string) => {
    const on = settings.favoriteRepos.includes(repo)
    const favoriteRepos = on ? settings.favoriteRepos.filter((r) => r !== repo) : [...settings.favoriteRepos, repo]
    void updateSettings({ favoriteRepos, repos: favoritesFirst(settings.repos, favoriteRepos) })
    if (!on) pinTab(repo)
  }
  const move = (repo: string, dir: -1 | 1) => {
    const list = [...settings.repos]
    const i = list.indexOf(repo)
    const j = i + dir
    if (j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    void updateSettings({ repos: list })
  }
  const suggestions = mine.filter((r) => !settings.repos.includes(r.fullName))

  return (
    <div className="stack">
      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault()
          void add(input)
        }}
      >
        {settings.accounts.length > 0 && (
          <select aria-label="Account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">GitHub (github.com)</option>
            {settings.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.host})
              </option>
            ))}
          </select>
        )}
        <input list="my-repos" placeholder="owner/name or GitHub URL" value={input} onChange={(e) => setInput(e.target.value)} autoFocus />
        <datalist id="my-repos">
          {suggestions.map((r) => (
            <option key={r.fullName} value={r.fullName}>
              {r.description ?? ''}
            </option>
          ))}
        </datalist>
        <button className="btn btn-primary" type="submit" disabled={!input.trim()}>
          Add
        </button>
        <button className="btn" type="button" title="Find clones of GitHub repos on this computer, link them and watch them" onClick={() => pushModal({ kind: 'find-clones' })}>
          Find on this computer…
        </button>
      </form>
      <ul className="repo-list">
        {settings.repos.map((repo) => (
          <li key={repo}>
            <button
              className="icon-btn"
              title={settings.favoriteRepos.includes(repo) ? 'Remove from favourites' : 'Favourite: list first and pin its tab'}
              aria-pressed={settings.favoriteRepos.includes(repo)}
              onClick={() => toggleFavorite(repo)}
            >
              {settings.favoriteRepos.includes(repo) ? '★' : '☆'}
            </button>
            <span className="mono">{repo}</span>
            {accountName(repo) && <span className="chip">{accountName(repo)}</span>}
            {snapshot.repos[repo]?.error && <span className="del small">{snapshot.repos[repo].error}</span>}
            <span className="spacer" />
            <button className="icon-btn" title="Move up" onClick={() => move(repo, -1)}>
              ↑
            </button>
            <button className="icon-btn" title="Move down" onClick={() => move(repo, 1)}>
              ↓
            </button>
            <IconButton icon="close" title="Stop tracking" onClick={() => remove(repo)} />
          </li>
        ))}
        {!settings.repos.length && <li className="dim">No repositories yet.</li>}
      </ul>
      {suggestions.length > 0 && (
        <>
          <h4 className="group-head">Recently pushed</h4>
          <div className="suggestions">
            {suggestions.slice(0, 12).map((r) => (
              <button key={r.fullName} className="chip chip-btn" onClick={() => add(r.fullName)} title={r.description ?? ''}>
                + {r.fullName}
                {r.private && ' 🔒'}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function NotifySection() {
  const settings = useSettings()
  return (
    <div className="stack">
      {NOTIFY_LABELS.map(([key, label]) => (
        <label key={key} className="check">
          <input type="checkbox" checked={settings.notify[key]} onChange={(e) => void updateSettings({ notify: { ...settings.notify, [key]: e.target.checked } })} />
          {label}
        </label>
      ))}
      <p className="dim small">Clicking a notification opens the run or pull request in Pushback. Bursts of more than three updates are grouped.</p>
      <NotifyRulesSection />
    </div>
  )
}

/** Hours until the next 08:00, for "Snooze until tomorrow". */
function untilTomorrowMorning(now: Date): number {
  const t = new Date(now)
  t.setHours(8, 0, 0, 0)
  if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1)
  return t.getTime()
}

function NotifyRulesSection() {
  const settings = useSettings()
  const rules = settings.notifyRules
  const now = new Date()
  const set = (patch: Partial<NotifyRules>) => void updateSettings({ notifyRules: { ...rules, ...patch } })
  const setQuiet = (patch: Partial<NotifyRules['quietHours']>) => set({ quietHours: { ...rules.quietHours, ...patch } })
  const toggleMuted = (repo: string, muted: boolean) =>
    set({ mutedRepos: muted ? [...rules.mutedRepos, repo] : rules.mutedRepos.filter((r) => r !== repo) })
  const snoozed = isSnoozed(rules, now)
  return (
    <>
      <h4 className="group-head">Quiet times</h4>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => set({ snoozedUntil: now.getTime() + 60 * 60 * 1000 })}>Snooze 1 hour</button>
        <button className="btn" onClick={() => set({ snoozedUntil: untilTomorrowMorning(now) })}>Until tomorrow 8:00</button>
        {snoozed && <button className="btn" onClick={() => set({ snoozedUntil: 0 })}>Resume now</button>}
      </div>
      <p className="dim small">
        {snoozed ? `Notifications are snoozed until ${new Date(rules.snoozedUntil).toLocaleString()}.` : 'Snoozing hides toasts only. Everything still appears in Activity.'}
      </p>
      <label className="check">
        <input type="checkbox" checked={rules.quietHours.enabled} onChange={(e) => setQuiet({ enabled: e.target.checked })} />
        No notifications during quiet hours
      </label>
      {rules.quietHours.enabled && (
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <input type="time" value={rules.quietHours.start} onChange={(e) => e.target.value && setQuiet({ start: e.target.value })} aria-label="Quiet hours start" />
          <span className="dim">to</span>
          <input type="time" value={rules.quietHours.end} onChange={(e) => e.target.value && setQuiet({ end: e.target.value })} aria-label="Quiet hours end" />
        </div>
      )}
      {settings.repos.length > 0 && (
        <>
          <h4 className="group-head">Mute repositories</h4>
          {settings.repos.map((repo) => (
            <label key={repo} className="check">
              <input type="checkbox" checked={rules.mutedRepos.includes(repo)} onChange={(e) => toggleMuted(repo, e.target.checked)} />
              {repo}
            </label>
          ))}
        </>
      )}
    </>
  )
}

function ThemeCard({ theme, selected, onPick }: { theme: ThemePreset; selected: boolean; onPick: () => void }) {
  const c = theme.colors
  return (
    <button className={`theme-card${selected ? ' on' : ''}`} onClick={onPick} aria-pressed={selected} title={theme.name}>
      <span className="theme-preview" style={{ background: c.bg, borderRadius: Math.min(theme.radius ?? 10, 8) }}>
        <span className="theme-panel" style={{ background: c.panel, borderColor: c.border }}>
          <span className="theme-line" style={{ background: c.text, width: '70%' }} />
          <span className="theme-line" style={{ background: c.dim, width: '45%' }} />
          <span className="theme-dots">
            {[c.ok, c.bad, c.warn, c.accent].map((color, i) => (
              <i key={i} style={{ background: color }} />
            ))}
          </span>
        </span>
      </span>
      <span className="theme-name" style={{ fontFamily: theme.font }}>
        {theme.name}
      </span>
    </button>
  )
}

function LookSection() {
  const settings = useSettings()
  const appearance = useAppearance()
  const [paletteMode, setPaletteMode] = useState<'dark' | 'light'>(appearance.mode)
  const preset = findTheme(paletteMode === 'dark' ? settings.darkTheme : settings.lightTheme, paletteMode)
  const overrides = settings.colorOverrides[paletteMode]

  const pick = (t: ThemePreset) => {
    setPaletteMode(t.mode)
    void updateSettings({
      ...(t.mode === 'dark' ? { darkTheme: t.id } : { lightTheme: t.id }),
      // Show the choice straight away unless the OS is in charge.
      ...(settings.mode === 'system' ? {} : { mode: t.mode })
    })
  }
  const setColor = (key: keyof ThemeColors, value: string | null) => {
    const next = { ...overrides }
    if (value === null) delete next[key]
    else next[key] = value
    void updateSettings({ colorOverrides: { ...settings.colorOverrides, [paletteMode]: next } })
  }

  return (
    <div className="stack">
      <div className="field">
        <span>Mode</span>
        <Segmented
          value={settings.mode}
          onChange={(mode) => void updateSettings({ mode })}
          options={[
            ['dark', '🌙 Dark'],
            ['light', '☀️ Light'],
            ['system', 'Match system']
          ]}
        />
      </div>
      {(['dark', 'light'] as const).map((mode) => (
        <div key={mode} className="field">
          <span>{mode === 'dark' ? 'Dark theme' : 'Light theme'}</span>
          <div className="theme-grid">
            {THEMES.filter((t) => t.mode === mode).map((t) => (
              <ThemeCard key={t.id} theme={t} selected={(mode === 'dark' ? settings.darkTheme : settings.lightTheme) === t.id} onPick={() => pick(t)} />
            ))}
          </div>
        </div>
      ))}

      <div className="field">
        <span>Customise colours</span>
        <div className="inline">
          <Segmented
            value={paletteMode}
            onChange={setPaletteMode}
            options={[
              ['dark', `Dark · ${findTheme(settings.darkTheme, 'dark').name}`],
              ['light', `Light · ${findTheme(settings.lightTheme, 'light').name}`]
            ]}
          />
          <span className="spacer" />
          {Object.keys(overrides).length > 0 && (
            <button className="btn btn-sm" onClick={() => void updateSettings({ colorOverrides: { ...settings.colorOverrides, [paletteMode]: {} } })}>
              Reset {paletteMode} colours
            </button>
          )}
        </div>
        <div className="color-grid">
          {COLOR_LABELS.map(([key, label]) => {
            const value = overrides[key] ?? preset.colors[key]
            return (
              <label key={key} className={`color-field${overrides[key] ? ' changed' : ''}`}>
                <input type="color" value={value} onChange={(e) => setColor(key, e.target.value)} />
                <span>{label}</span>
                {overrides[key] && (
                  <button className="link small" onClick={(e) => (e.preventDefault(), setColor(key, null))} title={`Back to ${preset.colors[key]}`}>
                    reset
                  </button>
                )}
              </label>
            )
          })}
        </div>
      </div>

      <div className="field">
        <span>Font</span>
        <div className="inline">
          <select value={settings.font} onChange={(e) => void updateSettings({ font: e.target.value })}>
            {FONT_CHOICES.map(([value, label]) => (
              <option key={value} value={value} style={value !== 'theme' && value !== 'custom' && value !== 'system' ? { fontFamily: value } : undefined}>
                {label}
              </option>
            ))}
          </select>
          {settings.font === 'custom' && (
            <input
              placeholder="Any installed font, e.g. Iosevka"
              value={settings.customFont}
              onChange={(e) => void updateSettings({ customFont: e.target.value })}
            />
          )}
        </div>
      </div>
      <label className="field">
        <span>Text size · {settings.fontSize}px</span>
        <input type="range" min={11} max={18} value={settings.fontSize} onChange={(e) => void updateSettings({ fontSize: Number(e.target.value) })} />
      </label>
      <div className="field">
        <span>Tabs</span>
        <Segmented
          value={settings.tabLayout}
          onChange={(layout) => setTabLayout(layout)}
          options={[
            ['horizontal', 'Across the top'],
            ['vertical', 'Down the side']
          ]}
        />
        <small>Vertical tabs live in the repo sidebar (Ctrl+B), with pinned repos as tiles at the top. Right-click any tab to pin it.</small>
      </div>
      <div className="field">
        <span>Density</span>
        <Segmented
          value={settings.density}
          onChange={(density) => void updateSettings({ density })}
          options={[
            ['comfortable', 'Comfortable'],
            ['compact', 'Compact']
          ]}
        />
      </div>
    </div>
  )
}

function UpdatesField() {
  const settings = useSettings()
  const update = useUpdate()
  const status: Record<UpdateStatus['state'], string> = {
    idle: '',
    checking: 'Checking…',
    none: "You're on the latest version.",
    available: update.canInstall ? `Version ${update.version} is available.` : `Version ${update.version} is available to download.`,
    downloading: `Downloading ${update.version}… ${update.percent ?? 0}%`,
    ready: `Version ${update.version} is ready. Restart to finish updating.`,
    error: `Couldn't check for updates: ${update.error}`,
    unsupported: 'Updates are only checked in installed builds.'
  }
  return (
    <div className="field">
      <span>Updates · version {update.current}</span>
      <label className="check">
        <input type="checkbox" checked={settings.autoUpdate} onChange={(e) => void updateSettings({ autoUpdate: e.target.checked })} />
        Check for updates automatically{update.canInstall ? ' and download them in the background' : ''}
      </label>
      <div className="inline">
        {update.state === 'ready' ? (
          <button className="btn btn-primary" onClick={() => void api.installUpdate()}>
            Restart and update
          </button>
        ) : update.state === 'available' && !update.canInstall ? (
          <button className="btn btn-primary" onClick={() => void api.openExternal(update.url!)}>
            Download {update.version}
          </button>
        ) : (
          <button className="btn" disabled={update.state === 'checking' || update.state === 'downloading' || update.state === 'unsupported'} onClick={() => void api.checkForUpdates()}>
            Check now
          </button>
        )}
        <span className={`small ${update.state === 'error' ? 'del' : 'dim'}`}>{status[update.state]}</span>
      </div>
    </div>
  )
}

const CUSTOM = '__custom'

/** Default editor/IDE: pick one found on this machine, or type any command that takes a folder. */
function EditorField() {
  const settings = useSettings()
  const editors = useEditors()
  const current = resolveEditor(settings.editorCommand, editors)
  const known = editors?.find((e) => e.command === current)
  const [custom, setCustom] = useState(false)
  const showInput = custom || (!!editors && !known)
  return (
    <div className="field">
      <span>Default editor / IDE</span>
      <select
        value={showInput ? CUSTOM : (known?.command ?? '')}
        disabled={!editors}
        onChange={(e) => {
          if (e.target.value === CUSTOM) return setCustom(true)
          setCustom(false)
          void updateSettings({ editorCommand: e.target.value })
        }}
      >
        {!editors && <option value="">Looking for installed editors…</option>}
        {editors?.map((e) => (
          <option key={e.id} value={e.command}>
            {e.name}
          </option>
        ))}
        <option value={CUSTOM}>Custom command…</option>
      </select>
      {showInput && (
        <input value={settings.editorCommand} placeholder="e.g. code, nvim-qt, /path/to/editor" onChange={(e) => void updateSettings({ editorCommand: e.target.value })} />
      )}
      <small>
        Used by “Open in …” on a repo's Working copy, with the folder as the argument.
        {editors && !editors.length && ' No known editors were found, so enter the command that starts yours.'}
      </small>
    </div>
  )
}

function AdvancedSection() {
  const settings = useSettings()
  const [json, setJson] = useState('')
  return (
    <div className="stack">
      <UpdatesField />
      <label className="field">
        <span>Poll every (seconds)</span>
        <input type="number" min={15} max={3600} value={settings.pollSeconds} onChange={(e) => void updateSettings({ pollSeconds: Math.max(15, Number(e.target.value)) })} />
      </label>
      <label className="field">
        <span>While runs are active, poll every (seconds)</span>
        <input
          type="number"
          min={5}
          max={600}
          value={settings.activePollSeconds}
          onChange={(e) => void updateSettings({ activePollSeconds: Math.max(5, Number(e.target.value)) })}
        />
      </label>
      <p className="dim small">Unchanged data costs nothing: Pushback uses ETag requests, which GitHub doesn't count against your rate limit.</p>
      <EditorField />
      <div className="field">
        <span>Walkthrough</span>
        <div className="inline">
          <button className="btn btn-sm" onClick={() => (closeModal(), void updateSettings({ tourDone: false }))}>
            Take the tour again
          </button>
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={settings.closeToTray} onChange={(e) => void updateSettings({ closeToTray: e.target.checked })} />
        Keep running in the tray when the window is closed (so notifications keep coming)
      </label>
      <label className="check">
        <input type="checkbox" checked={settings.launchAtLogin} onChange={(e) => void updateSettings({ launchAtLogin: e.target.checked })} />
        Start Pushback when I sign in to my computer
      </label>
      {settings.launchAtLogin && (
        <label className="check">
          <input type="checkbox" checked={settings.startInTray} onChange={(e) => void updateSettings({ startInTray: e.target.checked })} />
          Start in the tray without opening the window
        </label>
      )}
      <div className="field">
        <span>Configuration</span>
        <div className="inline">
          <button
            className="btn"
            onClick={async () => {
              await navigator.clipboard.writeText(await api.exportSettings())
              toast('Settings copied to clipboard', 'ok')
            }}
          >
            Copy settings JSON
          </button>
          <button
            className="btn"
            onClick={() => {
              applyTemplate('overview')
              toast('Dashboard reset to the Overview layout', 'ok')
            }}
          >
            Reset this dashboard
          </button>
        </div>
        <textarea rows={4} placeholder="Paste settings JSON to import…" value={json} onChange={(e) => setJson(e.target.value)} />
        <button
          className="btn"
          disabled={!json.trim()}
          onClick={async () => {
            const r = await api.importSettings(json)
            toast(r.ok ? 'Settings imported' : `Import failed: ${r.error}`, r.ok ? 'ok' : 'error')
            if (r.ok) setJson('')
          }}
        >
          Import
        </button>
      </div>
    </div>
  )
}

export function SettingsModal() {
  const settings = useSettings()
  const [tab, setTab] = useState<Tab>(settings.repos.length ? 'notify' : 'repos')
  return (
    <Modal title="Settings" onClose={closeModal} width={680}>
      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          ['account', 'Account'],
          ['repos', 'Repositories'],
          ['notify', 'Notifications'],
          ['look', 'Appearance'],
          ['advanced', 'Advanced']
        ]}
      />
      <div className="settings-body">
        {tab === 'account' && <AccountSection />}
        {tab === 'repos' && <ReposSection />}
        {tab === 'notify' && <NotifySection />}
        {tab === 'look' && <LookSection />}
        {tab === 'advanced' && <AdvancedSection />}
      </div>
    </Modal>
  )
}
