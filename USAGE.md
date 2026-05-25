# Git Tools — 使用说明

[English](./USAGE.en.md) · **简体中文**

IDEA 风格的 **History / Diff / Merge / Blame / Rebase** 桌面应用，基于 Tauri 2 + React 19 + git2-rs (vendored libgit2)，可在 Windows / macOS / Linux 运行。

> 适用版本：v0.13.17  
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
  - [3.14 Tag 管理（v0.13.12）](#314-tag-管理v01312)
- [四、Topbar 与远程操作](#四topbar-与远程操作)
  - [4.1 应用菜单（☰）](#41-应用菜单)
  - [4.2 Undo 按钮（reflog quick actions）](#42-undo-按钮reflog-quick-actions)
  - [4.3 多仓库 tabs（v0.12.0 / v0.13.5）](#43-多仓库-tabsv0120--v0135)
  - [4.4 错误提示与 Toast（v0.13.1）](#44-错误提示与-toastv0131)
  - [4.5 危险操作确认（v0.13.15）](#45-危险操作确认v01315)
- [五、Command Palette（Ctrl+K）](#五command-palettectrlk)
  - [5.1 最近文件（Ctrl+E，v0.13.8）](#51-最近文件ctrle-v0138)
- [六、设置面板](#六设置面板)
- [七、自动更新](#七自动更新)
- [八、键盘快捷键](#八键盘快捷键)
- [九、典型工作流](#九典型工作流)
- [十、从源码运行 / 二次开发](#十从源码运行--二次开发)
- [十一、构建可分发安装包](#十一构建可分发安装包)
- [十二、常见问题排查（FAQ）](#十二常见问题排查faq)
- [十三、卸载与清理](#十三卸载与清理)
- [十四、版本历史一览](#十四版本历史一览)

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

> **Graph 显示模式（v0.13.6）**：在 fork 数极多的仓库（≥ 15 lanes）里，graph 列默认会把 commit summary 挤瘪。过滤栏右侧新增一个 **Graph** 按钮（图标即视觉档位），单击循环 3 档：
>
> | 档位        | 单 lane 宽 | dot 半径 | 列宽硬上限 | 适用场景                             |
> | ----------- | ---------- | -------- | ---------- | ------------------------------------ |
> | **Full**    | 14 px      | 4.5 px   | 220 px     | 默认；常规仓库（≤ 15 lanes）         |
> | **Compact** | 9 px       | 3 px     | 140 px     | fork 数较多时仍想看全图              |
> | **Hidden**  | —          | —        | 0 px       | 只关心 commit 文案，graph 完全不渲染 |
>
> 当 graph 实际宽度超过列宽硬上限（比如 30 lanes × 14 px = 420 px > 220 px），SVG 会在 graph 列**内部**横向滚动，保证 commit summary 永远有足够宽度。模式选择持久化到 localStorage（`gittools.settings.v1`），跨会话保留。

**右 — Commit Details**

- 顶部：subject + **复制按钮**三件套（v0.13.13）—— 📋 整条 message（subject+body）、🔗 完整 40 位 SHA、🔗 7 位短 SHA，每个按钮点击后短暂变成 ✓ Copied 反馈
- **Commit / Parents / Children**（v0.13.13）：parent 与 child 都以可点击 chip 渲染，点击 chip 直接跳到对应 commit；children 是从当前已加载历史窗口反查 `parents.includes(oid)` 实时算的，零额外 IPC
- **Author** + **Date**；当 committer 与 author 不同（cherry-pick / rebase 留下的痕迹）时单独追加 **Committer** 行 + 该 commit 实际进入仓库的时间（v0.13.13）
- **Refs** chips（HEAD / branch / tag）
- **Contained in**（v0.13.13）：commit 所在的本地分支 / 远端分支 / tag。本地分支用主品牌色徽章，远端分支灰色，tag 暖色，一眼区分。后端用 libgit2 `graph_descendant_of` 逐 ref 判断，annotated tag 自动 peel；首次出现要等几十毫秒后台计算（"Computing containing branches & tags…"），算完才显示
- **Changed files** 列表（A / M / D / R / C / T 状态 + 行级 +N -N）；点击 → 跳到 Diff 视图；右键菜单可 Copy path / Show file history / Blame
- **Message**：完整多行 message（subject 之外的 body 段落、trailers 等），来自 v0.13.13 后端 `commit_meta` 接口

> **大仓库性能（v0.10.3 起）**：History 视图采用 cursor-based 分页，首屏只加载 1000 条 commit；当虚拟滚动到接近列表尾部（默认距底部 20 行）时自动 fetch 下一页 1000 条并追加。Graph layout（lane 分配 + curve 计算）也升级为增量算法，新加载的 page 只对新增 commit 计算，并完全沿用上一 page 的 lane 状态——所以滚动加载不会"跳色"，性能也不会随着列表增大而退化。  
> 状态栏的 `· +more` 提示后端还有更多页；`· loading more...` 表示正在追加。

#### Graph 节点导航 / 高亮（v0.13.16）

History 视图的右键菜单底部新增 **Highlight reachability** 区块，提供两个反查方向：

- **Ancestors (this commit + parents)** — 高亮当前 commit 与所有它的祖先（沿 `parent_ids()` BFS）。回答"这个特性是从哪条线长出来的？"
- **Descendants (this commit + children)** — 高亮当前 commit 与所有它的后代（先扫描所有 ref tip 反向构建 child map，再 BFS）。回答"这个修复合到了哪些分支？"

启用后：

- 不在 highlight set 内的 commit 行降至 25% 不透明度；选中行始终保持完整可见
- 触发 highlight 的源头 commit 用主品牌色 `ring + 浅底` 标记，方便定位起点
- 状态栏出现 `Highlighting ancestors of abc1234 · 42 commits` 提示，附 `clear` 按钮一键清除
- 切换 filter / 重新加载 history 时自动清除（避免对作废的 oid 集做无意义对比）

后端通过 `commit_ancestors` / `commit_descendants` 两个 Tauri 命令实现：祖先方向无需扫描即可上限 50000 个；后代方向先以 `refs/heads/* + refs/remotes/* + refs/tags/*` glob 扫 200000 commit 构建 child map，BFS 上限同样 50000——足够覆盖大部分实际场景，同时确保超大 monorepo 也不会卡顿。

### 3.2 Diff（差异查看）

**左：文件树**（按目录分组，状态字母 + 文件名 + 行数）；**右：Diff 主体**

- **模式切换**：Side-by-side（左旧右新）/ Unified
- **行级 + 词级高亮**：替换行内只对真正变动的 token 加 `+`/`-` 颜色（基于 LCS）。**Side-by-side 与 Unified 两种模式都支持**——v0.13.14 起 Unified 模式也按"连续 `-` 块 → 连续 `+` 块"配对计算 word-level token，同一行里的格式调整、变量改名一眼能看出来
- **Shiki 语法高亮**：~35 种语言（TS / Rust / Python / Go / C++ / …）
- **Whitespace 可视化**：⌫ 按钮启用，空格→`·`，tab→`→`
- **Ignore Whitespace**（v0.2.0）：另一个按钮，让后端用 libgit2 的 `ignore_whitespace` 重算 diff（与可视化是互补的）
- **跳转到 hunk**（v0.2.0）：工具栏 ↑/↓ 按钮，或快捷键 `n` / `p`
- **Blame 按钮**：跳到 Blame 视图查看该文件

#### Image diff（v0.13.14）

当选中的文件是图片资源（`.png` / `.jpg` / `.jpeg` / `.gif` / `.webp` / `.svg` / `.avif` / `.bmp` / `.ico`），Diff 主体区会自动切换为**双栏图片预览**：

- **Before（左）** / **After（右）** 两个 pane，标题栏右侧显示文件大小（KB / MB）
- 透明区域用棋盘格背景渲染，避免在深色主题下"看不见"
- 文件被新增 → Before 显示 "(no previous version)"；被删除 → After 显示 "(file deleted)"；超过 8 MB → 显示 "Too large to preview"
- 重命名+内容变更（rename + modify）会自动用 `fileDiff.old_path` 和 `new_path` 各取各的 blob

后端通过新命令 `read_blob_at_commit` / `read_working_blob` 拉 base64 字节（与现有 `MAX_FILE_BYTES = 8 MB` 限制一致），前端只用扩展名做 image 检测，不嗅探 magic bytes，零额外 IPC 往返。

#### 双向 Diff 编辑（v0.13.3）

当 Diff 来源是**工作树文件**（从 Changes 视图点文件名进入，而不是从 History 选某个 commit），且模式为 **Side-by-side** 时，工具栏会多出一个 **Edit** 切换。

| 操作               | 行为                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------ |
| 点 **Edit**        | 右侧 pane 从静态 diff 切换为可编辑 textarea，绑定到磁盘上的工作树文件文本            |
| 直接打字           | 编辑右侧 buffer；左侧始终是 HEAD 只读参考；工具栏出现 **● dirty** 徽章               |
| 点 **Save**        | 原子写回磁盘（先写 tmp 再 rename），随后自动重新 `working_diff` 让左侧 hunk 预览刷新 |
| 点 **Reset**       | 丢弃 buffer 改动，重新读取磁盘文本                                                   |
| 再点 **Edit** 取消 | 关闭编辑模式，回到只读 diff（buffer 在内存里保留，下次 Edit 再开就是上次的 buffer）  |

**安全护栏**（后端 `read/write_working_file` 命令实现）：

- 路径 traversal 防御：拒绝任何含 `..` 段的相对路径，绝对路径必须落在仓库 workdir 之内
- Binary 文件拒写：检测 NUL 字节，binary 文件不允许编辑（避免你不小心改坏二进制资源）
- 8 MB 上限：单文件超过这个大小就拒绝读写——防止大文件卡死 textarea
- 原子写：写 tmp 文件后 rename，进程 crash 也不会留下半截写入的源文件

**典型场景**：

1. 跑测试发现 1 行 typo → 不切到 IDE，直接在 Diff 视图改 → Save → 立刻看到 hunk 消失
2. 想快速试一下"如果这 5 行改成 X 会怎样"→ 编辑右侧 → 跑测试 → 不行 → **Reset** 一键回退
3. 修完 typo 想立即提交 → Save 后切 Changes 视图，文件已自动出现在改动列表，直接 commit

> 仅 Side-by-side 模式下、且 Diff 来源是工作树文件时显示 Edit 按钮。从 History 进入的"历史 commit 之间的 diff"是只读的，因为没有"现在的工作树文本"可以写回。

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
| 应用 patch          | 顶部 **Apply patch…** 按钮，弹出 textarea 粘贴 unified-patch 文本（v0.13.9）   |

**Patch I/O（v0.13.9）**：

- **Copy patch**（Diff 工具栏）：把当前文件的 diff 序列化成标准 unified-patch 字符串复制到剪贴板。无论是 commit-vs-parent diff 还是工作树 diff，都能直接复制；适合贴到 PR 评论 / 邮件 / IM 给同事看
- **Apply patch…**（Changes 工具栏）：弹出对话框粘贴一段 patch 文本 → 后端先用 `git2::Repository::apply` 的 **dry-run check** 模式探一下能否干净 apply，能就执行真正的 apply（写到工作树，**不动 index** —— 你可以再决定要不要 stage）
- 失败时对话框**保持打开**并把 libgit2 的具体原因（如 "context line N does not match"）显示在底部红条里——避免半完成的 apply 让工作树脏掉

后端实现要点（`src-tauri/src/git/patch.rs`）：

- `format_commit_file_patch` / `format_working_file_patch` 用 `Diff::print(DiffFormat::Patch, …)` 拼出 GNU `patch` / `git apply` 都识别的标准 unified diff
- `apply_patch_check` 用 `ApplyOptions::check(true)` 做 dry-run，只校验不实际写盘
- `apply_patch` 用 `ApplyLocation::WorkDir`，**不**改 index（让用户保留对暂存粒度的控制）
- 后端带 3 个集成测试覆盖 round-trip / 拒绝乱码输入 / 重命名场景

### 3.5 Blame（行级历史 + 跨重命名追溯）

入口：Diff 工具栏的 **Blame** 按钮。

- 同 commit 修改的连续行只在第一行显示作者/时间/oid（IDEA 风格分组）
- 短 oid 可点击 → 跳到 History 选中
- 整列虚拟滚动 + Shiki 语法高亮
- **Annotate previous（v0.3.0）**：工具栏出现 "Annotate previous: <oldpath>@<oid>" 链接（基于 `Diff::find_similar` 的重命名检测）。点击跳到该文件的上一个身份（可能是不同路径）；自动维护 back stack（**Back** 按钮回退）。这是 IDE 友好的"跨重命名追溯"
- **行级右键菜单（v0.13.17）**：任意行右键弹出菜单：
  - **Show this commit in History** — 跳到 History 视图并选中该 commit（与点击 short oid 等价）
  - **Annotate revision before this change** — 重新 blame 当前文件，但起点是该行所在 commit 的父级（`<oid>^`）。等价 IntelliJ 的"Annotate Revision Before This Change"，回答"这一行变成现在这样之前长什么样？"——同样压栈，**Back** 一键回退
  - **Copy SHA / Copy commit summary / Copy line content** — 三个剪贴板动作

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

操作按钮：

- **Init**：仅在未初始化时显示——把 `.gitmodules` 中的 entry 写入 `.git/config`
- **Update**：clone（如需要）+ checkout 父仓库记录的 commit；自动 init-first
- **Update recursively**（v0.13.11 起的 🌳 图标按钮）：先 update 顶层 submodule，再递归打开它作为 Repository、对**它的**子 submodules 重复执行——等价于 `git submodule update --init --recursive`，对嵌套 submodule 仓库尤其有用
- **Sync**：把 `.gitmodules` 里的 URL 同步到本地 `.git/config`

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

### 3.14 Tag 管理（v0.13.12）

Sidebar 第 10 个图标（🏷️ Tag）= 专用 **Tag 管理面板**。也可 `Ctrl+K` → "Tags" 进入，或 History 视图右键任一 commit → **Create tag here…** 创建后自动出现在面板里。

| 列                     | 含义                                                                    |
| ---------------------- | ----------------------------------------------------------------------- |
| `annot` / `light` 徽标 | annotated（`git tag -a`，自带消息 + 打标人）/ lightweight（仅一个 ref） |
| `name`                 | tag 短名（不含 `refs/tags/` 前缀）                                      |
| 短 SHA                 | tag 指向的**最终 commit**（annotated tag 会先穿过 tag 对象再到 commit） |
| commit summary         | 指向 commit 的 summary，方便记起这个 tag 是给什么版本打的               |
| 时间                   | annotated tag 的打标时间，或 lightweight tag 指向的 commit 时间         |

按时间**新→旧**排序，最新发布的 tag 始终在顶部。

**逐行操作**（最右侧按钮组）：

| 按钮          | 作用                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| **Push**      | `git push origin <tag>` — 推单个 tag 到默认 remote                                                   |
| **Force**     | `git push origin +<tag>` — 当 tag 被移动/重建时覆盖远端那份；点击会先弹 confirm                      |
| **Local** 🗑️  | 仅删本地 tag（`git tag -d <name>`），远端那份不动                                                    |
| **Remote** 🗑️ | 仅删远端 tag（`git push origin :refs/tags/<name>`），本地那份不动；弹 confirm 提醒"只推删除 refspec" |

**顶部工具栏**：

- **Push all tags**（☁️↑） = `git push origin --tags`，一次把所有本地 tag 镜像到远端，refspec 是 `refs/tags/*:refs/tags/*`

**展开行**（点击行首 ▶ 图标）：annotated tag 会展开显示 `tag oid`、`commit oid`、`tagger name <email>`、原始 message（多行保留）；lightweight tag 只展开提示"无 message + 无 tagger"。

> 所有 push / push --force / delete-remote 都走和 push branch **同一套**进度通道（v0.13.7）：Topbar 出进度条 + 取消按钮（Esc），凭据缺失会弹同样的 Credential 对话框。

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

**实时进度 + 取消**（v0.5.0 起进度事件；v0.13.7 加进度条 + 一键取消）：远程操作进行时，Topbar 右侧出现一个 24px 宽的进度条 + 百分比 + 状态明细 + **取消按钮**：

| 元素                   | 含义                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| 进度条（确定态）       | 蓝色填充条 + 百分比，表示当前 phase 的 `received/total` 或 `pushed/total`                    |
| 进度条（不确定态）     | 浅蓝脉冲动画——sideband 文本阶段或 push-status 等没有 ratio 的阶段不撒谎给 0%                 |
| 文本明细               | "Receiving 1234/5678 · 4.2 MB" / "Indexing 9001/12345" / 服务端 sideband 一行原文 / 推送状态 |
| **Cancel 按钮**        | 点击 / 按 **Esc** 触发；后端立即翻转 cancel-token，下一次 callback tick 让 libgit2 终止操作  |
| Cancel → "Cancelling…" | 点击后按钮变灰禁用，等后端真正中断（一般 < 1 秒）；中断后 banner 显示"Cancelled."            |

**取消机制实现要点**（后端 `git/remote.rs`）：

- 每次 `fetch / pull / push` 进来分配一个 `op_id` + `Arc<AtomicBool>` cancel-token，注册到全局 `CANCEL_TOKENS` map
- 立即向前端 emit `started { op_id, op }`，后续所有 progress / done / cancelled 事件都带同一 `op_id`，前端用它把进度绑定到当前 op（防止旧 op 的迟到事件污染新 op）
- libgit2 callbacks（transfer / push / sideband）每个 tick 检查 token，true 时返回 `false` → libgit2 中止 → 抛出 `git2::Error`
- `error.rs` 的启发式：err message 含 "cancel" / "user dismissed" / "user aborted" → 自动归类为 `UserCancelled` kind → toast / banner 文案变成"Cancelled."
- `OpHandle::Drop` 在 op 结束时自动从 map 移除 token——所以重复的 cancel 调用幂等（finished op 的 cancel 是 no-op）

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

### 4.4 错误提示与 Toast（v0.13.1）

v0.13.1 起所有后端报错走统一的 **Toast** 队列（屏幕右下角浮层），不再静默吞掉、也不再用 `alert()`。

**视觉**：

- **Error**（红边）：远端拒绝、合并冲突、认证失败、文件读写失败等，默认停留 **8 秒**
- **Info**（中性边）：成功提示（"Stashed working changes."、"Pruned 2 worktrees"），默认停留 **3 秒**
- 鼠标悬停在 toast 上时**暂停自动关闭**，方便复制错误文本
- 同屏最多堆叠 **5 个**，超出后最老的自动出栈

**错误分类**（后端 `AppError` 的 10 种 kind 自动从 `git2::Error` 推断）：

| Kind                                | 触发场景示例                           | Toast 标题前缀     |
| ----------------------------------- | -------------------------------------- | ------------------ |
| `NotFound`                          | 引用 / commit oid / 文件不存在         | `NotFound:`        |
| `MergeConflict`                     | merge / cherry-pick / revert 产生冲突  | `MergeConflict:`   |
| `NonFastForward`                    | push 被远端拒绝（远端有新 commit）     | `NonFastForward:`  |
| `Auth`                              | SSH key 不对、HTTPS 凭据失败、证书校验 | `Auth:`            |
| `UserCancelled`                     | 凭据弹窗被关、文件选择对话框 cancel    | `UserCancelled:`   |
| `InvalidArgument`                   | 不合法的 reset mode、空 commit message | `InvalidArgument:` |
| `Git` / `Io` / `Internal` / `Other` | 其他兜底分类                           | （对应 kind 前缀） |

**Topbar 远程操作 banner**（v0.13.1 起增强）：

- Push 被拒（NonFastForward）：banner 显示"Pull/Fetch 后再 push"的引导文案
- Auth 失败：banner 显示"检查凭据 / SSH key 配置"的引导文案
- 其他错误：照原样显示后端 message

**全局兜底**：任何**没人 catch** 的 Promise rejection 都会被 `App.tsx` 里的全局 `unhandledrejection` 监听器捕获并弹 toast——也就是说就算某个组件忘了 try/catch，错误也不会消失到 console 里没人看。

> 旧版本（< v0.13.1）的错误处理是把 `git2::Error` 直接 `String(e)` 出来扔到组件 local error 里，没全局兜底。如果某个 ctor 把 error 揉进了 effect 的回调里，可能就丢了。v0.13.1 起这个口子被堵上。

### 4.5 危险操作确认（v0.13.15）

之前散落在十几处的 `window.confirm()` 已全部替换为统一的 **ConfirmDialog**——居中浮层、主题色协调、按危险等级着色：

| 等级       | 视觉                                                 | 适用场景                                                                                                                                                                           |
| ---------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🛡 Danger  | 红色 confirm 按钮 + 盾牌图标 (ShieldAlert)           | 不可逆 / 可能丢失工作的操作：discard / drop stash / delete branch / delete tag (local + remote) / hard reset / abort merge / abort rebase / force-push tag / force remove worktree |
| ⚠️ Warning | 主品牌色 confirm 按钮 + 三角警告图标 (AlertTriangle) | 可恢复但有副作用：cherry-pick / revert / soft+mixed reset / detached HEAD checkout / submodule update / push --tags / 创建分支后是否立即 checkout                                  |

**键盘**：`Esc` = 取消，`Enter` = 确认；点击对话框外的遮罩 = 取消（避免误点 Confirm）。**焦点**：弹窗打开时焦点跳到 Confirm 按钮，所以用户必须**主动**按 Enter 才会触发——不会"误回车确认上一个操作"。

**详细信息块**：危险操作通常配一个 `<pre>` monospace 块显示**真实的 git 命令 / refspec / 文件清单**，让用户在按下 Confirm 前能再核对一次。例：

- 删远端 tag → `git push origin :refs/tags/v1.2.3`
- Force-push tag → `git push origin +refs/tags/v1.2.3:refs/tags/v1.2.3`
- Discard N 个文件 → 列出前 20 个文件名 + 剩余计数
- Push all tags → `git push origin refs/tags/*:refs/tags/*`

**单飞实现**：弹窗以 zustand store 单例承载（`store.confirmRequest`），调用方 `await get().confirm({...})` 拿到 boolean——使整个调用点的代码形态和原 `confirm(...)` 完全一致，但不再阻塞 JS 线程也不抢系统焦点。

> 设计取舍：**高频操作不加确认**（push 单个 tag、checkout branch、stash apply / pop），避免用户疲劳；只对**会丢工作树修改 / 改动远端 / 删除引用**的真实危险操作加确认。Apply patch 走自己的 dry-run dialog，已经是二次确认链，故不重复。

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

### 5.1 最近文件（`Ctrl+E`，v0.13.8）

频繁在 2-3 个 hot file 之间跳跃时，每次走 Command Palette 模糊搜并不舒服。`Ctrl+E` 直接弹出 **per-repo MRU** 浮层：

```
┌─[🕘 最近文件]──────────────────────────[Ctrl+E]─┐
│ ▶ src/foo.ts            src/                   │
│   src/bar.tsx           src/                   │
│   README.md                                    │
│   …                                            │
├────────────────────────────────────────────────┤
│ ↑↓ 上下移动  ↵ Diff  ⇧↵ Blame  ⌃↵ 文件历史  12 │
└────────────────────────────────────────────────┘
```

**核心交互**：

| 操作                            | 行为                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `Ctrl+E`                        | 弹出最近文件列表（最多 12 条）；默认选中**第二条**——和 IntelliJ Recent Files 一致，意为"返回上一个文件" |
| `↓` / `Tab` / `↑` / `Shift+Tab` | 上下移动选中行（循环）                                                                                  |
| `Enter`                         | 在 **Diff** 视图打开（最常用——若是工作树文件则是双向编辑器）                                            |
| `Shift+Enter`                   | 在 **Blame** 视图打开                                                                                   |
| `Ctrl+Enter`                    | 在 **文件历史** 视图打开（跨重命名追溯）                                                                |
| 鼠标点行                        | 等价于 Enter（Diff）                                                                                    |
| 鼠标 hover 行                   | 移动选中（避免双重操作）                                                                                |
| 行尾 `🗑️`（hover 出现）         | 把该条从最近列表删掉（不删除文件本身）                                                                  |
| `Esc`                           | 关闭浮层                                                                                                |

**采集规则**：每当用户主动打开一个文件——通过 Changes 视图点文件名（→ `working`）/ Commit Details 点变动文件（→ `diff`）/ Diff 工具栏的 Blame 按钮（→ `blame`）/ Diff/Blame 工具栏的 File History 按钮（→ `history`）——都会自动 push 到该 repo 的 MRU。同一文件**按 path 去重**：再次打开同一文件只会把它顶到列表头部并更新 action 标记，不会产生重复行。

**持久化**：每个 repo 一份独立的 MRU，落在 `localStorage` 的 `gittools.recent-files.v1.<hash>`，hash 是 djb2 8 字节算的——重启 / 切 tab 都能立刻恢复。`MAX_RECENT_FILES = 12` 上限。

**实现要点**：

- 纯函数 `pushRecent` / `removeRecent` / `loadFor` / `saveFor` 在 `src/lib/recentFiles.ts`，11 个 `bun:test` 用例覆盖 dedup / cap / ordering / 错误数据 fallback / 不变性
- store 改动只是给 `openDiff` / `openWorkingDiff` / `openBlame` / `openFileHistory` 4 个 action 各加一行 `noteRecentFile` 调用——失败路径不 push，避免脏数据
- `switchTab` / `closeTab` / `openRepo` 切换 repo 时自动 rehydrate MRU——和 v0.13.5 Tabs v2 持久化模型对齐

---

## 六、设置面板

v0.4.0 起。点 Topbar 右侧 **⚙** 图标打开。

**外观**：

- **主题**：Auto（跟随系统）/ Light / Dark；切换无 FOUC（启动前内联 script 已读 localStorage）
- **字号**：12 / 13 / 14 / 15 / 16 / 18 px
- **Tab 宽度**：2 / 4 / 8（影响 Diff / Blame 显示）
- **语言**：English / 中文（启动时从 `navigator.language` 自动检测，可手动切换）
- **历史 Graph**（v0.13.10）：完整 / 紧凑 / 隐藏——和 History 视图工具栏的 Graph 按钮**共享**同一字段，在哪改都同步。Settings 这里给"长期偏好"的统一入口；HistoryFilterBar 上的快捷按钮给"临时切换"的便利。详见 [3.1 History](#31-history提交历史--graph) 的 Graph 显示模式表格

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
| `Ctrl+E`            | 最近文件（v0.13.8）                   | 全局  |
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

> 表格按功能聚类列出当前 `src-tauri/src/commands.rs` 中 `#[tauri::command]` 装饰的所有 invokable，前端绑定见 `src/ipc/git.ts`。

| 类别              | 命令                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repo              | `open_repo`, `tracked_files`                                                                                                                      |
| File History      | `file_history`                                                                                                                                    |
| History           | `git_log`, `git_log_page`, `commit_files`, `file_diff`, `working_diff`, `list_refs`, `list_tags`, `commit_meta`                                   |
| Working tree      | `working_changes`, `stage_files`, `unstage_files`, `discard_files`, `commit_changes`, `read_working_file`, `read_head_file`, `write_working_file` |
| Patch I/O         | `format_commit_file_patch`, `format_working_file_patch`, `apply_patch_check`, `apply_patch`                                                       |
| Image / blob      | `read_blob_at_commit`, `read_working_blob`                                                                                                        |
| Merge             | `conflicts`, `merge_state`, `conflict_content`, `resolve_conflict`, `abort_merge`, `commit_merge`                                                 |
| Branches / Tags   | `create_branch`, `checkout_branch`, `checkout_commit`, `delete_branch`, `rename_branch`, `create_tag`, `delete_tag`                               |
| Tag remote ops    | `git_push_tag`, `git_push_all_tags`, `git_delete_remote_tag`                                                                                      |
| Commit ops        | `cherry_pick`, `revert_commit`, `reset_to`                                                                                                        |
| Stash             | `stash_list`, `stash_save`, `stash_apply`, `stash_pop`, `stash_drop`                                                                              |
| Blame             | `blame_file`, `blame_at_revision`, `previous_filename`                                                                                            |
| Reflog            | `reflog_list`                                                                                                                                     |
| Submodules        | `submodule_list`, `submodule_init`, `submodule_update`, `submodule_update_recursive`, `submodule_sync`                                            |
| Remote            | `git_fetch`, `git_pull`, `git_push`, `submit_credentials`, `cancel_credentials`, `cancel_remote_op`                                               |
| Rebase            | `rebase_plan`, `rebase_start`, `rebase_next`, `rebase_continue`, `rebase_abort`, `rebase_status`                                                  |
| Worktrees         | `worktree_list`, `worktree_add`, `worktree_remove`, `worktree_prune`                                                                              |
| .gitignore editor | `gitignore_read`, `gitignore_write`, `gitignore_preview`, `gitignore_templates`                                                                   |
| Search            | `search_commits`                                                                                                                                  |
| Config            | `config_get`, `config_set`                                                                                                                        |

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

| 版本     | 关键改动                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v0.1.0   | History / Diff / Merge / Blame / Changes / 远程操作（系统 git）/ 基础 UI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| v0.2.0   | Stash / 分支 & Tag CRUD / Commit 右键菜单（cherry-pick / revert / reset）/ Diff hunk 导航 + Ignore Whitespace / 历史高级过滤                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| v0.3.0   | Reflog / Annotate previous（跨重命名追溯）/ Submodules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| v0.4.0   | GitHub Actions CI + 4 平台自动发版 / 设置面板（主题/字号/tab/autocrlf）/ 自动更新（minisign 签名）/ i18n（en + zh）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| v0.5.0   | 原生 push/pull/fetch（git2-rs，告别 system git）/ 凭据弹窗（SSH agent → keys → helper → prompt）/ 实时进度事件                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| v0.6.0   | 交互式 Rebase（pick/reword/squash/fixup/drop + reorder + 状态持久化 + 冲突暂停）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| v0.7.0   | Command Palette（Ctrl+K，搜 commits/refs/files/views）+ 自研子序列模糊匹配                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| v0.8.0   | File History（`git log --follow`，跨重命名追溯单文件提交时间线 + 选中提交即时 diff）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| v0.9.0   | 单元测试（前端 42 用例 / 后端 14 用例）+ CI 集成；同时修复 file_history 跨重命名 bug                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| v0.9.1   | UI 调整：Refs 面板顶部置顶 HEAD item；Topbar 引入应用菜单（☰），收纳 Open / Recent / Close / About / Quit；新增 `Ctrl+O` 快捷键                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| v0.10.0  | Worktrees 视图：列表 + 添加（带分支选择 + 目录选择器）+ 移除（含 force）+ prune；Sidebar 第 7 入口与 `Ctrl+9` 快捷键                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| v0.10.1  | .gitignore 编辑器：三栏布局 + 8 个内置模板 + 实时 preview（基于 libgit2 `is_path_ignored`），原子保存；`Ctrl+0` 入口                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| v0.10.2  | Topbar Undo 按钮：从 reflog 推断最近一次危险操作，一键 mixed-reset 回滚；下拉列出最近 8 条可撤销项，安全过滤普通 commit / checkout                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| v0.10.3  | History 大仓库性能优化：cursor-based 分页（首屏 1000 / 增量 1000）+ 增量 Graph layout（lane 状态跨 page 复用，零跳色）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| v0.11.0  | 历史搜索（Ctrl+Shift+F）：message + diff pickaxe + regex/literal + path scope，cargo 依赖加 `regex`，Sidebar 升至 11 入口                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| v0.12.0  | 多仓库 tabs：Topbar 上方新增 RepoTabs 栏，支持 `Ctrl+T` 新建、`Ctrl+W` 关闭、双击重命名；每个 tab 独立保留 view/filter/选中态                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| v0.12.1  | 测试覆盖率扩展：diff/blame/commit_ops/workspace 共 15 个新集成测试（35→50）；附带修复 `blame::previous_filename` 跨重命名解析 bug                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| v0.13.0  | 双语化文档：新增 `README.zh.md` 与 `USAGE.en.md`，原 `README.md` / `USAGE.md` 顶部加语言切换链接（English · 简体中文）；无功能变更                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| v0.13.1  | 结构化错误处理：后端 `AppError`（10 种 kind 自动从 `git2::Error` 推断）+ 前端 toast 队列（`useToasts` + `ToastContainer`）+ 全局 `unhandledrejection` 兜底；Topbar 远程操作 banner 区分 NonFastForward / Auth                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| v0.13.2  | Release 流水线签名密钥治理：新增 `signing-preflight` job（缺 secret 即失败）+ `scripts/check-signing-key.ts`（pubkey ↔ privkey 指纹比对）+ `publish-latest-json` job（聚合 .sig 生成 updater 索引）；README 新增"配置自动更新签名密钥"章节                                                                                                                                                                                                                                                                                                                                                                                                                |
| v0.13.3  | 双向 Diff 编辑：Side-by-side 模式下查看工作树文件可点击 Edit 切换右侧为可编辑 textarea，HEAD 参考保持只读，Save 原子写回 + 自动重算 diff，dirty 徽章实时提示；后端 `read/write/head_working_file` 三命令带 path-traversal / binary / 8 MB 上限保护                                                                                                                                                                                                                                                                                                                                                                                                        |
| v0.13.4  | Search v2：Group-by 切换（commit / 文件视图）、最近 12 条查询 dropdown（结构化去重）、★ 保存搜索（命名 + 持久化到 localStorage）；纯函数 `searchAggregate` + `searchPersist` 各带 8 / 14 个 bun:test                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| v0.13.5  | Tabs v2：跨会话持久化（`gittools.tabs.v1` localStorage，重启自动恢复 tab 顺序 + pinned）、tab 钉选（`Ctrl+W` 拒绝、批量关闭保留）、HTML5 拖拽重排（拖入/出 pinned 区自动 pin/unpin）、右键菜单（Pin/Close/Close others/Close to right）、`Ctrl+PageDown` / `Ctrl+PageUp` 循环切换；纯函数 `reorderTabs` + `togglePin` + `nextTabId` 共 17 个 bun:test 含穷举 invariant                                                                                                                                                                                                                                                                                    |
| v0.13.6  | History 视图新增 **Graph 显示模式**（完整 / 紧凑 / 隐藏）：在 fork 数极多（≥ 15 lanes）的仓库里 graph 列默认会挤瘪 commit summary，过滤栏右侧 **Graph** 按钮单击循环 3 档，列宽硬上限 220 / 140 / 0 px，紧凑档 SVG 内部横滚；偏好持久化到 `gittools.settings.v1`                                                                                                                                                                                                                                                                                                                                                                                          |
| v0.13.7  | Push / Pull / Fetch **可视化进度条 + 一键取消**：Topbar 远程操作进行时显示 24 px 宽确定/不确定进度条 + 百分比 + 状态明细 + Cancel 按钮（Esc 快捷键）；后端 `Arc<AtomicBool>` cancel token + `OpHandle` RAII，`ProgressEvent` 增加 `Started{op_id}` / `Cancelled{op_id}` variant，所有事件携带 op_id；libgit2 callbacks 返回 false 终止网络流                                                                                                                                                                                                                                                                                                              |
| v0.13.8  | **最近文件**（`Ctrl+E`）：per-repo MRU 持久化（`gittools.recent-files.v1.<repoHash>` localStorage，djb2 哈希），浮层 Tab/Shift+Tab 导航，Enter→Diff、Shift+Enter→Blame、Ctrl+Enter→FileHistory；`switchTab` / `closeTab` / `openRepo` 切换 repo 时自动 rehydrate；纯函数 `recentFiles.ts` + 11 个 bun:test                                                                                                                                                                                                                                                                                                                                                |
| v0.13.9  | Diff 视图 **Copy patch / Apply patch from clipboard**：`DiffViewer` 工具栏 Copy patch 按钮（带 "Copied!" 反馈），`ChangesPage` 顶部 **Apply patch…** 对话框（粘贴 unified-patch 文本，dry-run check 失败时保持打开 + 显示 libgit2 原因，避免半应用脏工作树）；新模块 `src-tauri/src/git/patch.rs`（`format_commit_file_patch` / `format_working_file_patch` / `apply_patch_check` / `apply_patch`）+ 3 个集成测试                                                                                                                                                                                                                                         |
| v0.13.10 | Settings 面板镜像 **Graph 显示模式**：与 HistoryFilterBar 上的 Graph 按钮共享同一字段（双向同步），Settings 给"长期偏好"统一入口，HistoryFilterBar 快捷按钮给"临时切换"便利；新增 `settings.graphMode.*` 4 条 i18n key                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| v0.13.11 | Submodules 视图 **递归 update**：FolderTree 🌳 图标按钮深度优先递归——先 update 顶层 submodule，再打开它作为 Repository、对**它的**子 submodules 重复执行，等价于 `git submodule update --init --recursive`，对嵌套 submodule 仓库尤其有用；后端 `git/submodule.rs::update_recursive`                                                                                                                                                                                                                                                                                                                                                                      |
| v0.13.12 | 专用 **Tag 管理面板**：Sidebar 新增 🏷️ Tag 入口 + `Ctrl+K` 命令面板可达；表格按时间倒序展示所有 tag，annotated 行可展开显示 message / tagger / 原始 oid，lightweight 行清晰区分；逐行 **Push** / **Force** / 删本地 / 删远端 + 顶部 **Push all tags**（`refs/tags/*:refs/tags/*`）+ 删除远端走 `:refs/tags/<name>` refspec；后端 `git/refs.rs::list_tags` 解析 annotated tag 对象 + `git/remote.rs` 三个新公开函数（push_tag / push_all_tags / delete_remote_tag）共享既有 OpHandle 进度 + 取消通道，新增 1 个集成测试                                                                                                                                    |
| v0.13.13 | **Commit 详情面板增强**：顶部加 Copy message / Copy full SHA / Copy short SHA 三个一键复制按钮；Parents / Children chip 全部可点击直接跳转（children 从已加载历史窗口反查 `parents.includes(oid)` 实时算，零额外 IPC）；committer 与 author 不同（cherry-pick / rebase）时单独显示 **Committer** 行 + commit 进入仓库的时间；新增 **Contained in** 区块——commit 所在的本地 / 远端 branches + tags，按视觉色区分。后端 `git::log::commit_meta` 命令通过 libgit2 `graph_descendant_of` 逐 ref 判断（annotated tag 自动 peel），新增 1 个集成测试覆盖 contained-in 逻辑                                                                                      |
| v0.13.14 | **Diff 视图双重升级**：(1) **Unified 模式补 word-level**——和 SBS 对齐，连续 `-`/`+` 块按 index 配对计算 LCS token，新纯函数 `unifiedWordTokens` + 7 个 bun:test；(2) **Image diff**——选中常见图片扩展（png/jpg/gif/webp/svg/avif/bmp/ico）时 Diff 主体自动切换为双栏图片预览，标题栏显示文件大小，棋盘格背景显示透明区，新增/删除/oversized(>8 MB) 三种边界态各有 placeholder。后端新增 `git/blob.rs::read_blob_at_commit` + `read_working_blob`（base64 编码 + 8 MB 上限），加 base64 = "0.22" 依赖 + 3 个集成测试 + 5 个 imageMime 前端测试                                                                                                             |
| v0.13.15 | **统一危险操作确认对话框**：之前散落 14 处的 `window.confirm()` 全部替换为自定义 `ConfirmDialog`——按 danger / warning 两级着色（红色破坏性 / 主品牌色）、可携带 detail 块显示真实 git 命令、Esc=取消 / Enter=确认 / 背景点击=取消、焦点自动跳到 Confirm 按钮（防误触）。覆盖：discard / drop stash / delete branch / delete tag (local + remote) / hard reset / abort merge / abort rebase / detached HEAD checkout / cherry-pick / revert / soft+mixed reset / submodule update / submodule update recursive / push --tags / force-push tag / force remove worktree。store 加 `confirm()` Promise API 单飞实现；调用点和原生 confirm 一致的 `await` 形态 |
| v0.13.16 | **Graph 节点祖先 / 后代高亮**：History 视图右键菜单新增 **Highlight reachability** 区块，可对任意 commit 高亮 ancestors（沿 parent BFS）或 descendants（先扫所有 ref tip 反向构建 child map 再 BFS）。激活后非匹配行降至 25 % 不透明度，源头 commit 加主品牌色 ring + 浅底，状态栏出现"Highlighting ancestors of abc1234 · 42 commits · clear"。filter 变化 / repo 切换 / 重载 history 时自动清除。后端新增 `git/commit_relations.rs` 两条命令（`commit_ancestors` / `commit_descendants`），祖先方向 50000 上限、后代方向 200000 扫描上限 + 50000 结果上限，超大 monorepo 也在亚秒完成。+3 Rust 单元测试                                                 |
| v0.13.17 | **Blame 行级右键菜单**：BlamePage 任意行右键弹出 4 项菜单——Show this commit in History（与短 oid 点击同效）/ **Annotate revision before this change**（对该行所在 commit 的父级 `<oid>^` 重新 blame，对应 IntelliJ 的 "Annotate Revision Before This Change"，让用户追"这一行的上一次形态"）/ Copy SHA / Copy commit summary / Copy line content。新 store action `blameBeforeCommit(oid)`：复用既有 `blameAt` + 自动压 history 栈，**Back** 一键回退。整行加 hover 高亮 + tooltip 提示右键菜单可用                                                                                                                                                       |

---

## 反馈与扩展

- **新 Rust 命令**：`src-tauri/src/commands.rs` 加 `#[tauri::command]`，在 `lib.rs` 的 `invoke_handler!` 注册；前端 `src/ipc/git.ts` 加包装
- **新视图**：`stores/app.ts` 的 `ViewKey` 加，`App.tsx` 加路由，`Sidebar.tsx` 加 item，`lib/locales/{en,zh}.ts` 加 label
- **改主题色**：`src/styles/globals.css` 顶部的 `--branch-1..5`、`--diff-*` 变量；以及 `GraphRow.tsx` 里的 `BRANCH_COLORS` 字面量
- **新 i18n key**：先在 `lib/locales/en.ts` 加，`Dict` 类型会要求 `zh.ts` 同步补齐（编译期保证不漏）

---

**祝使用愉快！** 🎉
