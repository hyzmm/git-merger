import type { FileHotspot } from "@/ipc/git";

function formatNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

export function FileHotspots({ data }: { data: FileHotspot[] }) {
  if (!data.length) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        No data
      </div>
    );
  }

  const maxCount = Math.max(...data.map((f) => f.change_count), 1);

  return (
    <div className="h-full overflow-auto px-2 py-1">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="pb-1.5 font-medium">File</th>
            <th className="pb-1.5 text-right font-medium">Changes</th>
            <th className="pb-1.5 text-right font-medium">Churn</th>
            <th className="w-24 pb-1.5 pl-3 font-medium">Freq</th>
          </tr>
        </thead>
        <tbody>
          {data.map((f) => (
            <tr key={f.path} className="border-b border-border/40 last:border-0">
              <td
                className="max-w-[180px] truncate py-1.5 pr-2 text-foreground"
                title={f.path}
              >
                {f.path.split("/").pop() ?? f.path}
              </td>
              <td className="py-1.5 text-right tabular-nums text-foreground">
                {f.change_count}
              </td>
              <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                {formatNum(f.total_churn)}
              </td>
              <td className="py-1.5 pl-3">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-400"
                    style={{ width: `${(f.change_count / maxCount) * 100}%` }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
