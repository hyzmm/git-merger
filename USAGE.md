# Git Tools — 使用说明

[English](./USAGE.en.md) · **简体中文**

IDEA 风格的 **History / Diff / Merge / Blame / Rebase** 桌面应用，基于 Tauri 2 + React 19 + git2-rs (vendored libgit2)，可在 Windows / macOS / Linux 运行。

> 适用版本：v0.13.0  
> 仓库位置：`G:\GitTools\`  
> 安装包位置：`G:\GitTools\src-tauri\target\release\bundle\`（本地构建）或 [GitHub Releases](https://github.com/hyzmm/git-merger/releases)

---

## 目录

- [一、安装](#一安装)
- [二、首次启动](#二首次启动)
- [三、视图速览](#三视图速览)
  - [3.1 History（提交历史 + Graph）](#31-history提交历史--graph)
  - [3.2 Diff（差异查看）](#32-diff差异查看)
  - [3.3 Merge（冲突解决）](#33-merge冲突解决)
  - [3.4 Changes（工作树）](#34-changes工作树)
  - [3.5 Blame（行级历史 + 跨重命名追溯）](#35-blame行级历史--跨重命名追溯)
  - [3.6 Stash](#36-stash)
  - [3.7 Reflog（HEAD 时光机）](#37-refloghead-时光机)
  - [3.8 Submodules](#38-submodules)
  - [3.9 Interactive Rebase](#39-interactive-rebase)
  - [3.10 File History（单文件时间线 + 跟随重命名）](#310-file-history单文件时间线--跟随重命名)
  - [3.11 Worktrees（多工作树）](#311-worktrees多工作树)
  - [3.12 .gitignore 编辑器](#312-gitignore-编辑器)
  - [3.13 历史搜索（跨提交内容查找）](#313-历史搜索跨提交内容查找)
- [四、Topbar 与远程操作](#四topbar-与远程操作)
  - [4.1 应用菜单（☰）](#41-应用菜单)
  - [4.2 Undo 按钮（reflog quick actions）](#42-undo-按钮reflog-quick-actions)
  - [4.3 多仓库 tabs（v0.12.0 / v0.13.5）](#43-多仓库-tabsv0120--v0135)
- [五、Command Palette（Ctrl+K）](#五command-palettectrlk)
- [六、设置面板](#六设置面板)
- [七、自动更新](#七自动更新)
- [八、键盘快捷键](#八键盘快捷键)
- [九、典型工作流](#九典型工作流)
- [十、从源码运行 / 二次开发](#十从源码运行--二次开发)
- [十一、构建可分发安装包](#十一构建可分发安装包)
- [十二、常见问题排查（FAQ）](#十二常见问题排查faq)
- [十三、卸载与清理](#十三卸载与清理)

---

## 一、安装

### Windows（推荐）

任选一种安装包（在 `src-tauri/target/release/bundle/` 或 GitHub Releases）：

| 安装包                 | 文件                            | 适合                |
| ---------------------- | ------------------------------- | ------------------- |
| **NSIS**（推荐，更轻） | `Git Tools_x.y.z_x64-setup.exe` | 个人使用            |
| **MSI**                | `Git Tools_x.y.z_x64_en-US.msi` | 企业部署 / 静默安装 |

> 第一次启动可能会弹 Windows SmartScreen 提示（因为安装包未数字签名），点 "更多信息 → 仍要运行" 即可。从 v0.4.0 起应用支持自动更新（详见第七章）。

### macOS / Linux

GitHub Actions release 流水线会在 tag push 时为 4 个平台同时构建（windows / macos-arm64 / macos-intel / linux），并把所有产物附在 GitHub Release Draft 上。

如果要本地构建：

```bash
git clone https://github.com/hyzmm/git-merger.git GitTools
cd GitTools
bun install
bun run tauri:build
```

产物：

- macOS：`src-tauri/target/release/bundle/{dmg,macos}/`
- Linux：`src-tauri/target/release/bundle/{appimage,deb,rpm}/`

---

## 二、首次启动

启动后看到 **Welcome 页**：左侧 Logo + 介绍，右侧 Recent 仓库列表（hover 出 `×` 可移除）。点 **Open Repository** 按钮选择仓库根目录（包含 `.git/` 那一层）。

> Windows 文件对话框里 **地址栏当前所在的目录** 才是被选中目录——不要进入它内部再点确认。

打开成功后自动跳到 History 视图。从 v0.4.0 起应用会记住你上次选的语言（en/zh）和主题（auto/light/dark），并在启动前同步主题，避免亮屏闪烁（FOUC-free）。

---

## 三、视图速览

左侧 Sidebar 共 **11 个视图图标**，对应快捷键 `Ctrl+1..9`、`Ctrl+0` 与 `Ctrl+Shift+F`：

| Sidebar 顺序 | 快捷键         | 视图               |
| ------------ | -------------- | ------------------ |
| 1            | `Ctrl+1`       | History            |
| 2            | `Ctrl+2`       | Changes            |
| 3            | `Ctrl+3`       | Stash              |
| 4            | `Ctrl+4`       | Reflog             |
| 5            | `Ctrl+5`       | Submodules         |
| 6            | `Ctrl+8`       | Interactive Rebase |
| 7            | `Ctrl+9`       | Worktrees          |
| 8            | `Ctrl+0`       | .gitignore 编辑器  |
| 9            | `Ctrl+Shift+F` | 历史搜索           |
| 10           | `Ctrl+6`       | Diff               |
| 11           | `Ctrl+7`       | Merge              |

> Blame 没有独立 sidebar 入口，从 Diff 工具栏的 **Blame** 按钮进入。

### 3.1 History（提交历史 + Graph）

三栏布局：左 **Refs 面板**、中 **Commit List + DAG**、右 **Commit Details**。

**左 — Refs 面板**

- **HEAD 置顶项（v0.9.1）**：列表最顶部独立一栏，显示当前 HEAD。已 attach 到分支时显示分支名 + 短 oid，左侧带主题色边条 + 半透明高亮背景；detached 状态显示 `(detached)` 提示。点击即跳转到 HEAD 所在 commit
- **过滤栏（Filter Bar，v0.2.0 起）**：
  - 关键字框：按 message / author / email / oid 前缀 / ref 名 实时过滤
  - **作者下拉**（v0.2.0）：自动汇总所有 commit 的 author，按出现频率排序
  - **日期范围（since / until）**（v0.2.0）：UNIX 秒级精确过滤
  - **路径（pathspec）**（v0.2.0）：输入路径让后端走 `git log -- <path>`，只显示触及该路径的 commit
  - **Reset filters** 按钮一键清空所有过滤条件
- **LOCAL / REMOTE / TAGS 三段**：HEAD 分支高亮 `HEAD` 标识；颜色与 DAG lane 一致
- **单击任一 ref → 跳转并选中该 commit**（v0.2.0 修复，commit 列表会自动滚到目标行）
- **右键 ref（v0.2.0 起）**：
  - 本地分支：Checkout / Rename / Delete / Create branch from / Copy name
  - 远端分支：Checkout as new local / Copy name
  - 标签：New branch from tag / Delete / Copy name
- **"+" 按钮**：从 HEAD 创建新分支（可选立即 checkout）
- **双击本地分支**：直接 checkout

**中 — Commit List + DAG**

- 5 色循环（蓝/紫/金/绿/红）按 ref 名稳定分配 lane
- 直线 = 同 lane 持续；曲线 = 分支或合并；多 parent merge 同时连接所有父 lane
- 虚拟滚动（@tanstack/react-virtual），10 万 commit 流畅
- **右键任一 commit（v0.2.0 起）**：
  - **Cherry-pick onto HEAD**（冲突自动跳到 Merge 视图）
  - **Revert this commit**
  - **Reset HEAD to here**（soft / mixed / hard，每种带不同警告文案）
  - **Rebase interactively from here**（v0.6.0，详见 3.9）
  - **Create branch from here** / **Create tag here**
  - **Checkout (detached HEAD)**（带二次确认）
  - **Copy SHA** / **Copy commit message**

**右 — Commit Details**

- 完整 oid / parents 短哈希 / author + email / 本地化时间 / 所有 ref chips
- **Changed files** 列表（A / M / D / R / C / T 状态 + 行级 +N -N）
- 点击文件名 → 跳到 Diff 视图

> **大仓库性能（v0.10.3 起）**：History 视图采用 cursor-based 分页，首屏只加载 1000 条 commit；当虚拟滚动到接近列表尾部（默认距底部 20 行）时自动 fetch 下一页 1000 条并追加。Graph layout（lane 分配 + curve 计算）也升级为增量算法，新加载的 page 只对新增 commit 计算，并完全沿用上一 page 的 lane 状态——所以滚动加载不会"跳色"，性能也不会随着列表增大而退化。  
> 状态栏的 `· +more` 提示后端还有更多页；`· loading more...` 表示正在追加。

### 3.2 Diff（差异查看）

**左：文件树**（按目录分组，状态字母 + 文件名 + 行数）；**右：Diff 主体**

- **模式切换**：Side-by-side（左旧右新）/ Unified
- **行级 + 词级高亮**：替换行内只对真正变动的 token 加 `+`/`-` 颜色（基于 LCS）
- **Shiki 语法高亮**：~35 种语言（TS / Rust / Python / Go / C++ / …）
- **Whitespace 可视化**：⌫ 按钮启用，空格→`·`，tab→`→`
- **Ignore Whitespace**（v0.2.0）：另一个按钮，让后端用 libgit2 的 `ignore_whitespace` 重算 diff（与可视化是互补的）
- **跳转到 hunk**（v0.2.0）：工具栏 ↑/↓ 按钮，或快捷键 `n` / `p`
- **Blame 按钮**：跳到 Blame 视图查看该文件

### 3.3 Merge（冲突解决）

> 仓库正在 merge / rebase / cherry-pick / revert 时此视图才有内容。

三栏：LEFT (ours) / RESULT (working, 可编辑) / RIGHT (theirs)。每个 conflict block 顶部有：

| 按钮         | 状态色 | 作用               |
| ------------ | ------ | ------------------ |
| Accept Left  | 蓝     | 用 ours 内容       |
| Accept Right | 紫     | 用 theirs 内容     |
| Accept Both  | 绿     | ours + theirs 拼接 |
| 直接编辑     | 橙     | manual             |

**所有 block 都不再 pending → "Mark resolved & stage" 可点击** → 写文件 + `git add`。

**v0.1.0 起内置的两个按钮**：

- **Abort merge**：调用 libgit2 取消当前 merge / cherry-pick / revert（rebase 用第 3.9 节的 Abort）
- **Commit merge**：直接在 UI 内提交合并 commit，无需切换终端

### 3.4 Changes（工作树）

按 `Ctrl+2`。三段：**Unmerged** / **Staged** / **Unstaged**。

| 想做什么            | 怎么做                                                                         |
| ------------------- | ------------------------------------------------------------------------------ |
| 单文件加暂存        | 勾选 → **Stage**                                                               |
| 全选                | **Select all** → **Stage**                                                     |
| 撤回暂存            | 勾选 → **Unstage**                                                             |
| 丢弃工作区改动      | 勾选 → **Discard**（带不可逆确认）                                             |
| 提交                | 输入 commit message → **Commit M files**                                       |
| 暂存当前改动到栈    | 顶部 **Stash…** 按钮（可选 include-untracked）（v0.2.0）                       |
| 在 Diff 中查看/编辑 | 直接点击文件名 → 跳到 Diff 视图，工具栏多出 **Edit** 切换可编辑右侧（v0.13.3） |

### 3.5 Blame（行级历史 + 跨重命名追溯）

入口：Diff 工具栏的 **Blame** 按钮。

- 同 commit 修改的连续行只在第一行显示作者/时间/oid（IDEA 风格分组）
- 短 oid 可点击 → 跳到 History 选中
- 整列虚拟滚动 + Shiki 语法高亮
- **Annotate previous（v0.3.0）**：工具栏出现 "Annotate previous: <oldpath>@<oid>" 链接（基于 `Diff::find_similar` 的重命名检测）。点击跳到该文件的上一个身份（可能是不同路径）；自动维护 back stack（**Back** 按钮回退）。这是 IDE 友好的"跨重命名追溯"

### 3.6 Stash

按 `Ctrl+3`。每个 stash entry 一行，按时间倒序：

| 按钮      | 作用                     |
| --------- | ------------------------ |
| **Apply** | 应用，保留在栈           |
| **Pop**   | 应用并从栈移除           |
| **Drop**  | 不应用直接丢弃（带确认） |

新建 stash：在 **Changes** 视图顶部点 **Stash…** 按钮（可输入消息、勾选 include-untracked）。

### 3.7 Reflog（HEAD 时光机）

按 `Ctrl+4`。展示 `HEAD@{N}` 的所有变更，并按动作类别上色：

- commit / reset / checkout / merge / rebase / cherry-pick / revert / pull 不同色 chip
- 每行后面：
  - **Restore** = mixed reset 到该状态（保留工作区）
  - **Hard** = hard reset 到该状态（带警告，**会丢失未提交改动**）

这是"撤销刚才那个错误操作"的最后一道保险。

### 3.8 Submodules

按 `Ctrl+5`。每个 submodule 一行，自动计算的状态徽章：

- `not cloned` / `not initialized` / `needs update` / `dirty` / `clean`

操作按钮：**Init** / **Update**（含 init-first）/ **Sync**（同步 URL）。

### 3.9 Interactive Rebase

按 `Ctrl+8`，或在 History 中右键任一 commit → **Rebase interactively from here (`<oid>^`)**。

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

**草稿模式**：

- 顶部 **PICK / REWORD / SQUASH / FIXUP / DROP** 选择器，颜色不同
- ↑↓ 重排顺序
- REWORD / SQUASH 展开内嵌消息编辑框
- 点 **Start rebase** 开始

**执行模式**：

- 顶部进度条 `done/total (pct%)`
- 后端按 plan 顺序 cherry-pick → commit / amend
- **遇到冲突**：进度条变红，UI 自动跳到 Merge 视图。在 Merge 视图解决并 stage（**Mark resolved & stage**），然后回到 Rebase 视图点 **Continue**
- **Abort**：随时点击红色 Abort 按钮（带确认），恢复到原 branch tip
- 状态持久化到 `.git/gittools-rebase/state.json`，**关闭应用再打开 plan 仍在**

### 整理顺序示例

把"wip"和"debug log"压扁到上一个 commit，并整理 message：

1. History 右键 `eee2a1d` → Rebase interactively from here
2. 把 `wip` 设为 **squash**，写新合并消息
3. 把 `debug log` 设为 **drop**
4. 第二条设为 **reword**，改 message
5. 点 Start，自动跑完即可（无冲突时秒回）

### 3.10 File History（单文件时间线 + 跟随重命名）

`git log --follow -- <path>` 等价的视图。两栏：

- **左**：该文件的提交时间线（旧→新逆序）。每行：状态徽章（A/M/D/R/C/T）+ 短 oid + 摘要 + 作者 + +N -N 行数。**重命名 / 拷贝** 在行尾显示 `oldpath → newpath` 的细字
- **右**：选中提交时该文件的 diff（Side-by-side / Unified 自由切换，复用主 Diff 视图的渲染管线）

后端按需 `Diff::find_similar` 检测重命名，每次循环后切换跟踪的路径，所以 `lib/graph.ts` → `src/lib/graph.ts` → `src/components/Graph.tsx` 这样的迁移链能完整呈现。

**入口（v0.8.0）**：

- **Diff 工具栏 → History**：当前打开的文件的历史
- **Blame 工具栏 → File history**：blame 文件的历史
- **History → Commit Details 右键文件**：弹出菜单，含 "Show file history (follows renames)" / "Open diff at this commit" / "Blame current version" / "Copy path"

点击右栏标题里的短 oid 也能直接跳到完整 commit diff。

### 3.11 Worktrees（多工作树）

按 `Ctrl+9`。`git worktree` 等价的视图，让你在同一个仓库里同时检出多个分支到不同目录，无需 stash 来回切换。

**布局**：单列列表，**主检出 (main)** 始终置顶并带半透明高亮。每行显示工作目录绝对路径、分支名（或 `(detached)`）、HEAD 短 oid 与注册名。

**徽章**：

- `main`：当前仓库的主检出
- `locked`：通过 `git worktree lock` 锁定，禁止 prune
- `prunable`：磁盘上工作目录已不在，元数据残留可清理（橙色提示）

**工具栏按钮**：

| 按钮      | 行为                                                                           |
| --------- | ------------------------------------------------------------------------------ |
| **Add**   | 展开内联表单：路径（带 Browse 选目录）/ 名称（默认取末段）/ 分支（留空则新建） |
| **Prune** | 一键扫描所有可清理工作树并删除元数据                                           |

**每行（非 main）按钮**：

- **Remove**：在工作树干净时安全移除（`git worktree remove`）
- **Force remove**（红色）：即使工作目录还在也强制删除，弹二次确认；适用于已知不会丢东西的场景

**典型用例**：

1. 想边 review PR 边在主分支继续开发 → Worktrees → Add，路径填 `../gittools-review`，分支选 PR 分支
2. 跨目录 build / test 同时跑两个 commit
3. 误删工作目录后留下"幽灵"工作树 → 直接点 **Prune**

后端通过 libgit2 `git_worktree_*` 接口实现，没有 fork system git。所有 4 个操作都覆盖了 `cargo test --test git_layer` 集成测试。

### 3.12 .gitignore 编辑器

按 `Ctrl+0`。**仓库根 `.gitignore` 的可视化编辑器**，三栏布局：

| 栏位          | 作用                                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| **左 模板**   | 8 个内置 starter（Node / Rust / Python / Go / macOS / Windows / JetBrains / VS Code），点击即追加到当前内容 |
| **中 编辑器** | 大 textarea，等宽字体；底部状态栏显示行数 / 字符数；右上 toolbar 含 Preview / Reset / Save                  |
| **右 预览**   | 点击 Preview 后展示这份候选文本相对磁盘版本的差异                                                           |

**"未保存"提示**：编辑器内容与磁盘不同步时，标题栏出现橙色 `unsaved` 徽章。

**Preview** 是这个编辑器的核心特性 —— 不需要 Save 就能告诉你：

- ⚠️ **Newly ignored**（橙色 ＋）：候选规则会让哪些工作目录文件**新被忽略**。**Tracked 文件不会因为加规则而停止追踪**——若列出来意味着可能需要后续 `git rm --cached`
- ✅ **No longer ignored**（绿色 −）：候选规则比磁盘版本宽松，哪些之前被忽略的路径会变成不再忽略

实现细节：后端先用 `Repository::statuses(include_ignored=true)` 收集所有 tracked / untracked / ignored 路径，做 baseline 快照；然后**临时把磁盘 `.gitignore` 重命名为 `.gitignore.gittools-preview-bak`**，开新 `Repository` handle、用 `add_ignore_rule(candidate)` 注入候选文本作为唯一规则源，再次调 `is_path_ignored` 算 candidate 状态；用 RAII 守护保证文件总是恢复（即便 panic）。整个窗口几毫秒。

**Save** 写入 `<repo>/.gitignore`（原子 rename），并自动刷新 Changes 视图，避免你看到过时的 untracked 列表。

**典型用例**：

1. 新仓库初始化 → 选 Node + macOS 模板 → Save
2. 想把 `dist/` 加进忽略 → 输入 `dist/` → Preview 显示哪些文件会被新忽略 → 确认无误后 Save
3. 临时取消某条规则做实验 → 删除规则行 → Preview 看不再忽略的列表 → 不满意点 Reset 一键还原

### 3.13 历史搜索（跨提交内容查找）

按 `Ctrl+Shift+F`。**两栏布局**：左 = 工具栏 + 结果列表，右 = 命中预览。

**三种搜索模式**（toolbar 切换）：

| 模式             | git 等价         | 适用场景                                                         |
| ---------------- | ---------------- | ---------------------------------------------------------------- |
| **Both**（默认） | message + 内容   | 不确定关键词在哪里就用这个                                       |
| **Message**      | `git log --grep` | 只搜 commit message（subject + body）                            |
| **Diff**         | `git log -S/-G`  | **pickaxe**：定位"哪个 commit 引入/删除了某段代码"——最强大的模式 |

**两种匹配方式**：

- **Literal**（默认）：把输入当作字面量子串
- **Regex**：Rust 风格正则表达式（支持锚点、字符类、捕获组等）

其它 toolbar 项：

- **Aa**（Case）：切换大小写敏感
- **Path**：限定 pathspec，比如 `src/` 或 `*.rs`，用与 History 视图相同的语义

**结果行**：每条命中显示短 oid / summary / 作者 / 相对时间 / `msg`（命中 message）/ `+/− N`（diff 命中数）。点选某行 → 右栏显示：

- 命中 message 的高亮预览（如果 message 命中）
- 按文件分组的 +/- 行清单：行号、`+/−` 标志、内容；新增行用绿色，删除行用红色
- 标题栏右侧 **Open** 按钮 → 跳转到 History 视图并自动选中该 commit

**安全与性能**：

- 默认扫描上限 **5000 commits**；超过则返回 `truncated` 标识，UI 顶部显示橙色 `truncated` 徽章
- 单 commit diff 文本若超过 2 MB 自动跳过 diff 检查（避免 `vendored` 大目录拖慢进度）
- 单 commit 最多记录 **20** 条 diff 命中，单次搜索最多 **500** 条 hits
- 后端用 `git2 diff_tree_to_tree` + Rust `regex` 实现，没有 fork system git，跨平台一致

**典型用例**：

1. 想知道 `LICENSE` 改动史 → mode=Diff、pattern=`MIT License`、path=`LICENSE`
2. 找到引入 `unwrap_or_default` 的 commit → mode=Diff、pattern=`unwrap_or_default`
3. 查所有提到 issue #42 的 commit → mode=Message、pattern=`#42`
4. 查找硬编码的 IP 地址 → mode=Diff、kind=Regex、pattern=`\b(?:\d{1,3}\.){3}\d{1,3}\b`

