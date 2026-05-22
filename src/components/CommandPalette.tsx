/**
 * Cmd-K / Ctrl-K Command Palette.
 *
 * Aggregates 4 sources into a single fuzzy-searchable list:
 *   - commits (oid + summary), ranked by both
 *   - refs (branches + tags)
 *   - tracked files (HEAD tree)
 *   - app views (history, changes, …)
 *
 * Hit Enter to act on the highlighted result. Esc closes. ↑/↓ navigate.
 * Tracked files open in Blame; commits select-and-jump in History; refs
 * checkout (for local branches) or jump to their commit; views switch.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Box,
  FileText,
  GitBranch,
  GitCommit,
  History as HistoryIcon,
  Search,
  Tag as TagIcon,
} from "lucide-react";
import { useApp, type ViewKey } from "@/stores/app";
import { fuzzyScore, highlight, type FuzzyResult } from "@/lib/fuzzy";
import { useT, type TKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type ItemKind = "commit" | "ref" | "file" | "view";

interface PaletteItem {
  kind: ItemKind;
  /** Primary string we match against. */
  haystack: string;
  /** Render label (may differ from haystack when we want to show oid + msg). */
  primary: string;
  /** Subtitle (e.g. author, ref kind, file dir). */
  secondary?: string;
  Icon: typeof GitCommit;
  onActivate: () => void;
}

const MAX_RESULTS = 50;

export function CommandPalette() {
  const open = useApp((s) => s.palette.open);
  const closePalette = useApp((s) => s.closePalette);
  const repo = useApp((s) => s.repo);
  const commits = useApp((s) => s.history.commits);
  const refs = useApp((s) => s.history.refs);
  const files = useApp((s) => s.palette.files);
  const setView = useApp((s) => s.setView);
  const selectCommit = useApp((s) => s.selectCommit);
  const checkoutBranch = useApp((s) => s.checkoutBranch);
  const openBlame = useApp((s) => s.openBlame);
  const t = useT();

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Reset on open.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Build the candidate pool. Memoized on repo data, NOT on query — we
  // re-rank on each keystroke separately.
  const items = useMemo<PaletteItem[]>(() => {
    if (!repo) return [];
    const out: PaletteItem[] = [];

    const VIEWS: { key: ViewKey; labelKey: TKey; Icon: typeof GitCommit }[] = [
      { key: "history", labelKey: "sidebar.history", Icon: HistoryIcon },
      { key: "changes", labelKey: "sidebar.changes", Icon: FileText },
      { key: "stash", labelKey: "sidebar.stash", Icon: Box },
      { key: "reflog", labelKey: "sidebar.reflog", Icon: HistoryIcon },
      { key: "submodules", labelKey: "sidebar.submodules", Icon: Box },
      { key: "rebase", labelKey: "sidebar.rebase", Icon: GitBranch },
      { key: "tags", labelKey: "sidebar.tags", Icon: TagIcon },
      { key: "diff", labelKey: "sidebar.diff", Icon: FileText },
      { key: "merge", labelKey: "sidebar.merge", Icon: GitBranch },
    ];
    for (const v of VIEWS) {
      const label = t(v.labelKey);
      out.push({
        kind: "view",
        haystack: `${label} ${v.key}`,
        primary: label,
        secondary: t("palette.view"),
        Icon: v.Icon,
        onActivate: () => setView(v.key),
      });
    }

    for (const r of refs) {
      out.push({
        kind: "ref",
        haystack: r.name,
        primary: r.name,
        secondary:
          r.kind === "local_branch"
            ? t("palette.localBranch")
            : r.kind === "remote_branch"
              ? t("palette.remoteBranch")
              : t("palette.tag"),
        Icon: r.kind === "tag" ? TagIcon : GitBranch,
        onActivate: () => {
          if (r.kind === "local_branch") {
            void checkoutBranch(r.name);
          } else if (r.target) {
            // remote branch / tag → jump to its commit in history
            setView("history");
            void selectCommit(r.target);
          }
        },
      });
    }

    // Cap commits at 5000 (the same as initial history load) so massive repos
    // don't make the palette laggy.
    const limit = Math.min(commits.length, 5000);
    for (let i = 0; i < limit; i++) {
      const c = commits[i]!;
      out.push({
        kind: "commit",
        haystack: `${c.short_oid} ${c.summary} ${c.author_name}`,
        primary: c.summary,
        secondary: `${c.short_oid} · ${c.author_name}`,
        Icon: GitCommit,
        onActivate: () => {
          setView("history");
          void selectCommit(c.oid);
        },
      });
    }

    for (const f of files) {
      out.push({
        kind: "file",
        haystack: f,
        primary: f,
        secondary: t("palette.fileBlame"),
        Icon: FileText,
        onActivate: () => void openBlame(f),
      });
    }

    return out;
  }, [repo, commits, refs, files, t, setView, selectCommit, checkoutBranch, openBlame]);

  // Rank.
  const results = useMemo(() => {
    if (!query.trim()) {
      // Default: show views + first 30 commits, no scoring.
      return items
        .filter((i) => i.kind === "view" || i.kind === "ref")
        .concat(items.filter((i) => i.kind === "commit").slice(0, 30))
        .slice(0, MAX_RESULTS)
        .map((item) => ({ item, fuzzy: { score: 0, matches: [] } as FuzzyResult }));
    }
    const q = query.trim();
    const scored: { item: PaletteItem; fuzzy: FuzzyResult }[] = [];
    for (const item of items) {
      const fuzzy = fuzzyScore(q, item.haystack);
      if (!fuzzy) continue;
      // Slight kind bias: refs > files > commits > views (when scores tie).
      const kindBoost =
        item.kind === "ref" ? 8 : item.kind === "file" ? 4 : item.kind === "commit" ? 2 : 0;
      scored.push({ item, fuzzy: { ...fuzzy, score: fuzzy.score + kindBoost } });
    }
    scored.sort((a, b) => b.fuzzy.score - a.fuzzy.score);
    return scored.slice(0, MAX_RESULTS);
  }, [items, query]);

  // Keep `active` in range as results shrink.
  useEffect(() => {
    if (active >= results.length) setActive(0);
  }, [results.length, active]);

  // Auto-scroll the active item into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  function activate(i: number) {
    const r = results[i];
    if (!r) return;
    closePalette();
    r.item.onActivate();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      closePalette();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      activate(active);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(results.length - 1);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[12vh]"
      onClick={closePalette}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-xl rounded-lg border border-border bg-card text-card-foreground shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={t("palette.placeholder")}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden shrink-0 rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
            esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-auto">
          {results.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              {t("palette.noResults")}
            </div>
          )}
          {results.map((r, i) => (
            <Row
              key={`${r.item.kind}-${i}`}
              idx={i}
              item={r.item}
              fuzzy={r.fuzzy}
              active={i === active}
              query={query}
              onActivate={() => activate(i)}
              onHover={() => setActive(i)}
            />
          ))}
        </div>

        <div className="flex items-center gap-3 border-t border-border bg-secondary/40 px-3 py-1.5 text-[10px] text-muted-foreground">
          <span>
            <kbd className="font-mono">↑↓</kbd> {t("palette.hint.navigate")}
          </span>
          <span>
            <kbd className="font-mono">↵</kbd> {t("palette.hint.activate")}
          </span>
          <span className="ml-auto">{results.length} results</span>
        </div>
      </div>
    </div>
  );
}

