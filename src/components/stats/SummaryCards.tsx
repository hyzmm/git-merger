import { GitCommitHorizontal, Users, Plus, Minus, GitBranch, CalendarDays } from "lucide-react";
import type { StatsOverview, StatsChurn } from "@/ipc/git";

function formatNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

interface Props {
  overview: StatsOverview | null;
  churn: StatsChurn | null;
  loadingOverview: boolean;
  loadingChurn: boolean;
  authorMode?: boolean;
  activeDays?: number;
}

export function SummaryCards({ overview, churn, loadingOverview, loadingChurn, authorMode, activeDays }: Props) {
  const cards = authorMode
    ? [
        {
          key: "commits",
          label: "Commits",
          Icon: GitCommitHorizontal,
          color: "text-blue-400",
          bg: "bg-blue-400/10",
          value: overview?.total_commits ?? null,
          loading: loadingOverview,
        },
        {
          key: "insertions",
          label: "Insertions",
          Icon: Plus,
          color: "text-green-400",
          bg: "bg-green-400/10",
          value: churn?.total_insertions ?? null,
          loading: loadingChurn,
        },
        {
          key: "deletions",
          label: "Deletions",
          Icon: Minus,
          color: "text-red-400",
          bg: "bg-red-400/10",
          value: churn?.total_deletions ?? null,
          loading: loadingChurn,
        },
        {
          key: "activeDays",
          label: "Active Days",
          Icon: CalendarDays,
          color: "text-amber-400",
          bg: "bg-amber-400/10",
          value: activeDays ?? null,
          loading: loadingOverview,
        },
      ]
    : [
        {
          key: "commits",
          label: "Commits",
          Icon: GitCommitHorizontal,
          color: "text-blue-400",
          bg: "bg-blue-400/10",
          value: overview?.total_commits ?? null,
          loading: loadingOverview,
        },
        {
          key: "authors",
          label: "Contributors",
          Icon: Users,
          color: "text-purple-400",
          bg: "bg-purple-400/10",
          value: overview?.total_authors ?? null,
          loading: loadingOverview,
        },
        {
          key: "insertions",
          label: "Insertions",
          Icon: Plus,
          color: "text-green-400",
          bg: "bg-green-400/10",
          value: churn?.total_insertions ?? null,
          loading: loadingChurn,
        },
        {
          key: "deletions",
          label: "Deletions",
          Icon: Minus,
          color: "text-red-400",
          bg: "bg-red-400/10",
          value: churn?.total_deletions ?? null,
          loading: loadingChurn,
        },
        {
          key: "branches",
          label: "Branches",
          Icon: GitBranch,
          color: "text-amber-400",
          bg: "bg-amber-400/10",
          value: overview?.active_branches ?? null,
          loading: loadingOverview,
        },
      ];

  return (
    <div className={`grid gap-3 px-4 py-2 ${authorMode ? "grid-cols-4" : "grid-cols-5"}`}>
      {cards.map(({ key, label, Icon, color, bg, value, loading }) => (
        <div
          key={key}
          className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
        >
          <div className={`flex h-9 w-9 items-center justify-center rounded-md ${bg}`}>
            <Icon className={`h-4.5 w-4.5 ${color}`} />
          </div>
          <div className="min-w-0">
            <div className="text-lg font-semibold leading-tight text-foreground">
              {value != null ? (
                formatNum(value)
              ) : loading ? (
                <span className="inline-block h-5 w-10 animate-pulse rounded bg-muted-foreground/20" />
              ) : (
                "—"
              )}
            </div>
            <div className="text-[11px] text-muted-foreground">{label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
