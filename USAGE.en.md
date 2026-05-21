# Git Tools — User Guide

**English** · [简体中文](./USAGE.md)

IDEA-style **History / Diff / Merge / Blame / Rebase** desktop app, built on Tauri 2 + React 19 + git2-rs (vendored libgit2). Runs on Windows / macOS / Linux.

> Target version: v0.13.0
> Repo location: `G:\GitTools\`
> Installers: `G:\GitTools\src-tauri\target\release\bundle\` (local build) or [GitHub Releases](https://github.com/hyzmm/git-merger/releases)

---

## Table of Contents

- [1. Install](#1-install)
- [2. First launch](#2-first-launch)
- [3. View tour](#3-view-tour)
  - [3.1 History (commit log + Graph)](#31-history-commit-log--graph)
  - [3.2 Diff](#32-diff)
  - [3.3 Merge (conflict resolution)](#33-merge-conflict-resolution)
  - [3.4 Changes (working tree)](#34-changes-working-tree)
  - [3.5 Blame (line history + cross-rename follow)](#35-blame-line-history--cross-rename-follow)
  - [3.6 Stash](#36-stash)
  - [3.7 Reflog (HEAD time machine)](#37-reflog-head-time-machine)
  - [3.8 Submodules](#38-submodules)
  - [3.9 Interactive Rebase](#39-interactive-rebase)
  - [3.10 File History (per-file timeline + follow renames)](#310-file-history-per-file-timeline--follow-renames)
  - [3.11 Worktrees](#311-worktrees)
  - [3.12 .gitignore editor](#312-gitignore-editor)
  - [3.13 History search (cross-commit content search)](#313-history-search-cross-commit-content-search)
- [4. Topbar & remote ops](#4-topbar--remote-ops)
  - [4.1 App menu (☰)](#41-app-menu-)
  - [4.2 Undo button (reflog quick actions)](#42-undo-button-reflog-quick-actions)
  - [4.3 Multi-repo tabs (v0.12.0 / v0.13.5)](#43-multi-repo-tabs-v0120--v0135)
  - [4.4 Error feedback & Toasts (v0.13.1)](#44-error-feedback--toasts-v0131)
- [5. Command Palette (Ctrl+K)](#5-command-palette-ctrlk)
- [6. Settings panel](#6-settings-panel)
- [7. Auto-update](#7-auto-update)
- [8. Keyboard shortcuts](#8-keyboard-shortcuts)
- [9. Typical workflows](#9-typical-workflows)
- [10. Run from source / development](#10-run-from-source--development)
- [11. Build distributable installers](#11-build-distributable-installers)
- [12. FAQ](#12-faq)
- [13. Uninstall & cleanup](#13-uninstall--cleanup)
- [14. Version history](#14-version-history)

---

## 1. Install

### Windows (recommended)

Pick either installer (in `src-tauri/target/release/bundle/` or GitHub Releases):

| Installer                       | File                            | Use case                   |
| ------------------------------- | ------------------------------- | -------------------------- |
| **NSIS** (lighter, recommended) | `Git Tools_x.y.z_x64-setup.exe` | personal use               |
| **MSI**                         | `Git Tools_x.y.z_x64_en-US.msi` | enterprise / silent deploy |

> First launch may trigger Windows SmartScreen (installer is unsigned). Click "More info → Run anyway". Auto-update is supported since v0.4.0 (see section 7).

### macOS / Linux

The GitHub Actions release pipeline builds 4 platforms in parallel on tag push (windows / macos-arm64 / macos-intel / linux) and attaches every artifact to the GitHub Release Draft.

To build locally:

```bash
git clone https://github.com/hyzmm/git-merger.git GitTools
cd GitTools
bun install
bun run tauri:build
```

Artifacts:

- macOS: `src-tauri/target/release/bundle/{dmg,macos}/`
- Linux: `src-tauri/target/release/bundle/{appimage,deb,rpm}/`

---

## 2. First launch

On startup you land on the **Welcome page**: logo + intro on the left, Recent repositories on the right (hover to reveal `×` for removal). Click **Open Repository** and pick the directory containing `.git/`.

> On Windows the **directory currently open in the file dialog's address bar** is the one selected — don't enter it before clicking OK.

After opening, the app jumps to History. Since v0.4.0 it remembers your locale (en/zh) and theme (auto/light/dark), and applies the theme synchronously before paint to avoid FOUC.

---

## 3. View tour

The Sidebar has **11 view icons**, mapped to `Ctrl+1..9`, `Ctrl+0`, and `Ctrl+Shift+F`:

| Sidebar position | Shortcut       | View               |
| ---------------- | -------------- | ------------------ |
| 1                | `Ctrl+1`       | History            |
| 2                | `Ctrl+2`       | Changes            |
| 3                | `Ctrl+3`       | Stash              |
| 4                | `Ctrl+4`       | Reflog             |
| 5                | `Ctrl+5`       | Submodules         |
| 6                | `Ctrl+8`       | Interactive Rebase |
| 7                | `Ctrl+9`       | Worktrees          |
| 8                | `Ctrl+0`       | .gitignore editor  |
| 9                | `Ctrl+Shift+F` | History search     |
| 10               | `Ctrl+6`       | Diff               |
| 11               | `Ctrl+7`       | Merge              |

> Blame has no dedicated sidebar entry — open it from the **Blame** button in the Diff toolbar.

### 3.1 History (commit log + Graph)

Three panes: left **Refs panel**, center **Commit list + DAG**, right **Commit details**.

**Left — Refs panel**

- **HEAD pin (v0.9.1)**: a dedicated row at the very top showing the current HEAD. When attached, displays the branch name + short oid; when detached, shows `(detached)` + short oid. Visually distinguished by a left accent bar and a half-opacity highlight background. Click to jump to the HEAD commit.
- **Filter bar (since v0.2.0)**:
  - keyword box: live filter by message / author / email / oid prefix / ref name
  - **author dropdown** (v0.2.0): auto-collected, sorted by frequency
  - **date range** (since / until, v0.2.0): UNIX-second precision
  - **path** (pathspec, v0.2.0): delegates to backend `git log -- <path>` walk
  - **Reset filters** clears everything
- **LOCAL / REMOTE / TAGS** sections: HEAD branch is highlighted with a `HEAD` badge; ref colors match the DAG lane.
- **Click any ref → jump-to and select that commit** (fixed in v0.2.0; the commit list auto-scrolls).
- **Right-click on a ref (since v0.2.0)**:
  - local branch: Checkout / Rename / Delete / Create branch from / Copy name
  - remote branch: Checkout as new local / Copy name
  - tag: New branch from tag / Delete / Copy name
- **"+" button**: create a branch from HEAD (with optional immediate checkout).
- **Double-click a local branch**: checkout directly.

**Center — Commit list + DAG**

- 5-color cycle (blue / purple / gold / green / red), lanes assigned stably by ref name.
- Straight line = same lane; curve = branch or merge; multi-parent merges connect every parent lane.
- Virtualized via `@tanstack/react-virtual`; smooth on 100k commits.
- **Right-click any commit (since v0.2.0)**:
  - **Cherry-pick onto HEAD** (auto-jumps to Merge view on conflict)
  - **Revert this commit**
  - **Reset HEAD to here** (soft / mixed / hard, each with its own warning)
  - **Rebase interactively from here** (v0.6.0, see 3.9)
  - **Create branch from here** / **Create tag here**
  - **Checkout (detached HEAD)** (with confirmation)
  - **Copy SHA** / **Copy commit message**

**Right — Commit details**

- Full oid / parent short hashes / author + email / localized timestamp / all ref chips
- **Changed files** list (A / M / D / R / C / T status + per-file +N -N line stats)
- Click a filename → jump to Diff view

> **Large-repo performance (since v0.10.3)**: History uses cursor-based pagination — first page loads only 1000 commits; the next 1000 are fetched lazily when the virtual scroll lands within 20 rows of the tail. The graph layout (lane allocation + curve calculation) is also incremental: each new page only computes deltas while reusing the previous page's lane state, so loading more never causes color flicker, and performance no longer degrades with history size.
> The status bar shows `· +more` when the backend has another page, and `· loading more...` while a fetch is in flight.

### 3.2 Diff

**Left: file tree** (grouped by directory; status letter + filename + line counts). **Right: diff body**

- **Modes**: Side-by-side (old left, new right) / Unified
- **Line + word-level highlighting**: replacement pairs only color the actually-changed tokens (LCS-based) with `+`/`-`.
- **Shiki syntax highlighting**: ~35 languages (TS / Rust / Python / Go / C++ / …)
- **Whitespace visualization**: ⌫ button toggles space → `·`, tab → `→`.
- **Ignore Whitespace** (v0.2.0): a separate button that re-runs libgit2 with `ignore_whitespace` (complementary to the visualization toggle).
- **Hunk navigation** (v0.2.0): toolbar ↑/↓ buttons, or `n` / `p` shortcuts.
- **Blame button**: jump to Blame for the current file.

#### Bidirectional Diff editor (v0.13.3)

When the Diff source is a **working-tree file** (entered via clicking a filename in the Changes view, not via picking a commit in History) and the mode is **Side-by-side**, the toolbar gains an **Edit** toggle.

| Action               | Behavior                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| Click **Edit**       | The right pane switches from a static diff to a live textarea bound to the on-disk working-tree text           |
| Type freely          | Edits the right-side buffer; the left pane stays a read-only HEAD reference; toolbar shows **● dirty**         |
| Click **Save**       | Atomically writes back (write-to-tmp + rename) and re-runs `working_diff` so the hunk preview refreshes        |
| Click **Reset**      | Discards buffer edits and re-reads the on-disk text                                                            |
| Click **Edit** again | Closes edit mode back to read-only diff (the buffer survives in memory; reopening picks up where you left off) |

**Safety guards** (enforced by the backend `read/write_working_file` commands):

- Path-traversal defence: relative paths containing `..` segments are rejected; absolute paths must resolve inside the repo workdir
- Binary refusal: if the on-disk content contains a NUL byte, the file is treated as binary and editing is blocked (so you can't accidentally clobber a binary asset)
- 8 MB cap: per-file size limit on read and write — keeps the textarea responsive
- Atomic writes: write to a temp file then rename, so a process crash never leaves a half-written source

**Typical scenarios**:

1. Tests caught a 1-line typo → fix it directly in Diff view → Save → watch the hunk vanish, no IDE switch
2. Want to try "what if these 5 lines changed to X" → edit right pane → run tests → didn't work → **Reset** in one click
3. Fixed a typo and want to commit immediately → Save, switch to Changes — the file is already in the modified list, ready to stage

> The Edit button only appears in Side-by-side mode AND when the diff source is a working-tree file. Diffs between two historical commits (entered from History) stay read-only — there's no "current working text" to write back to.

### 3.3 Merge (conflict resolution)

> This view only has content while the repo is in merge / rebase / cherry-pick / revert state.

Three panes: LEFT (ours) / RESULT (working, editable) / RIGHT (theirs). Each conflict block has:

| Button       | Color  | Action               |
| ------------ | ------ | -------------------- |
| Accept Left  | blue   | use ours             |
| Accept Right | purple | use theirs           |
| Accept Both  | green  | concat ours + theirs |
| edit inline  | orange | manual               |

**Once every block is resolved → "Mark resolved & stage" enables** → writes file + `git add`.

**Two buttons baked in since v0.1.0**:

- **Abort merge**: invokes libgit2 to cancel the current merge / cherry-pick / revert. (Use the Rebase view's Abort for rebase.)
- **Commit merge**: directly commits the merge from the UI, no terminal needed.

### 3.4 Changes (working tree)

`Ctrl+2`. Three sections: **Unmerged** / **Staged** / **Unstaged**.

| Want to               | How                                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Stage one file        | check it → **Stage**                                                                                                                      |
| Stage everything      | **Select all** → **Stage**                                                                                                                |
| Unstage               | check → **Unstage**                                                                                                                       |
| Discard working edits | check → **Discard** (irreversible confirm)                                                                                                |
| Commit                | type message → **Commit M files**                                                                                                         |
| Stash current edits   | top-bar **Stash…** (optionally include-untracked, v0.2.0)                                                                                 |
| View / edit in Diff   | click any filename → jumps to the Diff view; toolbar gains an **Edit** toggle that turns the right pane into an editable buffer (v0.13.3) |

### 3.5 Blame (line history + cross-rename follow)

Entry: **Blame** button in the Diff toolbar.

- Consecutive lines from the same commit only display author / time / oid on the first line (IDEA grouping).
- Short oids are clickable → jump-to-and-select in History.
- Whole column virtualized + Shiki-highlighted.
- **Annotate previous (v0.3.0)**: a toolbar link "Annotate previous: <oldpath>@<oid>" appears (driven by `Diff::find_similar` rename detection). Click to jump to the file's previous identity (possibly a different path); a back stack is maintained (**Back** button retraces). This is the IDE-friendly cross-rename follow.

### 3.6 Stash

`Ctrl+3`. One row per entry, newest first:

| Button    | Action                             |
| --------- | ---------------------------------- |
| **Apply** | apply, keep on stack               |
| **Pop**   | apply and remove from stack        |
| **Drop**  | discard without applying (confirm) |

Create a stash from the **Changes** view's top-bar **Stash…** button (with optional message + include-untracked checkbox).

### 3.7 Reflog (HEAD time machine)

`Ctrl+4`. Lists every change to `HEAD@{N}` colored by action category:

- color chips for commit / reset / checkout / merge / rebase / cherry-pick / revert / pull
- per-row buttons:
  - **Restore** = mixed reset to that state (working tree preserved)
  - **Hard** = hard reset to that state (warning, **discards uncommitted edits**)

This is your last-resort undo for any accidental operation.

### 3.8 Submodules

`Ctrl+5`. One row per submodule with auto-derived status badges:

- `not cloned` / `not initialized` / `needs update` / `dirty` / `clean`

Action buttons: **Init** / **Update** (init-first as needed) / **Sync** (URL sync).

### 3.9 Interactive Rebase

`Ctrl+8`, or in History right-click any commit → **Rebase interactively from here (`<oid>^`)**.

```
┌─Draft plan ──────────── [Cancel] [Start rebase]──┐
│ ↑↓ [PICK ▾]   a3f9c1e   feat: word-level diff    │
│ ↑↓ [REWORD ▾] 5e2bd84   chore: rename Diff prop  │
│      └─[ Updated message…                     ]──│
│ ↑↓ [SQUASH ▾] 1c4a8e1   wip                      │
│      └─[ Optional combined message…           ]──│
│ ↑↓ [DROP ▾]   9b0e612   debug log                │
│ ↑↓ [PICK ▾]   eee2a1d   docs: README             │
└──────────────────────────────────────────────────┘
```

**Draft mode**:

- per-row **PICK / REWORD / SQUASH / FIXUP / DROP** selector, each color-coded
- ↑↓ to reorder
- REWORD / SQUASH expand an inline message editor
- click **Start rebase** to begin

**Execution mode**:

- top progress bar `done/total (pct%)`
- backend cherry-picks each step in order → commit / amend
- **on conflict**: progress bar turns red, UI auto-jumps to the Merge view. Resolve there and stage (**Mark resolved & stage**), then return to Rebase view and click **Continue**.
- **Abort**: click the red Abort button anytime (with confirm); restores the original branch tip.
- State persists to `.git/gittools-rebase/state.json` — **closing the app and reopening keeps the plan intact**.

#### Cleanup example

Squash "wip" and "debug log" into the previous commit and tidy messages:

1. History right-click `eee2a1d` → Rebase interactively from here
2. set `wip` to **squash**, write the merged message
3. set `debug log` to **drop**
4. set the second commit to **reword**, edit its message
5. click Start, watch it finish (instantly when no conflicts)

### 3.10 File History (per-file timeline + follow renames)

The `git log --follow -- <path>` equivalent. Two panes:

- **Left**: the file's commit timeline (newest → oldest). Each row: status badge (A/M/D/R/C/T) + short oid + summary + author + +N -N line counts. **Renames / copies** show `oldpath → newpath` in fine print at the row tail.
- **Right**: the file's diff at the selected commit (Side-by-side / Unified toggle, reuses the main Diff renderer).

The backend uses `Diff::find_similar` per step to detect renames and switches the tracked path so a chain like `lib/graph.ts` → `src/lib/graph.ts` → `src/components/Graph.tsx` is presented continuously.

**Entry points (v0.8.0)**:

- **Diff toolbar → History**: history of the currently open file
- **Blame toolbar → File history**: history of the blamed file
- **History → Commit Details right-click on a file**: context menu with "Show file history (follows renames)" / "Open diff at this commit" / "Blame current version" / "Copy path"

The right pane's title also exposes a clickable short oid → jumps to the full commit diff.

### 3.11 Worktrees

`Ctrl+9`. The `git worktree` equivalent — check out multiple branches into separate directories from the same repo, no stash dance.

**Layout**: single-column list. **Main checkout** is always pinned to the top with a half-opacity highlight. Each row shows the absolute working directory, branch name (or `(detached)`), HEAD short oid, and registered name.

**Badges**:

- `main`: the repo's primary checkout
- `locked`: locked via `git worktree lock`, prune-protected
- `prunable`: working dir is gone from disk, metadata can be cleaned (orange hint)

**Toolbar**:

| Button    | Behavior                                                                                        |
| --------- | ----------------------------------------------------------------------------------------------- |
| **Add**   | inline form: path (with Browse picker) / name (defaults to last segment) / branch (empty = new) |
| **Prune** | one-click sweep all prunable worktrees                                                          |

**Per-row (non-main) buttons**:

- **Remove**: safely remove when the worktree is clean (`git worktree remove`)
- **Force remove** (red): force even when working dir still exists, with confirm. Use only when you're sure nothing will be lost.

**Typical scenarios**:

1. Want to review a PR while keeping main checkout intact → Worktrees → Add, path `../gittools-review`, branch = PR branch
2. Run build/test concurrently across two commits in different folders
3. Working dir deleted by hand, leaving "ghost" worktrees → click **Prune**

The backend uses libgit2's `git_worktree_*` C API directly (no fork-and-exec to system git). All four operations are covered by `cargo test --test git_layer` integration tests.

### 3.12 .gitignore editor

`Ctrl+0`. Visual editor for the **repo-root `.gitignore`**, three columns:

| Column               | Purpose                                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| **Left — Templates** | 8 built-in starters (Node / Rust / Python / Go / macOS / Windows / JetBrains / VS Code), click to append  |
| **Center — Editor**  | large monospace textarea; bottom status bar shows line / char count; top-right has Preview / Reset / Save |
| **Right — Preview**  | after clicking Preview, shows diff of candidate vs the on-disk version                                    |

**"Unsaved" indicator**: when the editor differs from disk, an orange `unsaved` badge appears in the title bar.

**Preview** is the editor's killer feature — without saving, it tells you:

- ⚠️ **Newly ignored** (orange `+`): which working-dir files would become newly ignored. **Tracked files do NOT stop being tracked just because a rule is added** — if any appear here, you'll need a follow-up `git rm --cached`.
- ✅ **No longer ignored** (green `−`): which previously-ignored paths would un-ignore.

Implementation: the backend first calls `Repository::statuses(include_ignored=true)` to snapshot all tracked / untracked / ignored paths as a baseline. Then it **temporarily renames `<workdir>/.gitignore` to `<workdir>/.gitignore.gittools-preview-bak`**, opens a fresh `Repository` handle (so libgit2 rebuilds its per-handle ignore cache), injects the candidate text via `add_ignore_rule` as the only rule source, and re-queries `is_path_ignored` for every path to compute the candidate state. A RAII Drop guard always restores the file (panic-safe). The whole window is single-digit milliseconds. Results are capped at 200 entries per side so big monorepos don't drown the UI.

**Save** writes `<repo>/.gitignore` (atomic rename) and auto-refreshes the Changes view so you don't see a stale untracked list.

**Typical scenarios**:

1. New repo init → select Node + macOS templates → Save
2. Want to ignore `dist/` → type `dist/` → Preview shows newly-ignored files → confirm → Save
3. Temporarily disable a rule for an experiment → delete the line → Preview shows newly-unignored list → unsatisfied → click Reset to restore

### 3.13 History search (cross-commit content search)

`Ctrl+Shift+F`. **Two-pane layout**: left = toolbar + result list; right = hit preview.

**Three search modes** (toolbar toggle):

| Mode               | git equivalent    | Use case                                                                              |
| ------------------ | ----------------- | ------------------------------------------------------------------------------------- |
| **Both** (default) | message + content | when you don't know where the keyword is — start here                                 |
| **Message**        | `git log --grep`  | search commit messages only (subject + body)                                          |
| **Diff**           | `git log -S/-G`   | **pickaxe**: locate "which commit added/removed a chunk of code" — the strongest mode |

**Two pattern kinds**:

- **Literal** (default): treat input as a literal substring
- **Regex**: Rust-flavored regular expressions (anchors, character classes, capture groups, etc.)

Other toolbar items:

- **Aa** (Case): case sensitivity toggle
- **Path**: scope by pathspec (e.g. `src/` or `*.rs`), same semantics as History view

**Result rows**: each hit shows short oid / summary / author / relative time / `msg` (message hit) / `+/− N` (diff hit count). Click to populate the right pane:

- highlighted message excerpt (when message matched)
- per-file grouped +/- listing: line number, `+/−` marker, content; additions in green, deletions in red
- title bar **Open** button → jumps to History view and selects that commit

**Safety & performance**:

- Default scan cap: **5000 commits**; exceeding sets `truncated` and surfaces an amber `truncated` badge.
- Per-commit diffs over 2 MB are skipped (avoids vendored bloat).
- Per-commit cap: **20** diff hits; per-search cap: **500** total hits.
- Backend uses `git2::diff_tree_to_tree` + Rust `regex` (no fork to system git, consistent across platforms).

**Typical scenarios**:

1. Track changes to `LICENSE` → mode=Diff, pattern=`MIT License`, path=`LICENSE`
2. Find when `unwrap_or_default` was introduced → mode=Diff, pattern=`unwrap_or_default`
3. List every commit referencing issue #42 → mode=Message, pattern=`#42`
4. Hunt hard-coded IPs → mode=Diff, kind=Regex, pattern=`\b(?:\d{1,3}\.){3}\d{1,3}\b`

