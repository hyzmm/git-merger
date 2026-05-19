import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, X } from "lucide-react";
import { useApp } from "@/stores/app";

export function WelcomePage() {
  const openRepo = useApp((s) => s.openRepo);
  const recent = useApp((s) => s.recentRepos);
  const removeRecent = useApp((s) => s.removeRecentRepo);

  async function pick() {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") await openRepo(dir);
  }

  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="grid w-full max-w-3xl grid-cols-1 gap-8 md:grid-cols-[1fr_1fr]">
        {/* Welcome card */}
        <div className="flex flex-col items-start gap-4">
          <h1 className="text-2xl font-semibold">Git Tools</h1>
          <p className="text-sm text-muted-foreground">
            IDEA-style History, Diff and Merge for any local Git repository.
          </p>
          <button
            onClick={pick}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <FolderOpen className="h-4 w-4" />
            Open Repository
          </button>
          <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
            <ShortcutLine combo="Ctrl+1 / 2 / 3" desc="Switch History / Diff / Merge" />
            <ShortcutLine combo="F5 or Ctrl+R" desc="Refresh current view" />
            <ShortcutLine combo="F7 / Shift+F7" desc="Next / previous conflict (Merge view)" />
            <ShortcutLine combo="Alt+1 / 2 / 3" desc="Accept Left / Right / Both" />
          </div>
        </div>

        {/* Recent repos */}
        <div className="min-w-0">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Recent
          </h2>
          {recent.length === 0 && (
            <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              No recent repositories yet.
            </div>
          )}
          <div className="flex flex-col gap-1">
            {recent.map((r) => (
              <div
                key={r.path}
                className="group flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 hover:border-border hover:bg-accent/40"
              >
                <button
                  onClick={() => openRepo(r.path)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-mono">{basename(r.path)}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{r.path}</div>
                  </div>
                </button>
                <button
                  onClick={() => removeRecent(r.path)}
                  className="invisible h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent group-hover:inline-flex"
                  title="Remove from list"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ShortcutLine({ combo, desc }: { combo: string; desc: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px]">
        {combo}
      </span>
      <span>{desc}</span>
    </div>
  );
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i === -1 ? p : p.slice(i + 1);
}
