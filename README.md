# Git Tools

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
8. ✅ Remote ops — Fetch / Pull / Push buttons in the topbar (delegates to system `git` so the user's existing credential helper / SSH key / 2FA setup just works). Result banner shows stdout/stderr.
9. ✅ Global UX — keyboard shortcuts (`Ctrl+1/2/3/4` switch view, `F5`/`Ctrl+R` refresh, `Alt+1/2/3` accept in merge), Refresh button, Recent repositories (localStorage), top-level `ErrorBoundary`, IDEA-style dark theme, zero-asset cross-platform font fallback (sans + mono with CJK).
10. ✅ Open Design driven UI — per-page HTML drafts in `design/` (history.html / diff.html / merge.html / index.html sharing `design.css`); the React implementation is a 1:1 port of those drafts.
11. ✅ Distribution — `bun run tauri:build` produces signed-ready Windows MSI (~2.7 MB) and NSIS (~2.0 MB) installers; release-profile binary is ~5.4 MB after LTO + strip. macOS `.dmg` / Linux `.deb`/`.rpm`/`.AppImage` build from the same source on those platforms.

### Backlog (post-v0.1.0)

- ⏳ Built-in stash / unstash workflow.
- ⏳ Native libgit2-driven push/pull with progress UI and credential dialogs (current implementation shells out to system `git`).
- ⏳ Per-line blame following file renames (`-C` / `-M`).
- ⏳ Code signing (Windows EV cert / macOS notarization) so installers don't trigger SmartScreen / Gatekeeper.

## Cross-platform notes

`git2-rs` is configured with `vendored-libgit2` + `vendored-openssl`, so no system libssh/libgit2 dependency on any OS.