**v0.13.4 新增**：

- **Group by**（工具栏切换）：**Commit** = 一行一个命中（旧版本布局）；**File** = Find-in-Path 风格，每个文件一次显示，触及它的 commit 嵌套展开。文件按总命中行数降序，前 3 个默认展开。仅 message 命中（无 diff 命中）的 commit 在文件视图里**不出现**——文件视图是内容驱动的。
- **最近搜索**（输入框右侧时钟图标）：保留最近 12 条结构化去重的搜索（mode + kind + case + path + query 任一不同就视为新条目）。点击即应用并立即重跑。
- **★ Save**（保存当前搜索）：起个名字保存当前的全套条件（query/mode/kind/case/path），下次一键复用。同名保存直接替换。所有保存项 + 最近搜索都持久化到 localStorage，跨会话保留。

---

## 四、Topbar 与远程操作

```
┌─[☰]──[F5↻]──────────[Cloud][↓Pull][↑Push]──[↺Undo▾]──[ Search Ctrl+K ]──[Updater]──[⚙]─┐
│           branch: main  G:\GitTools                                                    │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

> v0.9.1 起左上角由原 **Open Repository** 按钮替换为 ☰ **应用菜单**，把"打开仓库 / 最近仓库 / 关闭仓库 / 关于 / 退出"等低频项收进菜单，Topbar 只保留高频按钮。详见 [4.1 应用菜单](#41-应用菜单)。

**Fetch / Pull / Push**（v0.5.0 起原生 libgit2，不再依赖系统 git）：

| 按钮      | 行为                                                              |
| --------- | ----------------------------------------------------------------- |
| **Fetch** | 抓取所有 remote + prune 失效远端 ref                              |
| **Pull**  | **仅 fast-forward**；非 FF 会报错并引导你用 Merge 视图            |
| **Push**  | 自动从 branch upstream 推断 remote；无 upstream 时回落到 `origin` |

**实时进度**（v0.5.0）：右上角显示 "Receiving 1234/5678" / "Indexing" / "Pushing" 等。

**凭据解析顺序**：

1. **SSH agent**（URL 是 SSH 时）
2. **`~/.ssh/id_ed25519` / `id_rsa` / `id_ecdsa`**
3. **Git credential helper**（HTTPS 用户名/密码，从 `~/.gitconfig` 读）
4. **应用内弹窗**：弹出"登录远端"对话框，填用户名 + token（GitHub / GitLab / Bitbucket 都已不支持密码，请用 PAT）。最多重试 3 次，2 分钟超时

完成后顶部出现绿色 / 红色 banner，含 message 和 details，点 Dismiss 关闭。

### 4.1 应用菜单（☰）

v0.9.1 起 Topbar 最左侧的 ☰ 图标点开后弹出"应用菜单"：

| 菜单项                  | 快捷键   | 行为                                                                      |
| ----------------------- | -------- | ------------------------------------------------------------------------- |
| **Open repository…**    | `Ctrl+O` | 等同 Welcome 页的打开按钮，弹出系统目录选择对话框                         |
| **Recent repositories** | —        | 内联展开列表（最多 8 条），点击即打开；hover 行尾出现 `×`，可移除该条记录 |
| **Close repository**    | —        | 关闭当前仓库回到 Welcome 页                                               |
| **About Git Tools**     | —        | 弹出关于对话框：应用名 + 版本号 + GitHub 链接                             |
| **Quit**                | `Alt+F4` | 退出应用                                                                  |

设计原则：高频按钮（Refresh / Fetch / Pull / Push / Search / Settings / Updater）仍直接挂在 Topbar，低频管理项收进菜单，让顶栏更简洁。

> `Ctrl+O` 是全局快捷键，无需打开菜单也能直接弹起目录选择。

### 4.2 Undo 按钮（reflog quick actions）

v0.10.2 起在 Topbar 远程按钮组之后加入 **↺Undo** 一键撤销按钮，目标是把 Reflog 视图里"恢复到操作前状态"的常用动作前置出来。

**主按钮**：直接撤销最近一次"有意义"的操作（**reset / merge / pull / cherry-pick / revert / rebase（开始/结束）/ commit (amend)**）。点击后调用 `git reset --mixed` 把 HEAD 重置到该操作发生**前**的 oid——保留工作目录的改动，安全可逆。

**下拉箭头**：展开浮层，列出最近 8 条可撤销项，每条 inline 一键回退。每行显示：

- `HEAD@{N}`：reflog 索引
- 操作类型徽章（reset / merge / pull / …，不同色）
- reflog 原始 message
- 目标短 oid

**重要安全设计**：

- **不展示普通 commit**——避免一键删除你刚写完的代码
- **不展示 checkout / branch / push / stash**——这些不是危险操作，没必要预置
- **顶端遇到 commit 即停**——`findQuickUndo` 在 reflog 顺序里碰到普通 commit 后立刻 `return null`，意味着"你提交完后，按钮就消失了"，需要去 Reflog 视图手动操作
- **rebase 中间步骤被排除**——只有 `(start)` / `(finish)` 视为可 undo，`(pick)` 等过程态不能直接撤销

**典型用例**：

1. 不小心 `git reset --hard` 多了 → 一键 Undo reset
2. 误 merge 了错分支 → 一键 Undo merge
3. cherry-pick 错 commit → 一键 Undo cherry-pick
4. amend 了不该 amend 的 message → 一键 Undo amend

按钮在 reflog 顶端没有可撤销项时**自动隐藏**，不占空间。

### 4.3 多仓库 tabs（v0.12.0 / v0.13.5）

Topbar 上方新增一栏 **RepoTabs**，支持同时打开多个仓库并在它们之间快速切换——类似 IDE 的标签页。

**核心交互**：

| 操作              | 行为                                                          |
| ----------------- | ------------------------------------------------------------- |
| `Ctrl+T`          | 新建一个空白 tab，立即显示 Welcome 页                         |
| 点击 tab          | 切换到该 tab                                                  |
| 双击 tab 标签     | 重命名该 tab（默认是仓库末段路径名）                          |
| 点击 tab 上的 ×   | 关闭该 tab；如果是最后一个 tab，回到 Welcome 页               |
| `Ctrl+W`          | 关闭当前 tab（pinned tab 会被拒绝，需要先取消钉选）           |
| `Ctrl+PageDown`   | 切到下一个 tab，循环（v0.13.5）                               |
| `Ctrl+PageUp`     | 切到上一个 tab，循环（v0.13.5）                               |
| 拖拽 tab          | 重排 tab 顺序；拖入/拖出 pinned 区会自动 pin/unpin            |
| 右键 tab          | 弹出菜单：Pin / Unpin / Close / Close others / Close to right |
| AppMenu → New tab | 等价于 `Ctrl+T`                                               |

**Per-tab 状态隔离**：每个 tab 独立保留 view（History/Diff/Merge/...）、history 滚动位置 / filter / 选中 commit、stash / reflog / submodules / rebase 状态、Diff 选中文件、Worktrees 列表、.gitignore 草稿、Search 查询。切换 tab 时**当前 tab 的全部状态被快照存档**，目标 tab 的状态被恢复到顶层——这是 zero-cost 切换，不会因为 tab 数量增加而拖慢。

**v0.13.5 — 跨会话持久化 + 钉选 + 拖拽 + 右键菜单**：

- **持久化**：tab 列表（id / repoPath / label / pinned）+ active tab id 写入 `localStorage` 的 `gittools.tabs.v1`，重启自动恢复。Per-tab session（history / refs / diff …）**不**持久化——每个恢复的 tab 第一次被切到时按需重新 `openRepo`，比序列化整个 `SessionSnapshot` 便宜得多。空白 "(new)" tab 被刻意排除（避免重启后复活没用的占位）。`MAX_TABS = 32` 上限。
- **Pinned tabs**：右键 → **Pin tab**，被钉的 tab 会按稳定分区排到 tab 栏最前（pinned 区域），拒绝被 `Ctrl+W` 关闭，`×` 按钮替换为内联的 ⊘ 取消钉选按钮。Close other tabs / Close right 等批量操作**保留**所有 pinned tab——尊重用户显式的钉选意图。
- **拖拽重排**：`draggable={true}` 原生 HTML5 拖拽。拖动中 tab 透明度变 50%，目标位置出现 2px 主题色插入条。拖到 tab 右半边插到其后，左半边插到其前，拖过最右边落在末尾。**拖入 pinned 区自动 pin，拖出去自动 unpin**——和 VS Code / 浏览器一致。
- **右键菜单**：`ContextMenu` 弹层（复用 `RefsPane` / `CommitList` 的同款组件）。菜单项：Pin/Unpin · Close · Close other tabs · Close tabs to the right。无意义项自动 disabled（如所有非 pinned 都已关、当前 tab 右边没非 pinned）。

**实现要点**：

- 顶层 store 始终镜像 active tab 的状态，所有现有的 `useApp(s => s.history.commits)` selectors 完全不需要改动
- 非 active tab 的状态停泊在 `sessionsById: Record<tabId, SessionSnapshot>`，切换是一次 batch swap
- 同一 repo 已被某个 tab 打开时，再次 `openRepo` 会自动**切到那个 tab**而不是建新的——避免重复
- 持久化通过 `useApp.subscribe(...)` 在 store 创建后挂载——任何改 tabs / activeTabId 的 set() 都自动触发 `saveTabs`，结构化 diff 减少冗余写
- 重排算法 `reorderTabs(from, to)` 是纯函数，单测覆盖了"无论怎么拖，pinned 始终在 unpinned 之前"的 invariant（`bun:test` 里跑了所有 (from, to) 组合的穷举）

**典型用例**：

1. 同时开 frontend / backend 两个仓库，频繁切换看 PR
2. 一个 tab 在 main 分支查 history，另一个 tab 在 feature 分支跑 rebase plan
3. 临时打开第三个仓库查个 commit hash，查完 `Ctrl+W` 关闭即可
4. 把工作区主仓库 pin 住，再开关 N 个临时仓库都不会误关核心 tab（v0.13.5）
5. 关掉应用第二天打开，所有 tab 顺序 + pinned 状态原样恢复（v0.13.5）

---

## 五、Command Palette（`Ctrl+K`）

v0.7.0 新增。按 `Ctrl+K` 或 `Ctrl+P` 弹出，或点 Topbar 的 **Search** 按钮。

```
┌─[🔎 搜索提交 / 分支 / 文件…                   ][esc]─┐
│ ✦ History                                       视图  │
│ 🌿 main                                  本地分支  →  │
│ 🌿 origin/feat/login                     远端分支     │
│ ● a3f9c1e  feat: word-level diff   3 days ago         │
│ 📄 src/lib/wordDiff.ts            在 Blame 中打开     │
│ 📄 src/lib/graph.ts                                   │
│ ─────────────────────────────────────────────────     │
│ ↑↓ navigate   ↵ open                  214 results     │
└───────────────────────────────────────────────────────┘
```

**搜索目标**（按命中后的行为）：

| Kind   | 行为                                  |
| ------ | ------------------------------------- |
| 视图   | 切换到该视图                          |
| 分支   | 本地：`checkout`；远端：跳到该 commit |
| 标签   | 跳到该 commit                         |
| Commit | 跳到 History 并选中该 commit          |
| 文件   | 在 Blame 中打开                       |

**模糊匹配**：子序列（`grph` 能匹配 `lib/graph.ts`），命中字符内联 `<mark>` 高亮，前缀 / 词边界 / 连续命中 / 大小写敏感都有加分。

**键盘**：`↑↓` / `Home` / `End` 导航，`Enter` 打开，`Esc` 关闭。

---

## 六、设置面板

v0.4.0 起。点 Topbar 右侧 **⚙** 图标打开。

**外观**：

- **主题**：Auto（跟随系统）/ Light / Dark；切换无 FOUC（启动前内联 script 已读 localStorage）
- **字号**：12 / 13 / 14 / 15 / 16 / 18 px
- **Tab 宽度**：2 / 4 / 8（影响 Diff / Blame 显示）
- **语言**：English / 中文（启动时从 `navigator.language` 自动检测，可手动切换）

**Git config**（v0.4.0）：

- 编辑 `core.autocrlf`，作用域可选 **当前仓库** 或 **全局 ~/.gitconfig**
- 选项：`(unset)` / `false` / `input`（推荐 macOS/Linux）/ `true`（推荐 Windows）

---

## 七、自动更新

v0.4.0 起内置 `tauri-plugin-updater`。当检测到新版本：

- Topbar 出现一个绿色徽章 **Update vX.Y.Z**
- 点击弹出 release notes 预览
- 点 **Download & install**：显示进度条
- 完成后 **Restart now** → 重启即装好新版

服务端：GitHub Releases 的 `latest.json`。CI 在每次 tag push 时用 `TAURI_SIGNING_PRIVATE_KEY` 仓库 secret 签名 updater bundles。

> 自动更新需要正确配置 minisign 公钥。从 v0.4.0 起仓库的 `tauri.conf.json` 已有公钥；CI 需配置对应私钥 secret 才会签出真正可用的更新包。

---

## 八、键盘快捷键

| 快捷键              | 作用                                  | 适用  |
| ------------------- | ------------------------------------- | ----- |
| `Ctrl+1`            | History                               | 全局  |
| `Ctrl+2`            | Changes                               | 全局  |
| `Ctrl+3`            | Stash                                 | 全局  |
| `Ctrl+4`            | Reflog                                | 全局  |
| `Ctrl+5`            | Submodules                            | 全局  |
| `Ctrl+6`            | Diff                                  | 全局  |
| `Ctrl+7`            | Merge                                 | 全局  |
| `Ctrl+8`            | Interactive Rebase                    | 全局  |
| `Ctrl+9`            | Worktrees                             | 全局  |
| `Ctrl+0`            | .gitignore 编辑器                     | 全局  |
| `Ctrl+Shift+F`      | 历史搜索（跨提交）                    | 全局  |
| `Ctrl+T`            | 新建仓库 tab（v0.12.0）               | 全局  |
| `Ctrl+W`            | 关闭当前 tab；pinned 拒绝（v0.13.5）  | 全局  |
| `Ctrl+PageDown`     | 切到下一个 tab，循环（v0.13.5）       | 全局  |
| `Ctrl+PageUp`       | 切到上一个 tab，循环（v0.13.5）       | 全局  |
| `Ctrl+K` / `Ctrl+P` | Command Palette                       | 全局  |
| `Ctrl+O`            | 打开仓库（v0.9.1）                    | 全局  |
| `F5` / `Ctrl+R`     | 刷新当前视图                          | 全局  |
| `n` / `p`           | 下一个 / 上一个 hunk                  | Diff  |
| `Alt+1` / `2` / `3` | 第一个 pending 冲突的 Left/Right/Both | Merge |

> 输入框（input/textarea/contenteditable）里这些快捷键自动失效，不会干扰打字（除非用 `Ctrl+` 显式修饰）。

---

## 九、典型工作流

### 1. 审 PR 合并提交

1. 打开仓库 → History
2. 点最新 merge commit → 右栏 changed files
3. 逐个文件点击 → Diff 视图
4. Side-by-side 看核心，Unified 做最终阅读
5. 词级高亮直接定位"改了哪个变量名"

### 2. 解决 merge 冲突

1. 终端 `git merge feature` → 冲突
2. `Ctrl+7` → Merge 视图
3. 每个 block：`Alt+1/2/3` 一键，或手动编辑
4. **Mark resolved & stage** → 下一个文件
5. 全部解完 → 点 **Commit merge** 直接出合并提交（无需回终端）

### 3. 整理一组 wip commit（Interactive Rebase）

1. History 右键 base 之后第一个 wip commit → **Rebase interactively from here**
2. 把不要的 commit 拖排序、设 squash / drop / reword
3. **Start rebase** → 自动跑
4. 遇冲突 → Merge 视图解决 → Continue
5. 完成 → branch ref 自动指向新 tip

### 4. 撤销刚才的错误操作

1. `Ctrl+4` → Reflog
2. 找到"上一个良好状态"那一行
3. 点 **Restore**（保工作区）或 **Hard**（彻底回退）

### 5. 找文件去哪了（重命名追溯）

1. Diff 工具栏 → Blame
2. 工具栏出现 "Annotate previous: <oldpath>"
3. 点击穿越每一次重命名 / 大改
4. **Back** 按钮回到上层

### 6. 在 100k commit 仓库找一行代码

1. `Ctrl+K` → 输入 "graph"
2. 从结果里选 `src/lib/graph.ts` → 在 Blame 中打开
3. 点任意行的短 oid → History 选中该 commit → Diff

---

## 十、从源码运行 / 二次开发

### 环境依赖

| 工具    | 最低版本                                                                    | 安装方式                                    |
| ------- | --------------------------------------------------------------------------- | ------------------------------------------- |
| Bun     | 1.3+                                                                        | `irm bun.sh/install.ps1 \| iex`（Win）      |
| Rust    | 1.77+                                                                       | https://rustup.rs                           |
| Git     | 任意                                                                        | https://git-scm.com（仅开发用，应用不依赖） |
| Windows | + MSVC C++ Build Tools + WebView2（Win11 自带）                             | VS Installer                                |
| macOS   | + Xcode CLT                                                                 | `xcode-select --install`                    |
| Linux   | + webkit2gtk-4.1 + libssl-dev + librsvg2-dev + libayatana-appindicator3-dev | apt/dnf                                     |

### Dev 模式

```bash
cd G:\GitTools
bun install                # 首次执行
bun run scripts/gen-icons.ts   # 生成 Tauri 图标占位
bun run tauri:dev          # 启动 dev：Vite + Rust + 自动开窗
```

首次 Rust 编译 30-90s，之后增量秒级。React HMR 改动秒回。

### 质量门

```bash
bun run typecheck                # tsc -b
bun run lint                     # eslint
bun run format                   # prettier --write
bun run format:check             # prettier --check（CI 用）
bun run test                     # bun test src/lib —— 前端单测 (v0.9.0)
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --tests --no-deps -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml   # 后端集成测试 (v0.9.0)
```

CI 配置（`.github/workflows/ci.yml`）会在每次 push 跑全部门；`release.yml` 在 tag push 时为 4 个平台并行打包并 draft 一个 GitHub Release。

### 项目结构速查

```
G:\GitTools\
├── src/
│   ├── App.tsx               # 视图路由 + 全局快捷键
│   ├── main.tsx              # Root + ErrorBoundary
│   ├── components/
│   │   ├── Sidebar.tsx       # 8 个视图入口
│   │   ├── Topbar.tsx        # 仓库 / refresh / search / 远程 / updater / settings
│   │   ├── ContextMenu.tsx   # 右键菜单原语
│   │   ├── CredentialDialog.tsx       # 远程鉴权弹窗 (v0.5.0)
│   │   ├── CommandPalette.tsx         # Ctrl+K (v0.7.0)
│   │   ├── SettingsDialog.tsx         # 设置面板 (v0.4.0)
│   │   ├── UpdateBadge.tsx            # 自动更新 (v0.4.0)
│   │   ├── ErrorBoundary.tsx
│   │   ├── history/          # CommitList / CommitDetails / GraphRow / RefsPane / HistoryFilterBar
│   │   ├── diff/             # DiffViewer / DiffViews / FileTree / DiffPrimitives
│   │   └── merge/            # ConflictsList / ThreeWayEditor
│   ├── pages/                # Welcome/History/Diff/Merge/Blame/Changes/Stash/Reflog/Submodules/Rebase
│   ├── stores/
│   │   ├── app.ts            # Zustand 全局 store
│   │   └── settings.ts       # 持久化外观设置 (v0.4.0)
│   ├── ipc/git.ts            # 类型化 invoke 包装
│   ├── lib/
│   │   ├── graph.ts                # DAG lane 分配
│   │   ├── pairLines.ts            # diff 行配对
│   │   ├── wordDiff.ts             # LCS 词级 diff
│   │   ├── conflictParser.ts       # <<<<<<< 解析
│   │   ├── recentRepos.ts          # localStorage
│   │   ├── useShortcuts.ts         # 全局快捷键 hook
│   │   ├── useUpdater.ts           # 自动更新 hook (v0.4.0)
│   │   ├── i18n.ts                 # 自研 typed i18n (v0.4.0)
│   │   ├── locales/{en,zh}.ts
│   │   ├── fuzzy.ts                # 子序列匹配 (v0.7.0)
│   │   ├── time.ts / utils.ts / highlighter.ts
│   ├── styles/globals.css    # Tailwind v4 + 设计 tokens
│   └── vite-env.d.ts
├── src-tauri/
│   ├── Cargo.toml            # git2 (vendored) + tauri 2 + plugins
│   ├── tauri.conf.json
│   ├── capabilities/         # Tauri 2 ACL
│   └── src/
│       ├── main.rs / lib.rs
│       ├── commands.rs       # 50+ 个 #[tauri::command]
│       └── git/
│           ├── repo.rs       # open_repo / tracked_files
│           ├── file_history.rs # 单文件提交历史 + 跟随重命名 (v0.8.0)
│           ├── log.rs        # 含 author/date/pathspec 过滤
│           ├── diff.rs       # 含 ignore_whitespace
│           ├── merge.rs      # 三路 + abort + commit
│           ├── refs.rs       # 列表
│           ├── refs_ops.rs   # 分支/标签 CRUD (v0.2.0)
│           ├── commit_ops.rs # cherry/revert/reset (v0.2.0)
│           ├── blame.rs      # 含 blame_at_revision + previous_filename (v0.3.0)
│           ├── stash.rs      # save/apply/pop/drop (v0.2.0)
│           ├── reflog.rs     # (v0.3.0)
│           ├── submodule.rs  # init/update/sync (v0.3.0)
│           ├── workspace.rs  # 工作树 stage/unstage/commit
│           ├── remote.rs     # 原生 fetch/pull/push + 凭据 + 进度 (v0.5.0)
│           ├── rebase.rs     # 交互式 rebase 执行器 (v0.6.0)
│           └── config.rs     # core.autocrlf 等 (v0.4.0)
├── .github/workflows/{ci,release}.yml   # (v0.4.0)
├── design/                   # 静态 HTML 设计稿
├── scripts/
│   ├── gen-icons.ts
│   └── preview-design.ts
├── package.json / tsconfig.json / vite.config.ts
├── eslint.config.js / .prettierrc.json / .gitattributes
├── bunfig.toml               # 国内镜像
└── README.md / USAGE.md
```

### 主要 Rust 命令清单

| 类别          | 命令                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------- |
| Repo          | `open_repo`, `tracked_files`                                                                                        |
| File History  | `file_history`                                                                                                      |
| History       | `git_log`, `commit_files`, `file_diff`, `working_diff`, `list_refs`                                                 |
| Working tree  | `working_changes`, `stage_files`, `unstage_files`, `discard_files`, `commit_changes`                                |
| Merge         | `conflicts`, `merge_state`, `conflict_content`, `resolve_conflict`, `abort_merge`, `commit_merge`                   |
| Branches/Tags | `create_branch`, `checkout_branch`, `checkout_commit`, `delete_branch`, `rename_branch`, `create_tag`, `delete_tag` |
| Commit ops    | `cherry_pick`, `revert_commit`, `reset_to`                                                                          |
| Stash         | `stash_list`, `stash_save`, `stash_apply`, `stash_pop`, `stash_drop`                                                |
| Blame         | `blame_file`, `blame_at_revision`, `previous_filename`                                                              |
| Reflog        | `reflog_list`                                                                                                       |
| Submodules    | `submodule_list`, `submodule_init`, `submodule_update`, `submodule_sync`                                            |
| Remote        | `git_fetch`, `git_pull`, `git_push`, `submit_credentials`, `cancel_credentials`                                     |
| Rebase        | `rebase_plan`, `rebase_start`, `rebase_next`, `rebase_continue`, `rebase_abort`, `rebase_status`                    |
| Config        | `config_get`, `config_set`                                                                                          |

---

## 十一、构建可分发安装包

```bash
cd G:\GitTools
bun run tauri:build
```

首次 Rust release LTO 约 3-6 分钟，之后增量。产物：

| 平台    | 路径                                                  |
| ------- | ----------------------------------------------------- |
| Windows | `src-tauri/target/release/bundle/{msi,nsis}/`         |
| macOS   | `src-tauri/target/release/bundle/{dmg,macos}/`        |
| Linux   | `src-tauri/target/release/bundle/{appimage,deb,rpm}/` |

**自动发版**（v0.4.0）：在主仓库打 tag 并 push（如 `git tag v0.7.1 && git push origin v0.7.1`），GitHub Actions `release.yml` 会同时跑 4 个平台 matrix 并 draft 一个 GitHub Release，所有 installers 自动 attach。

---

## 十二、常见问题排查（FAQ）

### Q1：双击 Open Repository 后窗口空白？

`F12` 打开 DevTools → Console → 看红色错误。常见原因：选中目录不是 git 仓库 / WebView2 太老。

### Q2：DAG 提交图错乱？

按 `F5` / `Ctrl+R` 刷新；如仍异常，DevTools 控制台 `console.table(__layout)` 输出截图反馈。

### Q3：Diff 没颜色？

工具栏 "X hunks" 是 0 说明该文件确实没变；binary 文件会显示 "Binary file — no preview."

### Q4：Push 报 "authentication required (no usable credentials)"？

依次检查：

1. SSH 仓库：`ssh-add ~/.ssh/id_ed25519` 看是否能连通 `ssh -T git@github.com`
2. HTTPS 仓库：在 SmartCard / Settings 里清掉旧 Windows Credentials；下次 push 应用会弹凭据对话框
3. GitHub / GitLab / Bitbucket：**密码不行**，必须 PAT（personal access token）

### Q5：Pull 报 "non-fast-forward — use the merge UI"？

说明 upstream 有你本地没有的提交，且本地也有 upstream 没有的提交。两个选择：

- 终端 `git pull --rebase`（v0.6.0 起也可以本地交互式 rebase 后再 push）
- 终端 `git merge origin/<branch>` → 在 UI 内的 Merge 视图解决

### Q6：Interactive Rebase 中途想退出？

随时点 Rebase 视图右上角的 **Abort**（红色），会 hard-reset 回原 branch tip 并清状态文件。

### Q7：Rebase 卡在 Conflicted 但 Merge 视图显示 clean？

理论上不会发生。若发生：删除 `.git/gittools-rebase/state.json`，重启应用，再 Abort 一次。

### Q8：自动更新 download 进度卡住？

最常见的原因是 `latest.json` 的签名与本地公钥不匹配。临时跳过：在仓库 `tauri.conf.json` 里把 `plugins.updater.endpoints` 注释掉，重新打包。

### Q9：在 Tauri dev 模式下改 Rust 代码后窗口没刷新？

cargo 增量编译完会自动 reload。卡住时：看终端日志（`.tauri-dev.log.err`），或 `Stop-Process -Name git-tools, bun -Force` 后重新 `bun run tauri:dev`。

### Q10：bun install 时 ConnectionRefused？

检查 `bunfig.toml`：

```toml
[install]
registry = "https://registry.npmmirror.com/"
```

或公司内网镜像。

### Q11：Windows SmartScreen 弹"已保护你的电脑"？

安装包未做 EV 代码签名（截至 v0.13.0 仍在 backlog）。点 "更多信息 → 仍要运行" 即可。

### Q12：高 DPI 屏字体太小？

`Ctrl + 滚轮` 缩放 webview；或在 Settings → 字号选大档位（v0.4.0）。

---

## 十三、卸载与清理

### 卸载应用

- **NSIS**：开始菜单 → Git Tools → Uninstall
- **MSI**：控制面板 → 程序和功能 → Git Tools → 卸载

### 清理用户数据

应用本身**不在用户目录写额外文件**，仅以下位置：

| 数据            | 位置                                                 | 清理方式                                |
| --------------- | ---------------------------------------------------- | --------------------------------------- |
| Recent 仓库列表 | localStorage `gittools.recent-repos`                 | F12 → Application → Local Storage 删    |
| 外观/语言设置   | localStorage `gittools.settings` / `gittools.locale` | 同上                                    |
| Rebase 状态     | `<repo>/.git/gittools-rebase/state.json`             | 在 Rebase 视图点 **Abort** 即清；或手删 |

### 清理源码构建产物

```powershell
cd G:\GitTools
Remove-Item -Recurse -Force node_modules, dist, .tsbuild, src-tauri\target -ErrorAction SilentlyContinue
Remove-Item -Force .tauri-dev.log*, .tauri-build.log* -ErrorAction SilentlyContinue
```

---

## 十四、版本历史一览

| 版本    | 关键改动                                                                                                                                                                                                                                                                                                                                                               |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v0.1.0  | History / Diff / Merge / Blame / Changes / 远程操作（系统 git）/ 基础 UI                                                                                                                                                                                                                                                                                               |
| v0.2.0  | Stash / 分支 & Tag CRUD / Commit 右键菜单（cherry-pick / revert / reset）/ Diff hunk 导航 + Ignore Whitespace / 历史高级过滤                                                                                                                                                                                                                                           |
| v0.3.0  | Reflog / Annotate previous（跨重命名追溯）/ Submodules                                                                                                                                                                                                                                                                                                                 |
| v0.4.0  | GitHub Actions CI + 4 平台自动发版 / 设置面板（主题/字号/tab/autocrlf）/ 自动更新（minisign 签名）/ i18n（en + zh）                                                                                                                                                                                                                                                    |
| v0.5.0  | 原生 push/pull/fetch（git2-rs，告别 system git）/ 凭据弹窗（SSH agent → keys → helper → prompt）/ 实时进度事件                                                                                                                                                                                                                                                         |
| v0.6.0  | 交互式 Rebase（pick/reword/squash/fixup/drop + reorder + 状态持久化 + 冲突暂停）                                                                                                                                                                                                                                                                                       |
| v0.7.0  | Command Palette（Ctrl+K，搜 commits/refs/files/views）+ 自研子序列模糊匹配                                                                                                                                                                                                                                                                                             |
| v0.8.0  | File History（`git log --follow`，跨重命名追溯单文件提交时间线 + 选中提交即时 diff）                                                                                                                                                                                                                                                                                   |
| v0.9.0  | 单元测试（前端 42 用例 / 后端 14 用例）+ CI 集成；同时修复 file_history 跨重命名 bug                                                                                                                                                                                                                                                                                   |
| v0.9.1  | UI 调整：Refs 面板顶部置顶 HEAD item；Topbar 引入应用菜单（☰），收纳 Open / Recent / Close / About / Quit；新增 `Ctrl+O` 快捷键                                                                                                                                                                                                                                       |
| v0.10.0 | Worktrees 视图：列表 + 添加（带分支选择 + 目录选择器）+ 移除（含 force）+ prune；Sidebar 第 7 入口与 `Ctrl+9` 快捷键                                                                                                                                                                                                                                                   |
| v0.10.1 | .gitignore 编辑器：三栏布局 + 8 个内置模板 + 实时 preview（基于 libgit2 `is_path_ignored`），原子保存；`Ctrl+0` 入口                                                                                                                                                                                                                                                   |
| v0.10.2 | Topbar Undo 按钮：从 reflog 推断最近一次危险操作，一键 mixed-reset 回滚；下拉列出最近 8 条可撤销项，安全过滤普通 commit / checkout                                                                                                                                                                                                                                     |
| v0.10.3 | History 大仓库性能优化：cursor-based 分页（首屏 1000 / 增量 1000）+ 增量 Graph layout（lane 状态跨 page 复用，零跳色）                                                                                                                                                                                                                                                 |
| v0.11.0 | 历史搜索（Ctrl+Shift+F）：message + diff pickaxe + regex/literal + path scope，cargo 依赖加 `regex`，Sidebar 升至 11 入口                                                                                                                                                                                                                                              |
| v0.12.0 | 多仓库 tabs：Topbar 上方新增 RepoTabs 栏，支持 `Ctrl+T` 新建、`Ctrl+W` 关闭、双击重命名；每个 tab 独立保留 view/filter/选中态                                                                                                                                                                                                                                          |
| v0.12.1 | 测试覆盖率扩展：diff/blame/commit_ops/workspace 共 15 个新集成测试（35→50）；附带修复 `blame::previous_filename` 跨重命名解析 bug                                                                                                                                                                                                                                      |
| v0.13.0 | 双语化文档：新增 `README.zh.md` 与 `USAGE.en.md`，原 `README.md` / `USAGE.md` 顶部加语言切换链接（English · 简体中文）；无功能变更                                                                                                                                                                                                                                     |
| v0.13.1 | 结构化错误处理：后端 `AppError`（10 种 kind 自动从 `git2::Error` 推断）+ 前端 toast 队列（`useToasts` + `ToastContainer`）+ 全局 `unhandledrejection` 兜底；Topbar 远程操作 banner 区分 NonFastForward / Auth                                                                                                                                                          |
| v0.13.2 | Release 流水线签名密钥治理：新增 `signing-preflight` job（缺 secret 即失败）+ `scripts/check-signing-key.ts`（pubkey ↔ privkey 指纹比对）+ `publish-latest-json` job（聚合 .sig 生成 updater 索引）；README 新增"配置自动更新签名密钥"章节                                                                                                                             |
| v0.13.3 | 双向 Diff 编辑：Side-by-side 模式下查看工作树文件可点击 Edit 切换右侧为可编辑 textarea，HEAD 参考保持只读，Save 原子写回 + 自动重算 diff，dirty 徽章实时提示；后端 `read/write/head_working_file` 三命令带 path-traversal / binary / 8 MB 上限保护                                                                                                                     |
| v0.13.4 | Search v2：Group-by 切换（commit / 文件视图）、最近 12 条查询 dropdown（结构化去重）、★ 保存搜索（命名 + 持久化到 localStorage）；纯函数 `searchAggregate` + `searchPersist` 各带 8 / 14 个 bun:test                                                                                                                                                                   |
| v0.13.5 | Tabs v2：跨会话持久化（`gittools.tabs.v1` localStorage，重启自动恢复 tab 顺序 + pinned）、tab 钉选（`Ctrl+W` 拒绝、批量关闭保留）、HTML5 拖拽重排（拖入/出 pinned 区自动 pin/unpin）、右键菜单（Pin/Close/Close others/Close to right）、`Ctrl+PageDown` / `Ctrl+PageUp` 循环切换；纯函数 `reorderTabs` + `togglePin` + `nextTabId` 共 17 个 bun:test 含穷举 invariant |

---

## 反馈与扩展

- **新 Rust 命令**：`src-tauri/src/commands.rs` 加 `#[tauri::command]`，在 `lib.rs` 的 `invoke_handler!` 注册；前端 `src/ipc/git.ts` 加包装
- **新视图**：`stores/app.ts` 的 `ViewKey` 加，`App.tsx` 加路由，`Sidebar.tsx` 加 item，`lib/locales/{en,zh}.ts` 加 label
- **改主题色**：`src/styles/globals.css` 顶部的 `--branch-1..5`、`--diff-*` 变量；以及 `GraphRow.tsx` 里的 `BRANCH_COLORS` 字面量
- **新 i18n key**：先在 `lib/locales/en.ts` 加，`Dict` 类型会要求 `zh.ts` 同步补齐（编译期保证不漏）

---

**祝使用愉快！** 🎉