**New in v0.13.4**:

- **Group by** (toolbar toggle): **Commit** = one row per matching commit (legacy layout); **File** = Find-in-Path style — each file appears once with its touching commits nested underneath. Files are sorted by total `+`/`-` line count (desc), and the first 3 file groups auto-expand. Commits with only message-matches (no diff hits) are intentionally **not** shown in the file rollup — that view is content-driven.
- **Recent searches** (clock icon on the right of the query input): keeps the 12 most recent searches, deduped on a structural key (mode + kind + case + path + query — any axis change → new entry). Click any row to apply and immediately re-run.
- **★ Save** (save the current search): name it and the full axes (query / mode / kind / case / path) are persisted under that name. Same name overwrites the existing entry. Both saved searches and recents persist to `localStorage`, so they survive across app sessions.

---

## 4. Topbar & remote ops

```
┌─[☰]──[F5↻]──────────[Cloud][↓Pull][↑Push]──[↺Undo▾]──[ Search Ctrl+K ]──[Updater]──[⚙]─┐
│           branch: main  G:\GitTools                                                    │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

> Since v0.9.1, the original "Open Repository" button is replaced by an ☰ **app menu**, collapsing low-frequency items (Open / Recent / Close / About / Quit). High-frequency buttons stay on the topbar. See [4.1 App menu](#41-app-menu-).

**Fetch / Pull / Push** (native libgit2 since v0.5.0, no system git dependency):

| Button    | Behavior                                                                  |
| --------- | ------------------------------------------------------------------------- |
| **Fetch** | fetch all remotes + prune stale remote refs                               |
| **Pull**  | **fast-forward only**; non-FF errors out and points you to the Merge view |
| **Push**  | auto-resolves remote from branch upstream config; falls back to `origin`  |

**Live progress** (v0.5.0): top-right shows "Receiving 1234/5678" / "Indexing" / "Pushing".

**Credential resolution order**:

1. **SSH agent** (if URL is SSH)
2. **`~/.ssh/id_ed25519` / `id_rsa` / `id_ecdsa`**
3. **Git credential helper** (HTTPS user/password from `~/.gitconfig`)
4. **In-app prompt**: a "Sign in to remote" dialog asking for username + token (GitHub / GitLab / Bitbucket all require PATs now). Up to 3 retries, 2-min timeout.

When done, a green/red banner appears with message + details; click Dismiss to close.

### 4.1 App menu (☰)

Since v0.9.1, the leftmost ☰ icon in the Topbar opens the app menu:

| Item                    | Shortcut | Behavior                                                                       |
| ----------------------- | -------- | ------------------------------------------------------------------------------ |
| **Open repository…**    | `Ctrl+O` | same as the Welcome page button — opens the directory picker                   |
| **Recent repositories** | —        | inline list (up to 8); click to open; hover row tail to reveal `×` for removal |
| **Close repository**    | —        | close the current repository, return to Welcome page                           |
| **About Git Tools**     | —        | dialog: app name + version + GitHub link                                       |
| **Quit**                | `Alt+F4` | quit the app                                                                   |

Design intent: high-frequency actions (Refresh / Fetch / Pull / Push / Search / Settings / Updater) stay visible on the Topbar; low-frequency management items move into the menu, keeping the bar clean.

> `Ctrl+O` is global — opens the directory picker without opening the menu first.

### 4.2 Undo button (reflog quick actions)

Since v0.10.2, an **↺Undo** split-button sits after the remote group on the Topbar. Goal: surface the "restore to before this action" workflow without a Reflog-view detour.

**Main button**: undo the most recent "meaningful" action (**reset / merge / pull / cherry-pick / revert / rebase (start|finish) / commit (amend)**). Click → `git reset --mixed` to the OID HEAD pointed at _before_ the action ran (preserves working-tree edits, fully recoverable from reflog itself).

**Chevron**: dropdown with up to 8 most recent undoable entries, each one-click. Each row shows:

- `HEAD@{N}` reflog index
- action category badge (reset / merge / pull / …, color-coded)
- raw reflog message
- target short oid

**Critical safety design**:

- **Plain commits are NOT shown** — to prevent silently dropping authored work.
- **Checkout / branch / push / stash are NOT shown** — they aren't dangerous, no need to expose.
- **Stops at the first commit barrier** — `findQuickUndo` returns `null` once it sees a plain commit, so "make a new commit and the button hides itself" — go to the Reflog view for finer-grained ops.
- **Mid-rebase steps are excluded** — only `(start)` / `(finish)` count; `(pick)` etc. are not directly undoable.

**Typical scenarios**:

1. Accidentally `git reset --hard` too far → one-click Undo reset
2. Merged the wrong branch → one-click Undo merge
3. Cherry-picked the wrong commit → one-click Undo cherry-pick
4. Amended a message that shouldn't have been amended → one-click Undo amend

The button **auto-hides** when there's nothing undoable at the top of reflog.

### 4.3 Multi-repo tabs (v0.12.0 / v0.13.5)

A new **RepoTabs** strip above the Topbar lets you keep several repositories open at once and bounce between them — IDE-style.

**Core interactions**:

| Action             | Behavior                                                               |
| ------------------ | ---------------------------------------------------------------------- |
| `Ctrl+T`           | new blank tab, immediately shows Welcome page                          |
| click a tab        | switch to that tab                                                     |
| double-click label | rename the tab (default = last segment of repo path)                   |
| click × on a tab   | close the tab; if it was the last, fall back to Welcome page           |
| `Ctrl+W`           | close the current tab (refused when pinned — unpin first)              |
| `Ctrl+PageDown`    | switch to the next tab, wraps (v0.13.5)                                |
| `Ctrl+PageUp`      | switch to the previous tab, wraps (v0.13.5)                            |
| drag a tab         | reorder tabs; dragging across the pinned/unpinned boundary toggles pin |
| right-click a tab  | popup menu: Pin / Unpin / Close / Close others / Close to right        |
| AppMenu → New tab  | equivalent to `Ctrl+T`                                                 |

**Per-tab state isolation**: each tab independently retains view (History/Diff/Merge/...), history scroll position / filter / selected commit, stash / reflog / submodules / rebase state, Diff selected file, Worktrees list, .gitignore draft, Search query. Switching tabs **snapshots the full state of the current tab** and restores the target tab's snapshot to the top — zero-cost swap that doesn't slow down with tab count.

**v0.13.5 — cross-session persistence + pinning + drag + right-click menu**:

- **Persistence**: the tab list (id / repoPath / label / pinned) plus the active tab id are written to `localStorage` under `gittools.tabs.v1` and restored on next launch. Per-tab session payloads (history / refs / diff / …) are intentionally **not** persisted — each restored tab calls `openRepo` lazily the first time it's surfaced, which is way cheaper than serializing entire `SessionSnapshot`s. Blank "(new)" tabs are deliberately excluded so they don't get resurrected. `MAX_TABS = 32` cap.
- **Pinned tabs**: right-click → **Pin tab**. Pinned tabs sort to the front of the bar (stable partition), refuse `Ctrl+W` (the keyboard handler in `App.tsx` checks the active tab's `pinned` flag and silently no-ops), and swap their `×` button for an inline ⊘ unpin glyph. **Close other tabs** / **Close tabs to the right** keep all pinned tabs intact — they respect the user's explicit pinning intent.
- **Drag-to-reorder**: `draggable={true}` HTML5 drag sources. Mid-drag the moved tab fades to 50% opacity and a 2px primary-coloured insertion bar appears between target tabs (or at the very end). Drop on the right half of a tab → insert after it; left half → insert before it; past the rightmost tab → drop at the end. **Dragging into the pinned region pins automatically; dragging out unpins** — matching VS Code / browser behaviour.
- **Right-click menu**: `ContextMenu` popup (reuses the same component shared by `RefsPane` / `CommitList`). Items: Pin/Unpin · Close · Close other tabs · Close tabs to the right. Items that would be no-ops (e.g. nothing non-pinned to the right) auto-disable.

**Implementation notes**:

- The top-level store always mirrors the active tab's state, so all existing `useApp(s => s.history.commits)` selectors needed zero changes.
- Inactive tabs park their state in `sessionsById: Record<tabId, SessionSnapshot>`. Switching is one batch swap.
- When `openRepo` is called for a repo already open in some tab, it switches to that tab instead of creating a duplicate.
- Persistence runs through a `useApp.subscribe(...)` listener attached after store creation — every `set()` that touches tabs / activeTabId triggers `saveTabs`, with a structural diff to skip redundant writes.
- The reorder algorithm `reorderTabs(from, to)` is a pure function; the unit tests cover the "all pinned remain before all unpinned no matter the move" invariant via brute-force enumeration of `(from, to)` pairs.

**Typical scenarios**:

1. Frontend / backend repos open simultaneously, switching frequently while reviewing PRs
2. One tab on `main` browsing history, another tab on a feature branch running a rebase plan
3. Open a third repo briefly to look up a commit hash, `Ctrl+W` to close
4. Pin your primary monorepo tab so opening/closing N temporary repos can never accidentally close it (v0.13.5)
5. Quit the app and relaunch the next day — every tab + its pinned state comes back exactly as it was (v0.13.5)

### 4.4 Error feedback & Toasts (v0.13.1)

Starting in v0.13.1, every backend error funnels through a unified **Toast** queue (floating overlay in the bottom-right corner) instead of being silently swallowed or shown via `alert()`.

**Visuals**:

- **Error** (red border): remote rejection, merge conflict, auth failure, file IO failure — default lifetime **8 seconds**
- **Info** (neutral border): success messages ("Stashed working changes.", "Pruned 2 worktrees") — default lifetime **3 seconds**
- Hovering a toast **pauses its auto-dismiss timer** so you can copy the error text
- At most **5** toasts stacked at once; older ones drop off the top

**Error classification** (the backend `AppError` is a 10-kind tagged enum auto-derived from `git2::Error`):

| Kind                                | Triggered by                                       | Toast title prefix          |
| ----------------------------------- | -------------------------------------------------- | --------------------------- |
| `NotFound`                          | missing ref / oid / file                           | `NotFound:`                 |
| `MergeConflict`                     | merge / cherry-pick / revert produced conflicts    | `MergeConflict:`            |
| `NonFastForward`                    | push rejected (remote has newer commits)           | `NonFastForward:`           |
| `Auth`                              | wrong SSH key, HTTPS creds, cert validation        | `Auth:`                     |
| `UserCancelled`                     | credential dialog dismissed, file picker cancelled | `UserCancelled:`            |
| `InvalidArgument`                   | invalid reset mode, empty commit message           | `InvalidArgument:`          |
| `Git` / `Io` / `Internal` / `Other` | catch-all categories                               | (corresponding kind prefix) |

**Topbar remote-op banner** (enhanced in v0.13.1):

- Push refused (NonFastForward): banner shows guidance — "Pull/Fetch first, then push"
- Auth failure: banner shows guidance — "Check credentials / SSH key configuration"
- Other errors: backend message is shown verbatim

**Global safety net**: any **un-caught** Promise rejection is intercepted by the global `unhandledrejection` listener in `App.tsx` and surfaced as a toast — meaning even if a component forgets to try/catch, the error never disappears silently into `console.error`.

> Pre-v0.13.1 errors were just `String(e)`'d into a component's local error state with no global safety net. If a constructor folded the error into an effect's callback, it could be lost. v0.13.1 closes that gap.

---

## 5. Command Palette (`Ctrl+K`)

Added in v0.7.0. Press `Ctrl+K` or `Ctrl+P`, or click the **Search** button on the Topbar.

```
┌─[🔎 search commits / branches / files…         ][esc]─┐
│ ✦ History                                       view  │
│ 🌿 main                                  local branch → │
│ 🌿 origin/feat/login                     remote branch │
│ ● a3f9c1e  feat: word-level diff   3 days ago         │
│ 📄 src/lib/wordDiff.ts            open in Blame       │
│ 📄 src/lib/graph.ts                                   │
│ ─────────────────────────────────────────────────     │
│ ↑↓ navigate   ↵ open                  214 results     │
└───────────────────────────────────────────────────────┘
```

**Targets** (and their on-Enter behavior):

| Kind   | Action                                         |
| ------ | ---------------------------------------------- |
| view   | switch to that view                            |
| branch | local: `checkout`; remote: jump to that commit |
| tag    | jump to that commit                            |
| commit | jump to History and select that commit         |
| file   | open in Blame                                  |

**Fuzzy match**: subsequence (e.g. `grph` matches `lib/graph.ts`); matched characters are inline-highlighted with `<mark>`; bonuses for prefix / word-boundary / consecutive-run / case-sensitivity hits.

**Keyboard**: `↑↓` / `Home` / `End` to navigate, `Enter` to open, `Esc` to close.

---

## 6. Settings panel

Since v0.4.0. Click the **⚙** icon at the right of the Topbar.

**Appearance**:

- **Theme**: Auto (follow system) / Light / Dark; FOUC-free (an inline pre-paint script reads localStorage)
- **Font size**: 12 / 13 / 14 / 15 / 16 / 18 px
- **Tab width**: 2 / 4 / 8 (affects Diff / Blame rendering)
- **Language**: English / Chinese (auto-detected from `navigator.language` on first run, switchable live)

**Git config** (v0.4.0):

- Edit `core.autocrlf`; scope = **current repo** or **global ~/.gitconfig**
- Options: `(unset)` / `false` / `input` (recommended for macOS/Linux) / `true` (recommended for Windows)

---

## 7. Auto-update

Since v0.4.0, `tauri-plugin-updater` is built in. When a new version is detected:

- a green **Update vX.Y.Z** badge appears on the Topbar
- click for release notes preview
- **Download & install** shows a progress bar
- once done, **Restart now** → relaunches into the new version

Backend: GitHub Releases' `latest.json`. CI signs updater bundles with the `TAURI_SIGNING_PRIVATE_KEY` repo secret on every tag push.

> Auto-update requires the minisign public key. The repo's `tauri.conf.json` already ships the public key since v0.4.0; CI must hold the matching private secret to produce signed bundles.

---

## 8. Keyboard shortcuts

| Shortcut            | Action                                           | Scope  |
| ------------------- | ------------------------------------------------ | ------ |
| `Ctrl+1`            | History                                          | global |
| `Ctrl+2`            | Changes                                          | global |
| `Ctrl+3`            | Stash                                            | global |
| `Ctrl+4`            | Reflog                                           | global |
| `Ctrl+5`            | Submodules                                       | global |
| `Ctrl+6`            | Diff                                             | global |
| `Ctrl+7`            | Merge                                            | global |
| `Ctrl+8`            | Interactive Rebase                               | global |
| `Ctrl+9`            | Worktrees                                        | global |
| `Ctrl+0`            | .gitignore editor                                | global |
| `Ctrl+Shift+F`      | History search (cross-commit)                    | global |
| `Ctrl+T`            | new repo tab (v0.12.0)                           | global |
| `Ctrl+W`            | close current tab; refused when pinned (v0.13.5) | global |
| `Ctrl+PageDown`     | switch to next tab, wraps (v0.13.5)              | global |
| `Ctrl+PageUp`       | switch to previous tab, wraps (v0.13.5)          | global |
| `Ctrl+K` / `Ctrl+P` | Command Palette                                  | global |
| `Ctrl+O`            | Open repository (v0.9.1)                         | global |
| `F5` / `Ctrl+R`     | refresh current view                             | global |
| `n` / `p`           | next / previous hunk                             | Diff   |
| `Alt+1` / `2` / `3` | first pending conflict's Left/Right/Both         | Merge  |

> These shortcuts are auto-disabled inside input/textarea/contenteditable elements, so they won't interfere with typing (unless explicitly modified by `Ctrl+`).

---

## 9. Typical workflows

### 1. Review a merge commit on a PR

1. Open repo → History
2. Click the latest merge commit → right pane shows changed files
3. Click each file → Diff view
4. Side-by-side for understanding, Unified for final read
5. Word-level highlighting pinpoints "which variable was renamed"

### 2. Resolve a merge conflict

1. Terminal `git merge feature` → conflicts
2. `Ctrl+7` → Merge view
3. For each block: `Alt+1/2/3` for one-click, or edit manually
4. **Mark resolved & stage** → next file
5. All resolved → click **Commit merge** straight from the UI (no terminal needed)

### 3. Tidy up a chain of wip commits (Interactive Rebase)

1. History right-click the first wip after base → **Rebase interactively from here**
2. Reorder, set squash / drop / reword
3. **Start rebase** → runs automatically
4. On conflict → Merge view → Continue
5. Done → branch ref points at the new tip automatically

### 4. Undo something you just did wrong

1. `Ctrl+4` → Reflog
2. Find "the last good state" row
3. Click **Restore** (keeps working tree) or **Hard** (full revert)

### 5. Where did this file go? (Cross-rename trace)

1. Diff toolbar → Blame
2. Toolbar shows "Annotate previous: <oldpath>"
3. Click through every rename / massive edit
4. **Back** retraces

### 6. Find a line of code in a 100k-commit repo

1. `Ctrl+K` → type "graph"
2. Pick `src/lib/graph.ts` from results → opens in Blame
3. Click any line's short oid → History selects that commit → Diff

---

## 10. Run from source / development

### Environment

| Tool    | Min version                                                                 | Install                                                   |
| ------- | --------------------------------------------------------------------------- | --------------------------------------------------------- |
| Bun     | 1.3+                                                                        | `irm bun.sh/install.ps1 \| iex` (Windows)                 |
| Rust    | 1.77+                                                                       | https://rustup.rs                                         |
| Git     | any                                                                         | https://git-scm.com (dev only; the app is self-contained) |
| Windows | + MSVC C++ Build Tools + WebView2 (Win11 built-in)                          | VS Installer                                              |
| macOS   | + Xcode CLT                                                                 | `xcode-select --install`                                  |
| Linux   | + webkit2gtk-4.1 + libssl-dev + librsvg2-dev + libayatana-appindicator3-dev | apt/dnf                                                   |

### Dev mode

```bash
cd G:\GitTools
bun install                # first time
bun run scripts/gen-icons.ts   # generate placeholder Tauri icons
bun run tauri:dev          # start dev: Vite + Rust + opens window
```

First Rust compile is 30-90 s; after that, incremental rebuilds are seconds. React HMR is instant.

### Quality gates

```bash
bun run typecheck                # tsc -b
bun run lint                     # eslint
bun run format                   # prettier --write
bun run format:check             # prettier --check (used in CI)
bun run test                     # bun test src/lib — frontend unit tests (v0.9.0)
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --tests --no-deps -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml   # backend integration tests (v0.9.0)
```

CI configuration: `.github/workflows/ci.yml` runs the full set on every push; `release.yml` runs a 4-platform matrix on tag push and drafts a GitHub Release.

### Project layout cheat sheet

```
G:\GitTools\
├── src/
│   ├── App.tsx               # view router + global shortcuts
│   ├── main.tsx              # Root + ErrorBoundary
│   ├── components/
│   │   ├── Sidebar.tsx       # 11 view entries
│   │   ├── Topbar.tsx        # repo / refresh / search / remote / updater / settings
│   │   ├── ContextMenu.tsx   # right-click primitive
│   │   ├── CredentialDialog.tsx       # remote auth dialog (v0.5.0)
│   │   ├── CommandPalette.tsx         # Ctrl+K (v0.7.0)
│   │   ├── SettingsDialog.tsx         # settings panel (v0.4.0)
│   │   ├── UpdateBadge.tsx            # auto-update (v0.4.0)
│   │   ├── RepoTabs.tsx               # multi-repo tabs (v0.12.0)
│   │   ├── ErrorBoundary.tsx
│   │   ├── history/          # CommitList / CommitDetails / GraphRow / RefsPane / HistoryFilterBar
│   │   ├── diff/             # DiffViewer / DiffViews / FileTree / DiffPrimitives
│   │   └── merge/            # ConflictsList / ThreeWayEditor
│   ├── pages/                # Welcome/History/Diff/Merge/Blame/Changes/Stash/Reflog/Submodules/Rebase/FileHistory/Worktrees/Gitignore/Search
│   ├── stores/
│   │   ├── app.ts            # Zustand global store (with multi-tab sessions)
│   │   └── settings.ts       # persisted appearance (v0.4.0)
│   ├── ipc/git.ts            # typed invoke wrappers
│   ├── lib/
│   │   ├── graph.ts                # DAG lane allocation (incremental, v0.10.3)
│   │   ├── pairLines.ts            # diff line pairing
│   │   ├── wordDiff.ts             # LCS word-level diff
│   │   ├── conflictParser.ts       # <<<<<<< parsing
│   │   ├── recentRepos.ts          # localStorage
│   │   ├── reflogActions.ts        # Undo classifier (v0.10.2)
│   │   ├── useShortcuts.ts         # global shortcuts hook
│   │   ├── useUpdater.ts           # auto-update hook (v0.4.0)
│   │   ├── i18n.ts                 # custom typed i18n (v0.4.0)
│   │   ├── locales/{en,zh}.ts
│   │   ├── fuzzy.ts                # subsequence matcher (v0.7.0)
│   │   ├── time.ts / utils.ts / highlighter.ts
│   ├── styles/globals.css    # Tailwind v4 + design tokens
│   └── vite-env.d.ts
├── src-tauri/
│   ├── Cargo.toml            # git2 (vendored) + tauri 2 + plugins + regex
│   ├── tauri.conf.json
│   ├── capabilities/         # Tauri 2 ACL
│   └── src/
│       ├── main.rs / lib.rs
│       ├── commands.rs       # 50+ #[tauri::command]s
│       └── git/
│           ├── repo.rs       # open_repo / tracked_files
│           ├── file_history.rs # per-file log + follow renames (v0.8.0)
│           ├── log.rs        # author/date/pathspec filters + cursor pagination (v0.10.3)
│           ├── search.rs     # cross-commit message + diff pickaxe (v0.11.0)
│           ├── diff.rs       # ignore_whitespace
│           ├── merge.rs      # 3-way + abort + commit
│           ├── refs.rs       # listing
│           ├── refs_ops.rs   # branch/tag CRUD (v0.2.0)
│           ├── commit_ops.rs # cherry/revert/reset (v0.2.0)
│           ├── blame.rs      # blame_at_revision + previous_filename (v0.3.0)
│           ├── stash.rs      # save/apply/pop/drop (v0.2.0)
│           ├── reflog.rs     # (v0.3.0)
│           ├── submodule.rs  # init/update/sync (v0.3.0)
│           ├── workspace.rs  # working-tree stage/unstage/commit
│           ├── remote.rs     # native fetch/pull/push + creds + progress (v0.5.0)
│           ├── rebase.rs     # interactive rebase executor (v0.6.0)
│           ├── worktree.rs   # worktrees lifecycle (v0.10.0)
│           ├── gitignore.rs  # .gitignore preview/save (v0.10.1)
│           └── config.rs     # core.autocrlf etc. (v0.4.0)
├── .github/workflows/{ci,release}.yml   # (v0.4.0)
├── design/                   # static HTML design drafts
├── scripts/
│   ├── gen-icons.ts
│   └── preview-design.ts
├── package.json / tsconfig.json / vite.config.ts
├── eslint.config.js / .prettierrc.json / .gitattributes
├── bunfig.toml               # mainland mirror
└── README.md / README.zh.md / USAGE.md / USAGE.en.md
```

### Main Rust command list

| Category      | Commands                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------- |
| Repo          | `open_repo`, `tracked_files`                                                                                        |
| File History  | `file_history`                                                                                                      |
| History       | `git_log`, `git_log_page`, `commit_files`, `file_diff`, `working_diff`, `list_refs`                                 |
| Search        | `search_commits`                                                                                                    |
| Working tree  | `working_changes`, `stage_files`, `unstage_files`, `discard_files`, `commit_changes`                                |
| Merge         | `conflicts`, `merge_state`, `conflict_content`, `resolve_conflict`, `abort_merge`, `commit_merge`                   |
| Branches/Tags | `create_branch`, `checkout_branch`, `checkout_commit`, `delete_branch`, `rename_branch`, `create_tag`, `delete_tag` |
| Commit ops    | `cherry_pick`, `revert_commit`, `reset_to`                                                                          |
| Stash         | `stash_list`, `stash_save`, `stash_apply`, `stash_pop`, `stash_drop`                                                |
| Blame         | `blame_file`, `blame_at_revision`, `previous_filename`                                                              |
| Reflog        | `reflog_list`                                                                                                       |
| Submodules    | `submodule_list`, `submodule_init`, `submodule_update`, `submodule_sync`                                            |
| Worktrees     | `worktree_list`, `worktree_add`, `worktree_remove`, `worktree_prune`                                                |
| Gitignore     | `gitignore_read`, `gitignore_write`, `gitignore_preview`, `gitignore_templates`                                     |
| Remote        | `git_fetch`, `git_pull`, `git_push`, `submit_credentials`, `cancel_credentials`                                     |
| Rebase        | `rebase_plan`, `rebase_start`, `rebase_next`, `rebase_continue`, `rebase_abort`, `rebase_status`                    |
| Config        | `config_get`, `config_set`                                                                                          |

---

## 11. Build distributable installers

```bash
cd G:\GitTools
bun run tauri:build
```

First Rust release build (with LTO) takes 3-6 minutes; subsequent are incremental. Artifacts:

| Platform | Path                                                  |
| -------- | ----------------------------------------------------- |
| Windows  | `src-tauri/target/release/bundle/{msi,nsis}/`         |
| macOS    | `src-tauri/target/release/bundle/{dmg,macos}/`        |
| Linux    | `src-tauri/target/release/bundle/{appimage,deb,rpm}/` |

**Auto-publish** (v0.4.0): tag and push (e.g. `git tag v0.13.0 && git push origin v0.13.0`); GitHub Actions `release.yml` runs the 4-platform matrix in parallel, drafting a Release with all installers attached.

---

## 12. FAQ

### Q1: Window goes blank after Open Repository?

`F12` → DevTools → Console for red errors. Common causes: directory isn't a git repo / WebView2 is too old.

### Q2: DAG graph looks wrong?

Press `F5` / `Ctrl+R` to refresh. If still off, in DevTools console run `console.table(__layout)` and screenshot for a bug report.

### Q3: Diff has no colors?

If the toolbar reads "0 hunks", the file genuinely didn't change. Binary files render "Binary file — no preview."

### Q4: Push reports "authentication required (no usable credentials)"?

Check in order:

1. SSH repo: `ssh-add ~/.ssh/id_ed25519` and verify `ssh -T git@github.com` works
2. HTTPS repo: clear stale Windows Credentials in SmartCard / Settings; the next push should pop the credential dialog
3. GitHub / GitLab / Bitbucket: **password won't work**, use a PAT (personal access token)

### Q5: Pull reports "non-fast-forward — use the merge UI"?

Means upstream has commits you don't have locally, and your local has commits upstream doesn't. Two options:

- terminal `git pull --rebase` (or use the in-app interactive rebase since v0.6.0 then push)
- terminal `git merge origin/<branch>` → resolve in the in-app Merge view

### Q6: Want to bail out of an interactive rebase mid-way?

Click the red **Abort** button in the Rebase view at any time; it hard-resets to the original branch tip and clears the state file.

### Q7: Rebase is stuck Conflicted but Merge view shows clean?

Shouldn't happen. If it does: delete `.git/gittools-rebase/state.json`, restart the app, and Abort once more.

### Q8: Auto-update download stuck?

Most common cause: `latest.json` signature mismatches the local public key. Temporary workaround: in the repo's `tauri.conf.json`, comment out `plugins.updater.endpoints` and rebuild.

### Q9: Window doesn't reload after editing Rust in dev mode?

Cargo finishes incremental and auto-reloads. If stuck: check the terminal log (`.tauri-dev.log.err`), or `Stop-Process -Name git-tools, bun -Force` then re-run `bun run tauri:dev`.

### Q10: `bun install` ConnectionRefused?

Check `bunfig.toml`:

```toml
[install]
registry = "https://registry.npmmirror.com/"
```

Or your corporate intranet mirror.

### Q11: Windows SmartScreen says "Windows protected your PC"?

The installer isn't EV-code-signed yet (still in backlog as of v0.13.0). Click "More info → Run anyway".

### Q12: Fonts too small on a HiDPI display?

`Ctrl + scroll` to zoom the webview, or pick a larger font size in Settings (v0.4.0).

---

## 13. Uninstall & cleanup

### Uninstall the app

- **NSIS**: Start menu → Git Tools → Uninstall
- **MSI**: Control Panel → Programs and Features → Git Tools → Uninstall

### Clean user data

The app does **not** write to user-profile directories beyond:

| Data                | Location                                             | How to clean                            |
| ------------------- | ---------------------------------------------------- | --------------------------------------- |
| Recent repos list   | localStorage `gittools.recent-repos`                 | F12 → Application → Local Storage → del |
| Appearance / locale | localStorage `gittools.settings` / `gittools.locale` | same as above                           |
| Rebase state        | `<repo>/.git/gittools-rebase/state.json`             | click **Abort** in Rebase view, or `rm` |

### Clean source build artifacts

```powershell
cd G:\GitTools
Remove-Item -Recurse -Force node_modules, dist, .tsbuild, src-tauri\target -ErrorAction SilentlyContinue
Remove-Item -Force .tauri-dev.log*, .tauri-build.log* -ErrorAction SilentlyContinue
```

---

## 14. Version history

| Version | Highlights                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v0.1.0  | History / Diff / Merge / Blame / Changes / remote ops (system git) / baseline UI                                                                                                                                                                                                                                                                                                                                                                                                              |
| v0.2.0  | Stash / branch & tag CRUD / commit context menu (cherry-pick / revert / reset) / Diff hunk nav + Ignore Whitespace / advanced filters                                                                                                                                                                                                                                                                                                                                                         |
| v0.3.0  | Reflog / Annotate previous (cross-rename trace) / Submodules                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| v0.4.0  | GitHub Actions CI + 4-platform releases / Settings panel (theme/font/tab/autocrlf) / auto-update (minisign) / i18n (en + zh)                                                                                                                                                                                                                                                                                                                                                                  |
| v0.5.0  | Native push/pull/fetch (git2-rs, no system git) / credential dialog (SSH agent → keys → helper → prompt) / live progress events                                                                                                                                                                                                                                                                                                                                                               |
| v0.6.0  | Interactive Rebase (pick/reword/squash/fixup/drop + reorder + persisted state + conflict pause)                                                                                                                                                                                                                                                                                                                                                                                               |
| v0.7.0  | Command Palette (Ctrl+K, search commits/refs/files/views) + custom subsequence fuzzy matcher                                                                                                                                                                                                                                                                                                                                                                                                  |
| v0.8.0  | File History (`git log --follow`, follows renames) with on-click diff at each revision                                                                                                                                                                                                                                                                                                                                                                                                        |
| v0.9.0  | Test suite (frontend 42 / backend 14) + CI integration; fixed file_history follow-rename bug                                                                                                                                                                                                                                                                                                                                                                                                  |
| v0.9.1  | Refs panel HEAD pin at the top; Topbar app menu (☰) collapses Open / Recent / Close / About / Quit; new `Ctrl+O`                                                                                                                                                                                                                                                                                                                                                                             |
| v0.10.0 | Worktrees view: list + add (with branch & dir picker) + remove (incl. force) + prune; Sidebar 7th entry, `Ctrl+9`                                                                                                                                                                                                                                                                                                                                                                             |
| v0.10.1 | .gitignore editor: 3-column layout + 8 templates + live preview (`is_path_ignored`-based), atomic save; `Ctrl+0`                                                                                                                                                                                                                                                                                                                                                                              |
| v0.10.2 | Topbar Undo button: infers latest dangerous op from reflog, one-click mixed reset; dropdown lists 8 most recent undoables                                                                                                                                                                                                                                                                                                                                                                     |
| v0.10.3 | History large-repo perf: cursor-based pagination (1000 first / 1000 incremental) + incremental graph layout (lane state across pages)                                                                                                                                                                                                                                                                                                                                                         |
| v0.11.0 | History search (Ctrl+Shift+F): message + diff pickaxe + regex/literal + path scope; cargo `regex` dep added; sidebar grows to 11                                                                                                                                                                                                                                                                                                                                                              |
| v0.12.0 | Multi-repo tabs: RepoTabs strip above Topbar, `Ctrl+T` new / `Ctrl+W` close / double-click rename; per-tab view/filter/selection state                                                                                                                                                                                                                                                                                                                                                        |
| v0.12.1 | Test coverage push: 15 new diff/blame/commit_ops/workspace integration tests (35 → 50); fixed `blame::previous_filename` cross-rename bug                                                                                                                                                                                                                                                                                                                                                     |
| v0.13.0 | Bilingual docs: introduced `README.zh.md` and `USAGE.en.md`; both originals gain a language switcher header                                                                                                                                                                                                                                                                                                                                                                                   |
| v0.13.1 | Structured error handling: backend `AppError` (10-kind tagged enum auto-derived from `git2::Error`) + frontend toast queue (`useToasts` + `ToastContainer`) + global `unhandledrejection` safety net; Topbar banner now distinguishes NonFastForward / Auth                                                                                                                                                                                                                                   |
| v0.13.2 | Release-pipeline signing-key governance: new `signing-preflight` job (fails fast when the secret is missing) + `scripts/check-signing-key.ts` (pubkey ↔ privkey fingerprint check) + `publish-latest-json` job (aggregates `.sig`s into the updater index); README gains a "Configuring updater signing keys" section                                                                                                                                                                         |
| v0.13.3 | Bidirectional Diff editor: Side-by-side mode on a working-tree file gains an Edit toggle that turns the right pane into a live textarea while the left pane stays a read-only HEAD reference; Save atomically writes back and refreshes the underlying diff; backend `read/write_working_file` + `read_head_file` ship with path-traversal / binary / 8 MB safeguards                                                                                                                         |
| v0.13.4 | Search v2: Group-by toggle (commit / file rollup), recent-12 queries dropdown (structurally deduped), ★ Save (named, localStorage-backed); pure helpers `searchAggregate` + `searchPersist` shipped with 8 / 14 bun:test cases respectively                                                                                                                                                                                                                                                   |
| v0.13.5 | Tabs v2: cross-session persistence (`gittools.tabs.v1` localStorage, restores tab order + pinned state on next launch), tab pinning (`Ctrl+W` refused, batch closes preserve), HTML5 drag-to-reorder (drag across pinned/unpinned boundary auto-pins/unpins), right-click menu (Pin/Close/Close others/Close to right), `Ctrl+PageDown` / `Ctrl+PageUp` cycle; pure helpers `reorderTabs` + `togglePin` + `nextTabId` covered by 17 bun:test cases including a brute-force invariant property |

---

## Feedback & extension

- **Add a Rust command**: append a `#[tauri::command]` to `src-tauri/src/commands.rs`, register it in `lib.rs`'s `invoke_handler!`, and add a wrapper to `src/ipc/git.ts`
- **Add a view**: extend `ViewKey` in `stores/app.ts`, add a route in `App.tsx`, an item in `Sidebar.tsx`, and labels in `lib/locales/{en,zh}.ts`
- **Tweak theme colors**: `src/styles/globals.css` top: `--branch-1..5`, `--diff-*` variables; plus the `BRANCH_COLORS` literal in `GraphRow.tsx`
- **Add an i18n key**: add it to `lib/locales/en.ts` first; the `Dict` type forces `zh.ts` to stay in sync at compile time

---

**Happy hacking!** 🎉
