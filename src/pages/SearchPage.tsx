import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowRight,
  ChevronDown,
  FileText,
  Hash,
  History as HistoryIcon,
  Loader2,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useApp } from "@/stores/app";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/time";
import type { DiffHit, SearchHit } from "@/ipc/git";
import {
  aggregateByFile,
  uniqueCommitCount,
  type FileGroup,
  type FileGroupCommit,
} from "@/lib/searchAggregate";
import type { SavedSearch, SearchSnapshot } from "@/lib/searchPersist";

export function SearchPage() {
  const t = useT();

  const query = useApp((s) => s.search.query);
  const mode = useApp((s) => s.search.mode);
  const patternKind = useApp((s) => s.search.patternKind);
  const caseSensitive = useApp((s) => s.search.caseSensitive);
  const pathspec = useApp((s) => s.search.pathspec);
  const hits = useApp((s) => s.search.hits);
  const selectedOid = useApp((s) => s.search.selectedOid);
  const scanned = useApp((s) => s.search.scanned);
  const truncated = useApp((s) => s.search.truncated);
  const busy = useApp((s) => s.search.busy);
  const appliedQuery = useApp((s) => s.search.appliedQuery);
  const error = useApp((s) => s.search.error);
  const groupBy = useApp((s) => s.search.groupBy);
  const recents = useApp((s) => s.search.recents);
  const saved = useApp((s) => s.search.saved);

  const setSearchQuery = useApp((s) => s.setSearchQuery);
  const setSearchMode = useApp((s) => s.setSearchMode);
  const setSearchPatternKind = useApp((s) => s.setSearchPatternKind);
  const toggleSearchCase = useApp((s) => s.toggleSearchCase);
  const setSearchPathspec = useApp((s) => s.setSearchPathspec);
  const selectSearchHit = useApp((s) => s.selectSearchHit);
  const runSearch = useApp((s) => s.runSearch);
  const clearSearch = useApp((s) => s.clearSearch);
  const setSearchGroupBy = useApp((s) => s.setSearchGroupBy);
  const applySearchSnapshot = useApp((s) => s.applySearchSnapshot);
  const saveCurrentSearch = useApp((s) => s.saveCurrentSearch);
  const deleteSavedSearch = useApp((s) => s.deleteSavedSearch);
  const clearSearchRecents = useApp((s) => s.clearSearchRecents);
  const selectCommit = useApp((s) => s.selectCommit);
  const setView = useApp((s) => s.setView);

  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const [recentsOpen, setRecentsOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);

  // Close pop-overs on outside-click. Single shared listener for both.
  const recentsAnchorRef = useRef<HTMLDivElement>(null);
  const savedAnchorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!recentsOpen && !savedOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (recentsOpen && recentsAnchorRef.current && !recentsAnchorRef.current.contains(target)) {
        setRecentsOpen(false);
      }
      if (savedOpen && savedAnchorRef.current && !savedAnchorRef.current.contains(target)) {
        setSavedOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [recentsOpen, savedOpen]);

  const submitOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void runSearch();
    } else if (e.key === "Escape" && query) {
      e.preventDefault();
      clearSearch();
    }
  };

  const selected = hits.find((h) => h.oid === selectedOid) ?? null;
  const fileGroups = useMemo(() => aggregateByFile(hits), [hits]);
  const filesUniqueCommits = useMemo(() => uniqueCommitCount(fileGroups), [fileGroups]);

  const onApplySnapshot = (snap: SearchSnapshot, runImmediately: boolean) => {
    applySearchSnapshot(snap);
    setRecentsOpen(false);
    setSavedOpen(false);
    if (runImmediately) void runSearch();
  };

  const onSaveCurrent = () => {
    const proposed = window.prompt(t("search.savePrompt"), "");
    if (proposed === null) return;
    const name = proposed.trim();
    if (!name) return;
    saveCurrentSearch(name);
  };

  const jumpToHistory = (oid: string) => {
    setView("history");
    void selectCommit(oid);
  };

  return (
    <div className="grid h-full grid-cols-[1fr_440px]">
      <section className="flex min-h-0 min-w-0 flex-col border-r border-border">
        {/* ---------- Toolbar ---------- */}
        <div className="flex shrink-0 flex-col gap-2 border-b border-border bg-card p-3">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="relative flex-1" ref={recentsAnchorRef}>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={submitOnEnter}
                placeholder={t("search.placeholder")}
                className="h-8 w-full rounded border border-border bg-background pl-2 pr-8 font-mono text-[12.5px] outline-none focus:border-primary"
              />
              {recents.length > 0 && (
                <button
                  type="button"
                  onClick={() => setRecentsOpen((v) => !v)}
                  title={t("search.recents")}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <HistoryIcon className="h-3.5 w-3.5" />
                </button>
              )}
              {recentsOpen && (
                <RecentsPanel
                  recents={recents}
                  onPick={(snap, run) => onApplySnapshot(snap, run)}
                  onClear={() => {
                    clearSearchRecents();
                    setRecentsOpen(false);
                  }}
                  t={t}
                />
              )}
            </div>
            {query && (
              <button
                type="button"
                onClick={clearSearch}
                title={t("search.clear")}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => void runSearch()}
              disabled={busy || !query.trim()}
              className={cn(
                "h-8 rounded bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              {busy ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("search.searching")}
                </span>
              ) : (
                t("search.run")
              )}
            </button>
          </div>

          {/* Options row */}
          <div className="flex flex-wrap items-center gap-3 text-[11.5px]">
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">{t("search.mode")}:</span>
              {(["both", "message", "diff"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setSearchMode(m)}
                  className={cn(
                    "rounded border px-2 py-0.5",
                    mode === m
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-accent",
                  )}
                >
                  {t(`search.mode.${m}` as never)}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">{t("search.kind")}:</span>
              {(["literal", "regex"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSearchPatternKind(k)}
                  className={cn(
                    "rounded border px-2 py-0.5",
                    patternKind === k
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-accent",
                  )}
                >
                  {t(`search.kind.${k}` as never)}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={toggleSearchCase}
              title={t("search.caseTitle")}
              className={cn(
                "rounded border px-2 py-0.5",
                caseSensitive
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              Aa
            </button>

            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">{t("search.path")}:</span>
              <input
                type="text"
                value={pathspec}
                onChange={(e) => setSearchPathspec(e.target.value)}
                placeholder={t("search.pathPlaceholder")}
                className="h-6 w-44 rounded border border-border bg-background px-1.5 font-mono text-[11px] outline-none focus:border-primary"
              />
            </div>

            {/* v0.13.4 — Group-by toggle */}
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">{t("search.groupBy")}:</span>
              {(["commit", "file"] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setSearchGroupBy(g)}
                  className={cn(
                    "rounded border px-2 py-0.5",
                    groupBy === g
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-accent",
                  )}
                >
                  {t(`search.groupBy.${g}` as never)}
                </button>
              ))}
            </div>

            {/* v0.13.4 — Save / Saved-searches dropdown */}
            <div className="ml-auto flex items-center gap-1" ref={savedAnchorRef}>
              <button
                type="button"
                onClick={onSaveCurrent}
                disabled={!query.trim()}
                title={t("search.saveCurrentTitle")}
                className={cn(
                  "rounded border border-border px-2 py-0.5 text-muted-foreground hover:bg-accent",
                  !query.trim() && "cursor-not-allowed opacity-50",
                )}
              >
                <span className="inline-flex items-center gap-1">
                  <Star className="h-3 w-3" />
                  {t("search.save")}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setSavedOpen((v) => !v)}
                title={t("search.savedTitle")}
                className={cn(
                  "rounded border border-border px-1.5 py-0.5 text-muted-foreground hover:bg-accent",
                )}
              >
                <span className="inline-flex items-center gap-1">
                  {saved.length > 0 ? saved.length : 0}
                  <ChevronDown className="h-3 w-3" />
                </span>
              </button>
              {savedOpen && (
                <SavedPanel
                  saved={saved}
                  onApply={(snap) => onApplySnapshot(snap, true)}
                  onDelete={(name) => deleteSavedSearch(name)}
                  t={t}
                />
              )}
            </div>
          </div>
        </div>

        {/* ---------- Status row ---------- */}
        <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border bg-card/50 px-3 text-[11px]">
          {error ? (
            <span className="text-destructive">⚠ {error}</span>
          ) : appliedQuery ? (
            <>
              <span className="text-muted-foreground">
                {groupBy === "file"
                  ? t("search.foundFiles", {
                      files: fileGroups.length,
                      commits: filesUniqueCommits,
                    })
                  : t("search.found", { n: hits.length })}
              </span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">{t("search.scanned", { n: scanned })}</span>
              {truncated && (
                <span className="rounded bg-amber-500/15 px-1.5 text-[10px] text-amber-600 dark:text-amber-300">
                  {t("search.truncated")}
                </span>
              )}
              <span className="ml-auto truncate font-mono text-[10.5px] text-muted-foreground">
                "{appliedQuery}"
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">{t("search.idle")}</span>
          )}
        </div>

        {/* ---------- Results list ---------- */}
        <div className="min-h-0 flex-1 overflow-auto">
          {hits.length === 0 ? (
            <div className="flex h-full items-center justify-center p-8 text-center text-xs text-muted-foreground">
              {appliedQuery && !busy ? t("search.empty") : t("search.hint")}
            </div>
          ) : groupBy === "file" ? (
            <FileRollup
              groups={fileGroups}
              selectedOid={selectedOid}
              onPick={selectSearchHit}
              t={t}
            />
          ) : (
            <ul className="divide-y divide-border/40">
              {hits.map((h) => (
                <ResultRow
                  key={h.oid}
                  hit={h}
                  selected={h.oid === selectedOid}
                  onClick={() => selectSearchHit(h.oid)}
                />
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ---------- Right preview ---------- */}
      <aside className="flex min-h-0 min-w-0 flex-col bg-secondary/30">
        {selected ? (
          <>
            <div className="flex shrink-0 items-start justify-between gap-2 border-b border-border bg-card p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[11px]">
                  <Hash className="h-3 w-3 text-muted-foreground" />
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {selected.short_oid}
                  </span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">{selected.author_name}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">{timeAgo(selected.time)}</span>
                </div>
                <div className="mt-1 break-words text-sm text-foreground">{selected.summary}</div>
              </div>
              <button
                type="button"
                onClick={() => jumpToHistory(selected.oid)}
                title={t("search.openInHistory")}
                className="inline-flex shrink-0 items-center gap-1 rounded border border-border bg-background px-2 py-1 text-[11px] hover:bg-accent"
              >
                {t("search.open")}
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-2 text-[11.5px]">
              {selected.message_match && (
                <div className="mb-2 rounded border border-primary/40 bg-primary/5 p-2 text-[11.5px] text-foreground">
                  <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wide text-primary">
                    <FileText className="h-3 w-3" />
                    {t("search.messageMatch")}
                  </div>
                  <div className="whitespace-pre-wrap break-words font-mono">
                    {selected.summary}
                  </div>
                </div>
              )}
              {selected.diff_hits.length === 0 ? (
                !selected.message_match && (
                  <div className="p-4 text-center text-xs text-muted-foreground">
                    {t("search.noDiffHits")}
                  </div>
                )
              ) : (
                <DiffHitsList hits={selected.diff_hits} />
              )}
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
            {t("search.previewHint")}
          </div>
        )}
      </aside>
    </div>
  );
}

// ---------- Sub-components ----------

function ResultRow({
  hit,
  selected,
  onClick,
}: {
  hit: SearchHit;
  selected: boolean;
  onClick: () => void;
}) {
  const totalDiffHits = hit.diff_hits.length;
  return (
    <li
      onClick={onClick}
      className={cn("cursor-pointer px-3 py-2 hover:bg-accent/40", selected && "bg-accent")}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[11px] text-muted-foreground">{hit.short_oid}</span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">{hit.summary}</span>
        <span className="shrink-0 text-[10.5px] text-muted-foreground">{timeAgo(hit.time)}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10.5px]">
        <span className="text-muted-foreground">{hit.author_name}</span>
        {hit.message_match && (
          <span className="rounded bg-primary/15 px-1.5 text-primary">msg</span>
        )}
        {totalDiffHits > 0 && (
          <span className="rounded bg-secondary px-1.5 text-foreground">+/− {totalDiffHits}</span>
        )}
      </div>
    </li>
  );
}

function FileRollup({
  groups,
  selectedOid,
  onPick,
  t,
}: {
  groups: FileGroup[];
  selectedOid: string | null;
  onPick: (oid: string) => void;
  t: ReturnType<typeof useT>;
}) {
  // Per-file expand state. Default: first 3 files open, rest collapsed —
  // keeps the list scannable on big result sets.
  const [openSet, setOpenSet] = useState<Set<string>>(
    () => new Set(groups.slice(0, 3).map((g) => g.file)),
  );

  // When the result set changes, reset the default open set to keep the
  // "first 3 files open" intent fresh. Past selections are intentionally
  // discarded — the heuristic is more useful than memory here.
  useEffect(() => {
    setOpenSet(new Set(groups.slice(0, 3).map((g) => g.file)));
  }, [groups]);

  if (groups.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
        {t("search.noFileHits")}
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border/40">
      {groups.map((g) => {
        const open = openSet.has(g.file);
        return (
          <li key={g.file}>
            <button
              type="button"
              onClick={() => {
                setOpenSet((prev) => {
                  const next = new Set(prev);
                  if (next.has(g.file)) next.delete(g.file);
                  else next.add(g.file);
                  return next;
                });
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] hover:bg-accent/40",
              )}
            >
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                  !open && "-rotate-90",
                )}
              />
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono">{g.file}</span>
              <span className="shrink-0 rounded bg-secondary px-1.5 text-[10.5px] text-foreground">
                {g.commits.length}{" "}
                {g.commits.length === 1 ? t("search.commitOne") : t("search.commitMany")}
              </span>
              <span className="shrink-0 rounded bg-secondary px-1.5 text-[10.5px] text-muted-foreground">
                +/− {g.totalLines}
              </span>
            </button>
            {open && (
              <ul className="border-l-2 border-border/40 bg-background/60">
                {g.commits.map((c) => (
                  <FileCommitRow
                    key={c.oid}
                    commit={c}
                    selected={c.oid === selectedOid}
                    onClick={() => onPick(c.oid)}
                  />
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function FileCommitRow({
  commit,
  selected,
  onClick,
}: {
  commit: FileGroupCommit;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <li
      onClick={onClick}
      className={cn(
        "cursor-pointer px-6 py-1.5 text-[11.5px] hover:bg-accent/40",
        selected && "bg-accent",
      )}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[10.5px] text-muted-foreground">{commit.short_oid}</span>
        <span className="min-w-0 flex-1 truncate text-foreground">{commit.summary}</span>
        <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo(commit.time)}</span>
      </div>
      <div className="mt-0.5 text-[10.5px] text-muted-foreground">
        {commit.author_name} · +/− {commit.lines.length}
      </div>
    </li>
  );
}

function DiffHitsList({ hits }: { hits: DiffHit[] }) {
  // Group consecutive hits by file so the user sees per-file sections.
  const groups: { file: string; rows: DiffHit[] }[] = [];
  for (const h of hits) {
    const last = groups[groups.length - 1];
    if (last && last.file === h.file) {
      last.rows.push(h);
    } else {
      groups.push({ file: h.file, rows: [h] });
    }
  }
  return (
    <div className="space-y-3">
      {groups.map((g, gi) => (
        <div key={gi} className="overflow-hidden rounded border border-border bg-card">
          <div className="flex items-center gap-1.5 border-b border-border bg-secondary/50 px-2 py-1 text-[11px] text-muted-foreground">
            <FileText className="h-3 w-3" />
            <span className="font-mono">{g.file}</span>
            <span className="ml-auto rounded bg-background px-1.5 text-[10px]">
              {g.rows.length}
            </span>
          </div>
          <pre className="overflow-x-auto px-2 py-1 font-mono text-[11px] leading-tight">
            {g.rows.map((r, ri) => (
              <div
                key={ri}
                className={cn(
                  "flex gap-2 whitespace-pre",
                  r.side === "+"
                    ? "text-emerald-600 dark:text-emerald-300"
                    : "text-rose-600 dark:text-rose-300",
                )}
              >
                <span className="w-10 shrink-0 select-none text-right text-muted-foreground">
                  {r.line_no}
                </span>
                <span className="w-3 shrink-0 select-none">{r.side}</span>
                <span className="break-all">{r.text}</span>
              </div>
            ))}
          </pre>
        </div>
      ))}
    </div>
  );
}

// ---------- Pop-overs ----------

function RecentsPanel({
  recents,
  onPick,
  onClear,
  t,
}: {
  recents: SearchSnapshot[];
  onPick: (snap: SearchSnapshot, runImmediately: boolean) => void;
  onClear: () => void;
  t: ReturnType<typeof useT>;
}) {
  return (
    <div className="absolute right-0 top-full z-30 mt-1 w-[420px] overflow-hidden rounded-md border border-border bg-popover shadow-lg">
      <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground">
        <HistoryIcon className="h-3 w-3" />
        <span>{t("search.recents")}</span>
        <button
          type="button"
          onClick={onClear}
          className="ml-auto rounded px-1 text-[10.5px] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {t("search.clearAll")}
        </button>
      </div>
      <ul className="max-h-[280px] overflow-auto py-1">
        {recents.map((r, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => onPick(r, true)}
              className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-accent/40"
              title={t("search.applyAndRun")}
            >
              <span className="min-w-0 flex-1 truncate font-mono">{r.query}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {modeBadge(r.mode)} · {r.patternKind === "regex" ? "regex" : "lit"}
                {r.caseSensitive ? " · Aa" : ""}
                {r.pathspec ? ` · ${r.pathspec}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SavedPanel({
  saved,
  onApply,
  onDelete,
  t,
}: {
  saved: SavedSearch[];
  onApply: (snap: SearchSnapshot) => void;
  onDelete: (name: string) => void;
  t: ReturnType<typeof useT>;
}) {
  return (
    <div className="absolute right-0 top-full z-30 mt-1 w-[420px] overflow-hidden rounded-md border border-border bg-popover shadow-lg">
      <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground">
        <Star className="h-3 w-3" />
        <span>{t("search.savedTitle")}</span>
      </div>
      {saved.length === 0 ? (
        <div className="px-3 py-3 text-center text-[11px] text-muted-foreground">
          {t("search.savedEmpty")}
        </div>
      ) : (
        <ul className="max-h-[280px] overflow-auto py-1">
          {saved.map((s) => (
            <li key={s.name} className="group flex items-center gap-2 hover:bg-accent/40">
              <button
                type="button"
                onClick={() => onApply(s)}
                className="flex min-w-0 flex-1 items-baseline gap-2 px-3 py-1.5 text-left text-[12px]"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                <span className="shrink-0 truncate font-mono text-[10.5px] text-muted-foreground">
                  "{s.query}"
                </span>
              </button>
              <button
                type="button"
                onClick={() => onDelete(s.name)}
                title={t("search.delete")}
                className="mr-2 hidden rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:block"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function modeBadge(m: SearchSnapshot["mode"]): string {
  return m === "both" ? "msg+diff" : m;
}
