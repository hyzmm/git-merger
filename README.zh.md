# Git Tools

[English](./README.md) · **简体中文**

[![CI](https://github.com/hyzmm/git-merger/actions/workflows/ci.yml/badge.svg)](https://github.com/hyzmm/git-merger/actions/workflows/ci.yml)
[![Release](https://github.com/hyzmm/git-merger/actions/workflows/release.yml/badge.svg)](https://github.com/hyzmm/git-merger/actions/workflows/release.yml)

面向任意本地 Git 仓库的 IDEA 风格 **History / Diff / Merge** 工具，打包为跨平台桌面应用。

> 👉 **终端用户文档**：见 [`USAGE.md`](./USAGE.md)（中文）/ [`USAGE.en.md`](./USAGE.en.md)（English），包含安装、快捷键、典型工作流与 FAQ。

## 技术栈（截至 2026-05）

| 层级           | 选型                                                     |
| -------------- | -------------------------------------------------------- |
| 桌面外壳       | **Tauri 2**                                              |
| 前端           | **React 19** + **TypeScript 5.7**                        |
| Runtime / 包管 | **Bun 1.3+**                                             |
| 样式           | **Tailwind CSS v4**（CSS-first 配置）+ **shadcn/ui**     |
| 后端（Rust）   | **git2-rs**（vendored libgit2）+ Tauri commands          |
| 质量门         | **ESLint 9** + **typescript-eslint v8** + **Prettier 3** |

## 环境依赖

- **Bun ≥ 1.3** — https://bun.sh
- **Rust stable ≥ 1.77** — https://rustup.rs
- **Git**
- **Windows**：Visual Studio 2019/2022 + **使用 C++ 的桌面开发** 工作负载，外加 **WebView2 Runtime**（Win11 自带）
- **macOS**：Xcode Command Line Tools（`xcode-select --install`）
- **Linux**：`webkit2gtk-4.1`、`libssl-dev`、`librsvg2-dev`、`libayatana-appindicator3-dev`、`build-essential`。详见 https://tauri.app/start/prerequisites/

## 首次安装

```bash
cd G:\GitTools
bun install
bun run scripts/gen-icons.ts   # 生成占位图标，后续可替换为正式品牌图
```

## 开发模式

```bash
bun run tauri:dev
```

会在 `http://localhost:1420` 启动 Vite，Tauri 打开一个原生窗口指向它。React 与 Rust 都支持热重载（Rust 保存后增量重编）。

## 构建（release）

```bash
bun run tauri:build
```

产物位置：

- Windows：`src-tauri/target/release/bundle/{msi,nsis}/`
- macOS：`src-tauri/target/release/bundle/{dmg,macos}/`
- Linux：`src-tauri/target/release/bundle/{appimage,deb,rpm}/`

## 配置自动更新签名密钥

自动更新使用的 bundle 由 [minisign](https://jedisct1.github.io/minisign/) 密钥对签名。**公钥** 提交在 `src-tauri/tauri.conf.json::plugins.updater.pubkey`；**私钥** 只放在 GitHub Secret `TAURI_SIGNING_PRIVATE_KEY`（如果生成时带密码，再加 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`）。

Fork 本仓库且想发布自己签名版本时：

```bash
# 1. 生成新的密钥对（Tauri CLI 是 minisign 的薄封装）
bun x @tauri-apps/cli signer generate -w ~/.tauri/<your-app>.key

# 2. 命令打印的公钥已是 base64 包装的，直接粘贴到
#    src-tauri/tauri.conf.json 的 plugins.updater.pubkey 字段

# 3. 本地验证 pubkey 与 privkey 指纹一致：
bun run check-signing-key

# 4. 把 <your-app>.key 文件**完整内容**加到 GitHub Secrets：
#    Settings → Secrets and variables → Actions →
#       TAURI_SIGNING_PRIVATE_KEY = （粘贴 .key 文件全部内容）
#       TAURI_SIGNING_PRIVATE_KEY_PASSWORD = （仅当生成时设了密码）
```

Release 流水线的 `signing-preflight` job 会在 `TAURI_SIGNING_PRIVATE_KEY` 为空时**直接失败**——避免静默发出无法被 updater 校验的安装包。如果确实想跑一次未签名的演练，把仓库 variable `RELEASE_ALLOW_UNSIGNED` 设为 `true`，流水线会继续但会在 release notes 顶部加显眼警告。

## 质量门

```bash
bun run lint          # eslint
bun run format:check  # prettier
bun run typecheck     # tsc -b --noEmit
cargo check --manifest-path src-tauri/Cargo.toml
```

## 项目结构

```
G:\GitTools
├── src/                       # React 19 + Tailwind v4 + shadcn/ui
│   ├── components/            # Sidebar、Topbar、ui/（shadcn）
│   ├── pages/                 # HistoryPage、DiffPage、MergePage、WelcomePage
│   ├── stores/                # Zustand
│   ├── ipc/git.ts             # 类型化的 tauri::invoke 包装
│   ├── lib/utils.ts           # cn() 辅助
│   └── styles/globals.css     # Tailwind v4 入口 + 设计 tokens
├── src-tauri/                 # Rust 后端
│   ├── src/
│   │   ├── lib.rs             # Tauri builder
│   │   ├── commands.rs        # #[tauri::command] 暴露面
│   │   └── git/               # repo / log / diff / merge / …
│   ├── capabilities/          # Tauri 2 ACL
│   └── tauri.conf.json
├── design/                    # Open Design HTML 草稿（视觉参考）
├── scripts/gen-icons.ts       # 占位图标生成脚本
└── package.json
```

## 路线图

### v0.1.0 — 已完成

1. ✅ 工程骨架（Tauri 2 + React 19 + Tailwind v4 + 类 shadcn tokens）
2. ✅ Rust git 层 — `repo` / `log` / `diff` / `merge` / `refs` / `blame` / `workspace` / `remote` 全部走 git2-rs（vendored libgit2）。23 个类型化 `#[tauri::command]` 暴露给前端。
3. ✅ History 页 — DAG（5 色 lane 分配）、ref 徽章（HEAD/branch/remote/tag）、过滤（message / author / oid / ref）、commit 详情面板（含文件列表 A/M/D/R/C/T + 行级 +/- 统计 + 完整 message）。`@tanstack/react-virtual` 虚拟滚动，10 万 commit 仍流畅。
4. ✅ Diff 页 — 并排 / Unified 两种模式、行级染色，替换对采用基于 LCS 的**词级**高亮，**Shiki** 语法高亮覆盖约 35 种语言（TS/Rust/Python/Go/C++ …），空白可视化（`·` / `→`），文件树按目录分组，支持跳转 Blame。
5. ✅ Merge 页 — 三栏冲突编辑器（LEFT ours / RESULT 可编辑 / RIGHT theirs），冲突块解析（`<<<<<<<` / `|||||||` / `=======` / `>>>>>>>`，diff3-aware），单 block 的 Accept Left/Right/Both，支持手动编辑，"Mark resolved & stage"（写回文件 + `git add`），应用内 **Abort merge** 与 **Commit merge** 按钮。
6. ✅ Blame 视图 — 行级历史，同 commit 连续行视觉合并（IDEA 风格），短 oid 可点击跳到对应 commit，虚拟滚动 + Shiki 高亮。
7. ✅ Changes 视图（工作树）— Stage / Unstage / Discard 复选框，侧边 commit 表单（用 git config 签名，HEAD 作 parent）。三段式：Unmerged / Staged / Unstaged。
8. ✅ 远程操作 — Topbar 上的 Fetch / Pull / Push 按钮，原生 libgit2 传输，进度实时（receiving / indexing / pushing），HTTPS 凭据交互弹窗，SSH agent + `~/.ssh/id_*` key 回退。结果 banner 给出每个 remote 的细节。（v0.5.0 起从 system git 切换到原生。）
9. ✅ 全局 UX — 快捷键（`Ctrl+1..5` 切视图、`F5` / `Ctrl+R` 刷新、`Alt+1/2/3` Merge accept）、Refresh 按钮、Recent 仓库（localStorage）、顶层 `ErrorBoundary`、IDEA 暗主题、零资产跨平台字体回退（含中日韩 sans + mono）。
10. ✅ Open Design 驱动 — `design/` 下逐页 HTML 草稿（history.html / diff.html / merge.html / index.html 共享 `design.css`）；React 实现按 1:1 还原。
11. ✅ 分发 — `bun run tauri:build` 产出可签名的 Windows MSI（约 2.7 MB）与 NSIS（约 2.0 MB）安装包；release profile 二进制经 LTO + strip 后约 5.4 MB。macOS `.dmg` / Linux `.deb`/`.rpm`/`.AppImage` 在对应平台同源构建。

### v0.2.0 — 已完成

1. ✅ **Stash 工作流** — 独立 Sidebar 视图，含 list / Apply / Pop / Drop，Changes 页顶部的 "Stash…" 按钮支持 include-untracked。
2. ✅ **分支与标签管理** — RefsPane 右键菜单（Checkout / 基于此新建分支 / Rename / Delete；远端分支可 Checkout-as-new-local；标签可 New-branch-from-tag / Delete），以及右上 "+" 按钮基于 HEAD 新建分支。本地分支双击直接 checkout。
3. ✅ **Commit 右键菜单** — History 中右键任一 commit：Cherry-pick / Revert / Reset（soft / mixed / hard）/ 基于此创建分支 / 基于此创建标签 / Checkout（detached）/ Copy SHA / Copy message。Cherry-pick / revert 冲突时自动跳到 Merge 视图。
4. ✅ **Diff 导航** — `n` / `p`（含工具栏箭头）在当前文件 hunk 间跳转；**Ignore-Whitespace** 切换让 libgit2 用 `ignore_whitespace` 重算 diff，与现有的"空白可视化"互补。
5. ✅ **历史高级过滤** — 作者下拉（自动汇总，按出现频率排序）、日期范围（since / until），以及 `Path` 输入触发后端 `git log -- <path>` 走法，仅显示触及该路径的 commit。

### v0.3.0 — 已完成

1. ✅ **Reflog 视图** — Sidebar 入口，按动作类别染色 chip（commit / reset / checkout / merge / rebase / cherry-pick / revert / pull）。每条记录有 **Restore**（mixed reset 到该状态）和 **Hard** reset 按钮，把 reflog 变成"撤销时间线"。
2. ✅ **Annotate previous revision** — Blame 视图工具栏出现 "Annotate previous" 按钮，基于 `Diff::find_similar` 重命名检测。点击跳到该文件的上一身份（路径 + commit），并维护 back stack。彻底解决"文件被改名后 IDE 失忆"的痛点。
3. ✅ **Submodules 视图** — 子模块列表，状态徽章（`not cloned` / `not initialized` / `needs update` / `dirty` / `clean`），每行 **Init** / **Update** / **Sync** 按钮。状态由 `submodule_status`（`WD_*` flags）派生；更新走 `Submodule::update`。

### v0.4.0 — 已完成

1. ✅ **GitHub Actions CI** — `ci.yml`（每次 push 跑 typecheck + lint + format:check + cargo check + clippy）和 `release.yml`（tag push 触发 4 平台 matrix：windows / macos-arm64 / macos-intel / linux，drafts 一个 Release 并附带所有安装包）。`.gitattributes` 强制 LF。
2. ✅ **设置面板** — Topbar 齿轮图标弹出对话框：主题（auto / light / dark，无 FOUC，启动前内联 script 已应用 localStorage）、字号、tab 宽度、语言（en / zh），以及 `core.autocrlf` 编辑（写本地仓库或全局 `~/.gitconfig`，via `git2::Config`）。
3. ✅ **自动更新** — `tauri-plugin-updater` 配置指向 `https://github.com/.../releases/latest/download/latest.json`。Topbar 检测到更新时显示可点击徽章；release notes 预览、下载进度条、一键 "Restart now"。CI 用仓库 secret `TAURI_SIGNING_PRIVATE_KEY`（minisign keypair）签名 updater bundles，公钥已写入 `tauri.conf.json`。
4. ✅ **i18n** — 自研轻量 typed dict（无 i18next 依赖，约 1 kB），位于 `lib/i18n.ts`，初始 `en` + `zh` 覆盖应用 UI（Sidebar / Topbar / Welcome / Settings / Updater）。首次启动按 `navigator.language` 自动选择，运行时可在 Settings → Language 切换。

### v0.5.0 — 已完成

1. ✅ **原生 push / pull / fetch via git2-rs** — 取代了 shell-out system `git`。Pull 仅支持 fast-forward（非 FF 提示用户走 Merge 视图）；push 自动从 branch config 推断 upstream，首次 push 自动 `-u`；fetch 默认抓所有 remote 并 prune 失效 ref。
2. ✅ **远程实时进度** — `transfer_progress` / sideband / `push_transfer_progress` / `push_update_reference` 等回调发出 `git://progress` 事件；Topbar 实时显示 "Receiving 1234/5678" / "Indexing" / "Pushing"，及 push 后每条 ref 的状态。
3. ✅ **凭据弹窗** — 当 libgit2 需要 `USER_PASS_PLAINTEXT` 而 helper / SSH key 都未满足时，后端 `emit` 一个 `git://credentials-needed` 事件；前端弹窗收集用户名 + token，回调通过 `Condvar` 解锁 libgit2。解析顺序：SSH agent → 默认 `~/.ssh/id_{ed25519,rsa,ecdsa}` → `Cred::credential_helper`（HTTPS）→ 用户弹窗（≤3 次重试，2 分钟超时）。

### v0.6.0 — 已完成

1. ✅ **Interactive Rebase** — History 中右键 commit → "从此处开始交互式 rebase"。Rebase 页列出 `base..HEAD` 的每个 commit，每行带动作选择器（pick / reword / squash / fixup / drop）和 ↑/↓ 重排按钮。Reword / squash 步骤展开内嵌消息编辑框。开始后执行器按顺序 cherry-pick；遇冲突时暂停，Topbar 进度条变红，用户在 Merge 视图解决并 stage，再点 **Continue**。**Abort** 从保存的状态恢复原 branch tip。Plan + state 持久化到 `.git/gittools-rebase/state.json`，关闭窗口不会丢失进度。

### v0.7.0 — 已完成

1. ✅ **Command Palette（`Ctrl+K` / `Ctrl+P`）** — IDEA 风格的 "Search Everywhere" 浮层。聚合四类来源做模糊排序：app 视图（Sidebar 入口）、refs（分支 + 标签）、commits（oid + summary + author）、tracked files（HEAD tree 一次性遍历后按仓库缓存）。子序列匹配器带前缀 / 词边界 / 连续命中 / 大小写敏感等加分项，外加每类 tie-breaker（refs > files > commits > views）。↑↓ 导航、Enter 执行：refs 本地 checkout / 远端跳到 commit、commits 在 History 中 jump-and-select、files 在 Blame 中打开、views 切换页面。命中字符内联高亮。

### v0.8.0 — 已完成

1. ✅ **File History 视图** — 等价于 `git log --follow -- <path>`。HEAD 倒序遍历收集触及指定路径的 commit；每步用 libgit2 的 `Diff::find_similar` 检测重命名 / 拷贝，命中时把跟踪路径切换到旧名以延续追溯。每条记录携带"该 commit 的路径"、变更状态（added / modified / deleted / renamed / copied / typechange）和每文件 +/- 行数。两栏页面：左侧 commit 列表，右侧选中 commit 的文件 diff（Side-by-side / Unified 切换，复用主 Diff 渲染）。入口：Diff 工具栏 **History**、Blame 工具栏 **File history**、Commit Details 文件右键菜单（含 "Open diff at this commit" / "Blame current version" / "Copy path"）。

### v0.9.0 — 已完成

1. ✅ **测试套件** — 前端：`bun test` 跑 `lib/`，覆盖 `fuzzy.ts`（子序列匹配 + 高亮）、`wordDiff.ts`（LCS + tokenization 边界）、`conflictParser.ts`（parse / resolveText / joinChunks / chunkSummary，含 diff3 风格与多冲突文件）、`graph.ts`（lane 分配、分叉 + 合并、root commit、through-segments）。42 用例，约 60 ms。后端：`cargo test --test git_layer`，用基于 `tempfile` 的 `TempRepo` 辅助构建一次性仓库；覆盖 `log`（pathspec 过滤）、`refs_ops`（分支创建/重命名/删除 + lightweight & annotated tag）、`commit_ops`（`reset --hard` + 非法 mode 错误）、`stash`（save→apply→drop 闭环）、`reflog`、`file_history`（基础 + **跨重命名**）、`rebase`（pick reorder、drop、abort 恢复）。9 个模块共 14 用例，约 200 ms。
2. ✅ **由 file_history 测试暴露的 bug 修复** — `git/file_history.rs` 中每步的 diff 在 `find_similar` **之前**就调用了 `DiffOptions::pathspec(&tracked)`，过滤掉了 deleted old path delta，导致 libgit2 无法把 deleted+added 配对成 rename。改法：移除早期 pathspec 限制，let `find_similar` 跑完后由我们自己过滤到 `tracked`。v0.8.0 宣称的"跟随重命名"现在才真正成立。
3. ✅ **CI 集成** — `ci.yml` 前端 job 在 lint + format-check 之后跑 `bun run test`，后端 job 在 `cargo clippy --tests` 之后跑 `cargo test --all-features`。`tsconfig.json` 排除 `*.test.ts`，让测试文件不污染生产 type-check。

### v0.9.1 — 已完成

1. ✅ **Refs 面板顶部 HEAD 置顶** — `RefsPane.tsx` 在 LOCAL/REMOTE/TAGS 上方独立渲染 HEAD 段。已 attach 时显示分支名 + 短 oid；detached 时显示 `(detached)` + 短 oid。点击跳到 HEAD 对应 commit。视觉上左侧带主题色边条 + 半透明高亮背景，让"我现在在哪"始终一眼可见，无需滚分支列表。
2. ✅ **Topbar 应用菜单（☰）** — 新组件 `AppMenu.tsx` 替代左上角原 "Open Repository" 按钮。菜单收纳低频项：**Open repository…**（`Ctrl+O`）、**Recent repositories**（最多 8 条内联，hover 出 `×` 可移除）、**Close repository**、**About Git Tools**（弹窗：应用名 + 版本 + GitHub 链接）、**Quit**（`Alt+F4`）。高频按钮（Refresh / Fetch / Pull / Push / Search / Settings / Updater）保留在 Topbar。新增全局 `Ctrl+O` 快捷键。新增 i18n key：`topbar.menu`、`menu.*`、`about.*`，en/zh 双语补齐。

### v0.10.0 — 已完成

1. ✅ **Worktrees 视图** — 完整的 `git worktree` 生命周期 UI，原生跑在 libgit2 的 `git_worktree_*` C API 上（不 fork system git）。后端模块 `git/worktree.rs` 暴露 4 个函数：`list`（返回主检出 + 所有 linked worktree，每条带 branch / HEAD oid / `is_locked` / `is_prunable`）、`add`（可选附加已有分支，via `WorktreeAddOptions::reference`）、`remove`（可配置 force flag，切换 `WorktreePruneOptions::valid + working_tree`）、`prune`（清扫所有工作目录已不存在的 dangling worktree）。前端 `WorktreesPage.tsx` 列表展示，主检出置顶并带主题色背景 + 半透明高亮，状态徽章（`main` / `locked` / `prunable`），内联 Add 表单含目录选择器与可选分支选择器，每行 Remove（clean）/ Force-remove（带二次确认）按钮。Sidebar 增至 9 个入口，全局 `Ctrl+9` 快捷键。新增 i18n key：`sidebar.worktrees` + 19 个 `worktrees.*`，en/zh 双语补齐。测试面：`tests/git_layer.rs` 新增 3 个集成测试，覆盖 `list_returns_main_only_for_fresh_repo` / `add_and_remove_round_trip` / `prune_cleans_dangling_metadata`。后端测试总数 17（从 14）。

### v0.10.1 — 已完成

1. ✅ **.gitignore 编辑器视图** — 仓库根 `.gitignore` 的三栏可视化编辑器。后端 `git/gitignore.rs` 暴露 `read`（文件不存在时返回空串）、`write`（通过 `.gitignore.tmp` 同名 sibling 原子重命名）、`preview`（核心特性，见下）、`templates`（8 个精选 starter：Node / Rust / Python / Go / macOS / Windows / JetBrains / VS Code）。前端 `GitignorePage.tsx`：左侧模板（点击即追加）、中间等宽 textarea（行/字符计数 + 脏 `unsaved` 徽章）、右侧预览（候选规则相对磁盘 `.gitignore` 的差异）：橙色 `+` 表示**新被忽略**的工作树路径，绿色 `−` 表示**不再忽略**。Sidebar 增至 10 入口（窄屏自动换两行 5 列）；`Ctrl+0` 打开。

2. ✅ **非破坏性 ignore 预览** — preview 命令的小机巧：为了在不持久修改任何文件的前提下比较候选文本与磁盘版本，先把 `<workdir>/.gitignore` 暂时重命名为 `<workdir>/.gitignore.gittools-preview-bak`，开一个**全新** `Repository` handle（让 libgit2 重建每 handle 的 ignore cache），用 `add_ignore_rule` 注入候选文本，然后遍历 `Repository::statuses(include_ignored=true)` 返回的所有路径调 `is_path_ignored` 算 candidate 状态，最后由 Drop guard 把文件名改回（panic 也安全）。整个窗口个位数毫秒。结果每侧 cap 在 200 条，保证大型 monorepo 也不会刷爆 UI。

3. ✅ **测试 + i18n** — 5 个新集成测试：`read_returns_empty_when_missing` / `write_then_read_round_trips` / `preview_marks_newly_ignored_path` / `preview_marks_no_longer_ignored_when_rule_removed` / `templates_are_well_formed`。后端测试总数 22（从 17）。22 个 `gitignore.*` i18n key，en/zh 双语补齐。

### v0.10.2 — 已完成

1. ✅ **Reflog quick actions（Topbar Undo 按钮）** — 新的 `↺Undo` 分裂按钮把"最近一次有意义的 HEAD 移动"直接前置到 Topbar，无需进 Reflog 视图。`src/lib/reflogActions.ts` 中的分类器解析每条 `ReflogEntry.message`，打上 `commit / amend / reset / merge / pull / push / cherry-pick / revert / rebase / checkout / branch / stash / other` 标签，仅把 `amend / reset / merge / pull / cherry-pick / revert / rebase(start|finish)` 视为可撤销。普通 `commit` 故意排除——避免按钮静默丢弃刚写完的代码；同时 `findQuickUndo` 拒绝越过普通 commit 屏障继续扫描，意味着"提交完后按钮就消失"。`listUndoables` 抽出最多 8 条候选填到下拉菜单，每条一键撤销。

2. ✅ **一键语义** — 主按钮点击 → `git reset --mixed <oldOid>` 把 HEAD 重置到该操作发生**前**的 OID（保留工作目录改动，可由 reflog 自身彻底恢复）。下拉箭头展开剩余可撤销条目，相同一键动作。Tooltip 动态变化为 "Undo merge" / "Undo reset --hard" / "Undo cherry-pick" 等。

3. ✅ **测试** — `src/lib/reflogActions.test.ts` 新增 12 个 bun:test 用例，覆盖分类器（commit / amend / reset / merge / pull / cherry-pick / revert / rebase 的 start vs (pick) vs (finish)，以及所有不可撤销形态），加上 `findQuickUndo`（empty / 最近一条 / 跳过 non-undoable / commit 屏障）和 `listUndoables`（过滤 + limit）。前端 bun:test 总数升至 54（从 42）。新增 7 个 `undo.*` i18n key，en/zh 双语补齐。

### v0.10.3 — 已完成

1. ✅ **基于 cursor 的历史分页** — 取代了之前"一上来加载 5000 条"的模型，改为真正的流式 walker。后端 `git/log.rs` 暴露新的 `log_page(after: Option<oid>, limit, pathspec)`，返回 `{ commits, has_more, next_cursor }`；cursor 即该页最后一条 commit 的 OID，下一次调用 push 该 commit 的 parents 进入新建 `revwalk`，因此 cursor 自身不会被 yield 两次。旧 `git_log` 命令保留作兼容，但 History 视图已改用 `git_log_page`：首屏 limit 1000，后续每页同样 1000，按虚拟滚动需要懒加载。

2. ✅ **增量 graph layout** — `src/lib/graph.ts` 拆分为 `createLayoutState()` + `extendLayout(state, commits)`，让 lane 分配器能跨 page 沿用状态。第 1 页上的 merge commit 为只在第 5 页才出现的 parent 预留的 lane，最终着色仍然一致。`CommitList` 组件用 ref 按未过滤 `commits` 数组身份缓存 layout state；新页 append 时只对增量 commit 计算，硬重置（filter 改变 / repo 切换）才整体重建。结果：滚动与拉页都是 O(page-size)，不再随历史规模退化。

3. ✅ **接近末尾自动加载** — `CommitList` 监听虚拟列表最后可见行，距未过滤列表尾 20 行内即触发 `loadMoreHistory()`。用户启用 filter 时，启发式更保守（距**已过滤**尾 5 行），因为过滤会遮蔽真实 walk 进度。Header 增加 `· +more`（后端还有更多页）/ `· loading more...`（拉取中）。

4. ✅ **测试** — `tests/git_layer.rs` 新增 5 个 cargo 集成测试，覆盖 `log_page`：从 HEAD 取首页 / 第二页连续无重叠 / 空仓库 / pathspec 过滤 / root commit 的 cursor 返回空。`src/lib/graph.test.ts` 新增 5 个 bun:test：`extendLayout` 与 `layoutGraph` 的等价回归 / 分页扩展稳定性 / waiting parent 的 dot 列确定性 / 空输入安全 / 不重叠 page 的 lane 复用。总计：后端 **27**（从 22），前端 **59**（从 54）。

### v0.11.0 — 已完成

1. ✅ **跨提交历史搜索** — 新建 `SearchPage`（Sidebar 第 9 入口，`Ctrl+Shift+F`），三个正交维度找东西：**模式**（Message / Diff / Both）、**类型**（Literal / Regex）、**大小写**（Aa 切换），加上 **Path** scope（与 History 共享同一 pathspec 语义）。后端 `git/search.rs::search_commits` 沿 `revwalk` 倒序遍历，每个 commit 跑：(a) message regex；(b) `diff_tree_to_tree` 与 parent[0]（root commit 用空树）+ 用户 pathspec，再收集每条匹配的 `+`/`-` 行。返回 `{ hits, scanned, truncated }`。

2. ✅ **正确实现的 pickaxe** — Diff 模式实战等同 `git log -G<re>`（Literal 类型时等同 `-S<text>`）。每 commit cap：最多 20 条 diff hits（再多 UI 也用不上）、2 MB patch budget（跳过自动打包的 vendored 大文件）、context_lines=0 保持输出紧凑。Walk cap：最多扫 5000 commits、最多收 500 hits。`truncated` 标志把两类停止条件都暴露给 UI，作为顶部琥珀色徽章提示用户用 path scope 缩小范围。

3. ✅ **两栏 UI** — 左栏：工具栏 + 结果列表，每行带徽章（`msg` 表示 message 命中，`+/− N` 表示 diff 命中数）+ 作者 / 时间 / 短 oid。右栏：选中命中的 commit 摘要头部带一键 **Open** 按钮（跳到 History 并选中该 commit），下方是 (a) message 命中节选；(b) 按文件分组的 diff 命中清单（行号、`+/−` 标志、绿/红配色）。Enter 提交搜索；Esc 清空。

4. ✅ **状态 + i18n** — 新 Zustand `SearchView` 切片，8 个 actions（setQuery / setMode / setPatternKind / toggleCase / setPathspec / selectHit / runSearch / clearSearch）—— `clearSearch` 故意保留 mode/kind/case/path 偏好。新增 24 个 `search.*` i18n key，en/zh 双语补齐。Sidebar 增至 11 入口（Search 图标在 gitignore 与 Diff 之间）。Cargo 依赖加入 `regex = "1"`。

5. ✅ **测试** — `tests/git_layer.rs` 新增 8 个 cargo 集成测试：message-mode 命中 / diff-mode pickaxe 找到新增行 / both-mode 取并集 / regex 类型按正则解析 / 大小写敏感双向 / pathspec 限定到子目录 / 空 pattern 不返回命中 / max_commits 触发截断。后端测试总数 **35**（从 27）。

### v0.12.0 — 已完成

1. ✅ **多仓库 tabs** — Topbar 之上新增 `RepoTabs` 栏，可同时打开多个仓库并在其间切换而不丢状态。仅有 ≤ 1 个 tab 时整栏自动隐藏，单仓库工作流保持简洁。新全局快捷键：`Ctrl+T`（新建空白 tab），`Ctrl+W`（关闭当前 tab）。双击标签可重命名。同仓库去重：再次打开已有 tab 的仓库会路由到该 tab，不会创建重复。

2. ✅ **零侵入 refactor 模式** — Store 把**当前激活** tab 的状态镜像在顶层，所有 240+ 个 `useApp(s => s.history.commits)` selector 与 28 个组件文件**完全无需改动**。非激活 tab 的状态停泊在 `sessionsById: Record<tabId, SessionSnapshot>`。切换 tab 是单次 batch swap：先把顶层字段快照写入旧 tab 的位置，再把新 tab 的快照应用到顶层。Per-tab 状态覆盖每个现有 slice：repo / view / history / diff / merge / blame / changes / stash / reflog / submodules / rebase / fileHistory / worktrees / gitignore / search。

3. ✅ **AppMenu 集成** — 汉堡菜单新增 "New tab" 项，紧跟 "Open repository"。原 "Close repository" 重定义为"关闭当前 tab"（自动回退到合理邻居 tab，或在最后一个 tab 关闭后回到 Welcome 页）。

4. ✅ **延后到下一个 minor 的决定** — 跨进程 tab 持久化（重启后恢复同一组 tab）**故意没在 v0.12.0 实现**。Recent repositories 列表已经覆盖了"我想重开上次在做的"这个常见场景，完整 session snapshot 序列化会带来 quota / 序列化复杂度（如 Changes 视图里的 `Set<string>`），短期收益不大。

### v0.12.1 — 已完成

1. ✅ **后端测试覆盖率扩展** — `tests/git_layer.rs` 新增 15 个集成测试，套件从 35 → **50**：
   - **diff**（3）：`commit_files` 区分 Added / Modified / Deleted；`file_diff` 对修改文件返回带 `+`/`−` 行的正确 hunks；`working_diff` 反映工作目录未暂存改动。
   - **blame**（3）：`blame_file` 把每行归到正确 commit；`previous_filename` 跨重命名追溯；`previous_filename` 在文件首次 add 时返回 `None`（再无更早历史）。
   - **commit_ops**（4）：`cherry_pick` 把目标改动 stage 进 index 而不自动提交 HEAD；`revert` 把反向变更写入 index；`reset --soft` 保留 index 与 workdir；`reset --mixed` 清空 index 但保留 workdir。
   - **workspace**（5）：`working_changes` 正确分类 untracked vs unstaged；stage → unstage 走完整 `WorkingFlag` 状态机；`discard_files` 把 tracked 文件还原到 index 版本；`discard_files` 直接从磁盘删 untracked；`commit_changes` 推进 HEAD 并清空 working changes。

2. ✅ **由新测试发现的 bug 修复** — `blame::previous_filename` 在 `find_similar` **之前**对 `diff_tree_to_tree` 加了 `pathspec(file)` 过滤，导致 libgit2 没有 `delete(old_path)` delta 可与 `add(new_path)` 配对，rename 解析悄悄返 `None`。修法：移除早期 pathspec 过滤，沿用 `file_history.rs` 已用的模式（先做无限制 diff，再 `find_similar`，由我们自己 filter 到 tracked path）。结果：在 Blame 视图对重命名文件点击 "Annotate previous" 现在能真正穿越 rename，而不是停在原地。

### v0.13.0 — 已完成

1. ✅ **双语化文档** — 新增中文 `README.zh.md` 与英文 `USAGE.en.md`，与现有 `README.md` / `USAGE.md` 一一对应；两个母版顶部加上语言切换链接（English · 简体中文）。这一版没有功能变更，只是把多语言外观补齐：终端用户的"使用说明"与开发者的"工程说明"现在都有 en/zh 两份等价文档，由 README 顶部的双向链接互通。

### v0.13.1 — 已完成

1. ✅ **结构化错误处理** — 后端错误现在是一等公民。把临时拼凑的 `CmdError`（一个被 `to_string` 的 `git2::Error`）替换为 `crate::error::AppError`，枚举式标签把失败分类成 10 种 kind：`NotFound / MergeConflict / NonFastForward / Auth / UserCancelled / InvalidArgument / Git / Io / Internal / Other`。映射全自动（`From<git2::Error>`）—— `git2::ErrorCode::NotFound` → `NotFound`、`Conflict / MergeConflict` → `MergeConflict`、`Auth / Certificate` → `Auth`、`User` → `UserCancelled` 等等——并有一小段消息启发式兜底处理 `git2::Error::from_str` 这类被标为 `GenericError` 的旧错误（让 "non-fast-forward" / "authentication required" / "unknown reset mode" 字符串仍能正确归类）。

2. ✅ **紧凑的线上格式** — `AppError` 序列化为 `{ kind, message, code?, class? }`。可选的 `code` / `class` 在 `None` 时**完全省略**（自定义 `Serialize` impl），JSON 保持精简。前端 `src/lib/appError.ts` 的镜像对称：`parseAppError(unknown)` 校验形状，碰到任何畸形（旧版 plain-string 错误、原生 `Error`、`null` 等）一律降级到 `{ kind: "Other", message }`。

3. ✅ **集中 toast 队列 + 全局兜底** — 新增 `src/lib/toast.ts`（zustand 实现，约 110 LOC）和 `src/components/ToastContainer.tsx`，最多同时渲染 4 个 toast 在窗口底部，每种 variant 有独立颜色 / 图标 / 自动消失时长。`App.tsx` 挂载了一个 `unhandledrejection` 全局监听器，捕获任何**没被本地 catch 消费**的 `AppErrorThrown` 并 push 一个 error toast——这样后端调用失败时，即便代码忘了处理 rejection，用户也总能看到反馈。

4. ✅ **零侵入 invoke 升级** — `src/ipc/git.ts` 内部走新的 `src/ipc/invoke.ts` wrapper：每个 Tauri rejection 都被转成 `AppErrorThrown extends Error`。现有的 `catch (e) { String(e) }` 模式无需任何修改即可继续工作（`toString` 返回 `"Kind: message"`），新代码则可以基于 `e.appError.kind` 做精细分支。Topbar 远程操作 banner 已经利用这一点：`NonFastForward` 时显示"Remote has diverged from your branch — open the Merge view or rebase first."，而不是原始的 libgit2 字符串。

5. ✅ **测试** — 后端在 `src/error.rs` 新增 11 个单元测试，覆盖每条分类路径（`NotFound / MergeConflict / Auth / InvalidArgument / UserCancelled` 走 `ErrorCode`；`NonFastForward / Auth / InvalidArgument` 走消息启发式；未识别的 libgit2 消息仍停在 `Git`；`std::io::Error → Io`；序列化 JSON 在带 / 不带 `code` & `class` 时都验证）。前端 `src/lib/appError.test.ts` + `src/lib/toast.test.ts` 共 19 个 bun:test：parse / format / 谓词 / 10 种 kind 全部 round-trip / 队列力学 / variant / MAX_VISIBLE 截断 / 默认时长排序 / helpers。总计：后端 **61**（50 集成 + 11 单元，从 50）；前端 **79**（从 59）。

### v0.13.2 — 已完成

1. ✅ **Release 流水线不再静默失败** — 在 `release.yml` 头部新增专门的 `signing-preflight` job，**在**启动 4 平台 build matrix **之前**先检查 `${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}` 是否为空。三种结果：(a) secret 已设 → 进入 `signed` 模式；(b) secret 为空**且**仓库 variable `RELEASE_ALLOW_UNSIGNED=true` → 进入 `unsigned` 模式但在 release notes 顶部加显眼"本版本无法被自动更新检测"警告；(c) secret 为空且没启用 override → 立即失败整条流水线。彻底取代了过去"静默产出 broken installer"的故障模式。

2. ✅ **`scripts/check-signing-key.ts`（CI gate + 本地工具）** — Bun 脚本：从 `tauri.conf.json::plugins.updater.pubkey` 解码公钥，从 `TAURI_SIGNING_PRIVATE_KEY`（或本地 `~/.tauri/<id>.key`）解码私钥，提取两侧 16 字符 hex keyId，断言一致。专门防 fork 时最常见的坑：rotate 了一半却忘了另一半。minisign 解析核心抽到 `src/lib/minisignKey.ts`，由 12 个 bun:test 用例覆盖（真实仓库 pubkey 解码、小写归一、encrypted-secret-key header、注释缺 keyId 时回落到 binary blob、畸形输入 reject）。已接到 build matrix：每次 signed release 在 tauri-action 跑前先校验密钥对。

3. ✅ **`scripts/build-latest-json.ts` + 新 `publish-latest-json` job** — `tauri-action` 已经把每个平台的 updater bundle 与对应 `.sig` 都上传到 GitHub Release，但**它不会发布** `tauri-plugin-updater` 真正去拉取的顶层索引 `releases/latest/download/latest.json`。新的聚合 job（gated on `signing-preflight.outputs.signing-mode == 'signed'`）遍历刚发布的 release assets，按扩展名分类（`.nsis.zip` → windows，`.app.tar.gz` → mac arm64/x64，`.AppImage.tar.gz` → linux），各自配对 `.sig`，按 updater plugin 期望的 schema 生成 `latest.json`，再用 `gh release upload --clobber` 附到 release 上。**自动更新链路终于真正能闭环了**。

4. ✅ **`bun run check-signing-key`** — tag 前的本地 sanity check 一行命令。让 keyId mismatch 这种坑在本地就暴露，而不是 CI 25 分钟后才发现。`README.md` / `README.zh.md` 新增"配置自动更新签名密钥"章节文档。

5. ✅ **测试** — 前端在 `src/lib/minisignKey.test.ts` 新增 12 个 bun:test：wrap/unwrap、keyId 提取、binary fallback、`fingerprintFromWrapped` 端到端。总计：后端 **61**（不变）；前端 **91**（从 79）。

### v0.13.3 — 已完成

1. ✅ **双向 Diff 编辑器** — Diff 工具栏新增 "Edit" 切换按钮（仅在 Side-by-side 模式下查看工作树文件时显示），点击后**右侧面板从静态 diff 切换为绑定到磁盘文本的实时 `<textarea>`**。左侧仍是只读 HEAD 参考（带行号 gutter）；双面板共享行高（`lineHeight: 18px`）并通过成对 `onScroll` handler 同步滚动，所以中等强度编辑不会让视觉对齐错位。**Save** 原子写回 buffer 并重跑 `working_diff` 让底部 hunk 预览刷新；**Reset** 重读磁盘版本丢弃 buffer 编辑。只要 buffer ≠ savedText 工具栏就显示 `● dirty` 徽章，避免用户误关 tab 丢工作。脏态时右侧 gutter 背景染 `--diff-modified-bg` 让状态一目了然。

2. ✅ **三个新后端命令 + 安全加固** — `src-tauri/src/git/workspace.rs` 新增 `read_working_file` / `read_head_file` / `write_working_file`。所有路径走新 `safe_workdir_path` 辅助：向上找最近存在的祖先（让写入能创建新的父目录）、canonicalize 后断言其在 workdir 内、再额外拒绝未解析尾部里出现的 `..` 段（防 symlink 逃逸）。读命令拒绝二进制（前 8 KiB 含 NUL byte 即拒绝）；写命令限制 8 MB 上限，使用 `tmp + rename` 原子写避免半写状态。`read_head_file` 干净处理"文件还没在 HEAD"的情况（返回 `missing: true` 而不报错），所以新建的 untracked 文件也能驱动编辑器。

3. ✅ **ChangesPage 入口** — Staged / unstaged / unmerged 段中的文件名现在是可点击的 button，调用 `openWorkingDiff(file)` 切到 Diff 视图（`oid === WORKING_OID`）并通过 `Promise.all` 并行预载 HEAD 参考 + working buffer。复选框与文件名点击区解耦，所以批量 stage / discard / stash 仍可用而不会误打开 Diff。

4. ✅ **Store 接线** — Diff store 新增 `WORKING_OID` 哨兵常量 + `WorkingEditState` 子切片（`active` / `headText` / `buffer` / `savedText` / `busy` / `error`）。5 个新 actions：`openWorkingDiff` / `setEditActive`（若在 `openWorkingDiff` 完成前就被激活，自行懒加载 buffer）/ `setEditBuffer` / `saveEditBuffer`（保留 save 往返中到达的新键入，不会被旧 buffer 覆盖）/ `resetEditBuffer`。所有 action 都用 `oid === WORKING_OID` 守卫，从历史 commit 视图误调时直接 no-op 而不污染状态。

5. ✅ **测试** — `tests/git_layer.rs` 新增 9 个后端集成测试：`working_file_read_returns_disk_contents` / `working_file_read_missing_marks_flag` / `working_file_read_rejects_path_traversal` / `working_file_read_rejects_binary` / `write_working_file_round_trips_through_disk` / `write_working_file_creates_missing_parent_dirs` / `write_working_file_refuses_path_traversal` / `read_head_file_returns_blob_at_head` / `read_head_file_marks_missing_when_file_not_in_head`。总计：后端 **72**（59 集成 + 13 单元，从 61），前端 **91**（不变）。

### v0.13.4 — 已完成

1. ✅ **Search v2 — 文件视图** — 搜索工具栏新增 **Group by** 切换，结果列表在 **Commit**（v0.11 旧布局，一行一个 commit）和 **File**（Find-in-Path 风格：每个文件出现一次，触及它的 commit 嵌套在下面）之间切换。文件视图按总 `+`/`-` 行命中数降序排（同分用文件名 alpha）—— "改得最多"的文件浮到顶部。仅 message 命中（没 diff 命中）的 commit 不会出现在文件视图——这个视图是内容驱动的。前 3 个文件组默认展开，其余折叠保持大结果集可扫。状态栏在此模式下显示 "{N} files · {M} commits" 而不是 "{N} hits"。

2. ✅ **最近搜索 dropdown** — 查询框右侧新增时钟图标，弹出最近 12 条搜索历史，持久化到 localStorage 的 `gittools.search.recents`。最近列表用**结构化键**（mode + kind + case + path + query）去重——再跑同一组合不会产生重复行，只会把已有记录顶到头部。点击任一行 → 应用快照（mode/kind/case/path/query 全套）并立即重跑；**Clear all** 一键清空。

3. ✅ **保存搜索** — 工具栏 **★ Save** 按钮弹窗输名字，把当前条件保存到 `gittools.search.saved`（cap 50 条）。配套 dropdown 列出全部保存项，点击应用并运行，hover 出 🗑️ 删除。同名保存幂等（原地替换 + 顶到头部）。空名字立即报错。

4. ✅ **纯函数抽离 + 测试** — 聚合逻辑（`aggregateByFile` / `uniqueCommitCount`）落在 `src/lib/searchAggregate.ts`（8 个 bun:test：排序、tie、message-only 排除、同 commit 多行、dedup），持久化逻辑（`pushRecent` / `upsertSaved` / `removeSaved` / `snapshotKey` + safe-JSON load/save round-trip）落在 `src/lib/searchPersist.ts`（14 个 bun:test）。两个都是纯函数 —— UI 只做粘合 —— 所以 dedup / cap / sort 行为是孤立测的，不依赖 React 端到端。总计：后端 **72**（不变）；前端 **113**（从 91）。

5. ✅ **Store + i18n** — SearchView slice 新增 `groupBy` / `recents` / `saved` 字段，store 创建时从 localStorage 水合，每次成功 `runSearch` / `saveCurrentSearch` / `deleteSavedSearch` / `clearSearchRecents` 都重新写回。`clearSearch` 现在也保留持久化的副状态（旧版本就保留 mode/kind/case 了）。新增 19 个 `search.*` i18n key，en / zh 双语补齐。

### v0.13.5 — 已完成

1. ✅ **Tabs v2 — 跨会话持久化** — 打开的 tab 列表（id + repoPath + label + pinned 标志）以及 active tab id，现在通过 Zustand `subscribe()` 监听器镜像写入 `localStorage` 的 `gittools.tabs.v1`。Per-tab 的 session payload（history / refs / diff …）**不**持久化——它们由现有的 `switchTab → openRepo` 懒加载路径在用户首次切回该 tab 时按需重建。应用启动时会主动给上次的 active tab 跑一次 `openRepo(activeTab.repoPath)`，重启后第一帧就拿到了 history。空白 "(new)" tab 在写入时被剔除，避免重启复活。`MAX_TABS = 32` 上限。

2. ✅ **Tab 钉选** — 每个 tab 新增 `pinned: boolean` 字段。Pinned tab 会按稳定分区排到 tab 栏最前；`Ctrl+W` 拒绝关 pinned（`App.tsx` 的快捷键 handler 检查 active tab 的 `pinned` 标志后静默跳过）；`×` 关闭按钮会替换为内联的 ⊘ 取消钉选按钮。右键 → **Pin tab** / **Unpin tab** 切换状态。拖拽重排尊重 pinned/unpinned 区域分界：把 tab 拖进 pinned 区会自动钉选，拖出去自动取消钉选——和 VS Code / 浏览器一致。

3. ✅ **拖拽重排** — Tab 现在是 `draggable={true}` 的原生 HTML5 source。拖拽中被拖的 tab 透明度变 50%，目标 tab 之间会出现 2px 主题色插入条（拖到末尾会出现末尾条）。落点语义：落在 tab 右半边插到其后，左半边插到其前。重排只走单一 store action `reorderTab(fromIdx, toIdx)`，调用 `src/lib/tabsPersist.ts` 里的纯函数 `reorderTabs`——孤立单测覆盖，不靠 DOM 事件 e2e。

4. ✅ **右键菜单** — Tab 上右键打开 `ContextMenu`（复用 `RefsPane` / `CommitList` 已经在用的组件）。菜单项：**Pin / Unpin** · **Close**（pinned 时禁用） · **Close other tabs**（除当前 + pinned 外没东西可关时禁用） · **Close tabs to the right**（当前 tab 右边没非 pinned 时禁用）。所有 "批量关闭" 操作都故意保留 pinned tab——尊重用户显式的钉选意图。

5. ✅ **Tab 循环切换** — `Ctrl+PageDown` / `Ctrl+PageUp` 在 tab 之间循环切换，到边界自动绕回（前→后或后→前）。通过纯函数 `nextTabId` 实现，方便孤立单测。tab 栏在只有 1 个 tab 时也会显示了（v0.12.0 的 `tabs.length <= 1` 判断已移除）——只要 ≥1 个 tab 就显示，和持久化模型一致。

6. ✅ **纯函数抽离 + 测试** — `src/lib/tabsPersist.ts` 暴露 `loadTabs` / `saveTabs`（严格校验：格式不对、repo 路径为空、active id 找不到都会被丢弃）以及 4 个纯辅助函数 —— `reorderTabs` / `stablePartitionPinned` / `togglePin` / `nextTabId`，每个都独立测。新增 **17** 个 `bun:test` 用例，包括一个穷举 invariant 属性检查（"对所有 (from, to) 组合在混合 pinned/unpinned 输入上做 reorder 之后，pinned 仍全在 unpinned 之前"）。总计：后端 **72**（不变）；前端 **130**（从 113）。

### Backlog（v0.13.5 之后）

- ⏳ 代码签名（Windows EV cert / macOS notarization），让安装包不再触发 SmartScreen / Gatekeeper 警告。

## 跨平台注意

`git2-rs` 配置为 `vendored-libgit2` + `vendored-openssl`，因此任何 OS 都不依赖系统的 libssh / libgit2。
