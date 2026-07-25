import { useEffect } from "react";
import { Box, Download, RefreshCw, Plug, FolderTree } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/stores/app";
import { cn } from "@/lib/utils";
import type { SubmoduleInfo } from "@/ipc/git";

export function SubmodulesPage() {
  const repo = useApp((s) => s.repo);
  const entries = useApp((s) => s.submodules.entries);
  const loading = useApp((s) => s.submodules.loading);
  const busy = useApp((s) => s.submodules.busy);
  const status = useApp((s) => s.submodules.status);
  const error = useApp((s) => s.submodules.error);

  const load = useApp((s) => s.loadSubmodules);
  const initSm = useApp((s) => s.initSubmodule);
  const updateSm = useApp((s) => s.updateSubmodule);
  const updateSmRecursive = useApp((s) => s.updateSubmoduleRecursive);
  const syncSm = useApp((s) => s.syncSubmodule);

  useEffect(() => {
    if (repo) void load();
  }, [repo, load]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card px-3 text-xs">
        <Box className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">{entries.length} submodule(s)</span>
        {loading && <span className="text-muted-foreground">· loading...</span>}
        {busy && <span className="text-muted-foreground">· working...</span>}
        {status && <span className="text-[hsl(var(--branch-1))]">· {status}</span>}
      </div>

      {error && (
        <div className="border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {!loading && entries.length === 0 && (
          <div className="p-6 text-center text-xs text-muted-foreground">
            No submodules in this repository.
          </div>
        )}
        {entries.map((sm) => (
          <Row
            key={sm.name}
            sm={sm}
            busy={busy}
            onInit={() => void initSm(sm.name)}
            onUpdate={() => void updateSm(sm.name)}
            onUpdateRecursive={() => void updateSmRecursive(sm.name)}
            onSync={() => void syncSm(sm.name)}
          />
        ))}
      </div>
    </div>
  );
}

function Row({
  sm,
  busy,
  onInit,
  onUpdate,
  onUpdateRecursive,
  onSync,
}: {
  sm: SubmoduleInfo;
  busy: boolean;
  onInit: () => void;
  onUpdate: () => void;
  onUpdateRecursive: () => void;
  onSync: () => void;
}) {
  const status = describe(sm);
  return (
    <div className="border-b border-border/40 px-3 py-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-mono text-foreground">{sm.path}</span>
        <span className={cn("rounded px-1.5 text-[10px] uppercase tracking-wider", status.cls)}>
          {status.label}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {!sm.initialized && (
            <Button
              onClick={onInit}
              disabled={busy}
              variant="secondary"
              size="sm"
              title="Submodule init — write entries from .gitmodules into .git/config"
            >
              <Plug className="h-3 w-3" />
              Init
            </Button>
          )}
          <Button
            onClick={onUpdate}
            disabled={busy}
            variant="default"
            size="sm"
            title="Submodule update — clone (if needed) and check out the recorded commit"
          >
            <Download className="h-3 w-3" />
            Update
          </Button>
          <Button
            onClick={onUpdateRecursive}
            disabled={busy}
            variant="ghost"
            size="icon-sm"
            title="Submodule update --recursive — also descend into the submodule's own submodules"
            aria-label="Update recursively"
          >
            <FolderTree className="h-3.5 w-3.5" />
          </Button>
          <Button
            onClick={onSync}
            disabled={busy}
            variant="secondary"
            size="sm"
            title="Submodule sync — copy URL from .gitmodules to local config"
          >
            <RefreshCw className="h-3 w-3" />
            Sync
          </Button>
        </div>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[10.5px] text-muted-foreground">
        {sm.url && <span title="Configured URL">{sm.url}</span>}
        {sm.head_oid && (
          <span title={`Recorded commit: ${sm.head_oid}`}>recorded: {sm.head_oid.slice(0, 7)}</span>
        )}
        {sm.workdir_oid && (
          <span title={`Working-tree HEAD: ${sm.workdir_oid}`}>
            checked out: {sm.workdir_oid.slice(0, 7)}
          </span>
        )}
      </div>
    </div>
  );
}

function describe(sm: SubmoduleInfo): { label: string; cls: string } {
  if (!sm.workdir_present) {
    return {
      label: "not cloned",
      cls: "bg-secondary text-muted-foreground",
    };
  }
  if (!sm.initialized) {
    return {
      label: "not initialized",
      cls: "bg-secondary text-muted-foreground",
    };
  }
  if (sm.commit_changed) {
    return {
      label: "needs update",
      cls: "bg-[hsl(var(--branch-3)/.18)] text-[hsl(var(--branch-3))]",
    };
  }
  if (sm.wd_dirty) {
    return {
      label: "dirty",
      cls: "bg-[hsl(var(--destructive)/.15)] text-[hsl(var(--destructive))]",
    };
  }
  return {
    label: "clean",
    cls: "bg-[hsl(var(--branch-1)/.18)] text-[hsl(var(--branch-1))]",
  };
}
