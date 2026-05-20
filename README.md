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

### Backlog (post-v0.5.0)

- ⏳ Interactive Rebase (drag-to-reorder, pick / squash / reword / drop).
- ⏳ Code signing (Windows EV cert / macOS notarization) so installers don't trigger SmartScreen / Gatekeeper.
- ⏳ Unit tests for `lib/graph.ts`, `lib/wordDiff.ts`, `lib/conflictParser.ts` (vitest) and Rust integration tests with `tempfile`-built repos.

## Cross-platform notes

`git2-rs` is configured with `vendored-libgit2` + `vendored-openssl`, so no system libssh/libgit2 dependency on any OS.
