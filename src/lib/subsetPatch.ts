/**
 * Build a sub-set unified-patch from a {@link FileDiff} given a set of
 * "selected" `+` / `-` lines. v0.13.25.
 *
 * Used by line-level staging on the working-tree Diff view: the user
 * picks individual changed lines, we synthesise the smallest valid
 * unified-patch that carries only those changes, and ship it to the
 * backend's `apply_patch` (with `PatchLocation::Index` for stage,
 * `PatchLocation::WorkDir` for discard, both routed through `reversePatch`
 * for the inverse direction).
 *
 * Algorithm
 * ---------
 * For each hunk, walk every line and decide its fate:
 *
 *   | origin | selected? | output            |
 *   | ------ | --------- | ----------------- |
 *   | " "    | n/a       | keep as context   |
 *   | "+"    | yes       | keep as `+`       |
 *   | "+"    | no        | drop entirely     |
 *   | "-"    | yes       | keep as `-`       |
 *   | "-"    | no        | demote to context |
 *
 * The "demote `-` to context" rule is the load-bearing trick: an
 * unselected deletion has to *remain visible* in the post-image as a
 * context line, otherwise the patch claims to delete a line that the
 * surrounding context says is still there.
 *
 * Hunk headers `@@ -A,B +C,D @@` are recomputed:
 *   - `B` (old_count) = number of context + `-` lines in the *output*.
 *   - `D` (new_count) = number of context + `+` lines in the *output*.
 *   - `A` (old_start) is unchanged from the source hunk; the original
 *     `-` lines that we demoted to context are still anchored at the
 *     same old line numbers.
 *   - `C` (new_start) is shifted by the cumulative delta of preceding
 *     hunks: every line we drop from the new side moves subsequent
 *     hunks' new-side anchors *up* by the same amount.
 *
 * If a hunk ends up with zero `+`/`-` lines (= every change was
 * unselected → it's pure context), it's elided. If every hunk in the
 * file is elided, we return `null` so callers know there's nothing to
 * apply.
 */
import type { FileDiff } from "@/ipc/git";

/**
 * Selection key format: `"<hunkIdx>:<lineIdxWithinHunk>"`. We use a
 * string set so a `Set<string>` survives the React render boundary
 * (Sets are by reference and Zustand snapshots compare by identity —
 * keeping it as primitive strings inside means equality is content-
 * based as soon as we recreate the Set).
 */
export function selectionKey(hunkIdx: number, lineIdx: number): string {
  return `${hunkIdx}:${lineIdx}`;
}

/**
 * Build the forward subset patch text. Returns `null` when no `+`/`-`
 * lines are selected (or when the file has no hunks at all), so the
 * caller can short-circuit instead of issuing an empty IPC call.
 */
export function buildSubsetPatch(diff: FileDiff, selected: Set<string>): string | null {
  const oldPath = diff.old_path ?? diff.new_path ?? "";
  const newPath = diff.new_path ?? diff.old_path ?? "";
  if (!oldPath && !newPath) return null;

  const out: string[] = [];
  let cumulativeNewDelta = 0;
  let anyChanges = false;

  for (let hi = 0; hi < diff.hunks.length; hi++) {
    const h = diff.hunks[hi]!;
    const lines: { origin: " " | "+" | "-"; content: string }[] = [];
    let kept = 0; // count of `+` / `-` in this hunk's output
    for (let li = 0; li < h.lines.length; li++) {
      const ln = h.lines[li]!;
      const isSel = selected.has(selectionKey(hi, li));
      if (ln.origin === " ") {
        lines.push({ origin: " ", content: ln.content });
      } else if (ln.origin === "+") {
        if (isSel) {
          lines.push({ origin: "+", content: ln.content });
          kept++;
        }
        // else: drop
      } else if (ln.origin === "-") {
        if (isSel) {
          lines.push({ origin: "-", content: ln.content });
          kept++;
        } else {
          // Demote to context. The deletion didn't happen in this
          // sub-patch, so the line is still present — show it as " ".
          lines.push({ origin: " ", content: ln.content });
        }
      }
    }
    if (kept === 0) {
      // No real changes in this hunk's selection — skip the whole hunk.
      // We DO need to update the cumulative new-side delta though: the
      // original hunk shifted subsequent new line numbers by
      // `new_lines - old_lines`; in the reduced patch this hunk is a
      // no-op (old size == new size), so the shift disappears and we
      // owe subsequent hunks a `-(new_lines - old_lines)` correction.
      cumulativeNewDelta -= h.new_lines - h.old_lines;
      continue;
    }

    // Recompute the hunk header counters from the post-filter line set.
    let oldCount = 0;
    let newCount = 0;
    for (const ln of lines) {
      if (ln.origin === " ") {
        oldCount++;
        newCount++;
      } else if (ln.origin === "-") {
        oldCount++;
      } else if (ln.origin === "+") {
        newCount++;
      }
    }
    const oldStart = h.old_start;
    const newStart = h.new_start + cumulativeNewDelta;

    // Update cumulative delta for the next hunk: anything we dropped on
    // the new side (= original new_lines − this hunk's effective
    // newCount) shifts subsequent hunks up by that same amount.
    cumulativeNewDelta += newCount - h.new_lines;

    // Emit the hunk header. We don't try to preserve the original
    // function-context tail (the bit after `@@`) because libgit2's
    // apply ignores it; keeping the format minimal sidesteps escaping
    // questions.
    out.push(formatHunkHeader(oldStart, oldCount, newStart, newCount));
    for (const ln of lines) {
      out.push(ln.origin + ensureTrailingNewline(ln.content));
    }
    anyChanges = true;
  }

  if (!anyChanges) return null;

  // File header. We don't emit `index <hash>..<hash>` because libgit2's
  // `Diff::from_buffer` doesn't require it for a workdir/index apply
  // — only the path lines and hunk bodies are load-bearing.
  const header =
    `diff --git a/${oldPath} b/${newPath}\n` + `--- a/${oldPath}\n` + `+++ b/${newPath}\n`;

  return header + out.join("");
}

