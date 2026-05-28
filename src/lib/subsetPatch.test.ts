import { describe, expect, it } from "bun:test";
import { buildSubsetPatch, reversePatch, selectionKey } from "./subsetPatch";
import type { FileDiff } from "@/ipc/git";

// Minimal helper to build a FileDiff from a compact spec.
function fd(opts: {
  oldPath?: string;
  newPath?: string;
  hunks: {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: { origin: " " | "+" | "-"; content: string }[];
  }[];
}): FileDiff {
  return {
    old_path: opts.oldPath ?? "a.txt",
    new_path: opts.newPath ?? "a.txt",
    is_binary: false,
    hunks: opts.hunks.map((h) => ({
      old_start: h.oldStart,
      old_lines: h.oldLines,
      new_start: h.newStart,
      new_lines: h.newLines,
      header: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,
      lines: h.lines.map((ln) => ({
        origin: ln.origin,
        old_lineno: null,
        new_lineno: null,
        content: ln.content,
      })),
    })),
  };
}

describe("buildSubsetPatch (v0.13.25)", () => {
  it("returns null when nothing is selected", () => {
    const diff = fd({
      hunks: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 2,
          lines: [
            { origin: " ", content: "one\n" },
            { origin: "+", content: "two\n" },
          ],
        },
      ],
    });
    expect(buildSubsetPatch(diff, new Set())).toBe(null);
  });

  it("builds a minimal patch with only the selected addition", () => {
    const diff = fd({
      hunks: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 3,
          lines: [
            { origin: " ", content: "one\n" },
            { origin: "+", content: "two\n" },
            { origin: "+", content: "three\n" },
          ],
        },
      ],
    });
    // Pick only the first added line.
    const sel = new Set([selectionKey(0, 1)]);
    const out = buildSubsetPatch(diff, sel);
    expect(out).not.toBeNull();
    expect(out!).toContain("+two\n");
    expect(out!).not.toContain("+three\n");
    // old_count should remain 1, new_count should drop to 2 (context + 1 add).
    expect(out!).toContain("@@ -1 +1,2 @@");
  });

  it("demotes unselected '-' lines to context", () => {
    // Original: "one\ntwo\nthree\n" → "one\nthree\n" (line 2 deleted).
    // User only wants to keep the deletion in unified view but NOT stage
    // it: pretend they deselect everything → result should be null.
    const diff = fd({
      hunks: [
        {
          oldStart: 1,
          oldLines: 3,
          newStart: 1,
          newLines: 2,
          lines: [
            { origin: " ", content: "one\n" },
            { origin: "-", content: "two\n" },
            { origin: " ", content: "three\n" },
          ],
        },
      ],
    });
    expect(buildSubsetPatch(diff, new Set())).toBe(null);
    // Now select the deletion: the patch should have `-two`.
    const sel = new Set([selectionKey(0, 1)]);
    const out = buildSubsetPatch(diff, sel)!;
    expect(out).toContain("-two\n");
    // old=3, new=2 — deleting 1 of 3 lines.
    expect(out).toContain("@@ -1,3 +1,2 @@");
  });

  it("keeps unselected '-' as context, only the selected '+' counts", () => {
    // Pre: "alpha\nbeta\n" → Post: "alpha\nGAMMA\n" (replace beta with GAMMA)
    // Diff has -beta and +GAMMA. User selects only +GAMMA: the resulting
    // sub-patch must still treat `beta` as still-present (context),
    // because we're not staging the removal.
    const diff = fd({
      hunks: [
        {
          oldStart: 1,
          oldLines: 2,
          newStart: 1,
          newLines: 2,
          lines: [
            { origin: " ", content: "alpha\n" },
            { origin: "-", content: "beta\n" },
            { origin: "+", content: "GAMMA\n" },
          ],
        },
      ],
    });
    const sel = new Set([selectionKey(0, 2)]);
    const out = buildSubsetPatch(diff, sel)!;
    // beta is now context, GAMMA stays added.
    expect(out).toContain(" beta\n");
    expect(out).toContain("+GAMMA\n");
    expect(out).not.toContain("-beta\n");
    // old=2 (alpha + beta), new=3 (alpha + beta + GAMMA).
    expect(out).toContain("@@ -1,2 +1,3 @@");
  });

  it("shifts subsequent hunks' new_start when earlier hunks drop additions", () => {
    // Two hunks, both add a single line. Stage only the second one;
    // the second hunk's new_start was originally computed assuming the
    // first hunk's `+` survived, so we have to rewind it by 1.
    const diff = fd({
      hunks: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 2,
          lines: [
            { origin: " ", content: "one\n" },
            { origin: "+", content: "first-add\n" },
          ],
        },
        {
          oldStart: 10,
          oldLines: 1,
          newStart: 11,
          newLines: 2,
          lines: [
            { origin: " ", content: "ten\n" },
            { origin: "+", content: "second-add\n" },
          ],
        },
      ],
    });
    // Pick the second hunk's +.
    const sel = new Set([selectionKey(1, 1)]);
    const out = buildSubsetPatch(diff, sel)!;
    // Should NOT include the first hunk at all.
    expect(out).not.toContain("first-add");
    // Second hunk's new_start must rewind from 11 → 10 (we dropped one add).
    expect(out).toContain("@@ -10 +10,2 @@");
    expect(out).toContain("+second-add\n");
  });

  it("elides hunks that end up with zero changes after filtering", () => {
    // Two hunks: first has a + we deselect, second has a + we keep.
    // The first hunk should be entirely absent from the output.
    const diff = fd({
      hunks: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 2,
          lines: [
            { origin: " ", content: "ctx1\n" },
            { origin: "+", content: "skipped\n" },
          ],
        },
        {
          oldStart: 5,
          oldLines: 1,
          newStart: 6,
          newLines: 2,
          lines: [
            { origin: " ", content: "ctx2\n" },
            { origin: "+", content: "kept\n" },
          ],
        },
      ],
    });
    const out = buildSubsetPatch(diff, new Set([selectionKey(1, 1)]))!;
    expect(out).not.toContain("skipped");
    expect(out).not.toContain("ctx1");
    expect(out).toContain("ctx2");
    expect(out).toContain("+kept");
  });
});

