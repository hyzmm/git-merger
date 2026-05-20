import { useMemo, useState } from "react";
import { useApp } from "@/stores/app";
import { fullDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { ContextMenu, type ContextMenuPos, type MenuItem } from "@/components/ContextMenu";
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

export function CommitDetails() {
  const commit = useApp((s) => {
    const oid = s.history.selectedOid;
    return s.history.commits.find((c) => c.oid === oid) ?? null;
  });
  const files = useApp((s) => s.history.files);
  const filesLoading = useApp((s) => s.history.filesLoading);
  const openDiff = useApp((s) => s.openDiff);
  const openBlame = useApp((s) => s.openBlame);
  const openFileHistory = useApp((s) => s.openFileHistory);

  const [menu, setMenu] = useState<{ pos: ContextMenuPos; items: MenuItem[] } | null>(null);

  const fullMessage = useMemo(() => commit?.summary ?? "", [commit]);

  if (!commit) {
    return (
      <aside className="flex h-full items-center justify-center border-l border-border bg-card text-xs text-muted-foreground">
        Select a commit
      </aside>
    );
  }

  return (
    <aside className="flex h-full min-w-0 flex-col border-l border-border bg-card">
      <div className="border-b border-border p-3.5">
        <div className="mb-2 text-[13.5px] font-semibold leading-snug">{commit.summary}</div>
        <div className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-1 text-xs">
          <span className="text-muted-foreground">Commit</span>
          <span className="break-all font-mono text-[11.5px]">{commit.oid}</span>

          <span className="text-muted-foreground">Parents</span>
          <span className="font-mono text-[11.5px]">
            {commit.parents.map((p) => p.slice(0, 7)).join(" ") || "(root)"}
          </span>

          <span className="text-muted-foreground">Author</span>
          <span className="font-mono text-[11.5px]">
            {commit.author_name}
            {commit.author_email && ` <${commit.author_email}>`}
          </span>

          <span className="text-muted-foreground">Date</span>
          <span className="text-[11.5px]">{fullDate(commit.time)}</span>

          {commit.refs.length > 0 && (
            <>
              <span className="text-muted-foreground">Refs</span>
              <span className="flex flex-wrap gap-1">
                {commit.refs.map((r) => (
                  <span
                    key={r}
                    className="inline-flex h-[18px] items-center rounded-full border border-border bg-secondary px-2 text-[10.5px]"
                  >
                    {r}
                  </span>
                ))}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="px-3.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          Changed files {files.length > 0 && `(${files.length})`}
        </div>
        {filesLoading && (
          <div className="px-3.5 py-2 text-xs text-muted-foreground">Loading...</div>
        )}
        {!filesLoading &&
          files.map((f) => (
            <div
              key={`${f.old_path ?? ""}->${f.path}`}
              onClick={() => commit && openDiff(commit.oid, f.path, files)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!commit) return;
                const items: MenuItem[] = [
                  {
                    label: "Open diff at this commit",
                    onClick: () => openDiff(commit.oid, f.path, files),
                  },
                  {
                    label: "Show file history (follows renames)",
                    onClick: () => void openFileHistory(f.path),
                  },
                  {
                    label: "Blame current version",
                    onClick: () => void openBlame(f.path),
                  },
                  { separator: true, label: "" },
                  {
                    label: `Copy path (${f.path.split("/").pop()})`,
                    onClick: () => void navigator.clipboard.writeText(f.path).catch(() => {}),
                  },
                ];
                setMenu({ pos: { x: e.clientX, y: e.clientY }, items });
              }}
              className="flex cursor-pointer items-center gap-2 px-3.5 py-1 hover:bg-accent/50"
            >
              <span
                className={cn(
                  "w-3.5 text-center font-mono text-[11px] font-bold",
                  STATUS_COLOR[f.status],
                )}
              >
                {STATUS_LABEL[f.status]}
              </span>
              <span className="flex-1 truncate font-mono text-xs">
                {f.old_path && f.old_path !== f.path ? `${f.old_path} → ${f.path}` : f.path}
              </span>
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
          ))}
        {!filesLoading && files.length === 0 && (
          <div className="px-3.5 py-2 text-xs text-muted-foreground">No file changes.</div>
        )}

        <div className="px-3.5 pb-1 pt-4 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          Message
        </div>
        <pre className="whitespace-pre-wrap px-3.5 pb-4 font-mono text-[11.5px] text-muted-foreground">
          {fullMessage}
        </pre>
      </div>
      <ContextMenu
        pos={menu?.pos ?? null}
        items={menu?.items ?? []}
        onClose={() => setMenu(null)}
      />
    </aside>
  );
}
