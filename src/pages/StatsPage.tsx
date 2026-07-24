import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { startOfMonth } from "date-fns";
import { useApp } from "@/stores/app";
import { useSettings } from "@/stores/settings";
import {
  git,
  type StatsOverview,
  type StatsBranches,
  type StatsChurn,
} from "@/ipc/git";
import { StatsFilterBar } from "@/components/stats/StatsFilterBar";
import type { DateRange } from "@/components/stats/DateRangePicker";
import { SummaryCards } from "@/components/stats/SummaryCards";
import { CommitTrendChart } from "@/components/stats/CommitTrendChart";
import { HeatmapCalendar } from "@/components/stats/HeatmapCalendar";
import { AuthorChart } from "@/components/stats/AuthorChart";
import { AuthorChurnChart } from "@/components/stats/AuthorChurnChart";
import { BranchChart } from "@/components/stats/BranchChart";
import { ChurnChart } from "@/components/stats/ChurnChart";
import { TimeDistribution } from "@/components/stats/TimeDistribution";
import { FileHotspots } from "@/components/stats/FileHotspots";
import { BranchLifecycleTable } from "@/components/stats/BranchLifecycle";
import { AuthorProfileHeader } from "@/components/stats/AuthorProfileHeader";

/** Reusable card wrapper with a title header. */
function ChartCard({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex min-h-0 flex-col rounded-lg border border-border bg-card ${className ?? ""}`}
    >
      <div className="shrink-0 border-b border-border/60 px-3 py-2 text-xs font-medium text-muted-foreground">
        {title}
      </div>
      <div className="min-h-0 flex-1 p-2">{children}</div>
    </div>
  );
}

/** Animated skeleton placeholder for chart areas. */
function ChartSkeleton() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex flex-col items-center gap-2">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
        <span className="text-[11px] text-muted-foreground/60">Loading…</span>
      </div>
    </div>
  );
}

export function StatsPage() {
  const repo = useApp((s) => s.repo);
  const refs = useApp((s) => s.history.refs);
  const headBranch = repo?.head ?? null;
  const mergeAuthorsByName = useSettings((s) => s.mergeAuthorsByName);

  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => ({
    from: startOfMonth(new Date()),
    to: new Date(),
  }));
  const [branch, setBranch] = useState<string | null>(null);
  const [author, setAuthor] = useState<string | null>(null);
  /** Tracks whether the user has manually changed the branch selector. */
  const userTouchedBranch = useRef(false);

  // Three independent data slices with their own loading states.
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [branches, setBranches] = useState<StatsBranches | null>(null);
  const [churn, setChurn] = useState<StatsChurn | null>(null);

  const [loadingOverview, setLoadingOverview] = useState(false);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [loadingChurn, setLoadingChurn] = useState(false);

  // Extract local branch names for the filter dropdown.
  const branchNames = useMemo(
    () =>
      refs
        .filter((r) => r.kind === "local_branch")
        .map((r) => r.name)
        .sort(),
    [refs],
  );

  // Default to the current HEAD branch once refs are loaded.
  useEffect(() => {
    if (userTouchedBranch.current) return;
    if (headBranch && branchNames.includes(headBranch)) {
      setBranch(headBranch);
    }
  }, [branchNames, headBranch]);

  const load = useCallback(async () => {
    if (!repo) return;
    const since = dateRange?.from
      ? Math.floor(dateRange.from.getTime() / 1000)
      : null;
    const until = dateRange?.to
      ? Math.floor(dateRange.to.getTime() / 1000) + 86399
      : null;

    // Reset all states immediately so skeletons show.
    setOverview(null);
    setBranches(null);
    setChurn(null);
    setLoadingOverview(true);
    setLoadingBranches(true);
    setLoadingChurn(true);

    // Fire all 3 requests in parallel — each resolves independently.
    const pOverview = git
      .statsOverview(repo.path, since, until, branch, author, mergeAuthorsByName)
      .then((d) => setOverview(d))
      .catch(() => {})
      .finally(() => setLoadingOverview(false));

    const pBranches = git
      .statsBranches(repo.path, since, until)
      .then((d) => setBranches(d))
      .catch(() => {})
      .finally(() => setLoadingBranches(false));

    const pChurn = git
      .statsChurn(repo.path, since, until, branch, author, mergeAuthorsByName)
      .then((d) => setChurn(d))
      .catch(() => {})
      .finally(() => setLoadingChurn(false));

    await Promise.allSettled([pOverview, pBranches, pChurn]);
  }, [repo, dateRange, branch, author, mergeAuthorsByName]);

  useEffect(() => {
    void load();
  }, [load]);

  // Derive author info and active days for the profile view.
  const selectedAuthorInfo = useMemo(() => {
    if (!author || !overview) return null;
    if (mergeAuthorsByName) {
      // Filter is by name; match case-insensitively.
      const authorLower = author.toLowerCase();
      return overview.authors.find((a) => a.name.toLowerCase() === authorLower) ?? null;
    }
    return overview.authors.find((a) => a.email === author) ?? null;
  }, [author, overview, mergeAuthorsByName]);

  const activeDays = useMemo(() => {
    if (!overview) return undefined;
    return overview.heatmap.filter((d) => d.count > 0).length;
  }, [overview]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <StatsFilterBar
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        branch={branch}
        onBranchChange={(b) => {
          userTouchedBranch.current = true;
          setBranch(b);
        }}
        branches={branchNames}
        author={author}
        onAuthorChange={setAuthor}
        authors={overview?.authors ?? []}
        mergeByName={mergeAuthorsByName}
      />

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {author ? (
          <>
            {/* === Author Profile View === */}
            {selectedAuthorInfo && (
              <AuthorProfileHeader
                name={selectedAuthorInfo.name}
                email={selectedAuthorInfo.email}
              />
            )}
            <SummaryCards
              overview={overview}
              churn={churn}
              loadingOverview={loadingOverview}
              loadingChurn={loadingChurn}
              authorMode
              activeDays={activeDays}
            />
            <div className="grid grid-cols-2 gap-3 px-4 pt-2">
              <ChartCard title="Commit Trend" className="h-64">
                {loadingOverview ? (
                  <ChartSkeleton />
                ) : overview ? (
                  <CommitTrendChart data={overview.timeline} />
                ) : null}
              </ChartCard>
              <ChartCard title="Activity Heatmap" className="h-64">
                {loadingOverview ? (
                  <ChartSkeleton />
                ) : overview ? (
                  <HeatmapCalendar data={overview.heatmap} />
                ) : null}
              </ChartCard>
              <ChartCard title="Code Churn" className="h-64">
                {loadingChurn ? (
                  <ChartSkeleton />
                ) : churn ? (
                  <ChurnChart data={churn.churn} />
                ) : null}
              </ChartCard>
              <ChartCard title="Commit Timing" className="h-64">
                {loadingOverview ? (
                  <ChartSkeleton />
                ) : overview ? (
                  <TimeDistribution
                    hourDist={overview.hour_distribution}
                    weekdayDist={overview.weekday_distribution}
                  />
                ) : null}
              </ChartCard>
              <ChartCard title="File Hotspots (Top 15)" className="col-span-2 h-64">
                {loadingChurn ? (
                  <ChartSkeleton />
                ) : churn ? (
                  <FileHotspots data={churn.file_hotspots} />
                ) : null}
              </ChartCard>
            </div>
          </>
        ) : (
          <>
            {/* === Repository Overview === */}
            <SummaryCards
              overview={overview}
              churn={churn}
              loadingOverview={loadingOverview}
              loadingChurn={loadingChurn}
            />
            <div className="grid grid-cols-2 gap-3 px-4 pt-2">
              <ChartCard title="Commit Trend" className="h-64">
                {loadingOverview ? (
                  <ChartSkeleton />
                ) : overview ? (
                  <CommitTrendChart data={overview.timeline} />
                ) : null}
              </ChartCard>
              <ChartCard title="Activity Heatmap" className="h-64">
                {loadingOverview ? (
                  <ChartSkeleton />
                ) : overview ? (
                  <HeatmapCalendar data={overview.heatmap} />
                ) : null}
              </ChartCard>
              <ChartCard title="Top Contributors" className="h-64">
                {loadingOverview ? (
                  <ChartSkeleton />
                ) : overview ? (
                  <AuthorChart data={overview.authors} />
                ) : null}
              </ChartCard>
              <ChartCard title="Branch Activity" className="h-64">
                {loadingBranches ? (
                  <ChartSkeleton />
                ) : branches ? (
                  <BranchChart data={branches.branches} />
                ) : null}
              </ChartCard>
              <ChartCard title="Code Churn" className="h-64">
                {loadingChurn ? (
                  <ChartSkeleton />
                ) : churn ? (
                  <ChurnChart data={churn.churn} />
                ) : null}
              </ChartCard>
              <ChartCard title="Commit Timing" className="h-64">
                {loadingOverview ? (
                  <ChartSkeleton />
                ) : overview ? (
                  <TimeDistribution
                    hourDist={overview.hour_distribution}
                    weekdayDist={overview.weekday_distribution}
                  />
                ) : null}
              </ChartCard>
              <ChartCard title="File Hotspots (Top 15)" className="h-64">
                {loadingChurn ? (
                  <ChartSkeleton />
                ) : churn ? (
                  <FileHotspots data={churn.file_hotspots} />
                ) : null}
              </ChartCard>
              <ChartCard title="Branch Lifecycle" className="h-64">
                {loadingBranches ? (
                  <ChartSkeleton />
                ) : branches ? (
                  <BranchLifecycleTable data={branches.branch_lifecycle} />
                ) : null}
              </ChartCard>
              <ChartCard title="Author Code Churn" className="col-span-2">
                {loadingChurn ? (
                  <ChartSkeleton />
                ) : churn && overview ? (
                  <AuthorChurnChart data={churn.author_churn} authors={overview.authors} mergeByName={mergeAuthorsByName} />
                ) : null}
              </ChartCard>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
