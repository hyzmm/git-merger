import { describe, expect, it } from "bun:test";
import { computeTrunkOids } from "./trunkOids";
import type { RefEntry } from "@/ipc/git";

function ref(
  name: string,
  target: string,
  opts?: { kind?: RefEntry["kind"]; is_head?: boolean },
): RefEntry {
  return {
    kind: opts?.kind ?? "local_branch",
    name,
    target,
    is_head: opts?.is_head ?? false,
  };
}

describe("computeTrunkOids (v0.13.29 B-4)", () => {
  it("returns [] for an empty ref list", () => {
    expect(computeTrunkOids([])).toEqual([]);
  });

  it("HEAD comes first", () => {
    const out = computeTrunkOids([
      ref("main", "oid-main"),
      ref("feature", "oid-feature", { is_head: true }),
    ]);
    expect(out[0]).toBe("oid-feature");
  });

  it("HEAD pointing at main de-duplicates: main does not get a second slot", () => {
    // Typical post-clone state: HEAD → main, both share the same oid.
    const out = computeTrunkOids([ref("main", "oid-main", { is_head: true })]);
    expect(out).toEqual(["oid-main"]);
  });

  it("orders trunk-name candidates by convention (main → master → develop → dev → trunk)", () => {
    const out = computeTrunkOids([
      ref("trunk", "oid-trunk"),
      ref("dev", "oid-dev"),
      ref("develop", "oid-develop"),
      ref("master", "oid-master"),
      ref("main", "oid-main"),
      ref("feature", "oid-feature", { is_head: true }),
    ]);
    // HEAD first, then conventional order.
    expect(out).toEqual([
      "oid-feature",
      "oid-main",
      "oid-master",
      "oid-develop",
      "oid-dev",
      "oid-trunk",
    ]);
  });

  it("ignores remote-only branches (no local main to anchor)", () => {
    const out = computeTrunkOids([
      ref("origin/main", "oid-origin-main", { kind: "remote_branch" }),
      ref("feature", "oid-feature", { is_head: true }),
    ]);
    expect(out).toEqual(["oid-feature"]);
  });

  it("matches trunk names case-insensitively", () => {
    const out = computeTrunkOids([
      ref("MAIN", "oid-main"),
      ref("feature", "oid-feature", { is_head: true }),
    ]);
    expect(out).toContain("oid-main");
    // Order: HEAD first, then main.
    expect(out).toEqual(["oid-feature", "oid-main"]);
  });

  it("ignores tags entirely", () => {
    const out = computeTrunkOids([
      ref("v1.0", "oid-tag", { kind: "tag" }),
      ref("main", "oid-main", { is_head: true }),
    ]);
    expect(out).toEqual(["oid-main"]);
  });

  it("returns each oid exactly once even when multiple refs share an oid", () => {
    // Two local branches both pointing at the same commit (after a
    // fresh branch-from-here without checkout).
    const out = computeTrunkOids([
      ref("main", "oid-shared", { is_head: true }),
      ref("hotfix-prep", "oid-shared"),
      ref("develop", "oid-shared"),
    ]);
    expect(out).toEqual(["oid-shared"]);
  });
});
