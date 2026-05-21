# Git Tools

[![CI](https://github.com/hyzmm/git-merger/actions/workflows/ci.yml/badge.svg)](https://github.com/hyzmm/git-merger/actions/workflows/ci.yml)
[![Release](https://github.com/hyzmm/git-merger/actions/workflows/release.yml/badge.svg)](https://github.com/hyzmm/git-merger/actions/workflows/release.yml)

IDEA-style **History / Diff / Merge** for any local Git repository, packaged as a cross-platform desktop app.

> 👉 **End-user docs**: see [`USAGE.md`](./USAGE.md) for installation, keyboard shortcuts, typical workflows and FAQ.

## Tech stack (latest as of 2026-05)

| Layer             | Choice                                                  |
| ----------------- | ------------------------------------------------------- |
| Desktop shell     | **Tauri 2**                                             |
| Frontend          | **React 19** + **TypeScript 5.7**                       |
| Runtime / pkg mgr | **Bun 1.3+**                                            |
| Styling           | **Tailwind CSS v4** (CSS-first config) + **shadcn/ui**  |
| Backend (Rust)    | **git2-rs** (libgit2, vendored), Tauri commands         |
| Quality           | **ESLint 9** + **typescript-eslint v8**, **Prettier 3** |

## Prerequisites

- **Bun ≥ 1.3** — https://bun.sh
- **Rust stable ≥ 1.77** — https://rustup.rs
- **Git**
- **Windows**: Microsoft Visual Studio 2019/2022 with **Desktop development with C++** workload, plus **WebView2 Runtime** (preinstalled on Win11).
- **macOS**: Xcode Command Line Tools (`xcode-select --install`).
- **Linux**: `webkit2gtk-4.1`, `libssl-dev`, `librsvg2-dev`, `libayatana-appindicator3-dev`, `build-essential`. See https://tauri.app/start/prerequisites/.

## First-time setup

```bash
cd G:\GitTools
bun install
bun run scripts/gen-icons.ts   # placeholder icons; replace later with branded ones
```

## Develop

```bash
bun run tauri:dev
```

This starts Vite at `http://localhost:1420` and Tauri opens a native window pointing to it. Hot reload works for both React and Rust (Rust rebuilds on save).

## Build (release)

```bash
bun run tauri:build
```

Artifacts:

- Windows: `src-tauri/target/release/bundle/{msi,nsis}/`
- macOS: `src-tauri/target/release/bundle/{dmg,macos}/`
- Linux: `src-tauri/target/release/bundle/{appimage,deb,rpm}/`

## Quality

```bash
bun run lint          # eslint
bun run format:check  # prettier
bun run typecheck     # tsc -b --noEmit
cargo check --manifest-path src-tauri/Cargo.toml
```

## Project layout

```
G:\GitTools
├── src/                       # React 19 + Tailwind v4 + shadcn/ui
│   ├── components/            # Sidebar, Topbar, ui/ (shadcn)
│   ├── pages/                 # HistoryPage, DiffPage, MergePage, WelcomePage
│   ├── stores/                # Zustand
│   ├── ipc/git.ts             # typed wrappers around tauri::invoke
│   ├── lib/utils.ts           # cn() helper
│   └── styles/globals.css     # Tailwind v4 entry + design tokens
├── src-tauri/                 # Rust backend
│   ├── src/
│   │   ├── lib.rs             # Tauri builder
│   │   ├── commands.rs        # #[tauri::command] surface
│   │   └── git/               # repo / log / diff / merge
│   ├── capabilities/          # ACL (Tauri 2)
│   └── tauri.conf.json
├── design/                    # Open Design HTML drafts (visual reference)
├── scripts/gen-icons.ts       # placeholder icon generator
└── package.json
```

## Roadmap

### v0.1.0 — Shipped

1. ✅ Skeleton (Tauri 2 + React 19 + Tailwind v4 + shadcn-ish tokens)
2. ✅ Rust git layer — `repo` / `log` / `diff` / `merge` / `refs` / `blame` / `workspace` / `remote` fully wired through git2-rs (vendored libgit2). 23 typed `#[tauri::command]`s exposed.
3. ✅ History page — DAG with 5-color lane assignment, ref chips (HEAD/branch/remote/tag), filter (message / author / oid / ref), commit details panel with file list (A/M/D/R/C/T + line stats) and full message. Virtualized with `@tanstack/react-virtual` for 100k-commit smoothness.
4. ✅ Diff page — side-by-side & unified modes, line-level coloring, **word-level** LCS-based highlighting on replace pairs, **Shiki syntax highlighting** for ~35 languages (TS/Rust/Python/Go/C++/...), whitespace visualization (`·` / `→`), file tree grouped by directory, Blame jump.
5. ✅ Merge page — 3-pane conflict editor (LEFT ours / RESULT editable / RIGHT theirs), conflict block parsing (`<<<<<<<` / `|||||||` / `=======` / `>>>>>>>`, diff3-aware), Accept Left/Right/Both per block, manual editing, "Mark resolved & stage" (writes file + `git add`), in-app **Abort merge** and **Commit merge** buttons.
6. ✅ Blame view — line-by-line history, consecutive lines from the same commit are visually grouped (IDEA-style), short-oid clickable to jump to that commit. Virtualized + Shiki-highlighted.
7. ✅ Changes view (working tree) — Stage / Unstage / Discard with file checkboxes, side-panel commit form (uses git config signature, HEAD as parent). Three sections: Unmerged / Staged / Unstaged.
8. ✅ Remote ops — Fetch / Pull / Push buttons in the topbar with native libgit2 transport, live progress (receiving / indexing / pushing), an interactive credential prompt for HTTPS, and SSH agent + `~/.ssh/id_*` key fallback. Result banner shows per-remote details. (Originally shelled out to system `git`; replaced in v0.5.0.)
9. ✅ Global UX — keyboard shortcuts (`Ctrl+1..5` switch view, `F5`/`Ctrl+R` refresh, `Alt+1/2/3` accept in merge), Refresh button, Recent repositories (localStorage), top-level `ErrorBoundary`, IDEA-style dark theme, zero-asset cross-platform font fallback (sans + mono with CJK).
10. ✅ Open Design driven UI — per-page HTML drafts in `design/` (history.html / diff.html / merge.html / index.html sharing `design.css`); the React implementation is a 1:1 port of those drafts.
11. ✅ Distribution — `bun run tauri:build` produces signed-ready Windows MSI (~2.7 MB) and NSIS (~2.0 MB) installers; release-profile binary is ~5.4 MB after LTO + strip. macOS `.dmg` / Linux `.deb`/`.rpm`/`.AppImage` build from the same source on those platforms.

### v0.2.0 — Shipped

1. ✅ **Stash workflow** — dedicated Sidebar view with list / Apply / Pop / Drop, plus a "Stash…" button on the Changes page (supports include-untracked).
2. ✅ **Branch & tag management** — RefsPane right-click menu (Checkout / New branch from / Rename / Delete; Checkout-as-new-local for remote branches; New-branch-from-tag / Delete-tag for tags) and a "+" button to create branches from HEAD. Double-click a local branch to checkout.
3. ✅ **Commit context menu** — right-click any commit in History for Cherry-pick / Revert / Reset (soft / mixed / hard) / Create branch from here / Create tag here / Checkout (detached) / Copy SHA / Copy message. Auto-jumps to Merge view on cherry-pick / revert conflicts.
4. ✅ **Diff navigation** — `n` / `p` (and toolbar arrows) jump between hunks within the current file; **Ignore-Whitespace** toggle re-runs `libgit2` with `ignore_whitespace`, complementing the existing whitespace-visualization toggle.
5. ✅ **Advanced history filters** — author dropdown (auto-collected, sorted by frequency), date range pickers (since / until), and `Path` input that delegates to a backend `git log -- <path>` walk for commits-touching-path semantics.

### v0.3.0 — Shipped

1. ✅ **Reflog view** — Sidebar entry showing `HEAD@{N}` history with action category color-coded (commit / reset / checkout / merge / rebase / cherry-pick / revert / pull). Per-entry **Restore** (mixed reset to that state) and **Hard** reset buttons turn the reflog into an undo timeline.
2. ✅ **Annotate previous revision** — when a Blame view is open, the toolbar shows an "Annotate previous" button driven by `Diff::find_similar`-based rename detection. Click to jump to the file's previous identity (path + commit), with a back stack to retrace the chain. Solves the IDE-hostile case where a file has been renamed.
3. ✅ **Submodules view** — list of submodules with derived status badges (`not cloned` / `not initialized` / `needs update` / `dirty` / `clean`), plus per-row **Init** / **Update** / **Sync** buttons. Status is computed via `submodule_status` (`WD_*` flags); update uses `Submodule::update`.

### v0.4.0 — Shipped

1. ✅ **GitHub Actions CI** — `ci.yml` (typecheck + lint + format:check + cargo check + clippy on every push) and `release.yml` (4-platform matrix on tag push: windows / macos-arm64 / macos-intel / linux → drafts a Release with all installers attached). `.gitattributes` enforces LF for cross-platform diffs.
2. ✅ **Settings panel** — Topbar gear icon opens a dialog with theme (auto / light / dark with FOUC-free pre-paint via inline localStorage script), font size, tab width, language (en / zh) and `core.autocrlf` editor (writes to local repo or global ~/.gitconfig via `git2::Config`).
3. ✅ **Auto-update** — `tauri-plugin-updater` configured against `https://github.com/.../releases/latest/download/latest.json`. Topbar shows a clickable badge when an update is available; release notes preview, download progress bar, and one-click "Restart now". CI signs updater bundles with the `TAURI_SIGNING_PRIVATE_KEY` repo secret (a minisign keypair was generated and the public key is committed in `tauri.conf.json`).
4. ✅ **i18n** — typed lightweight dictionary (no i18next dependency, ~1 kB) in `lib/i18n.ts`, `en` + `zh` locales for the user-facing chrome (Sidebar / Topbar / Welcome / Settings / Updater). Auto-detects from `navigator.language` on first run, switches live via Settings → Language.

### v0.5.0 — Shipped

1. ✅ **Native push / pull / fetch via git2-rs** — replaced the shell-out to system `git`. Pull is fast-forward-only (a non-FF prompts the user toward the merge UI); push auto-resolves the upstream remote from the branch config and supports `-u` for first-time pushes; fetch hits all configured remotes by default and prunes stale refs.
2. ✅ **Live remote progress** — `transfer_progress` / sideband / `push_transfer_progress` / `push_update_reference` callbacks emit `git://progress` events; the Topbar shows "Receiving 1234/5678", "Indexing", "Pushing", and per-ref push status in real time.
3. ✅ **Credential dialog** — when libgit2 needs `USER_PASS_PLAINTEXT` and no credential helper / SSH key satisfies it, the backend `emit`s a `git://credentials-needed` event; a modal collects the username + token and the libgit2 callback unblocks via a `Condvar`. Resolution order: SSH agent → default `~/.ssh/id_{ed25519,rsa,ecdsa}` keys → `Cred::credential_helper` (HTTPS) → user prompt (≤3 retries, 2-min timeout).

### v0.6.0 — Shipped

1. ✅ **Interactive Rebase** — right-click a commit in History → "Rebase interactively from here". The Rebase page lists `base..HEAD` with per-commit action selectors (pick / reword / squash / fixup / drop) and ↑/↓ reorder buttons. Reword / squash steps expose an inline message editor. Once started, the executor cherry-picks each step in order; on conflict it pauses, the Topbar shows the progress bar with conflict tone, and the user resolves via the Merge view and clicks **Continue**. **Abort** restores the original branch tip from the saved state. Plan + state are persisted to `.git/gittools-rebase/state.json` so a closed window doesn't lose progress.

### v0.7.0 — Shipped

1. ✅ **Command Palette (`Ctrl+K` / `Ctrl+P`)** — IDEA-style "Search Everywhere" overlay. Aggregates four sources into one fuzzy-ranked list: app views (Sidebar entries), refs (branches + tags), commits (oid + summary + author), and tracked files (HEAD tree walked once and cached per repo). Subsequence matcher with prefix / word-boundary / consecutive-run / case-sensitivity bonuses, plus a small per-kind tie-breaker (refs > files > commits > views). ↑↓ to navigate, Enter to act: refs check out (local) or jump to commit (remote/tag), commits jump-and-select in History, files open in Blame, views switch the page. Matched characters are highlighted inline.

### v0.8.0 — Shipped

1. ✅ **File History view** — `git log --follow -- <path>` equivalent. Walks HEAD backwards collecting commits that touch a tracked path; on each step uses libgit2's `Diff::find_similar` (renames + copies) to detect when a commit is a rename and switches the tracked path to the old name to keep following the chain. Each entry carries the path-at-that-commit, the change status (added / modified / deleted / renamed / copied / typechange), and per-file +/- line stats. Two-pane page: left commit list with rename arrows, right diff of the file's version at the selected commit (Side-by-side / Unified mode toggle, reuses the existing diff renderer). Entry points: Diff toolbar **History** button, Blame toolbar **File history** button, and a right-click on any file in Commit Details (also offers "Open diff at this commit" / "Blame current version" / "Copy path").

### v0.9.0 — Shipped

1. ✅ **Test suite** — Frontend: `bun test` over `lib/` covering `fuzzy.ts` (subsequence matcher + highlight), `wordDiff.ts` (LCS + tokenization edge cases), `conflictParser.ts` (parse / resolveText / joinChunks / chunkSummary, including diff3-style and multi-conflict files), `graph.ts` (lane assignment, branch+merge, root commit, through-segments). 42 tests, ~60 ms. Backend: `cargo test --test git_layer` with a `tempfile`-based `TempRepo` helper that builds throwaway repos in temp dirs, covering `log` (pathspec filter), `refs_ops` (create/rename/delete branches + lightweight & annotated tags), `commit_ops` (`reset --hard` + invalid mode error), `stash` (save→apply→drop round trip), `reflog`, `file_history` (basic + **rename-following**), and `rebase` (pick reorder, drop, abort restore). 14 tests across 9 modules, ~200 ms.
2. ✅ **Bug found by file_history test** — fixed `git/file_history.rs`: the per-step diff used `DiffOptions::pathspec(&tracked)` _before_ `find_similar`, which prevented libgit2 from pairing the deleted old path with the added new path on a rename commit. Removed the pathspec restriction; we filter to `tracked` ourselves once similarity is resolved. v0.8.0's "follows renames" claim now actually holds.
3. ✅ **CI integration** — `ci.yml` runs `bun run test` after lint + format-check on the frontend job, and `cargo test --all-features` after `cargo clippy --tests` on the backend job. `tsconfig.json` excludes `*.test.ts` so test files don't pollute production type-checking.

### v0.9.1 — Shipped

1. ✅ **HEAD pin in Refs panel** — `RefsPane.tsx` now renders a dedicated HEAD section above LOCAL/REMOTE/TAGS. When attached, shows the current branch name + short oid; when detached, shows `(detached)` with the short oid. Click to jump-to-HEAD-commit. Visually distinguished by a left edge accent bar and a half-opacity highlight background so the user always knows where HEAD is without scanning the branch list.
2. ✅ **App menu (☰) in Topbar** — New `AppMenu.tsx` component replaces the previous "Open Repository" button at the top-left with a hamburger icon. The menu collapses low-frequency actions: **Open repository…** (`Ctrl+O`), **Recent repositories** (inline list, up to 8 entries, hover-to-remove with ×), **Close repository**, **About Git Tools** (modal showing app name + version + GitHub link), **Quit** (`Alt+F4`). High-frequency buttons (Refresh / Fetch / Pull / Push / Search / Settings / Updater) stay directly on the Topbar. Added global `Ctrl+O` shortcut to open the repository picker without opening the menu. New i18n keys: `topbar.menu`, `menu.*`, `about.*` for both `en` and `zh` locales.

### v0.10.0 — Shipped

1. ✅ **Worktrees view** — Full `git worktree` lifecycle UI implemented natively on top of libgit2's `git_worktree_*` C API (no fork-and-exec to system git). Backend module `git/worktree.rs` exposes 4 functions: `list` (returns the main checkout plus every linked worktree, each with branch / HEAD oid / `is_locked` / `is_prunable`), `add` (with optional existing-branch attachment via `WorktreeAddOptions::reference`), `remove` (configurable force flag toggling `WorktreePruneOptions::valid + working_tree`), and `prune` (sweeps every dangling worktree whose working dir was nuked from disk). Frontend `WorktreesPage.tsx` shows the list with main pinned to the top with an accent background + half-opacity highlight, status badges (`main` / `locked` / `prunable`), an inline Add form with directory picker and optional branch chooser, and per-row Remove (clean) / Force-remove (with confirm) buttons. Sidebar grows to 9 entries with `Ctrl+9` global shortcut. New i18n keys: `sidebar.worktrees` + 19 `worktrees.*` keys mirrored in `en` and `zh`. Test surface: 3 new integration tests in `tests/git_layer.rs` covering `list_returns_main_only_for_fresh_repo`, `add_and_remove_round_trip`, and `prune_cleans_dangling_metadata`. Total backend tests now 17 (up from 14).

### v0.10.1 — Shipped

1. ✅ **.gitignore editor view** — A three-column visual editor for the repository-root `.gitignore`. Backend `git/gitignore.rs` exposes `read` (returns empty string when the file is missing), `write` (atomic rename via a sibling `.gitignore.tmp`), `preview` (the centerpiece — see below), and `templates` (8 curated starter packs: Node / Rust / Python / Go / macOS / Windows / JetBrains / VS Code). Frontend `GitignorePage.tsx` lays out templates on the left (click to append), a monospace textarea in the middle with line / char counter and `unsaved` badge when dirty, and a preview panel on the right showing **newly-ignored** (orange `+`) and **no-longer-ignored** (green `−`) working-tree paths relative to disk. Sidebar grows to 10 entries (now wraps to two rows of 5 in the icon column on narrow displays); `Ctrl+0` opens the view.

2. ✅ **Non-destructive ignore preview** — The preview command's interesting trick: to compare candidate text against the on-disk file without permanently modifying anything, we briefly rename `<workdir>/.gitignore` to `<workdir>/.gitignore.gittools-preview-bak`, open a _fresh_ `Repository` handle so libgit2 rebuilds its per-handle ignore cache, inject the candidate via `add_ignore_rule`, walk every path returned by `Repository::statuses(include_ignored=true)` and call `is_path_ignored` to compute the candidate ignore state, then a Drop guard renames the file back — even on panic. Window is single-digit milliseconds. Results are capped at 200 entries per side so the UI doesn't drown on huge monorepos.

3. ✅ **Tests + i18n** — 5 new integration tests: `read_returns_empty_when_missing`, `write_then_read_round_trips`, `preview_marks_newly_ignored_path`, `preview_marks_no_longer_ignored_when_rule_removed`, `templates_are_well_formed`. Total backend now 22 (up from 17). 22 `gitignore.*` i18n keys mirrored in `en` and `zh`.

### v0.10.2 — Shipped

1. ✅ **Reflog quick actions (Topbar Undo button)** — A new `↺Undo` split-button surfaces the most recent meaningfully-undoable HEAD movement straight from the Topbar, no Reflog-view detour required. The classifier in `src/lib/reflogActions.ts` parses each `ReflogEntry.message` and labels it with one of `commit / amend / reset / merge / pull / push / cherry-pick / revert / rebase / checkout / branch / stash / other`, marking only `amend / reset / merge / pull / cherry-pick / revert / rebase(start|finish)` as undoable. Plain `commit` is intentionally excluded so the button can't silently drop authored work — and `findQuickUndo` further refuses to scan past a plain commit barrier, so the button hides itself the moment you make new authored progress. `listUndoables` extracts up to 8 candidates for the chevron's dropdown menu, each with one-click undo.

2. ✅ **One-click semantics** — Click main button → `git reset --mixed <oldOid>` to the OID HEAD pointed at _before_ the action ran (preserves working-tree edits, fully recoverable from reflog itself). The chevron's dropdown lists every other undoable entry with the same one-click action. Tooltip dynamically reads "Undo merge" / "Undo reset --hard" / "Undo cherry-pick" matching the verb.

3. ✅ **Tests** — 12 new bun:test cases in `src/lib/reflogActions.test.ts` covering the classifier (commit / amend / reset / merge / pull / cherry-pick / revert / rebase start vs (pick) vs (finish), and all the non-undoable shapes) plus `findQuickUndo` (empty / most-recent / skip-non-undoables / commit-barrier) and `listUndoables` (filtering and limit). Total frontend bun:test now 54 (up from 42). 7 new `undo.*` i18n keys mirrored in `en` and `zh`.

### v0.10.3 — Shipped

1. ✅ **Cursor-based history pagination** — Replaces the previous "load 5000 commits up front" model with a real streaming walker. Backend `git/log.rs` exposes a new `log_page(after: Option<oid>, limit, pathspec)` returning `{ commits, has_more, next_cursor }`; cursor is the OID of the page's last commit, and the next call pushes that commit's parents into a fresh `revwalk` so the cursor itself isn't yielded twice. The old `git_log` command stays put for compatibility, but the History view now uses `git_log_page` with first-page limit 1000 and identical 1000-commit follow-up pages, fetched lazily as the user virtually scrolls the list.

2. ✅ **Incremental graph layout** — `src/lib/graph.ts` is split into `createLayoutState()` + `extendLayout(state, commits)` so the lane allocator can carry across pages. A merge commit on page 1 reserving a lane for a parent that only shows up on page 5 still gets the same dot color resolved when it finally arrives. The `CommitList` component caches the layout state in a ref keyed by the unfiltered `commits` array identity; appending a new page walks only the delta, while a hard reset (filter change, repo switch) rebuilds. End result: scrolling and pulling pages are both O(page-size), not O(history-size).

3. ✅ **Auto-load near tail** — `CommitList` watches the virtualizer's last visible row and triggers `loadMoreHistory()` when within 20 unfiltered rows of the tail. While a user filter is active, the heuristic is conservative (5 rows from the _filtered_ tail) since filtering shadows real walk progress. The header gains `· +more` (when the backend signals there's another page) and `· loading more...` (during the in-flight fetch).

4. ✅ **Tests** — 5 new cargo integration tests in `tests/git_layer.rs` covering `log_page` (first page from HEAD, second page continuation without overlap, empty repo, pathspec filtering, root-commit cursor returning empty). 5 new bun:test cases in `src/lib/graph.test.ts` covering `extendLayout` round-trip equivalence with `layoutGraph`, paged extension stability, deterministic dot-column resolution for waiting parents, empty-input safety, and lane reuse across non-overlapping pages. Totals: backend **27** (up from 22); frontend **59** (up from 54).

### v0.11.0 — Shipped

1. ✅ **Cross-history search view** — A new `SearchPage` (sidebar entry 9, `Ctrl+Shift+F`) that surfaces three orthogonal axes of finding things across the entire commit DAG: **mode** (Message / Diff / Both), **kind** (Literal / Regex), **case** (Aa toggle), plus a **path** scope reusing the same pathspec semantics as History. Backend `git/search.rs::search_commits` walks `revwalk` newest-first and per commit runs (a) message regex, (b) `diff_tree_to_tree` against parent[0] (or empty tree at root) with the user's pathspec, then collects every `+`/`-` line whose content matches. Returns `{ hits, scanned, truncated }`.

2. ✅ **Pickaxe done right** — The Diff mode is the practical equivalent of `git log -G<re>` (and `-S<text>` when in Literal kind). Per-commit caps: 20 diff hits max (UI wouldn't be useful with more), 2 MB patch budget (skip auto-bundled vendored files), context_lines=0 to keep output tight. Walk caps: 5000 commits scanned, 500 hits collected. The `truncated` flag surfaces both stop conditions to the UI as an amber badge so users know they may want to narrow with a path scope.

3. ✅ **Two-pane UI** — Left pane: toolbar + result list with per-row badges (`msg` for message match, `+/− N` for diff hits) plus author/time/short-oid metadata. Right pane: the selected hit's commit summary header with a one-click **Open** button that jumps to History view and selects that commit, then below it (a) the matched message excerpt for message hits and (b) per-file grouped diff hits with line numbers, `+`/`−` markers, and proper green/red colouring. Enter submits the search; Esc clears it.

4. ✅ **State + i18n** — New `SearchView` Zustand slice with 8 actions (setQuery / setMode / setPatternKind / toggleCase / setPathspec / selectHit / runSearch / clearSearch) — `clearSearch` deliberately preserves mode/kind/case/path preferences across resets. 24 new `search.*` i18n keys mirrored in en/zh. Sidebar grows to 11 entries (`Search` icon between gitignore and Diff). Cargo dependency `regex = "1"` added.

5. ✅ **Tests** — 8 new cargo integration tests in `tests/git_layer.rs`: message-mode finds matching commit; diff-mode pickaxe finds an added line; both-mode unions message + diff hits; regex kind treats pattern as a regex; case sensitivity is honoured both ways; pathspec scopes to a directory; empty pattern returns no hits; max_commits truncates the walk. Totals: backend **35** (up from 27).

### v0.12.0 — Shipped

1. ✅ **Multi-repo tabs** — A new `RepoTabs` strip above the Topbar that lets you keep several repositories open at once and bounce between them without losing state. The bar auto-hides when there's only ≤ 1 tab so the single-repo workflow stays uncluttered. New global shortcuts: `Ctrl+T` (new blank tab), `Ctrl+W` (close current tab). Double-click a tab label to rename. Same-repo de-duplication: re-opening a repo that already has a tab routes to the existing tab instead of creating a duplicate.

2. ✅ **Zero-touch refactor pattern** — The store keeps the _active_ tab's state mirrored at the top level so all 240+ `useApp(s => s.history.commits)` selectors and 28 component files keep working unchanged. Inactive tabs park their state in `sessionsById: Record<tabId, SessionSnapshot>`. Switching tabs is a single batch swap: snapshot the current top-level fields into the old tab's slot, then apply the new tab's snapshot onto the top level. Per-tab state spans every existing slice — repo / view / history / diff / merge / blame / changes / stash / reflog / submodules / rebase / fileHistory / worktrees / gitignore / search.

3. ✅ **AppMenu integration** — The hamburger menu gains a "New tab" item right under "Open repository". The existing "Close repository" was redefined to mean "close current tab" (which falls back to a sensible neighbour, or the welcome page if it was the last one).

4. ✅ **Decisions deferred to a future minor** — Cross-process tab persistence (recall the same set of tabs on app restart) is intentionally NOT implemented in v0.12.0. The recent-repositories list already covers the common "I want to reopen what I was working on" case, and persisting full session snapshots adds quota / serialization complexity (e.g. `Set<string>` in changes view) without a clear short-term payoff.

### Backlog (post-v0.12.0)

- ⏳ Code signing (Windows EV cert / macOS notarization) so installers don't trigger SmartScreen / Gatekeeper.

## Cross-platform notes

`git2-rs` is configured with `vendored-libgit2` + `vendored-openssl`, so no system libssh/libgit2 dependency on any OS.
