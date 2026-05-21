import { describe, expect, it } from "bun:test";
import { classifyAction, findQuickUndo, listUndoables } from "./reflogActions";
import type { ReflogEntry } from "@/ipc/git";

function entry(idx: number, message: string, oldOid = "aaaaaaa", newOid = "bbbbbbb"): ReflogEntry {
  return {
    index: idx,
    new_oid: newOid + "00000000000000000000000000000000",
    short_new_oid: newOid,
    old_oid: oldOid + "00000000000000000000000000000000",
    short_old_oid: oldOid,
    message,
    committer_name: "Test",
    committer_email: "test@example.com",
    time: 1700000000 + idx,
  };
}

describe("classifyAction", () => {
  it("classifies plain commits as non-undoable", () => {
    const c = classifyAction("commit: add login form");
    expect(c.kind).toBe("commit");
    expect(c.undoable).toBe(false);
  });

  it("classifies amend commits as undoable", () => {
    const c = classifyAction("commit (amend): tweak login form");
    expect(c.kind).toBe("amend");
    expect(c.undoable).toBe(true);
    expect(c.verb).toBe("amend");
  });

  it("classifies reset and hard-reset", () => {
    const soft = classifyAction("reset: moving to HEAD~3");
    expect(soft.kind).toBe("reset");
    expect(soft.undoable).toBe(true);
    expect(soft.verb).toBe("reset");

    const hard = classifyAction("reset: moving to HEAD~3 (hard)");
    expect(hard.kind).toBe("reset");
    expect(hard.undoable).toBe(true);
    expect(hard.verb).toBe("reset --hard");
  });

  it("classifies merge / pull / cherry-pick / revert as undoable", () => {
    expect(classifyAction("merge feat: Fast-forward").undoable).toBe(true);
    expect(classifyAction("pull: Fast-forward").undoable).toBe(true);
    expect(classifyAction("cherry-pick: feat: x").undoable).toBe(true);
    expect(classifyAction("revert: bad change").undoable).toBe(true);
  });

  it("classifies rebase start/finish as undoable but intermediate steps not", () => {
    expect(classifyAction("rebase (start): checkout main").undoable).toBe(true);
    expect(classifyAction("rebase (finish): returning to refs/heads/main").undoable).toBe(true);
    expect(classifyAction("rebase (pick): some commit").undoable).toBe(false);
  });

  it("classifies non-actionable messages as non-undoable", () => {
    expect(classifyAction("checkout: moving from main to feat").undoable).toBe(false);
    expect(classifyAction("branch: Created from HEAD").undoable).toBe(false);
    expect(classifyAction("stash: WIP on main").undoable).toBe(false);
    expect(classifyAction("push: refs/heads/main").undoable).toBe(false);
    expect(classifyAction("something weird").undoable).toBe(false);
  });
});

describe("findQuickUndo", () => {
  it("returns null when reflog is empty", () => {
    expect(findQuickUndo([])).toBeNull();
  });

  it("returns the most recent undoable entry", () => {
    const entries = [
      entry(0, "merge feat/x: Merge made by 'ort'."),
      entry(1, "commit: earlier work"),
    ];
    const r = findQuickUndo(entries);
    expect(r).not.toBeNull();
    expect(r!.index).toBe(0);
    expect(r!.action.kind).toBe("merge");
    expect(r!.targetOid.startsWith("aaaaaaa")).toBe(true);
  });

  it("skips non-undoable entries (checkout) and finds the next undoable one", () => {
    const entries = [
      entry(0, "checkout: moving from feat to main"),
      entry(1, "reset: moving to HEAD~1"),
      entry(2, "commit: foo"),
    ];
    const r = findQuickUndo(entries);
    expect(r).not.toBeNull();
    expect(r!.index).toBe(1);
    expect(r!.action.kind).toBe("reset");
  });

  it("stops at a plain commit barrier — never digs past authored work", () => {
    // Most recent is a commit. Anything before it would mean rolling
    // back over the user's own work, so we refuse.
    const entries = [
      entry(0, "commit: latest work"),
      entry(1, "merge feat: Fast-forward"), // would otherwise be undoable
    ];
    expect(findQuickUndo(entries)).toBeNull();
  });
});

describe("listUndoables", () => {
  it("collects up to N undoable entries while skipping non-undoables", () => {
    const entries = [
      entry(0, "merge a: Fast-forward"),
      entry(1, "checkout: moving from a to b"),
      entry(2, "reset: moving to HEAD~1"),
      entry(3, "branch: created"),
      entry(4, "cherry-pick: feat: x"),
      entry(5, "commit: not an action"), // commits are not listed but DO NOT stop the walk here
      entry(6, "revert: y"),
    ];
    const out = listUndoables(entries, 8);
    const kinds = out.map((c) => c.action.kind);
    // Note: listUndoables does NOT have the same "stop at commit" guard
    // as findQuickUndo — that guard only protects the implicit one-click
    // top action. Listing all candidates is fine here.
    expect(kinds).toContain("merge");
    expect(kinds).toContain("reset");
    expect(kinds).toContain("cherry-pick");
    expect(kinds).toContain("revert");
    expect(kinds).not.toContain("checkout");
    expect(kinds).not.toContain("branch");
    expect(kinds).not.toContain("commit");
  });

  it("respects the limit parameter", () => {
    const entries: ReflogEntry[] = [];
    for (let i = 0; i < 20; i++) {
      entries.push(entry(i, "merge x: Fast-forward"));
    }
    expect(listUndoables(entries, 5).length).toBe(5);
    expect(listUndoables(entries, 100).length).toBe(20);
  });
});
