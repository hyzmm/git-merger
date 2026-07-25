import { Input } from "@/components/ui/input";
import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, Regex, X, CaseSensitive } from "lucide-react";
import { useApp } from "@/stores/app";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * v0.13.34 — Find-in-diff floating bar.
 *
 * Sits as an absolutely-positioned overlay in the diff content area
 * (anchored top-right). Mounts when `s.diff.search.open === true` and
 * unmounts on close — that way the input loses focus when the user
 * presses Esc, which avoids the surprise of a hidden focused input
 * eating subsequent keystrokes.
 *
 * Local responsibilities:
 *   - autofocus the input on mount
 *   - dispatch query / case / regex / next / prev / close to the store
 *   - scroll the active match's row into view via the data-diff-line
 *     attribute the row renderers write
 *   - intercept Enter / Shift+Enter / Esc inside the input (so they
 *     don't fall through to the global useShortcuts)
 *
 * It deliberately does NOT own match counting or the matches array —
 * those live in the store so the row renderers can subscribe to them
 * directly without going through this component.
 */
export function DiffSearchBar() {
  const open = useApp((s) => s.diff.search.open);
  const query = useApp((s) => s.diff.search.query);
  const caseSensitive = useApp((s) => s.diff.search.caseSensitive);
  const regex = useApp((s) => s.diff.search.regex);
  const matches = useApp((s) => s.diff.search.matches);
  const activeIdx = useApp((s) => s.diff.search.activeIdx);

  const close = useApp((s) => s.closeDiffSearch);
  const setQuery = useApp((s) => s.setDiffSearchQuery);
  const toggleCase = useApp((s) => s.toggleDiffSearchCase);
  const toggleRegex = useApp((s) => s.toggleDiffSearchRegex);
  const step = useApp((s) => s.stepDiffSearch);

  const inputRef = useRef<HTMLInputElement>(null);

  // Autofocus on mount and select existing query so the user can
  // immediately overwrite it (matches Chrome / VS Code behaviour:
  // pressing Ctrl+F over an existing search reuses the last query but
  // expects you to type a new one without manually clearing).
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open]);

  // Scroll the active match into view whenever it changes.
  // We look up the row via the `data-diff-line` attribute the row
  // renderers (DiffPrimitives.DiffLineCell) emit — there are at most
  // two matching elements (one in the unified view, or one per side
  // in side-by-side) so we just scroll all of them; browsers no-op
  // when the target is already visible.
  useEffect(() => {
    if (!open) return;
    if (activeIdx < 0 || activeIdx >= matches.length) return;
    const m = matches[activeIdx];
    const key = `${m.hunkIdx}:${m.lineIdx}`;
    // Match either Unified (`U:`) or SideBySide (`L:` / `R:`) prefixes.
    // Querying the document is fine here — there's only ever one diff
    // pane mounted at a time.
    const candidates = document.querySelectorAll<HTMLElement>(
      `[data-diff-line$=":${key}"]`,
    );
    if (candidates.length === 0) return;
    // Scroll the first hit into view; the others (if any) are
    // typically right next to it on a side-by-side, so a single
    // scrollIntoView covers them.
    candidates[0].scrollIntoView({ block: "center", behavior: "smooth" });
  }, [open, activeIdx, matches]);

  if (!open) return null;

  const total = matches.length;
  // Display 1-based for humans, but show "0" when total is 0 so the
  // bar reads "0 / 0" instead of "1 / 0" (which would be confusing
  // when the query has no matches).
  const display = total === 0 ? 0 : Math.max(0, activeIdx) + 1;

  return (
    <div
      className={cn(
        "absolute right-3 top-3 z-20 flex items-center gap-1 rounded-md border border-border",
        "bg-card/95 px-2 py-1 shadow-lg backdrop-blur-sm",
      )}
      // Stop click events bubbling so clicking inside the bar doesn't
      // dismiss any popovers above us.
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Input
        ref={inputRef}
        type="text"
        value={query}
        placeholder="Find in diff…"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          // Intercept the navigation / dismiss combos before
          // useShortcuts sees them (the global Esc would otherwise
          // hit `clearDiffLineSelection`, which we don't want here).
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            close();
          } else if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            step(e.shiftKey ? -1 : 1);
          } else if (e.key === "F3") {
            e.preventDefault();
            e.stopPropagation();
            step(e.shiftKey ? -1 : 1);
          }
        }}
        className={cn(
          "h-6 w-44 rounded border-0 bg-transparent px-1.5 text-xs outline-none",
          "placeholder:text-muted-foreground/60 focus:ring-0",
        )}
      />

      {/* Match counter */}
      <span
        className={cn(
          "min-w-[3em] select-none text-center font-mono text-[10.5px]",
          total === 0 && query ? "text-destructive" : "text-muted-foreground",
        )}
        title={query && total === 0 ? "No matches" : `${display} of ${total}`}
      >
        {query ? `${display}/${total}` : "—"}
      </span>

      {/* Prev / Next */}
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => step(-1)}
        disabled={total === 0}
        title="Previous match (Shift+Enter)"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => step(1)}
        disabled={total === 0}
        title="Next match (Enter)"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </Button>

      {/* Case-sensitivity toggle. Subtle but discoverable — same idiom
          as VS Code's "Aa" pill. We use a lucide icon to stay
          consistent with the rest of the toolbar. */}
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={toggleCase}
        title="Match case"
        className={cn(caseSensitive && "border-border bg-secondary text-foreground")}
      >
        <CaseSensitive className="h-3.5 w-3.5" />
      </Button>

      {/* Regex toggle */}
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={toggleRegex}
        title="Use regular expression"
        className={cn(regex && "border-border bg-secondary text-foreground")}
      >
        <Regex className="h-3.5 w-3.5" />
      </Button>

      <Button
        variant="ghost"
        size="icon-xs"
        onClick={close}
        title="Close (Esc)"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
