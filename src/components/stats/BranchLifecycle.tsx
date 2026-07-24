import type { BranchLifecycle } from "@/ipc/git";
import { cn } from "@/lib/utils";

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / (86400 * 30))}mo ago`;
}

export function BranchLifecycleTable({ data }: { data: BranchLifecycle[] }) {
  if (!data.length) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        No data
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto px-2 py-1">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="pb-1.5 font-medium">Branch</th>
            <th className="pb-1.5 text-right font-medium">Commits</th>
            <th className="pb-1.5 text-right font-medium">Ahead</th>
            <th className="pb-1.5 text-right font-medium">Last Active</th>
            <th className="pb-1.5 text-center font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {data.slice(0, 20).map((b) => (
            <tr key={b.name} className="border-b border-border/40 last:border-0">
              <td
                className="max-w-[140px] truncate py-1.5 pr-2 text-foreground"
                title={b.name}
              >
                {b.name}
              </td>
              <td className="py-1.5 text-right tabular-nums text-foreground">
                {b.commit_count}
              </td>
              <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                +{b.ahead_of_main}
              </td>
              <td className="py-1.5 text-right text-muted-foreground">
                {b.last_commit ? timeAgo(b.last_commit) : "—"}
              </td>
              <td className="py-1.5 text-center">
                <span
                  className={cn(
                    "inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                    b.merged
                      ? "bg-green-400/10 text-green-400"
                      : "bg-amber-400/10 text-amber-400",
                  )}
                >
                  {b.merged ? "merged" : "active"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
