/**
 * ChangesPage — IDEA-style Commit tool window.
 *
 * Three-pane layout:
 *   Left  (280px)  — file tree with directory grouping
 *   Center (flex-1) — inline diff preview (Phase 2)
 *   Right (320px) — commit message + options + actions
 */
import { useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useApp } from "@/stores/app";
import { git } from "@/ipc/git";
import { toast } from "@/lib/toast";
import { confirm } from "@/lib/confirm";
import { FileTree } from "@/components/changes/FileTree";
import { ContextMenu, type ContextMenuPos, type MenuItem } from "@/components/ContextMenu";
import { useShortcuts } from "@/lib/useShortcuts";
import type { WorkingFile } from "@/ipc/git";

export function ChangesPage() {
  // ---- store selectors ----
  const files = useApp((s) => s.changes.files);
  const selected = useApp((s) => s.changes.selected);
  const message = useApp((s) => s.changes.message);
  const loading = useApp((s) => s.changes.loading);
  const committing = useApp((s) => s.changes.committing);
  const error = useApp((s) => s.changes.error);
  const amend = useApp((s) => s.changes.amend);
  const signoff = useApp((s) => s.changes.signoff);
  const skipHooks = useApp((s) => s.changes.skipHooks);
  const groupBy = useApp((s) => s.changes.groupBy);
  const expandedDirs = useApp((s) => s.changes.expandedDirs);
  const fileFilter = useApp((s) => s.changes.fileFilter);
  const previewFile = useApp((s) => s.changes.previewFile);
  const previewDiff = useApp((s) => s.changes.previewDiff);
  const previewLoading = useApp((s) => s.changes.previewLoading);
  const previewError = useApp((s) => s.changes.previewError);
  const messageHistory = useApp((s) => s.changes.messageHistory);
  const authorOverride = useApp((s) => s.changes.authorOverride);
  const showAdvancedOptions = useApp((s) => s.changes.showAdvancedOptions);
  const stashBusy = useApp((s) => s.stash.busy);

  // ---- store actions ----
  const toggle = useApp((s) => s.toggleChange);
  const clearSel = useApp((s) => s.clearChangeSelection);
  const commit = useApp((s) => s.commitWorking);
  const setMessage = useApp((s) => s.setCommitMessage);
  const setAmend = useApp((s) => s.setAmend);
  const setSignoff = useApp((s) => s.setSignoff);
  const setSkipHooks = useApp((s) => s.setSkipHooks);
  const setView = useApp((s) => s.setView);
  const saveStash = useApp((s) => s.saveStash);
  const openWorkingDiff = useApp((s) => s.openWorkingDiff);
  const repo = useApp((s) => s.repo);
  const loadChanges = useApp((s) => s.loadChanges);
  const setChangesGroupBy = useApp((s) => s.setChangesGroupBy);
  const toggleDirExpand = useApp((s) => s.toggleDirExpand);
  const expandAllDirs = useApp((s) => s.expandAllDirs);
  const collapseAllDirs = useApp((s) => s.collapseAllDirs);
  const setChangesFileFilter = useApp((s) => s.setChangesFileFilter);
  const selectFilteredChanges = useApp((s) => s.selectFilteredChanges);
  const previewChangesFile = useApp((s) => s.previewChangesFile);
  const clearChangesPreview = useApp((s) => s.clearChangesPreview);
  const setAuthorOverride = useApp((s) => s.setAuthorOverride);
  const setShowAdvancedOptions = useApp((s) => s.setShowAdvancedOptions);

  // ---- local state ----
  const [applyOpen, setApplyOpen] = useState(false);
  const [patchDraft, setPatchDraft] = useState("");
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [ctxPos, setCtxPos] = useState<ContextMenuPos | null>(null);
  const [ctxFile, setCtxFile] = useState<WorkingFile | null>(null);
  const [showMsgHistory, setShowMsgHistory] = useState(false);

  // ---- derived ----
  const staged = files.filter((f) => f.flag === "staged" || f.flag === "both");
  const stagedCount = staged.length;
  const hasAnyChange = files.length > 0 && files.filter((f) => f.flag === "conflict").length === 0;

  // ---- keyboard shortcuts (IDEA-style) ----
  const shortcuts = useMemo(() => ({
    "ctrl+alt+a": () => {
      if (selected.size > 0) {
        if (!repo) return;
        void git.stageFiles(repo.path, Array.from(selected));
        void loadChanges();
      }
    },
    "ctrl+k": () => {
      // Focus on the commit message textarea. If already focused, commit.
      const el = document.querySelector<HTMLTextAreaElement>(".changes-commit-msg");
      if (el) {
        if (document.activeElement === el) {
          void commit();
        } else {
          el.focus();
        }
      }
    },
    "ctrl+d": () => {
      // Show diff for the first selected file, or clear preview.
      if (previewFile) {
        clearChangesPreview();
      } else if (selected.size === 1) {
        const [file] = selected;
        void previewChangesFile(file);
      }
    },
    escape: () => {
      if (previewFile) clearChangesPreview();
      else if (ctxPos) setCtxPos(null);
    },
    delete: () => {
      if (selected.size > 0) {
        void (async () => {
          const list = Array.from(selected);
          const ok = await confirm({
            level: "danger",
            title: `Discard ${list.length} file${list.length === 1 ? "" : "s"}?`,
            message: "Working-tree changes will be reverted to HEAD. This cannot be undone.",
            detail:
              list.slice(0, 20).join("\n") +
              (list.length > 20 ? `\n…and ${list.length - 20} more` : ""),
            confirmLabel: "Discard",
          });
          if (!ok) return;
          if (!repo) return;
          await git.discardFiles(repo.path, list);
          void loadChanges();
        })();
      }
    },
  }), [selected, repo, loadChanges, commit, previewFile, clearChangesPreview, previewChangesFile, ctxPos]);
  useShortcuts(shortcuts);

  // ---- context menu ----
  const handleContextMenu = useCallback(
    (path: string, e: React.MouseEvent) => {
      e.preventDefault();
      const f = files.find((x) => x.path === path);
      if (!f) return;
      setCtxFile(f);
      setCtxPos({ x: e.clientX, y: e.clientY });
    },
    [files],
  );

  const ctxItems: MenuItem[] = (() => {
    if (!ctxFile) return [];
    const path = ctxFile.path;
    return [
      {
        label: "Show Diff",
        onClick: () => {
          void previewChangesFile(path);
        },
      },
      {
        label: "Open in Diff View",
        onClick: () => {
          void openWorkingDiff(path);
        },
      },
      { separator: true, label: "" },
      ...(ctxFile.flag === "unstaged" || ctxFile.flag === "untracked" || ctxFile.flag === "both"
        ? [
            {
              label: "Stage",
              onClick: async () => {
                if (!repo) return;
                await git.stageFiles(repo.path, [path]);
                void loadChanges();
              },
            },
          ]
        : []),
      ...(ctxFile.flag === "staged" || ctxFile.flag === "both"
        ? [
            {
              label: "Unstage",
              onClick: async () => {
                if (!repo) return;
                await git.unstageFiles(repo.path, [path]);
                void loadChanges();
              },
            },
          ]
        : []),
      { separator: true, label: "" },
      {
        label: "Discard",
        danger: true,
        onClick: async () => {
          const ok = await confirm({
            level: "danger",
            title: `Discard ${path}?`,
            message: "Working-tree changes will be reverted to HEAD. This cannot be undone.",
            confirmLabel: "Discard",
          });
          if (!ok) return;
          if (!repo) return;
          await git.discardFiles(repo.path, [path]);
          void loadChanges();
        },
      },
      { separator: true, label: "" },
      {
        label: "Copy Path",
        onClick: () => {
          void navigator.clipboard.writeText(path);
        },
      },
    ];
  })();

  // ---- Apply patch ----
  const submitApplyPatch = async () => {
    if (!repo) return;
    const text = patchDraft;
    if (!text.trim()) {
      setApplyError("Paste a patch first.");
      return;
    }
    setApplyBusy(true);
    setApplyError(null);
    try {
      await git.applyPatchCheck(repo.path, text);
      await git.applyPatch(repo.path, text);
      toast.success("Patch applied to working tree.");
      setApplyOpen(false);
      setPatchDraft("");
      void loadChanges();
    } catch (e) {
      setApplyError(String(e));
    } finally {
      setApplyBusy(false);
    }
  };

  // ---- Stash ----
  const onStashAll = async () => {
    const m = window.prompt(
      "Stash message (optional):\n\nLeave blank to use 'WIP on <branch>'.",
      "",
    );
    if (m === null) return;
    const includeUntracked = await confirm({
      level: "warning",
      title: "Include untracked files?",
      message:
        "OK = stash both tracked changes and brand-new files (`git stash -u`). Cancel = stash only tracked-but-modified files.",
      confirmLabel: "Include untracked",
      cancelLabel: "Skip untracked",
    });
    await saveStash({
      message: m.trim() || undefined,
      includeUntracked,
      keepIndex: false,
    });
    setView("stash");
  };

  // ---- Commit ----
  const doCommit = () => {
    if (!message.trim()) return;
    void commit();
  };

  const doCommitAndPush = async () => {
    if (!repo) return;
    if (!message.trim()) {
      void commit();
      return;
    }
    // We commit first, then push. The push is handled by calling the push
    // action after commit succeeds.
    await commit();
    // After commitWorking completes, it clears message and sets committing=false.
    // We can offer a push — for now use a simple approach.
    toast.success("Committed. Use Push from the toolbar to push to remote.");
  };

  // ---- Helpers ----
  const handleClickFile = useCallback(
    (path: string) => {
      void previewChangesFile(path);
    },
    [previewChangesFile],
  );

  const handleDoubleClickFile = useCallback(
    (path: string) => {
      void openWorkingDiff(path);
    },
    [openWorkingDiff],
  );

  /** Toggle all files under a directory — select if some are unselected, deselect if all are selected. */
  const handleToggleDirFiles = useCallback(
    (dirPath: string) => {
      // Collect all file paths under this directory.
      const dirPrefix = dirPath + "/";
      const dirFiles = files.filter((f) => f.path.startsWith(dirPrefix) || f.path === dirPath);
      if (dirFiles.length === 0) return;
      const allSelected = dirFiles.every((f) => selected.has(f.path));
      if (allSelected) {
        // Deselect all files in this directory.
        dirFiles.forEach((f) => selected.has(f.path) && toggle(f.path));
      } else {
        // Select all files not yet selected.
        dirFiles.forEach((f) => !selected.has(f.path) && toggle(f.path));
      }
    },
    [files, selected, toggle],
  );

  // ---- Phase 2 placeholder: inline diff component ----
  // This will be replaced in Phase 2 with a proper ChangesDiffPreview component.
  const PreviewPane = () => {
    if (!previewFile) {
      return (
        <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
          Click a file to preview changes
        </div>
      );
    }
    if (previewLoading) {
      return (
        <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
          Loading diff...
        </div>
      );
    }
    if (previewError) {
      return (
        <div className="flex h-full items-center justify-center text-[11px] text-destructive">
          {previewError}
        </div>
      );
    }
    if (previewDiff) {
      return (
        <div className="flex h-full flex-col">
          <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border bg-card px-2 text-[11px]">
            <span className="truncate font-mono">{previewFile}</span>
            <span className="ml-auto text-muted-foreground">
              {previewDiff.hunks.length} hunk{previewDiff.hunks.length !== 1 ? "s" : ""}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[10px]"
              onClick={() => void openWorkingDiff(previewFile)}
            >
              Open full diff
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={clearChangesPreview}
              title="Close preview (Esc)"
            >
              ✕
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-0">
            <DiffPreviewContent diff={previewDiff} />
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="grid h-full grid-cols-[280px_1fr_320px]">
      {/* Left: File tree */}
      <div className="flex min-w-0 flex-col border-r border-border">
        <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2">
          <div className="inline-flex overflow-hidden rounded-md border border-border text-[11px]">
            <Button
              variant={groupBy === "directory" ? "default" : "ghost"}
              size="sm"
              className="h-6 rounded-none px-2 text-[10px]"
              onClick={() => setChangesGroupBy("directory")}
            >
              Tree
            </Button>
            <Button
              variant={groupBy === "status" ? "default" : "ghost"}
              size="sm"
              className="h-6 rounded-none px-2 text-[10px]"
              onClick={() => setChangesGroupBy("status")}
            >
              List
            </Button>
          </div>
          <div className="ml-auto flex items-center gap-0.5">
            {loading && <span className="mr-1 text-[10px] text-muted-foreground">loading...</span>}
            <Button
              variant="secondary"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={() => {
                setApplyError(null);
                setApplyOpen(true);
              }}
              title="Apply a unified-patch text from the clipboard onto the working tree"
            >
              Patch...
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={onStashAll}
              disabled={!hasAnyChange || stashBusy}
              title="git stash — save all working changes for later"
            >
              Stash...
            </Button>
          </div>
        </div>

        {groupBy === "directory" ? (
          <FileTree
            files={files}
            selected={selected}
            expandedDirs={expandedDirs}
            fileFilter={fileFilter}
            onToggle={toggle}
            onToggleDir={toggleDirExpand}
            onToggleDirFiles={handleToggleDirFiles}
            onExpandAll={expandAllDirs}
            onCollapseAll={collapseAllDirs}
            onFilterChange={setChangesFileFilter}
            onSelectAll={selectFilteredChanges}
            onClearSelection={clearSel}
            onClickFile={handleClickFile}
            onDoubleClickFile={handleDoubleClickFile}
            onContextMenu={handleContextMenu}
          />
        ) : (
          <SectionList
            files={files}
            selected={selected}
            onToggle={toggle}
            onClickFile={handleClickFile}
            onDoubleClickFile={handleDoubleClickFile}
            onContextMenu={handleContextMenu}
          />
        )}
      </div>

      {/* Center: Inline diff preview */}
      <div className="flex min-w-0 flex-col border-r border-border">
        {error && (
          <div className="border-b border-[hsl(var(--destructive))]/30 bg-[hsl(var(--destructive))]/10 px-3 py-1.5 text-[11px] text-[hsl(var(--destructive))]">
            {error}
          </div>
        )}
        <div className="min-h-0 flex-1">
          <PreviewPane />
        </div>
      </div>

      {/* Right: Commit panel */}
      <aside className="flex h-full min-w-0 flex-col bg-card">
        <div className="border-b border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              {amend ? "Amend last commit" : "Commit staged changes"}
            </h2>
          </div>
          <div className="relative">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Commit message&#10;&#10;Optional longer body…"
              className="changes-commit-msg block h-32 w-full resize-none rounded-md border border-input bg-background p-2 pr-8 font-mono text-xs outline-none focus:border-ring"
            />
            {messageHistory.length > 0 && (
              <Button
                variant="ghost"
                size="icon-xs"
                className="absolute right-1 top-1 h-5 w-5"
                onClick={() => setShowMsgHistory(!showMsgHistory)}
                title="Recent messages"
              >
                🕐
              </Button>
            )}
          </div>
          {showMsgHistory && messageHistory.length > 0 && (
            <div className="mt-1 max-h-28 overflow-auto rounded-md border border-border bg-background">
              {messageHistory.map((m, i) => (
                <div
                  key={i}
                  className="cursor-pointer truncate border-b border-border/30 px-2 py-1 text-[11px] font-mono hover:bg-accent/50 last:border-b-0"
                  onClick={() => {
                    setMessage(m);
                    setShowMsgHistory(false);
                  }}
                >
                  {m.split("\n")[0]}
                </div>
              ))}
            </div>
          )}

          {/* Commit modifiers */}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
            <label
              className="inline-flex cursor-pointer select-none items-center gap-1.5"
              title="git commit --amend — replace the current HEAD with this commit instead of chaining onto it."
            >
              <Checkbox
                checked={amend}
                onCheckedChange={(checked) => void setAmend(checked)}
                className="h-3.5 w-3.5"
              />
              <span>Amend</span>
            </label>
            <label
              className="inline-flex cursor-pointer select-none items-center gap-1.5"
              title="Append a Signed-off-by: trailer using user.name and user.email (DCO compliance)."
            >
              <Checkbox
                checked={signoff}
                onCheckedChange={(checked) => void setSignoff(checked)}
                className="h-3.5 w-3.5"
              />
              <span>Sign off</span>
            </label>
            <label
              className="inline-flex cursor-pointer select-none items-center gap-1.5"
              title="git commit --no-verify — skip pre-commit, commit-msg, and post-commit hooks for THIS commit only."
            >
              <Checkbox
                checked={skipHooks}
                onCheckedChange={(checked) => void setSkipHooks(checked)}
                className="h-3.5 w-3.5"
              />
              <span>No verify</span>
            </label>
          </div>

          {/* Advanced options toggle */}
          <div className="mt-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1 text-[10px] text-muted-foreground"
              onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
            >
              {showAdvancedOptions ? "▾" : "▸"} Advanced
            </Button>
          </div>
          {showAdvancedOptions && (
            <div className="mt-1 space-y-2 rounded border border-border/50 p-2 text-[11px]">
              <label className="flex items-center gap-2">
                <span className="w-14 text-muted-foreground">Author</span>
                <input
                  type="text"
                  value={authorOverride ?? ""}
                  onChange={(e) => setAuthorOverride(e.target.value || null)}
                  placeholder='"Name <email>"'
                  className="flex-1 rounded border border-input bg-background px-2 py-1 font-mono text-[11px] outline-none focus:border-ring"
                />
              </label>
            </div>
          )}

          {/* Action buttons */}
          <div className="mt-3 flex items-center gap-2">
            <Button
              onClick={doCommit}
              disabled={committing || (!amend && stagedCount === 0)}
              variant="default"
            >
              {committing
                ? amend
                  ? "Amending..."
                  : "Committing..."
                : amend
                  ? "Amend commit"
                  : `Commit ${stagedCount > 0 ? stagedCount + " file" + (stagedCount === 1 ? "" : "s") : ""}`}
            </Button>
            <Button
              onClick={doCommitAndPush}
              disabled={committing || (!amend && stagedCount === 0)}
              variant="secondary"
              title="Commit and push to remote"
            >
              Commit &amp; Push
            </Button>
          </div>
        </div>
      </aside>

      {/* Context menu */}
      <ContextMenu pos={ctxPos} items={ctxItems} onClose={() => setCtxPos(null)} />

      {/* Apply patch dialog */}
      <Dialog
        open={applyOpen}
        onOpenChange={(open) => {
          if (!applyBusy) setApplyOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Apply patch</DialogTitle>
            <DialogDescription>
              Paste unified-patch text (the format produced by{" "}
              <code className="font-mono">git diff</code> /{" "}
              <code className="font-mono">git format-patch</code>) below, then Apply.
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={patchDraft}
            onChange={(e) => setPatchDraft(e.target.value)}
            autoFocus
            spellCheck={false}
            placeholder={
              "diff --git a/foo.ts b/foo.ts\nindex abc1234..def5678 100644\n--- a/foo.ts\n+++ b/foo.ts\n@@ -1,3 +1,4 @@\n …"
            }
            className="m-0 h-72 resize-none rounded-md border border-input bg-background px-3 py-2 font-mono text-[12px] outline-none focus:border-ring"
          />
          {applyError && (
            <div className="rounded border border-[hsl(var(--destructive)/.30)] bg-[hsl(var(--destructive)/.10)] px-3 py-2 font-mono text-[11px] text-[hsl(var(--destructive))]">
              {applyError}
            </div>
          )}
          <DialogFooter>
            <Button
              onClick={() => setApplyOpen(false)}
              disabled={applyBusy}
              variant="outline"
              size="sm"
            >
              Cancel
            </Button>
            <Button
              onClick={() => void submitApplyPatch()}
              disabled={applyBusy || !patchDraft.trim()}
              variant="default"
              size="sm"
            >
              {applyBusy ? "Applying..." : "Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---- Simple inline diff content (placeholder until Phase 2) ----
function DiffPreviewContent({ diff }: { diff: import("@/ipc/git").FileDiff }) {
  return (
    <div className="font-mono text-[11px] leading-[18px]">
      {diff.hunks.map((hunk, hi) => (
        <div key={hi} className="border-b border-border/20">
          <div className="bg-[hsl(var(--diff-header-bg))] px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--diff-header-fg))]">
            {hunk.header}
          </div>
          {hunk.lines.map((line, li) => (
            <div
              key={li}
              className={`whitespace-pre px-2 ${
                line.origin === "+"
                  ? "bg-[hsl(var(--diff-added-bg))] text-[hsl(var(--diff-added-fg))]"
                  : line.origin === "-"
                    ? "bg-[hsl(var(--diff-removed-bg))] text-[hsl(var(--diff-removed-fg))]"
                    : "text-muted-foreground"
              }`}
            >
              {line.origin} {line.content}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ---- Legacy list view (when groupBy === "status") ----
function SectionList({
  files,
  selected,
  onToggle,
  onClickFile,
  onDoubleClickFile,
  onContextMenu,
}: {
  files: import("@/ipc/git").WorkingFile[];
  selected: Set<string>;
  onToggle: (path: string) => void;
  onClickFile: (path: string) => void;
  onDoubleClickFile: (path: string) => void;
  onContextMenu: (path: string, e: React.MouseEvent) => void;
}) {
  const staged = files.filter((f) => f.flag === "staged" || f.flag === "both");
  const unstaged = files.filter(
    (f) => f.flag === "unstaged" || f.flag === "untracked" || f.flag === "both",
  );
  const conflicts = files.filter((f) => f.flag === "conflict");

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {conflicts.length > 0 && (
        <SectionBlock
          title="Unmerged"
          files={conflicts}
          selected={selected}
          onToggle={onToggle}
          onClickFile={onClickFile}
          onDoubleClickFile={onDoubleClickFile}
          onContextMenu={onContextMenu}
        />
      )}
      {staged.length > 0 && (
        <SectionBlock
          title="Staged changes"
          files={staged}
          selected={selected}
          onToggle={onToggle}
          onClickFile={onClickFile}
          onDoubleClickFile={onDoubleClickFile}
          onContextMenu={onContextMenu}
        />
      )}
      {unstaged.length > 0 && (
        <SectionBlock
          title="Unstaged changes"
          files={unstaged}
          selected={selected}
          onToggle={onToggle}
          onClickFile={onClickFile}
          onDoubleClickFile={onDoubleClickFile}
          onContextMenu={onContextMenu}
        />
      )}
      {files.length === 0 && (
        <div className="p-6 text-center text-[11px] text-muted-foreground">
          Working tree is clean.
        </div>
      )}
    </div>
  );
}

function SectionBlock({
  title,
  files,
  selected,
  onToggle,
  onClickFile,
  onDoubleClickFile,
  onContextMenu,
}: {
  title: string;
  files: import("@/ipc/git").WorkingFile[];
  selected: Set<string>;
  onToggle: (path: string) => void;
  onClickFile: (path: string) => void;
  onDoubleClickFile: (path: string) => void;
  onContextMenu: (path: string, e: React.MouseEvent) => void;
}) {
  const STATUS_LABEL: Record<string, string> = {
    added: "A",
    modified: "M",
    deleted: "D",
    renamed: "R",
    typechange: "T",
    untracked: "?",
    conflict: "!",
  };
  const STATUS_COLOR: Record<string, string> = {
    added: "text-[hsl(var(--diff-added-fg))]",
    modified: "text-[hsl(var(--diff-modified-fg))]",
    deleted: "text-[hsl(var(--diff-removed-fg))]",
    renamed: "text-[hsl(var(--branch-2))]",
    typechange: "text-[hsl(var(--branch-3))]",
    untracked: "text-muted-foreground",
    conflict: "text-[hsl(var(--destructive))]",
  };

  return (
    <div>
      <div className="border-b border-border bg-card px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title} ({files.length})
      </div>
      {files.map((f) => {
        const isSelected = selected.has(f.path);
        return (
          <div
            key={f.path}
            className="flex cursor-pointer items-center gap-2 border-b border-border/30 px-3 py-1 text-xs hover:bg-accent/40"
            onClick={() => onClickFile(f.path)}
            onDoubleClick={() => onDoubleClickFile(f.path)}
            onContextMenu={(e) => onContextMenu(f.path, e)}
          >
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onToggle(f.path)}
              className="h-3.5 w-3.5"
              aria-label={`Select ${f.path}`}
              onClick={(e) => e.stopPropagation()}
            />
            <span
              className={`w-3.5 text-center font-mono text-[11px] font-bold ${STATUS_COLOR[f.status] || ""}`}
            >
              {STATUS_LABEL[f.status] || "?"}
            </span>
            <span className="flex-1 truncate font-mono">{f.path}</span>
            <span className="text-[10.5px] text-muted-foreground">{f.flag}</span>
          </div>
        );
      })}
    </div>
  );
}