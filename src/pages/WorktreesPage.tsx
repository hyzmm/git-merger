/**
 * Worktrees view — list / add / remove / prune linked worktrees of the
 * current repository. The main checkout is always shown at the top with
 * a "main" badge. Linked worktrees show their branch + HEAD short oid.
 */
import { useEffect, useState } from "react";
import { GitBranch, Plus, Trash2, Lock, AlertTriangle, Trees } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useApp } from "@/stores/app";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { WorktreeInfo } from "@/ipc/git";

export function WorktreesPage() {
  const repo = useApp((s) => s.repo);
  const entries = useApp((s) => s.worktrees.entries);
  const loading = useApp((s) => s.worktrees.loading);
  const busy = useApp((s) => s.worktrees.busy);
  const status = useApp((s) => s.worktrees.status);
  const error = useApp((s) => s.worktrees.error);
  const load = useApp((s) => s.loadWorktrees);
  const removeWt = useApp((s) => s.removeWorktree);
  const pruneAll = useApp((s) => s.pruneWorktrees);
  const t = useT();

  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    if (repo) void load();
  }, [repo, load]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card px-3 text-xs">
        <Trees className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">
          {entries.length} {t("worktrees.count")}
        </span>
        {loading && <span className="text-muted-foreground">· {t("worktrees.loading")}</span>}
        {busy && <span className="text-muted-foreground">· {t("worktrees.working")}</span>}
        {status && <span className="text-[hsl(var(--branch-1))]">· {status}</span>}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => setShowAdd((v) => !v)}
            disabled={!repo || busy}
            title={t("worktrees.addBtn")}
            className={cn(
              "flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-foreground hover:opacity-90",
              (!repo || busy) && "cursor-not-allowed opacity-60",
            )}
          >
            <Plus className="h-3 w-3" />
            {t("worktrees.add")}
          </button>
          <button
            onClick={() => void pruneAll()}
            disabled={!repo || busy}
            title={t("worktrees.pruneTitle")}
            className={cn(
              "flex h-7 items-center gap-1 rounded-md border border-border bg-secondary px-2 text-[11px] hover:bg-accent",
              (!repo || busy) && "cursor-not-allowed opacity-60",
            )}
          >
            {t("worktrees.prune")}
          </button>
        </div>
      </div>

      {error && (
        <div className="border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
          {error}
        </div>
      )}

      {showAdd && <AddForm onCancel={() => setShowAdd(false)} onDone={() => setShowAdd(false)} />}

      <div className="min-h-0 flex-1 overflow-auto">
        {!loading && entries.length === 0 && (
          <div className="p-6 text-center text-xs text-muted-foreground">
            {t("worktrees.empty")}
          </div>
        )}
        {entries.map((wt) => (
          <Row
            key={wt.path}
            wt={wt}
            busy={busy}
            onRemove={(force) => void removeWt(wt.name, force)}
          />
        ))}
      </div>
    </div>
  );
}