/**
 * Reverse a unified-patch text so it un-applies what the forward patch
 * applied. Used by line-level **unstage** (apply reversed forward
 * patch to Index) and **discard** (apply reversed forward patch to
 * WorkDir).
 *
 * The transformation is purely textual:
 *   - Swap each `--- a/X` and `+++ b/Y` line.
 *   - Swap each hunk header's `-A,B` and `+C,D` ranges.
 *   - Swap `+` ↔ `-` on every body line.
 *
 * Garbage in → garbage out: we don't validate the input, we just
 * mechanically transform it. If the original patch had multiple files
 * (we don't currently produce those, but defensively we handle them)
 * each file block is reversed independently.
 */
export function reversePatch(patch: string): string {
  // Normalise to LF for splitting; we'll preserve LF endings on output.
  // Hunk headers + file headers don't carry the trailing newline as
  // part of their semantic content — split keeps trailing empty string
  // when input ends with a newline, so a join restores the exact
  // newline structure.
  const lines = patch.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]!;
    if (ln.startsWith("--- ")) {
      // Look ahead for the matching +++ line on the next physical line.
      const next = lines[i + 1] ?? "";
      if (next.startsWith("+++ ")) {
        // Extract the *path* from each side and swap them, keeping the
        // a/ and b/ prefixes attached to their canonical position
        // markers (a/ always means "old side", b/ always means "new
        // side"). So if forward says
        //     --- a/foo     +++ b/bar
        // reversed is
        //     --- a/bar     +++ b/foo
        // — i.e. the *paths* swap, the prefixes stay put.
        const oldPath = stripPathPrefix(ln.slice(4));
        const newPath = stripPathPrefix(next.slice(4));
        out.push("--- a/" + newPath);
        out.push("+++ b/" + oldPath);
        i += 1; // we consumed two source lines, advance past +++
        continue;
      }
      out.push(ln);
      continue;
    }
    if (ln.startsWith("@@")) {
      out.push(reverseHunkHeader(ln));
      continue;
    }
    if (ln.startsWith("+")) {
      out.push("-" + ln.slice(1));
      continue;
    }
    if (ln.startsWith("-")) {
      out.push("+" + ln.slice(1));
      continue;
    }
    out.push(ln);
  }
  return out.join("\n");
}

// ---------- helpers ----------

function formatHunkHeader(
  oldStart: number,
  oldCount: number,
  newStart: number,
  newCount: number,
): string {
  // Match git's format: omit the `,N` suffix when N === 1 (single-line
  // ranges). Some apply implementations are picky about this; libgit2
  // tolerates both, but matching `git diff` output keeps the patch
  // readable for humans inspecting it.
  const oldRange = oldCount === 1 ? `${oldStart}` : `${oldStart},${oldCount}`;
  const newRange = newCount === 1 ? `${newStart}` : `${newStart},${newCount}`;
  return `@@ -${oldRange} +${newRange} @@\n`;
}

function ensureTrailingNewline(s: string): string {
  // libgit2 emits diff line content WITH the trailing newline. We
  // forward it verbatim. If the source line was the special "no newline
  // at end of file" indicator (which git2's DiffLine doesn't surface
  // separately) it would be missing the newline; preserve as-is.
  return s.endsWith("\n") ? s : s + "\n";
}

function reverseHunkHeader(header: string): string {
  // `@@ -A,B +C,D @@` or `@@ -A +C @@` etc.
  const m = header.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)$/);
  if (!m) return header;
  const oldStart = m[1];
  const oldCount = m[2] ?? "1";
  const newStart = m[3];
  const newCount = m[4] ?? "1";
  const tail = m[5] ?? "";
  const oldRange = oldCount === "1" ? oldStart : `${oldStart},${oldCount}`;
  const newRange = newCount === "1" ? newStart : `${newStart},${newCount}`;
  // Swap: the *new* side becomes the old side and vice versa.
  return `@@ -${newRange} +${oldRange} @@${tail}`;
}

/**
 * Strip the canonical `a/` or `b/` prefix off a `--- ` / `+++ ` payload
 * so we can re-attach the *opposite* prefix during reversal. Falls back
 * to returning the input verbatim when the prefix is missing — patches
 * generated outside our pipeline (e.g. `git diff --no-prefix`) don't
 * carry it, and we shouldn't mangle them.
 */
function stripPathPrefix(s: string): string {
  if (s.startsWith("a/") || s.startsWith("b/")) return s.slice(2);
  return s;
}
