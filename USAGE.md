# Git Tools — 使用说明

IDEA 风格的 **History / Diff / Merge** 桌面应用，基于 Tauri 2 + React 19，可在 Windows / macOS / Linux 运行。

> 适用版本：v0.1.0  
> 仓库位置：`G:\GitTools\`  
> 安装包位置：`G:\GitTools\src-tauri\target\release\bundle\`

---

## 目录

- [一、安装](#一安装)
- [二、首次启动](#二首次启动)
- [三、三个核心视图](#三三个核心视图)
  - [3.1 History（提交历史）](#31-history提交历史)
  - [3.2 Diff（差异查看）](#32-diff差异查看)
  - [3.3 Merge（冲突解决）](#33-merge冲突解决)
- [四、键盘快捷键](#四键盘快捷键)
- [五、典型工作流](#五典型工作流)
- [六、从源码运行 / 二次开发](#六从源码运行--二次开发)
- [七、构建可分发安装包](#七构建可分发安装包)
- [八、常见问题排查（FAQ）](#八常见问题排查faq)
- [九、卸载与清理](#九卸载与清理)

---

## 一、安装

### Windows（推荐）

任选一种安装包（都在 `src-tauri/target/release/bundle/`）：

| 安装包                 | 文件                                 | 大小    | 适合                |
| ---------------------- | ------------------------------------ | ------- | ------------------- |
| **NSIS**（推荐，更轻） | `nsis/Git Tools_0.1.0_x64-setup.exe` | 1.96 MB | 个人使用            |
| **MSI**                | `msi/Git Tools_0.1.0_x64_en-US.msi`  | 2.68 MB | 企业部署 / 静默安装 |

**安装步骤**：

1. 双击 `Git Tools_0.1.0_x64-setup.exe`
2. 一路 Next 完成
3. 在开始菜单 → 找到 **Git Tools** → 启动

> 第一次启动可能会弹 Windows SmartScreen 提示（因为安装包未数字签名），点 "更多信息 → 仍要运行" 即可。

### macOS / Linux

当前 `G:\` 上只构建了 Windows 包；macOS/Linux 安装包要在对应系统上从源码 build：

```bash
# 在 macOS 或 Linux 上
git clone <你的仓库地址>
cd GitTools
bun install
bun run tauri:build
```

产物会出现在：

- macOS：`src-tauri/target/release/bundle/{dmg,macos}/`
- Linux：`src-tauri/target/release/bundle/{appimage,deb,rpm}/`

---

## 二、首次启动

启动后会看到 **Welcome 页**：

```
┌───────────────────────────────────────────────────────────┐
│  Git Tools                          Recent                │
│  IDEA-style History/Diff/Merge      ┌────────────────┐    │
│  for any local Git repository.      │ (无最近仓库)   │    │
│                                     └────────────────┘    │
│  [Open Repository]                                        │
│                                                           │
│  Ctrl+1/2/3   Switch History/Diff/Merge                   │
│  F5 / Ctrl+R  Refresh current view                        │
│  F7/Shift+F7  Next/previous conflict (Merge)              │
│  Alt+1/2/3    Accept Left/Right/Both                      │
└───────────────────────────────────────────────────────────┘
```

### 打开仓库

**方式 A：点 "Open Repository" 按钮**

1. 在弹出的文件夹选择对话框里，**导航到目标 git 仓库的根目录**（包含 `.git/` 那一层）
2. 注意：在 Windows 文件对话框里，**地址栏当前所在的目录才是被选中的目录**——不要进入它内部再点确认
3. 点 "选择文件夹"

**方式 B：从 Recent 列表点击**

- 之前打开过的仓库会自动出现在右侧 Recent 列表
- 点目录条目直接打开
- hover 上去会显示 `×` 图标，点击可从列表移除

打开成功后会自动跳到 **History 视图**。

---

## 三、三个核心视图

应用左侧的 sidebar 有 3 个图标，对应 3 个视图。也可以用 `Ctrl+1/2/3` 快速切换。

### 3.1 History（提交历史）

```
┌──────────┬────────────────────────────────┬──────────────────────────┐
│ Refs     │ Commits                        │ Commit Details           │
├──────────┼────────────────────────────────┼──────────────────────────┤
│ Filter…  │  ●  master, v0.1.0  Merge ...  │ Merge pull request #482  │
│          │  |\                            │                          │
│ LOCAL    │  | ●  refactor(diff)           │ Commit: a3f9c1e8d2b4...  │
│  master  │  | ●  feat(diff): word-level   │ Parents: e1c0ba2 7f2bd84 │
│  feat/*  │  ●  chore: initial scaffold    │ Author: Alice <a@x.io>   │
│          │                                │ Date: 2026-05-19 ...     │
│ TAGS     │                                │ Refs: master v0.1.0      │
│  v0.1.0  │                                │                          │
│          │                                │ CHANGED FILES (7)        │
│          │                                │  M src/components/Diff.. │
│          │                                │  A src/lib/word-diff.ts  │
│          │                                │  D src/old/DiffOld.tsx   │
│          │                                │                          │
│          │                                │ MESSAGE                  │
│          │                                │ Merge pull request #482  │
└──────────┴────────────────────────────────┴──────────────────────────┘
```

#### 三栏功能

**左 — Refs 面板**

- **Filter commits...** 输入框：按 message、author、email、oid 前缀、ref 名 实时过滤中间栏
- **LOCAL** 段：本地分支，HEAD 分支会高亮 + 标 `HEAD`
- **REMOTE** 段：远程分支（如 `origin/main`）
- **TAGS** 段：标签
- 每个 ref 前面的圆点颜色和它在 DAG 中的 lane 颜色一致

**中 — Commit List + DAG**

- 每行：DAG 图 / 引用 chips + commit message / 作者 / 相对时间 / 短 oid
- **DAG 渲染规则**：
  - 5 色循环（蓝/紫/金/绿/红）按 ref 名稳定分配
  - 直线 = 同 lane 持续；曲线 = 分支或合并
  - 多 parent 的 merge commit 会同时连接所有父 lane
- 点击任一行会在右侧详情面板加载该 commit 的详情

**右 — Commit Details**

- 完整 oid（40 位）、parents 短哈希、author + email、本地化日期、所有 ref chips
- **Changed files** 列表：A / M / D / R / C / T 状态 + 行级 +N -N 统计
- **点击任一文件 → 自动跳到 Diff 视图查看具体差异**
- 完整 commit message（multi-line preserve）

#### History 视图常见操作

| 想做什么                     | 怎么做                                                   |
| ---------------------------- | -------------------------------------------------------- |
| 看某分支的提交               | 点左侧分支 ref（目前选中后会显示在 chip 上，未来会过滤） |
| 找包含 "fix login" 的 commit | 在 Filter 框输入 `fix login`                             |
| 看某 commit 修改了哪些文件   | 点击该 commit，看右侧详情                                |
| 看某文件具体改了什么         | 在右侧详情里点击文件名，跳到 Diff                        |

---

### 3.2 Diff（差异查看）

```
┌──────────────────────┬──────────────────────────────────────────────────┐
│ Changed files (7)    │ src/components/DiffViewer.tsx  a3f9c1e           │
├──────────────────────┤ [Side-by-side] [Unified]    ⌫ Whitespace  3 hunks│
│ ▾ src/components     │                                                  │
│  M  DiffViewer.tsx ◀ │  42 │ export function DiffViewer({ │ 42 │ export function ...
│  D  old/DiffOld.tsx  │  43-│   const rows = flatten(...   │ 43+│   const hunks = group ...
│ ▾ src/lib            │  44-│   return rows.map(render);   │ 44+│   if (mode === "sbs")  ...
│  A  word-diff.ts     │  45 │                              │ 45+│   return <Unified ...   ...
│  M  diff/tokenizer   │  46 │   // guard against empty     │ 46 │   // guard against     ...
│ ▾ src/pages          │ ────────────────────────────────────────────────────────────────
│  M  DiffPage.tsx     │ @@ -120,8 +123,16 @@ function renderRow(row) {
│ ▾ /                  │  120 │ function renderRow(row) {  │ 123 │ function renderRow(...
│  M  README.md        │  121-│   const cls = row.origin   │ 124+│   const cls = classify(  ...
│                      │      │     === "+" ? "add"...     │     │   const tokens = wordDiff
└──────────────────────┴──────────────────────────────────────────────────┘
```

#### 三个核心能力

**1. 文件树（左栏）**

- 按目录分组的变更文件清单
- 每行：A/M/D/R/C/T 状态字母 + 文件名 + +N -N 行数
- 点击切换到该文件的 diff

**2. Diff 视图模式（顶栏 segmented 控件）**

- **Side-by-side**：左旧右新，行级对齐，方便对比改写位置
- **Unified**：传统 `git diff` 风格，一栏显示，连续阅读流畅

**3. 行级 + 词级高亮**

- 行级：删除行红色背景 + `-` marker；新增行绿色背景 + `+` marker
- 词级（仅 Side-by-side 模式）：在配对的"替换行"内，**只有真正变动的 token** 会被高亮（绿色加 / 红色删），让一眼能看出"改了哪个变量名 / 哪个参数"
- 算法：基于 LCS 的 token diff（无第三方依赖）

**4. Whitespace 可视化**

- 点 toolbar 上的 **⌫ Whitespace** 按钮启用
- 空格显示为 `·`，tab 显示为 `→`
- 排查"看不见的空白差异"必备

#### Diff 视图常见操作

| 想做什么                           | 怎么做                             |
| ---------------------------------- | ---------------------------------- |
| 看下一个文件的 diff                | 点左侧文件树另一项                 |
| 切换到 Unified 模式                | 顶栏点 Unified                     |
| 检查行尾有没有 trailing whitespace | 点 ⌫ Whitespace                    |
| 看本次 diff 一共改了几块           | 顶栏右侧 "X hunks"                 |
| 回到 commit 列表                   | `Ctrl+1` 或左侧 sidebar 第一个图标 |

---

### 3.3 Merge（冲突解决）

只有在仓库**当前正在进行 merge / rebase / cherry-pick** 时这个视图才有内容。否则显示 "Repository is clean"。

```
┌─[Merge in progress]  3 conflict files─────────────────────────────────────────┐
├──────────────────┬───────────────────────────────────────────────────────────┤
│ Conflicts (1/3)  │ src/components/DiffViewer.tsx  1/3 resolved  [Mark resolved & stage]│
├──────────────────┼───────────────────────────────────────────────────────────┤
│ Resolved         │  LEFT — ours       │  RESULT      │  RIGHT — theirs       │
│ ✓ word-diff.ts   │  (master)          │  working     │  (feat/diff-viewer)   │
│                  │                    │              │                       │
│ Pending          │  function render(  │ ◀ Conflict#1 │  function render(     │
│ ▶ DiffViewer.tsx │    row             │  ─ pending   │    row                │
│   diff.rs        │  ) {               │  [L][R][Both]│  ) {                  │
│                  │    const cls =     │              │    const cls = classify
│                  │      row.origin    │   ┌──────┐   │      (row.origin);    │
│                  │      === "+"       │   │master│   │    const tokens = ... │
│                  │      ? "add" ...   │   │side  │   │  return <div>...      │
│                  │  }                 │   │change│   │  }                    │
│                  │                    │   └──────┘   │                       │
└──────────────────┴───────────────────────────────────────────────────────────┘
```

#### 操作步骤

**Step 1：从外部触发一次 merge**

由于这个 v0.1.0 还没集成 merge 启动按钮，请在终端里手动触发，例如：

```bash
git merge feature-branch
# 或
git rebase main
# 或
git cherry-pick abc1234
```

如果出现冲突，git 会自动暂停在 merge 中间状态，工作目录里会有 `<<<<<<< / ======= / >>>>>>>` 标记的文件。

**Step 2：在 Git Tools 里切到 Merge 视图（Ctrl+3）**

- 顶部红色 chip 显示 "Merge in progress"
- 左栏列出所有冲突文件，分 Resolved / Pending 两段

**Step 3：解决每个冲突文件**

点击一个 Pending 文件，主区出现三栏：

| 栏             | 颜色                                 | 内容                         |
| -------------- | ------------------------------------ | ---------------------------- |
| LEFT — ours    | 🔵 蓝色                              | 当前分支（HEAD）的版本       |
| RESULT         | 🟢 绿色（已解决）/ 🔴 红色（待解决） | 工作目录文本，**可手动编辑** |
| RIGHT — theirs | 🟣 紫色                              | 要合并进来的分支版本         |

每个 conflict block 上方有一行黄色操作栏：

| 按钮                          | 作用                                        |
| ----------------------------- | ------------------------------------------- |
| **Accept Left**               | 用 ours 内容；状态变 `left`，背景蓝色       |
| **Accept Right**              | 用 theirs 内容；状态变 `right`，背景紫色    |
| **Accept Both**               | 拼接 ours + theirs；状态变 `both`，背景绿色 |
| 直接在 RESULT textarea 里改字 | 状态变 `manual`，背景橙色                   |

**Step 4：Mark resolved & stage**

当**所有冲突都不再是 pending**（变成 left / right / both / manual 任一种），顶部的 **Mark resolved & stage** 按钮变可点击。

点它会：

1. 把 RESULT 区合成的最终文本写入工作目录文件
2. `git add <文件>`（清掉 stage 1/2/3 槽位，写入 stage 0）
3. 该文件从 Pending 移到 Resolved 段，前面打 ✓

**Step 5：完成或放弃合并**

当前版本 v0.1.0 没在 UI 内置 commit/abort 按钮，请回终端：

```bash
# 所有冲突解决完成后，提交合并
git commit         # git 会用默认的 merge message

# 或者放弃这次合并
git merge --abort
```

之后回 Git Tools 按 F5 / 点 Refresh，Merge 视图会变回 "Repository is clean"。

---

## 四、键盘快捷键

| 快捷键             | 作用                                      | 适用视图 |
| ------------------ | ----------------------------------------- | -------- |
| `Ctrl + 1`         | 切到 History                              | 全局     |
| `Ctrl + 2`         | 切到 Diff                                 | 全局     |
| `Ctrl + 3`         | 切到 Merge                                | 全局     |
| `F5` 或 `Ctrl + R` | 刷新当前视图（重新拉取数据）              | 全局     |
| `Alt + 1`          | 对**第一个 pending 冲突**执行 Accept Left | Merge    |
| `Alt + 2`          | Accept Right（同上）                      | Merge    |
| `Alt + 3`          | Accept Both（同上）                       | Merge    |

> 在 input/textarea 里这些快捷键自动失效，不会干扰打字（除非用 Ctrl+ 显式修饰）。

---

## 五、典型工作流

### 工作流 1：审查同事的 PR 合并提交

1. 打开仓库（Welcome 页 → Open Repository 或 Recent 列表）
2. **History 视图**自动加载，最上面就是最新合并 commit
3. 点击它 → 右侧详情列出所有 changed files
4. **逐个文件点击**：自动跳到 **Diff 视图**
5. 用 Side-by-side 模式快速看核心改动；切到 Unified 模式做最终阅读
6. 切换到下一个文件继续

### 工作流 2：解决一次复杂的 merge 冲突

1. 终端 `git merge feature-branch` → 出现冲突
2. 切到 Git Tools → **Ctrl+3 进 Merge 视图**
3. 左栏会列出 N 个冲突文件
4. 第一个文件主区显示三栏 + M 个 conflict blocks
5. 对每个 block：
   - 简单的 → **Alt+1 / 2 / 3** 一键选择
   - 复杂的 → 直接在 RESULT 区编辑（可参考左右栏内容）
6. 所有 block 都不是 pending → 点 **Mark resolved & stage**
7. 选下一个冲突文件，重复 5-6
8. 全部解决完 → 终端 `git commit`

### 工作流 3：找出一个 bug 是哪次提交引入的

1. History 视图 + filter 输入框输入关键词（比如 `auth`）
2. 顺序看可疑的 commit
3. 点击 → 右栏详情看 changed files → 点击文件 → Diff 视图细看
4. F5 / Ctrl+R 刷新（如果你在外部又 commit 了新的）

---

## 六、从源码运行 / 二次开发

### 环境依赖

| 工具    | 最低版本                                                                    | 安装方式                               |
| ------- | --------------------------------------------------------------------------- | -------------------------------------- |
| Bun     | 1.3+                                                                        | `irm bun.sh/install.ps1 \| iex`（Win） |
| Rust    | 1.77+                                                                       | https://rustup.rs                      |
| Git     | 任意                                                                        | https://git-scm.com                    |
| Windows | + MSVC C++ Build Tools + WebView2（Win11 自带）                             | VS Installer                           |
| macOS   | + Xcode CLT                                                                 | `xcode-select --install`               |
| Linux   | + webkit2gtk-4.1 + libssl-dev + librsvg2-dev + libayatana-appindicator3-dev | apt/dnf                                |

### Dev 模式

```bash
cd G:\GitTools
bun install                # 首次执行，装前端依赖
bun run scripts/gen-icons.ts   # 生成 Tauri 必需的占位图标
bun run tauri:dev          # 启动 dev：Vite + Rust + 自动开窗
```

首次启动 Rust 端编译会比较慢（30-90s），之后增量编译几秒。React HMR 改动秒回；Rust 改动会触发 cargo 重编译。

### 质量门

```bash
bun run typecheck          # tsc -b
bun run lint               # eslint
bun run format             # prettier --write（自动修正）
bun run format:check       # prettier --check（CI 用）
cargo check --manifest-path src-tauri/Cargo.toml --release
```

### 项目结构速查

```
G:\GitTools\
├── src/
│   ├── App.tsx               # 视图路由 + 全局快捷键
│   ├── main.tsx              # Root + ErrorBoundary
│   ├── components/
│   │   ├── Sidebar.tsx       # 左侧 nav
│   │   ├── Topbar.tsx        # 顶栏（Open / Refresh / 路径）
│   │   ├── ErrorBoundary.tsx
│   │   ├── history/          # History 页面组件
│   │   ├── diff/             # Diff 页面组件
│   │   └── merge/            # Merge 页面组件
│   ├── pages/                # WelcomePage / HistoryPage / DiffPage / MergePage
│   ├── stores/app.ts         # Zustand 全局状态
│   ├── ipc/git.ts            # 类型化的 invoke 包装
│   ├── lib/
│   │   ├── graph.ts          # DAG lane 分配算法
│   │   ├── pairLines.ts      # diff 行配对
│   │   ├── wordDiff.ts       # LCS 词级 diff
│   │   ├── conflictParser.ts # <<<<<<< 解析
│   │   ├── recentRepos.ts    # localStorage 最近仓库
│   │   ├── useShortcuts.ts   # 全局快捷键 hook
│   │   ├── time.ts           # timeAgo / fullDate
│   │   └── utils.ts          # cn() helper
│   ├── styles/globals.css    # Tailwind v4 入口 + 设计 tokens
│   └── vite-env.d.ts
├── src-tauri/
│   ├── Cargo.toml            # git2-rs (vendored) + tauri 2 + plugins
│   ├── tauri.conf.json
│   ├── capabilities/         # Tauri 2 ACL
│   └── src/
│       ├── main.rs / lib.rs
│       ├── commands.rs       # 10 个 #[tauri::command]
│       └── git/              # repo / log / diff / merge / refs
├── design/                   # Open Design 风格静态 HTML 设计稿
├── scripts/
│   ├── gen-icons.ts          # 占位图标生成
│   └── preview-design.ts     # 设计稿本地 HTTP 预览
├── package.json / tsconfig.json / vite.config.ts
├── eslint.config.js / .prettierrc.json
├── bunfig.toml               # 腾讯内网 npm 镜像
└── README.md / USAGE.md
```

### Rust 命令清单（src-tauri/src/commands.rs）

| 命令               | 入参                | 返回              | 说明                           |
| ------------------ | ------------------- | ----------------- | ------------------------------ |
| `open_repo`        | path                | `RepoInfo`        | 打开仓库（自动 discover .git） |
| `git_log`          | path, limit, skip   | `CommitSummary[]` | 提交列表（含 refs 映射）       |
| `commit_files`     | path, oid           | `FileChange[]`    | 某 commit 的变更文件 + 行数    |
| `file_diff`        | path, oid, file     | `FileDiff`        | 某 commit 中单文件的 diff      |
| `working_diff`     | path, file          | `FileDiff`        | 工作目录 vs index              |
| `conflicts`        | path                | `ConflictFile[]`  | 当前冲突文件列表               |
| `merge_state`      | path                | `MergeState`      | 仓库当前状态                   |
| `conflict_content` | path, file          | `ConflictContent` | 冲突文件 3 路 blob 内容        |
| `resolve_conflict` | path, file, content | `()`              | 写入 + git add                 |
| `list_refs`        | path                | `RefEntry[]`      | 本地/远程分支 + tag            |

---

## 七、构建可分发安装包

```bash
cd G:\GitTools
bun run tauri:build
```

首次会跑 Rust release LTO（约 3-6 分钟），之后增量。

产物位置：

| 平台    | 路径                                                  |
| ------- | ----------------------------------------------------- |
| Windows | `src-tauri/target/release/bundle/{msi,nsis}/`         |
| macOS   | `src-tauri/target/release/bundle/{dmg,macos}/`        |
| Linux   | `src-tauri/target/release/bundle/{appimage,deb,rpm}/` |

---

## 八、常见问题排查（FAQ）

### Q1：双击 Open Repository 后窗口空白？

按 `F12` 打开 DevTools → Console 标签 → 看是否有红色错误。常见原因：

- 选中的目录不是 git 仓库（没有 `.git/`）
- WebView2 旧版本（更新一下 Edge）

如果有 ErrorBoundary 红色错误页，请截图反馈。

### Q2：DAG 提交图所有 dot 都在一列？

理论上不会发生（已修复）。如发生：

- 按 F5 或 Ctrl+R 刷新
- 重启应用
- 如果仍然有问题，把 DevTools 的 `console.table(__layout)` 输出截图反馈

### Q3：Diff 看不到颜色？

- 确认 toolbar 显示 "X hunks"，如果是 0 hunks 说明该文件确实没变
- 如果是 binary 文件，会显示 "Binary file — no preview."

### Q4：Merge 视图说 "Repository is clean" 但终端 git status 显示有冲突？

按 F5 刷新视图。如果仍然不行：

- 确认你在 Git Tools 里打开的就是终端那个仓库
- 检查 `.git/MERGE_HEAD` 文件是否存在

### Q5：Mark resolved & stage 按钮一直是灰的？

意味着至少一个 conflict block 还是 `pending` 状态。检查 RESULT 列每个块：

- `pending` 红色背景 = 未操作
- 任意其他状态（`left/right/both/manual`）= 已解决

需要把所有块都从 pending 切走。

### Q6：在 Tauri dev 模式下改 Rust 代码后窗口没刷新？

cargo 增量编译完会自动 reload。如果卡住：

- 看终端日志（`.tauri-dev.log.err`）
- 强制重启 dev：`Stop-Process -Name git-tools, bun -Force` 然后 `bun run tauri:dev`

### Q7：bun install 时 `ConnectionRefused`？

检查 `bunfig.toml`：

```toml
[install]
registry = "https://registry.npmmirror.com/"
```

或您公司内网镜像。

### Q8：Windows SmartScreen 弹"已保护你的电脑"？

因为安装包未做 EV 代码签名。点 "更多信息 → 仍要运行" 即可。如果要消除这个警告，需要购买 EV 代码签名证书并在 build 流程中签名。

### Q9：高 DPI 屏幕字体太小？

按住 Ctrl + 滚轮放大整个 webview（Tauri 默认支持）。或者修改 `tauri.conf.json` 的 `windows.width/height` 默认值。

---

## 九、卸载与清理

### 卸载应用

- **NSIS 安装的**：开始菜单 → Git Tools → Uninstall；或者控制面板 → 程序和功能
- **MSI 安装的**：控制面板 → 程序和功能 → Git Tools → 卸载

### 清理用户数据

应用本身不在用户目录写额外文件，**仅 localStorage** 存了 Recent 仓库列表。要清掉：

1. 打开应用 → F12 → Application 标签 → Local Storage → 删 `gittools.recent-repos`
2. 或直接在 Welcome 页对每条 hover 点 `×`

### 清理源码构建产物（如果跑过 dev/build）

```powershell
cd G:\GitTools
Remove-Item -Recurse -Force node_modules
Remove-Item -Recurse -Force dist
Remove-Item -Recurse -Force src-tauri\target
Remove-Item -Recurse -Force .tsbuild
Remove-Item -Force .tauri-dev.log*, .tauri-build.log*
```

---

## 反馈与扩展

如果想加功能，已具备的扩展点：

- **新增 Rust 命令**：在 `src-tauri/src/commands.rs` 加 `#[tauri::command]`，在 `src-tauri/src/lib.rs` 的 `invoke_handler!` 里注册
- **新增视图**：在 `ViewKey` 类型里加，`App.tsx` 加路由，`Sidebar.tsx` 加按钮
- **改主题颜色**：`src/styles/globals.css` 顶部的 `--branch-1..5`、`--diff-*` 变量；以及 `GraphRow.tsx` 里的 `BRANCH_COLORS` 字面量

---

**祝使用愉快！** 🎉
