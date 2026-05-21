import { describe, expect, test } from "bun:test";
import {
  reorderTabs,
  stablePartitionPinned,
  togglePin,
  nextTabId,
  type PersistedTab,
} from "./tabsPersist";

function tab(id: string, pinned = false): PersistedTab {
  return { id, repoPath: `/r/${id}`, label: id, pinned };
}

describe("stablePartitionPinned", () => {
  test("pinned entries float to the front, original order preserved within each group", () => {
    const out = stablePartitionPinned([tab("a"), tab("b", true), tab("c"), tab("d", true)]);
    expect(out.map((t) => t.id)).toEqual(["b", "d", "a", "c"]);
  });

  test("already-partitioned input is returned unchanged (in order)", () => {
    const out = stablePartitionPinned([tab("p", true), tab("q", true), tab("a"), tab("b")]);
    expect(out.map((t) => t.id)).toEqual(["p", "q", "a", "b"]);
  });

  test("all-pinned and all-unpinned both pass through", () => {
    expect(stablePartitionPinned([tab("a"), tab("b")]).map((t) => t.id)).toEqual(["a", "b"]);
    expect(stablePartitionPinned([tab("p", true), tab("q", true)]).map((t) => t.id)).toEqual([
      "p",
      "q",
    ]);
  });
});

describe("togglePin", () => {
  test("pinning a non-pinned tab moves it before all non-pinned tabs", () => {
    const out = togglePin([tab("a"), tab("b"), tab("c")], "c");
    expect(out.map((t) => t.id)).toEqual(["c", "a", "b"]);
    expect(out.find((t) => t.id === "c")?.pinned).toBe(true);
  });

  test("unpinning a pinned tab moves it after all remaining pinned tabs", () => {
    const out = togglePin([tab("p", true), tab("q", true), tab("a")], "p");
    expect(out.map((t) => t.id)).toEqual(["q", "p", "a"]);
    expect(out.find((t) => t.id === "p")?.pinned).toBe(false);
  });

  test("unknown id is a no-op", () => {
    const input = [tab("a"), tab("b")];
    expect(togglePin(input, "zzz").map((t) => t.id)).toEqual(["a", "b"]);
  });
});

describe("reorderTabs", () => {
  test("moving inside the unpinned region just shifts position", () => {
    // Semantics: toIdx is "drop before original index toIdx". So
    // [a, b, c, d] -> move from=0 to=3 means: take 'a' out, drop it
    // before original index 3 ('d') -> [b, c, a, d].
    const out = reorderTabs([tab("a"), tab("b"), tab("c"), tab("d")], 0, 3);
    expect(out.map((t) => t.id)).toEqual(["b", "c", "a", "d"]);
    expect(out.every((t) => !t.pinned)).toBe(true);
  });

  test("dragging an unpinned tab into the pinned region pins it", () => {
    // [P*, Q*, a, b] -> drag b (idx 3) before idx 1 (Q):
    //   splice → [P, Q, a], adjusted=1, insert b → [P, b, Q, a].
    // b's neighbours are both pinned → b becomes pinned.
    // Stable partition keeps the pinned region's *insertion order*, so
    // b stays where it was inserted: [P, b, Q, a].
    const out = reorderTabs([tab("P", true), tab("Q", true), tab("a"), tab("b")], 3, 1);
    expect(out.map((t) => t.id)).toEqual(["P", "b", "Q", "a"]);
    expect(out.find((t) => t.id === "b")?.pinned).toBe(true);
  });

  test("dragging a pinned tab into the unpinned region unpins it", () => {
    // [P, Q, a, b] -> drag P (idx 0) to idx 3 -> [Q, a, P*, b] then partition
    // P* becomes unpinned because right neighbour is unpinned and left is unpinned too.
    const out = reorderTabs([tab("P", true), tab("Q", true), tab("a"), tab("b")], 0, 3);
    expect(out.find((t) => t.id === "P")?.pinned).toBe(false);
    // Partition: pinned first → Q stays pinned at front.
    expect(out[0].id).toBe("Q");
    expect(out[0].pinned).toBe(true);
  });

  test("from===to is a no-op", () => {
    const input = [tab("a"), tab("b")];
    expect(reorderTabs(input, 1, 1).map((t) => t.id)).toEqual(["a", "b"]);
  });

  test("out-of-bounds indices return a copy unchanged", () => {
    expect(reorderTabs([tab("a")], 5, 0).map((t) => t.id)).toEqual(["a"]);
    expect(reorderTabs([tab("a")], 0, 5).map((t) => t.id)).toEqual(["a"]);
  });

  test("invariant: all pinned come before all non-pinned, no matter the move", () => {
    const inputs: PersistedTab[][] = [
      [tab("P", true), tab("a"), tab("b"), tab("Q", true)],
      [tab("a"), tab("b"), tab("P", true)],
      [tab("P", true), tab("Q", true), tab("a")],
    ];
    for (const inp of inputs) {
      for (let f = 0; f < inp.length; f++) {
        for (let t = 0; t <= inp.length; t++) {
          const out = reorderTabs(inp, f, t);
          let sawUnpinned = false;
          for (const x of out) {
            if (!x.pinned) sawUnpinned = true;
            else if (sawUnpinned) {
              throw new Error(
                `invariant broken from=${f} to=${t}: ${out.map((y) => `${y.id}${y.pinned ? "*" : ""}`).join(",")}`,
              );
            }
          }
        }
      }
    }
  });
});

describe("nextTabId", () => {
  test("returns null on empty list", () => {
    expect(nextTabId([], null, 1)).toBeNull();
  });

  test("wraps forward around the right edge", () => {
    const tabs = [tab("a"), tab("b"), tab("c")];
    expect(nextTabId(tabs, "c", 1)).toBe("a");
  });

  test("wraps backward around the left edge", () => {
    const tabs = [tab("a"), tab("b"), tab("c")];
    expect(nextTabId(tabs, "a", -1)).toBe("c");
  });

  test("unknown current id falls back to first tab", () => {
    const tabs = [tab("a"), tab("b")];
    expect(nextTabId(tabs, "zzz", 1)).toBe("a");
  });

  test("single tab cycles to itself", () => {
    expect(nextTabId([tab("a")], "a", 1)).toBe("a");
    expect(nextTabId([tab("a")], "a", -1)).toBe("a");
  });
});
