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
import { useState } from "react";
import { useApp } from "@/stores/app";
import { git } from "@/ipc/git";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { confirm } from "@/lib/confirm";
import type { WorkingFile } from "@/ipc/git";

const STATUS_LABEL: Record<WorkingFile["status"], string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  typechange: "T",
  untracked: "?",
  conflict: "!",
};

const STATUS_COLOR: Record<WorkingFile["status"], string> = {
  added: "text-[hsl(var(--diff-added-fg))]",
  modified: "text-[hsl(var(--diff-modified-fg))]",
  deleted: "text-[hsl(var(--diff-removed-fg))]",
  renamed: "text-[hsl(var(--branch-2))]",
  typechange: "text-[hsl(var(--branch-3))]",
  untracked: "text-muted-foreground",
  conflict: "text-[hsl(var(--destructive))]",
};

export function ChangesPage() {
  const files = useApp((s) => s.changes.files);
  const selected = useApp((s) => s.changes.selected);
  const message = useApp((s) => s.changes.message);
  const loading = useApp((s) => s.changes.loading);
  const committing = useApp((s) => s.changes.committing);
  const error = useApp((s) => s.changes.error);
  const stashBusy = useApp((s) => s.stash.busy);

  const toggle = useApp((s) => s.toggleChange);
  const selectAll = useApp((s) => s.selectAllChanges);
  const clearSel = useApp((s) => s.clearChangeSelection);
  const stageSel = useApp((s) => s.stageSelected);
  const unstageSel = useApp((s) => s.unstageSelected);
  const discardSel = useApp((s) => s.discardSelected);
  const setMessage = useApp((s) => s.setCommitMessage);
  const commit = useApp((s) => s.commitWorking);
  // v0.13.20 — amend / signoff / skip-hooks toggles live on the changes
  // slice; selectors stay narrow so unrelated state churn doesn't re-render
  // the panel.
  const amend = useApp((s) => s.changes.amend);
  const signoff = useApp((s) => s.changes.signoff);
  const skipHooks = useApp((s) => s.changes.skipHooks);
  const setAmend = useApp((s) => s.setAmend);
  const setSignoff = useApp((s) => s.setSignoff);
  const setSkipHooks = useApp((s) => s.setSkipHooks);
  const setView = useApp((s) => s.setView);
  const saveStash = useApp((s) => s.saveStash);
  const openWorkingDiff = useApp((s) => s.openWorkingDiff);
  const repo = useApp((s) => s.repo);
  const loadChanges = useApp((s) => s.loadChanges);

  // v0.13.9 — Apply patch dialog state. The flow is: open dialog → user
  // pastes a unified-patch text → we run a server-side dry-run check
  // (`apply_patch_check`); if that succeeds, we commit with `apply_patch`
  // (which does NOT touch the index, leaving the user free to stage).
  const [applyOpen, setApplyOpen] = useState(false);
  const [patchDraft, setPatchDraft] = useState("");
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

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
      // Dry-run first so the failure mode is "modal still open with the
      // backend's reason inline" rather than "half-applied workdir".
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

  const staged = files.filter((f) => f.flag === "staged" || f.flag === "both");
  const unstaged = files.filter(
    (f) => f.flag === "unstaged" || f.flag === "untracked" || f.flag === "both",
  );
  const conflicts = files.filter((f) => f.flag === "conflict");
  const stagedCount = staged.length;
  const hasSelection = selected.size > 0;
  const hasAnyChange = files.length > 0 && conflicts.length === 0;

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

  return (
    <div className="grid h-full grid-cols-[1fr_360px]">
      <div className="flex min-w-0 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card px-3 text-xs">
          <span className="text-muted-foreground">{files.length} changes</span>
          {stagedCount > 0 && <span className="text-muted-foreground">· {stagedCount} staged</span>}
          {conflicts.length > 0 && (
            <span className="text-[hsl(var(--destructive))]">· {conflicts.length} unmerged</span>
          )}
          {loading && <span className="text-muted-foreground">· loading...</span>}
          <div className="ml-auto flex items-center gap-2">
            <Button
              onClick={() => {
                setApplyError(null);
                setApplyOpen(true);
              }}
              variant="secondary"
              size="sm"
              title="Apply a unified-patch text from the clipboard onto the working tree"
            >
              Apply patch…
            </Button>
            <Button
              onClick={selectAll}
              variant="secondary"
              size="sm"
            >
              Select all
            </Button>
            <Button
              onClick={clearSel}
              disabled={!hasSelection}
              variant="secondary"
              size="sm"
            >
              Clear
            </Button>
            <Button
              onClick={stageSel}
              disabled={!hasSelection}
              variant="default"
              size="sm"
            >
              Stage
            </Button>
            <Button
              onClick={unstageSel}
              disabled={!hasSelection}
              variant="secondary"
              size="sm"
            >
              Unstage
            </Button>
            <Button
              onClick={discardSel}
              disabled={!hasSelection}
              variant="destructive"
              size="sm"
            >
              Discard
            </Button>
            <Button
              onClick={onStashAll}
              disabled={!hasAnyChange || stashBusy}
              variant="secondary"
              size="sm"
              title="git stash — save all working changes for later"
            >
              Stash…
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {conflicts.length > 0 && (
            <Section
              title="Unmerged"
              files={conflicts}
              selected={selected}
              toggle={toggle}
              openDiff={openWorkingDiff}
            />
          )}
          {staged.length > 0 && (
            <Section
              title="Staged changes"
              files={staged}
              selected={selected}
              toggle={toggle}
              openDiff={openWorkingDiff}
            />
          )}
          {unstaged.length > 0 && (
            <Section
              title="Unstaged changes"
              files={unstaged}
              selected={selected}
              toggle={toggle}
              openDiff={openWorkingDiff}
            />
          )}
          {!loading && files.length === 0 && (
            <div className="p-6 text-center text-xs text-muted-foreground">
              Working tree is clean.
            </div>
          )}
        </div>
      </div>

      {/* Right: commit panel */}
      <aside className="flex h-full min-w-0 flex-col border-l border-border bg-card">
        <div className="border-b border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              {amend ? "Amend last commit" : "Commit staged changes"}
            </h2>
          </div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Commit message&#10;&#10;Optional longer body…"
            className="block h-32 w-full resize-none rounded-md border border-input bg-background p-2 font-mono text-xs outline-none focus:border-ring"
          />

          {/* v0.13.20 — commit modifier toggles. Compact row to keep the
              panel from growing taller; tooltips carry the long-form
              explanation. */}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
            <label
              className="inline-flex cursor-pointer select-none items-center gap-1.5"
              title="git commit --amend — replace the current HEAD with this commit instead of chaining onto it. Pre-fills the message with HEAD's message; toggle off to restore your previous draft."
            >
              <Checkbox
              checked={amend}
              onCheckedChange={(checked) => void setAmend(checked)}
              className="h-3.5 w-3.5"
            />
            <span>Amend last commit</span>
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
            <span>Skip hooks</span>
            </label>
          </div>

          <div className="mt-2 flex items-center gap-2">
            <Button
              onClick={commit}
              disabled={committing || (!amend && stagedCount === 0) || !message.trim()}
              variant="default"
            >
              {committing
                ? amend
                  ? "Amending..."
                  : "Committing..."
                : amend
                  ? "Amend commit"
                  : `Commit ${stagedCount} file${stagedCount === 1 ? "" : "s"}`}
            </Button>
          </div>
          {error && <div className="mt-2 text-[11px] text-destructive">{error}</div>}
        </div>
      </aside>

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
              <code className="font-mono">git format-patch</code>) below, then Apply. The patch
              will be applied to your working tree only — the index is left untouched.
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
              {applyBusy ? "Applying…" : "Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Section({
  title,
  files,
  selected,
  toggle,
  openDiff,
}: {
  title: string;
  files: WorkingFile[];
  selected: Set<string>;
  toggle: (path: string) => void;
  /** Click on the filename text → open the working-tree Diff view (editable). */
  openDiff: (path: string) => Promise<void>;
}) {
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
            className={cn(
              "flex items-center gap-2 border-b border-border/30 px-3 py-1 text-xs",
              "hover:bg-accent/40",
              isSelected && "bg-accent/60",
            )}
          >
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => toggle(f.path)}
              className="accent-[hsl(var(--branch-1))]"
              aria-label={`Select ${f.path}`}
            />
            <span
              className={cn(
                "w-3.5 text-center font-mono text-[11px] font-bold",
                STATUS_COLOR[f.status],
              )}
            >
              {STATUS_LABEL[f.status]}
            </span>
            <Button
              onClick={() => void openDiff(f.path)}
              variant="link"
              size="sm"
              className="flex-1 truncate text-left font-mono"
              title="Open in Diff view (click for editable working-tree diff)"
            >
              {f.path}
            </Button>
            <span className="text-[10.5px] text-muted-foreground">{f.flag}</span>
          </div>
        );
      })}
    </div>
  );
}