function Row({
  idx,
  item,
  fuzzy,
  active,
  query,
  onActivate,
  onHover,
}: {
  idx: number;
  item: PaletteItem;
  fuzzy: FuzzyResult;
  active: boolean;
  query: string;
  onActivate: () => void;
  onHover: () => void;
}) {
  // Recompute matches on the visible primary text (cheaper for the highlight
  // pass than reusing haystack indices, which point to the longer string).
  const primaryFuzzy = query.trim() ? fuzzyScore(query.trim(), item.primary) : null;
  const segments = highlight(
    item.primary,
    primaryFuzzy?.matches ?? fuzzy.matches.filter((i) => i < item.primary.length),
    (s) => <span key={`p${s}-${Math.random()}`}>{s}</span>,
    (s) => (
      <mark
        key={`m${s}-${Math.random()}`}
        className="rounded bg-[hsl(var(--branch-2)/.30)] text-foreground"
      >
        {s}
      </mark>
    ),
  );
  const Icon = item.Icon;
  return (
    <button
      type="button"
      data-idx={idx}
      onMouseEnter={onHover}
      onClick={onActivate}
      className={cn(
        "flex w-full items-center gap-3 px-3 py-1.5 text-left text-sm",
        active && "bg-accent/60",
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{segments}</span>
      {item.secondary && (
        <span className="shrink-0 truncate font-mono text-[10.5px] text-muted-foreground">
          {item.secondary}
        </span>
      )}
      {active && <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
    </button>
  );
}