describe("reversePatch (v0.13.25)", () => {
  it("swaps + and - body lines", () => {
    const fwd =
      "diff --git a/x b/x\n" +
      "--- a/x\n" +
      "+++ b/x\n" +
      "@@ -1,1 +1,2 @@\n" +
      " ctx\n" +
      "+added\n";
    const rev = reversePatch(fwd);
    expect(rev).toContain("-added\n");
    expect(rev).not.toContain("+added\n");
    // Body context line is unchanged.
    expect(rev).toContain(" ctx\n");
  });

  it("swaps the --- / +++ header lines", () => {
    const fwd = "--- a/foo\n+++ b/bar\n@@ -1 +1 @@\n ctx\n";
    const rev = reversePatch(fwd);
    expect(rev).toContain("--- a/bar\n");
    expect(rev).toContain("+++ b/foo\n");
  });

  it("swaps old/new ranges in the hunk header", () => {
    const fwd = "@@ -1,3 +5,7 @@ tail\n ctx\n";
    const rev = reversePatch(fwd);
    expect(rev).toContain("@@ -5,7 +1,3 @@ tail");
  });

  it("preserves the trailing newline structure", () => {
    const fwd = "@@ -1 +1 @@\n ctx\n";
    expect(reversePatch(fwd)).toBe("@@ -1 +1 @@\n ctx\n");
  });

  it("is its own inverse for well-formed patches", () => {
    const fwd =
      "diff --git a/x b/x\n" +
      "--- a/x\n" +
      "+++ b/x\n" +
      "@@ -1,2 +1,3 @@\n" +
      " keep\n" +
      "-old\n" +
      "+new1\n" +
      "+new2\n";
    expect(reversePatch(reversePatch(fwd))).toBe(fwd);
  });
});
