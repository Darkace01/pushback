import { DEFAULT_DARK, DEFAULT_LIGHT } from './themes'
import type { EditorOption, LayoutItem, Settings, WidgetConfig, WidgetType } from './types'

export const WIDGET_DEFAULTS: Record<WidgetType, { title: string; w: number; h: number; options: WidgetConfig['options'] }> = {
  summary: { title: 'Repositories', w: 12, h: 3, options: {} },
  runs: { title: 'Workflow runs', w: 7, h: 9, options: { filter: 'all', branch: '', limit: 30 } },
  prs: { title: 'Pull requests', w: 5, h: 9, options: { filter: 'all', hideDrafts: false } },
  workflows: { title: 'Run a workflow', w: 5, h: 7, options: { dispatchableOnly: true } },
  events: { title: 'Activity', w: 7, h: 7, options: { unreadOnly: false } },
  inbox: { title: 'My work', w: 5, h: 8, options: { tab: 'reviewRequests' } },
  insights: { title: 'CI insights', w: 7, h: 8, options: {} },
  deployments: { title: 'Deployments', w: 12, h: 8, options: { view: 'environments' } },
  security: { title: 'Security alerts', w: 6, h: 8, options: { view: 'alerts', kind: '', severity: '' } },
  packages: { title: 'Packages', w: 6, h: 8, options: { scope: 'user', org: '', type: '', visibility: '' } },
  cihealth: { title: 'CI health', w: 12, h: 9, options: { view: 'failing', days: 14, branch: '' } },
  search: { title: 'Saved search', w: 6, h: 9, options: { query: 'is:open author:@me archived:false', kind: 'pr', author: '', label: '', repo: '', milestone: '', hideDrafts: false } }
}

const widgets: WidgetConfig[] = [
  { id: 'w-summary', type: 'summary', repos: [], options: { ...WIDGET_DEFAULTS.summary.options } },
  { id: 'w-runs', type: 'runs', repos: [], options: { ...WIDGET_DEFAULTS.runs.options } },
  { id: 'w-prs', type: 'prs', repos: [], options: { ...WIDGET_DEFAULTS.prs.options } },
  { id: 'w-workflows', type: 'workflows', repos: [], options: { ...WIDGET_DEFAULTS.workflows.options } },
  { id: 'w-events', type: 'events', repos: [], options: { ...WIDGET_DEFAULTS.events.options } },
  { id: 'w-inbox', type: 'inbox', repos: [], options: { ...WIDGET_DEFAULTS.inbox.options } },
  { id: 'w-insights', type: 'insights', repos: [], options: { ...WIDGET_DEFAULTS.insights.options } }
]

const layout: LayoutItem[] = [
  { i: 'w-summary', x: 0, y: 0, w: 12, h: 3 },
  { i: 'w-runs', x: 0, y: 3, w: 7, h: 9 },
  { i: 'w-prs', x: 7, y: 3, w: 5, h: 9 },
  { i: 'w-workflows', x: 0, y: 12, w: 5, h: 7 },
  { i: 'w-events', x: 5, y: 12, w: 7, h: 7 },
  { i: 'w-inbox', x: 0, y: 19, w: 5, h: 8 },
  { i: 'w-insights', x: 5, y: 19, w: 7, h: 8 }
]

export const DEFAULT_SETTINGS: Settings = {
  repos: [],
  pollSeconds: 60,
  activePollSeconds: 10,
  notify: {
    runStarted: false,
    runSuccess: true,
    runFailure: true,
    prOpened: true,
    prClosed: true,
    prReady: true,
    reviewRequested: true,
    checksFailed: true,
    approvalRequested: true,
    onlyMine: false
  },
  notifyRules: { quietHours: { enabled: false, start: '22:00', end: '08:00' }, snoozedUntil: 0, mutedRepos: [] },
  mode: 'dark',
  darkTheme: DEFAULT_DARK,
  lightTheme: DEFAULT_LIGHT,
  colorOverrides: { dark: {}, light: {} },
  font: 'theme',
  customFont: '',
  fontSize: 13,
  density: 'comfortable',
  closeToTray: true,
  launchAtLogin: false,
  startInTray: true,
  autoUpdate: true,
  widgets,
  layout,
  dashboards: [{ id: 'main', name: 'Main', widgets, layout }],
  activeDashboard: 'main',
  openTabs: [],
  favoriteRepos: [],
  pinnedTabs: [],
  activeTab: 'home',
  tabLayout: 'vertical',
  sidebarOpen: true,
  uiVersion: 1,
  tourDone: false,
  localPaths: {},
  editorCommand: 'code',
  autoLinkClones: false,
  accounts: [],
  repoAccounts: {},
  activeAccount: 'primary',
  savedSearches: []
}

/**
 * The editor command to run. If the user never changed the default (`code`) and VS Code isn't installed,
 * use the first editor that is, so "Open in" works out of the box with Cursor, Insiders, Zed and the like.
 */
export function resolveEditor(command: string, installed: EditorOption[] | undefined): string {
  const cmd = command.trim() || 'code'
  if (cmd !== 'code' || !installed?.length || installed.some((e) => e.command === 'code')) return cmd
  return installed[0].command
}