function Row({
  wt,
  busy,
  onRemove,
}: {
  wt: WorktreeInfo;
  busy: boolean;
  onRemove: (force: boolean) => void;
}) {
  const t = useT();
  return (
    <div className={cn("border-b border-border/40 px-3 py-2", wt.is_main && "bg-accent/20")}>
      <div className="flex items-center gap-2 text-xs">
        <span className="font-mono text-foreground" title={wt.path}>
          {wt.path}
        </span>
        {wt.is_main && (
          <span className="rounded bg-[hsl(var(--branch-1)/.18)] px-1.5 text-[10px] uppercase tracking-wider text-[hsl(var(--branch-1))]">
            {t("worktrees.main")}
          </span>
        )}
        {wt.is_locked && (
          <span
            className="flex items-center gap-0.5 rounded bg-secondary px-1.5 text-[10px] uppercase tracking-wider text-muted-foreground"
            title={t("worktrees.lockedTitle")}
          >
            <Lock className="h-2.5 w-2.5" />
            {t("worktrees.locked")}
          </span>
        )}
        {wt.is_prunable && (
          <span
            className="flex items-center gap-0.5 rounded bg-[hsl(var(--branch-3)/.18)] px-1.5 text-[10px] uppercase tracking-wider text-[hsl(var(--branch-3))]"
            title={t("worktrees.prunableTitle")}
          >
            <AlertTriangle className="h-2.5 w-2.5" />
            {t("worktrees.prunable")}
          </span>
        )}
        {!wt.is_main && (
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => onRemove(false)}
              disabled={busy}
              title={t("worktrees.removeTitle")}
              className={cn(
                "flex h-7 items-center gap-1 rounded-md border border-border bg-secondary px-2 text-[11px] hover:bg-accent",
                busy && "cursor-not-allowed opacity-60",
              )}
            >
              <Trash2 className="h-3 w-3" />
              {t("worktrees.remove")}
            </button>
            <button
              onClick={() => {
                if (confirm(t("worktrees.forceRemoveConfirm").replace("{name}", wt.name))) {
                  onRemove(true);
                }
              }}
              disabled={busy}
              title={t("worktrees.forceRemoveTitle")}
              className={cn(
                "flex h-7 items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2 text-[11px] text-destructive hover:bg-destructive/20",
                busy && "cursor-not-allowed opacity-60",
              )}
            >
              {t("worktrees.forceRemove")}
            </button>
          </div>
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[10.5px] text-muted-foreground">
        {wt.branch ? (
          <span className="flex items-center gap-1">
            <GitBranch className="h-2.5 w-2.5" />
            {wt.branch}
          </span>
        ) : (
          <span>(detached)</span>
        )}
        {wt.head_oid && <span title={wt.head_oid}>{wt.head_oid.slice(0, 7)}</span>}
        <span title={t("worktrees.nameTitle")}>{wt.name}</span>
      </div>
    </div>
  );
}

function AddForm({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const t = useT();
  const repo = useApp((s) => s.repo);
  const busy = useApp((s) => s.worktrees.busy);
  const addWorktree = useApp((s) => s.addWorktree);

  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("");

  const submit = async () => {
    if (!path.trim()) return;
    await addWorktree(name.trim(), path.trim(), branch.trim() || undefined);
    onDone();
  };

  const pickFolder = async () => {
    const dir = await open({
      directory: true,
      multiple: false,
      defaultPath: repo?.path,
    });
    if (typeof dir === "string") setPath(dir);
  };

  return (
    <div className="flex flex-col gap-2 border-b border-border bg-secondary/40 px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <label className="w-24 text-muted-foreground">{t("worktrees.formPath")}</label>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder={t("worktrees.formPathPh")}
          className="h-7 flex-1 rounded-md border border-border bg-background px-2 font-mono text-[11px] focus:border-primary focus:outline-none"
        />
        <button
          onClick={() => void pickFolder()}
          className="h-7 rounded-md border border-border bg-secondary px-2 text-[11px] hover:bg-accent"
        >
          {t("worktrees.formBrowse")}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <label className="w-24 text-muted-foreground">{t("worktrees.formName")}</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("worktrees.formNamePh")}
          className="h-7 flex-1 rounded-md border border-border bg-background px-2 font-mono text-[11px] focus:border-primary focus:outline-none"
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="w-24 text-muted-foreground">{t("worktrees.formBranch")}</label>
        <input
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder={t("worktrees.formBranchPh")}
          className="h-7 flex-1 rounded-md border border-border bg-background px-2 font-mono text-[11px] focus:border-primary focus:outline-none"
        />
      </div>
      <div className="flex justify-end gap-1.5">
        <button
          onClick={onCancel}
          disabled={busy}
          className="h-7 rounded-md border border-border bg-secondary px-2.5 text-[11px] hover:bg-accent"
        >
          {t("worktrees.cancel")}
        </button>
        <button
          onClick={() => void submit()}
          disabled={busy || !path.trim()}
          className={cn(
            "h-7 rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-foreground hover:opacity-90",
            (busy || !path.trim()) && "cursor-not-allowed opacity-60",
          )}
        >
          {t("worktrees.create")}
        </button>
      </div>
    </div>
  );
}
