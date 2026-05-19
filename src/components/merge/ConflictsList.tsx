import { useApp } from "@/stores/app";
import { cn } from "@/lib/utils";

export function ConflictsList() {
  const conflicts = useApp((s) => s.merge.conflicts);
  const selected = useApp((s) => s.merge.selectedFile);
  const resolvedFiles = useApp((s) => s.merge.resolvedFiles);
  const select = useApp((s) => s.selectConflict);

  const pending = conflicts.filter((c) => !resolvedFiles.has(c.path));
  const resolved = conflicts.filter((c) => resolvedFiles.has(c.path));

  return (
    <aside className="flex h-full flex-col overflow-hidden bg-card">
      <div className="border-b border-border px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        Conflicts ({resolvedFiles.size}/{conflicts.length} resolved)
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {resolved.length > 0 && (
          <>
            <div className="px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              Resolved
            </div>
            {resolved.map((c) => (
              <Row
                key={c.path}
                path={c.path}
                resolved
                active={c.path === selected}
                onClick={() => select(c.path)}
              />
            ))}
          </>
        )}
        {pending.length > 0 && (
          <>
            <div className="px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              Pending
            </div>
            {pending.map((c) => (
              <Row
                key={c.path}
                path={c.path}
                resolved={false}
                active={c.path === selected}
                onClick={() => select(c.path)}
              />
            ))}
          </>
        )}
        {conflicts.length === 0 && (
          <div className="p-4 text-xs text-muted-foreground">No merge conflicts.</div>
        )}
      </div>
    </aside>
  );
}

function Row({
  path,
  resolved,
  active,
  onClick,
}: {
  path: string;
  resolved: boolean;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "cursor-pointer border-l-2 border-transparent px-3 py-1.5 text-xs hover:bg-accent/50",
        active && "border-l-[hsl(var(--destructive))] bg-accent",
        resolved && "opacity-60",
      )}
    >
      <div className="truncate font-mono">
        {resolved && <span className="text-[hsl(var(--diff-added-fg))]">✓ </span>}
        {path}
      </div>
    </div>
  );
}
