import { useMemo } from "react";
import { useApp } from "@/stores/app";
import { cn } from "@/lib/utils";
import type { FileChange } from "@/ipc/git";

const STATUS_LABEL: Record<FileChange["status"], string> = {
  added: "A",
  deleted: "D",
  modified: "M",
  renamed: "R",
  copied: "C",
  typechange: "T",
};

const STATUS_COLOR: Record<FileChange["status"], string> = {
  added: "text-[hsl(var(--diff-added-fg))]",
  deleted: "text-[hsl(var(--diff-removed-fg))]",
  modified: "text-[hsl(var(--diff-modified-fg))]",
  renamed: "text-[hsl(var(--branch-2))]",
  copied: "text-[hsl(var(--branch-2))]",
  typechange: "text-[hsl(var(--branch-3))]",
};

interface Group {
  dir: string;
  items: FileChange[];
}

function groupByDir(files: FileChange[]): Group[] {
  const map = new Map<string, FileChange[]>();
  for (const f of files) {
    const slash = f.path.lastIndexOf("/");
    const dir = slash === -1 ? "/" : f.path.slice(0, slash);
    if (!map.has(dir)) map.set(dir, []);
    map.get(dir)!.push(f);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, items]) => ({ dir, items }));
}

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

export function FileTree() {
  const files = useApp((s) => s.diff.files);
  const selected = useApp((s) => s.diff.selectedFile);
  const selectFile = useApp((s) => s.selectDiffFile);

  const groups = useMemo(() => groupByDir(files), [files]);

  return (
    <aside className="flex h-full flex-col overflow-hidden bg-card">
      <div className="border-b border-border px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        Changed files {files.length > 0 && `(${files.length})`}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {groups.map(({ dir, items }) => (
          <div key={dir}>
            <div className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-muted-foreground">
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
              {dir}
            </div>
            {items.map((f) => {
              const active = f.path === selected;
              return (
                <div
                  key={`${f.old_path ?? ""}->${f.path}`}
                  onClick={() => selectFile(f.path)}
                  className={cn(
                    "grid cursor-pointer items-center gap-1.5 px-3 py-1 text-xs hover:bg-accent/50",
                    active && "bg-accent",
                  )}
                  style={{ gridTemplateColumns: "14px 1fr auto" }}
                >
                  <span
                    className={cn(
                      "text-center font-mono text-[11px] font-bold",
                      STATUS_COLOR[f.status],
                    )}
                  >
                    {STATUS_LABEL[f.status]}
                  </span>
                  <span className="truncate font-mono">{basename(f.path)}</span>
                  <span className="font-mono text-[10.5px] text-muted-foreground">
                    {f.insertions > 0 && (
                      <span className="text-[hsl(var(--diff-added-fg))]">+{f.insertions}</span>
                    )}
                    {f.insertions > 0 && f.deletions > 0 && " "}
                    {f.deletions > 0 && (
                      <span className="text-[hsl(var(--diff-removed-fg))]">-{f.deletions}</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
        {files.length === 0 && (
          <div className="p-4 text-xs text-muted-foreground">No file changes.</div>
        )}
      </div>
    </aside>
  );
}
