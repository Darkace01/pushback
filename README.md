<p align="center">
  <img src="build/icon.png" width="96" alt="Pushback icon" />
</p>

<h1 align="center">Pushback</h1>

<p align="center">
  A fast, customizable desktop dashboard for the GitHub repos you work on.<br />
  Watch Actions runs and pull requests, launch workflows, and get notified the moment something lands or breaks.
</p>

<p align="center">
  <a href="https://github.com/Darkace01/pushback/releases/latest"><img src="https://img.shields.io/github/v/release/Darkace01/pushback?label=download" alt="Latest release" /></a>
  <a href="https://github.com/Darkace01/pushback/actions/workflows/ci.yml"><img src="https://github.com/Darkace01/pushback/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-informational" alt="Platforms" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT license" /></a>
</p>

---

**Website and downloads:** https://darkace01.github.io/pushback/

## Features

- **Multiple dashboards** for different jobs (CI watching, code review, releases), started from ready-made templates or from scratch, and switched with `Ctrl/⌘+1…9`.
- **A dashboard of widgets** you can drag, resize, duplicate and scope to particular repos: repo health, workflow runs, pull requests, run-a-workflow, an activity feed, a "My work" inbox (review requests, your PRs, issues assigned to you across all of GitHub, deployments waiting for your approval and GitHub's own notifications) and CI insights (pass rate, average duration, recent outcomes).
- **GitHub Actions**: start `workflow_dispatch` workflows with their inputs, cancel runs, and re-run failed jobs or whole runs. Open a run to watch its jobs and steps live (or on a timeline), read a failed job's log, which opens at the error, download its artifacts, and approve or reject deployments waiting for review. **Watch** a run to pin it to a small always-on-top window. Each repo has **Actions settings** for secrets, variables, self-hosted runners and caches, and a workflow file viewer that explains why a workflow didn't run.
- **Deployments dashboard, Octopus-style**: see which release is live in every environment for each project, which version each **client** runs at each stage (from environment names like `prod-acme` or `staging-acme`), and a filterable history of every deployment with its outcome, duration and who ran it. Deploy runs are labelled with where they deployed to.
- **Pull requests, in the app**: open any PR in a side panel, next to the repo's details, live deployments and its other open PRs. Read its description and conversation, see its commits and checks, browse the changed files as a diff with **line comments** (reply, resolve, suggest changes), request reviewers, see the merge queue, and comment, approve or merge (squash, merge or rebase), all without leaving Pushback. Every view has an **Open in browser** button for when you want GitHub itself.
- **A tab for each repo**: open any repo, from your account or anywhere on GitHub, in its own tab, and switch with a click or `Ctrl+Tab`. Tabs run across the top or down a sidebar, and you can **pin** the repos you use most. A toggleable sidebar (`Ctrl/⌘+B`) keeps every watched repo one click away. Each repo tab is a full workspace with its README, PRs, runs, workflows and insights.
- **GitHub tools**: browse, read, comment on, create and close **issues**; see **branches** with how far each is ahead of or behind the default branch, and create, delete or open a PR from them; browse **commits**; read and publish **releases** with generated notes; open **new pull requests** from any branch; track **milestones** and **Projects** status; and read and join **discussions**.
- **Local git tools**: find every GitHub clone on your computer in one go (or link or clone repos one at a time) to see changes with diffs, stage, commit, stash, switch, merge, rebase and create branches, fetch, pull and push, and open it in your editor or a terminal.
- **Git history tools**: a **commit graph** with branch lines, labels and commit details (cherry-pick, revert, reset, branch or tag from any commit); **file history** and **blame** with an age heatmap; **compare** any two branches or tags; **search** commits by message, author, SHA, file or code change; plus **stashes**, **tags**, **remotes**, **worktrees** and **contributors**.
- **Desktop notifications** when runs fail, succeed or start; when PRs are opened, merged, closed or marked ready; when your review is requested; when checks fail on your PRs; and when a deployment is waiting for your approval. Each type can be switched off, "only mine" limits them to your own activity, and what quiet hours hold back can arrive as one digest afterwards (or once a day). Pushback keeps running in the tray so you don't miss any.
- **Fast and cheap on your rate limit**: it polls with ETag requests, which GitHub doesn't count against your limit when nothing changed, and polls faster while runs are active.
- **Command palette** (`Ctrl/⌘+K`) to jump to any PR, run, workflow, repo, theme or command.
- **Themes**: dark, light or follow the OS. Presets include GitHub Dark/Light (the defaults), Terminal, Amber CRT, Atom One Dark/Light, Dracula, Synthwave '84, Monokai, Nord, Tokyo Night, Catppuccin, Gruvbox, Solarized, Rosé Pine Dawn and Paper. You can override any colour and choose the font and text size.
- **Auto-updates** from GitHub Releases.
- **Portable config**: export and import all your settings as JSON.

## Install

### With a package manager

**Windows** ([winget](https://learn.microsoft.com/windows/package-manager/winget/)):

```powershell
winget install Darkace01.Pushback
```

**macOS** ([Homebrew](https://brew.sh)):

```bash
brew install --cask darkace01/tap/pushback
```

Upgrade later with `winget upgrade Darkace01.Pushback` or `brew upgrade --cask pushback`. The app's own updater works too.

### Or download an installer

Download the file for your system from the [latest release](https://github.com/Darkace01/pushback/releases/latest).

| System | File | How to install |
| --- | --- | --- |
| Windows 10/11 | `Pushback-x.y.z-win-x64.exe` | Run it and follow the installer. |
| macOS (Apple silicon) | `Pushback-x.y.z-mac-arm64.dmg` | Open it and drag Pushback into Applications. |
| macOS (Intel) | `Pushback-x.y.z-mac-x64.dmg` | Same as above. |
| Linux (any distro) | `Pushback-x.y.z-linux-x86_64.AppImage` | `chmod +x Pushback-*.AppImage`, then run it. |
| Debian / Ubuntu | `Pushback-x.y.z-linux-amd64.deb` | `sudo apt install ./Pushback-*.deb` |

> **Heads-up: the builds aren't code-signed yet**, so your OS will warn you the first time you open one.
>
> - **Windows**: SmartScreen says "Windows protected your PC". Click **More info → Run anyway**.
> - **macOS**: Gatekeeper says the app "can't be opened". (The Homebrew cask clears this for you.) Right-click Pushback in Applications and choose **Open**, then **Open** again. If macOS says the app is damaged, run `xattr -cr /Applications/Pushback.app` once.

### Updates

Pushback checks for new versions on startup and every few hours. You can turn this off, or check by hand, in **Settings → Advanced → Updates**.

- **Windows and AppImage** download updates in the background. When an update is ready, a **Restart to update** button appears in the top bar. If you don't click it, the update installs the next time you quit.
- **macOS and .deb** tell you a new version is out and link to the download. macOS can only self-update signed apps, and `.deb` installs are managed by your package manager.

## Getting started

### Finding your way around

Everything you open (a PR, an issue, a workflow run) opens as a page, inside the dashboard or repo tab you opened it from. The **breadcrumbs** above the content show where you are, for example *Main › owner/repo › #42 Fix login* or *owner/repo › Pull requests › #42 Fix login*, along with how many levels deep you are. Click any crumb to go back up to it, or press `Esc` (or **←**) to go back one level. Inside a repo tab, the repo's sections stay on the left while you look at a page.

The first time you open Pushback, a short **walkthrough** points out each part of the app. Replay it any time with **Take the tour** in the command palette, or from **Settings → Advanced**.

### 1. Connect to GitHub

Pushback needs a GitHub token. Use either of these:

- **The GitHub CLI (easiest).** If you've run `gh auth login`, Pushback uses that login automatically.
- **A personal access token.** Create a [classic token](https://github.com/settings/tokens/new?scopes=repo,workflow&description=Pushback) with the `repo` and `workflow` scopes and paste it into **Settings → Account**. It's stored encrypted with your OS keychain, never in plain text.

The token never leaves your machine except to talk to `api.github.com`.

### 2. Pick repositories

Choose the repos to watch from the list of repos you own or collaborate on, or type any `owner/name`, including public repos you don't own. You can change the list any time in **Settings → Repositories**.

### 3. Shape your dashboard

Press **`E`** (or click the grid icon) to edit the layout:

- **Move** a widget by dragging its header, and **resize** it from the bottom-right corner.
- **Add** a widget with **+ Add widget**. You can add the same type more than once, for example one Runs widget per team.
- Click a widget's **⚙** to rename it, limit it to certain repos, or set its options (status filter, branch, hide drafts and so on).
- Use the **🔍** in any widget header to filter its rows as you type.
- Click the **funnel** in a widget header for its filters: which repos, and depending on the widget the branch, workflow, trigger, who started it, author, label, activity type, environment or outcome. They apply as you choose them and are saved with the widget; a number on the funnel shows how many are set, and **Clear** resets them. Repo sections built from widgets (PRs, Runs, Workflows, Insights, Deployments) have the same filter bar.

Press `E` or `Esc` when you're done. The layout saves automatically.

### 4. Set up more dashboards

Your dashboards are tabs next to the logo: click one to switch (or press `Ctrl/⌘+K` and type `dashboard`). The first five show as tabs; the **▾** menu holds the rest, plus **New dashboard…** and **Manage dashboards…**. Each dashboard keeps its own widgets and layout. Start from a template:

| Template | What's on it |
| --- | --- |
| **Overview** | A bit of everything: repo health, runs, PRs, workflows, activity, your inbox and insights. |
| **CI monitor** | Runs in progress, failed runs, pass rates per workflow and the activity feed. |
| **Code review** | Reviews waiting on you, your own PRs and PRs with failing checks. |
| **Release manager** | Workflows to trigger, the latest run of each workflow and CI insights. |
| **Focus** | Repo health, your inbox and the activity feed. |
| **Blank** | Nothing yet: add your own widgets. |

You can also start from a copy of an existing dashboard. **Manage dashboards…** lets you rename, reorder, duplicate and delete them. `Ctrl/⌘+1` to `9` jumps straight to a dashboard.

### 5. Work with Actions

- **Run a workflow**: click **Run** in the *Run a workflow* widget. Pick a branch or tag, fill in the inputs (text, number, choice and checkbox inputs are all supported) and start it. The run appears within seconds.
- **Inspect a run**: click any run to see its jobs and steps update live. Click **Log** on a job to read its output; failed logs open at the first error.
- **Cancel or re-run** from the run row or the run window. *Re-run failed jobs* only repeats what broke.

### 6. Track deployments

Pushback reads the deployments GitHub records whenever an Actions job with an `environment:` runs, so deploy workflows show up with no setup. Add the **Deployments** widget (or start a dashboard from the **Deployments** template), or open a repo's **Deployments** section:

- **Environments**: projects down the side, environments across the top (dev → prod). Each cell shows the live release (its tag, or the commit if it isn't tagged), how long ago and who deployed it. A failed or in-progress attempt shows beneath it.
- **Clients**: environment names are split into a stage and a client, so `prod-acme`, `staging-acme` and `Acme` are all the client *Acme*, and `dev` or `Production` are shared stages. Each client gets a row with its version at every stage.
- **History**: every deployment, newest first, with its environment, client, version, outcome, duration and who ran it.

Click any deployment to open the run that made it. Runs that deployed something are labelled with their target (for example **⇢ prod-acme**), and a run's details list where it deployed to. Deployments refresh every 90 seconds while you're looking at them.

### 7. Review pull requests

The *Pull requests* widget shows checks (✓ ✗ ●), review state, labels and diff size. **Click a PR to open it in Pushback**:

- **Conversation**: the description, reviews and comments. You can also leave a comment, and `Ctrl+Enter` sends it.
- **Commits**, **Checks** (failures first) and **Files**, which shows each changed file as a diff.
- **Approve** and **Merge…** (you choose squash, merge or rebase, then confirm). Branch protection still applies, so GitHub refuses merges that are missing required checks or reviews, and Pushback shows its reason.
- **Open in browser** when you need GitHub itself.

Links inside descriptions and READMEs that point to PRs, issues, runs or repos also open in the app (repos open in a tab). Views stack, so closing a PR you opened from another PR takes you back to it.

### 8. Work in repo tabs

Click a repo tile, a repo link, or the **+** at the end of the tab bar to open a repo in its own tab. The **+** button opens a dropdown with a search box at the top. It lists the repos you watch and every repo on your account (search as you type). It also opens any `owner/name` or GitHub URL, including public repos you don't own. Drag tabs to reorder them, close them with **×** or a middle-click, and cycle through them with `Ctrl+Tab` / `Ctrl+Shift+Tab`. Open tabs come back when you restart.

**Vertical tabs, pinning and the sidebar.** Tabs run down a sidebar on the left by default, with every repo you watch listed below them, one click away. `Ctrl/⌘+B` (or the sidebar button at the top left) hides or shows it. Prefer tabs across the top? Choose **Across the top** under **Settings → Appearance → Tabs** (or click the tabs icon in the sidebar's footer). Right-click any tab to **Pin** it, or drag it onto the pinned area. Pinned repos sit at the top of the sidebar as tiles, each with its own colour, its owner's avatar and a CI-status dot. They stay open and come first in the tab order. The right-click menu can also close tabs, close the others, watch or unwatch, open in the browser and copy the name.

Each repo tab has these sections:

| Section | What you can do |
| --- | --- |
| **Overview** | Read the README and repo stats; watch or stop watching the repo. |
| **Pull requests** | Everything from the PR widget, scoped to this repo. **New pull request** in the header opens one from any branch. |
| **Issues** | Browse open and closed issues, open one to read and comment, close it as completed or not planned, reopen it, or create a new issue with labels. |
| **Branches** | See every branch with its last commit, how far it is ahead of or behind the default branch, and its open PR. Create a branch from any other branch, delete one, or start a PR from it. **Graph** draws the default branch and the most recently updated branches as one commit graph. |
| **Commits** | Commit history for any branch, with its branch lines; open a commit on GitHub. |
| **Releases** | Release notes and downloadable assets with download counts. **New release** creates a tag and a release, optionally as a draft or pre-release, with notes generated from merged PRs. |
| **Runs, Workflows, Insights** | Actions for this repo, as on the dashboard. |
| **Deployments** | This repo's deployments: **Environments** (what's live where), **Clients** (each client's version at each stage) and **History** (every deployment, filterable by environment, outcome or text). |
| **Working copy** and the other **Local** sections | Your local clone: see below. |

### 9. Use git without leaving the app

**Add all your clones at once:** in **Settings → Repositories**, click **Find on this computer…** (or run *Find repos on this computer* from `Ctrl/⌘+K`). Pushback looks through your home folder for git repos with a GitHub remote (`origin` first) and lists them, including clones whose folder name differs from the repo. Pick the ones you want, and each gets linked as that repo's working copy. You can also start watching them on the dashboard, and have new clones linked automatically each time Pushback starts. Kept your code somewhere else, like another drive? Use **Look in another folder…**.

To link a single repo instead, open **Working copy** in its tab and choose **Link existing clone…** (pick the folder; its remote must point at that repo) or **Clone into…** (pick a parent folder). Then:

- **Changes**: every modified, new and deleted file, with a diff of the selected one. Stage (**+**) or unstage files one at a time or all together, discard changes (you're asked to confirm), write a message and **Commit** (`Ctrl+Enter`). **Stash** puts everything aside, including new files, and **Pop stash** brings it back.
- **Fetch**, **Pull** and **Push** show how far you are ahead of or behind the remote. Pull only fast-forwards, so it never creates a surprise merge commit. A branch that hasn't been pushed yet shows **Publish branch**.
- **Branches**: switch between local branches, create one from the current branch, **Merge** a branch into the current one, **Rebase** the current branch onto another, or delete one (you're warned before deleting unmerged work).
- **Open in** your editor or IDE, **Terminal**, or click the path to open the folder. Choose the default in **Settings → Advanced → Default editor / IDE**, which lists the ones installed on your computer (VS Code, Cursor, Windsurf, Zed, Sublime Text, JetBrains IDEs, Visual Studio and more), or enter any other command.

The other **Local** sections bring git history tools into the app:

| Section | What you can do |
| --- | --- |
| **Commit graph** | Every branch (or just the current one) drawn with its branch lines, merges and branch, remote, tag and HEAD labels. Type to highlight matching commits. Click a commit for its message, parents, changed files and diffs. From there you can **Branch here**, **Tag**, **Cherry-pick** it onto the current branch, **Revert** it, or **Reset** the current branch to it (soft, mixed or hard; you're asked to confirm). |
| **File history & blame** | Find any tracked file. **History** lists every commit that changed it, following renames, with that commit's diff of the file. **Blame** shows who last changed each line and when, with a heat bar that highlights recent changes. Click a line to open its commit. |
| **Compare** | Pick two branches, remote branches or tags to see the commits only in each, and every changed file with its diff. |
| **Search commits** | Search every branch by message, author, SHA, file path, or **code change** (commits that added or removed some text). |
| **Stashes** | Every stash with its diff; apply, pop or drop one. |
| **Tags** | All tags with their commits; push or delete one. Create tags from the commit graph. |
| **Remotes & worktrees** | Fetch from any remote. Add a worktree to check out another branch in its own folder, or remove one. |
| **Contributors** | Who has committed to the current branch, and how much. |

Pushback runs your installed `git`, so it uses your existing credentials and config. Status refreshes every few seconds and whenever you switch back to the app.

### 10. Tune notifications

In **Settings → Notifications**, choose which events you want toasts for. Turn on **Only notify about runs and PRs that are mine** to hear only about your own runs and PRs (review requests always come through). Click a notification to open that run or PR in Pushback.

If you see no notifications at all, check that your OS isn't in Do Not Disturb or Focus mode, and that it allows notifications from Pushback.

### 11. Make it yours

**Settings → Appearance** has light, dark and system modes, separate themes for dark and light, per-colour overrides, a font picker (or any installed font), text size and density. You can also switch themes from the command palette: type `theme`.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl/⌘+K` or `/` | Command palette |
| `Ctrl/⌘+R` or `F5` | Refresh now |
| `Ctrl/⌘+1` … `9` | Switch to dashboard 1–9 |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Ctrl/⌘+B` | Show or hide the repo sidebar |
| `E` | Edit the layout (toggle) |
| `Ctrl/⌘+,` | Settings |
| `Esc` | Go back one level (close a page or dialog), or stop editing |

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "Not signed in" even though `gh` works | Pushback runs `gh auth token` on startup. Make sure `gh` is on your `PATH`, then click **check again**, or paste a token in Settings → Account. |
| A repo shows an error | The token can't see it (it's private or the name changed). Check the token's scopes, or that your organisation has approved it. |
| "Run" is missing for a workflow | Only workflows with an `on: workflow_dispatch` trigger can be started by hand. |
| API counter in the top bar is low | Raise the poll interval in Settings → Advanced. Requests where nothing changed are free, so this is rare. |
| Where's my data? | Settings, the activity history and the encrypted token are in `%APPDATA%\Pushback` (Windows), `~/Library/Application Support/Pushback` (macOS) or `~/.config/Pushback` (Linux). |

## Build from source

You need [Node.js](https://nodejs.org) 22 or newer.

```bash
git clone https://github.com/Darkace01/pushback.git
cd pushback
npm install
npm run dev        # run with hot reload
npm run dist       # build an installer for your current OS into dist/
```

## Contributing

Bug reports, ideas and pull requests are welcome. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for how to set up the project, how it's put together, and how to add a widget or theme.

## License

[MIT](LICENSE) © Kazeem Quadri
