import { useEffect, useRef, type KeyboardEvent } from "react";
import { Search, X, Loader2, Hash, FileText, ArrowRight } from "lucide-react";
import { useApp } from "@/stores/app";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/time";
import type { SearchHit, DiffHit } from "@/ipc/git";

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

  const setSearchQuery = useApp((s) => s.setSearchQuery);
  const setSearchMode = useApp((s) => s.setSearchMode);
  const setSearchPatternKind = useApp((s) => s.setSearchPatternKind);
  const toggleSearchCase = useApp((s) => s.toggleSearchCase);
  const setSearchPathspec = useApp((s) => s.setSearchPathspec);
  const selectSearchHit = useApp((s) => s.selectSearchHit);
  const runSearch = useApp((s) => s.runSearch);
  const clearSearch = useApp((s) => s.clearSearch);
  const selectCommit = useApp((s) => s.selectCommit);
  const setView = useApp((s) => s.setView);

  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={submitOnEnter}
              placeholder={t("search.placeholder")}
              className="h-8 flex-1 rounded border border-border bg-background px-2 font-mono text-[12.5px] outline-none focus:border-primary"
            />
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
          </div>
        </div>

        {/* ---------- Status row ---------- */}
        <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border bg-card/50 px-3 text-[11px]">
          {error ? (
            <span className="text-destructive">⚠ {error}</span>
          ) : appliedQuery ? (
            <>
              <span className="text-muted-foreground">{t("search.found", { n: hits.length })}</span>
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
