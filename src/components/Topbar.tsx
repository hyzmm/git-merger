import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, GitBranch, RefreshCw } from "lucide-react";
import { useApp } from "@/stores/app";
import { cn } from "@/lib/utils";

export function Topbar() {
  const { repo, openRepo, loading, error } = useApp();
  const refresh = useApp((s) => s.refresh);

  async function pickRepo() {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") await openRepo(dir);
  }

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
      <button
        onClick={pickRepo}
        className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-secondary px-3 text-sm text-secondary-foreground hover:bg-accent"
      >
        <FolderOpen className="h-4 w-4" />
        Open Repository
      </button>
      {repo && (
        <>
          <button
            onClick={() => refresh()}
            disabled={loading}
            title="Refresh (F5)"
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              loading && "animate-spin",
            )}
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <GitBranch className="h-4 w-4" />
            <span className="font-mono">{repo.head ?? "detached"}</span>
            <span className="text-xs opacity-70">{repo.path}</span>
          </div>
        </>
      )}
      <div className="ml-auto text-xs text-muted-foreground">
        {loading && "Loading..."}
        {error && <span className="text-destructive">{error}</span>}
      </div>
    </header>
  );
}
