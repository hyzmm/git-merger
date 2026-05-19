import { useMemo } from "react";
import { useApp } from "@/stores/app";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<string, string> = {
  local_branch: "Local",
  remote_branch: "Remote",
  tag: "Tags",
};

const HUE_VARS = [
  "var(--branch-1)",
  "var(--branch-2)",
  "var(--branch-3)",
  "var(--branch-4)",
  "var(--branch-5)",
];

function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return HUE_VARS[Math.abs(h) % HUE_VARS.length];
}

export function RefsPane() {
  const refs = useApp((s) => s.history.refs);
  const filter = useApp((s) => s.history.filter);
  const setFilter = useApp((s) => s.setFilter);

  const grouped = useMemo(() => {
    const g: Record<string, typeof refs> = {
      local_branch: [],
      remote_branch: [],
      tag: [],
    };
    for (const r of refs) g[r.kind]?.push(r);
    return g;
  }, [refs]);

  return (
    <aside className="flex h-full flex-col overflow-hidden bg-card">
      <div className="border-b border-border p-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter commits..."
          className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-ring"
        />
      </div>
      <div className="flex-1 overflow-auto">
        {(["local_branch", "remote_branch", "tag"] as const).map((kind) => {
          const list = grouped[kind] ?? [];
          if (list.length === 0) return null;
          return (
            <div key={kind}>
              <div className="px-3 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                {KIND_LABEL[kind]}
              </div>
              {list.map((r) => {
                const color = colorFor(r.name);
                return (
                  <div
                    key={`${kind}:${r.name}`}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 px-3 py-1 text-xs",
                      "hover:bg-accent/50",
                      r.is_head && "bg-accent",
                    )}
                    style={r.is_head ? { borderLeft: `2px solid hsl(${color})` } : undefined}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: `hsl(${color})` }}
                    />
                    <span className="flex-1 truncate font-mono">{r.name}</span>
                    {r.is_head && (
                      <span className="text-[10px] uppercase text-muted-foreground">HEAD</span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
        {refs.length === 0 && <div className="p-6 text-xs text-muted-foreground">No refs.</div>}
      </div>
    </aside>
  );
}
