import { describe, expect, it } from "bun:test";
import {
  BRANCH_PALETTE_SIZE,
  branchColorForName,
  branchColorVar,
  branchSlotForName,
} from "./branchColors";

describe("branchColors (v0.13.23)", () => {
  it("hashes a name to a slot inside the palette range", () => {
    for (const name of ["main", "develop", "feature/login", "v1.2.3", "origin/main"]) {
      const slot = branchSlotForName(name);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(BRANCH_PALETTE_SIZE);
    }
  });

  it("is deterministic — same name always hashes to the same slot", () => {
    expect(branchSlotForName("main")).toBe(branchSlotForName("main"));
    expect(branchSlotForName("feature/x")).toBe(branchSlotForName("feature/x"));
  });

  it("emits a hsl(var(--branch-N)) string for every slot", () => {
    for (let i = 0; i < BRANCH_PALETTE_SIZE; i++) {
      const css = branchColorVar(i);
      expect(css).toMatch(/^hsl\(var\(--branch-\d\)\)$/);
    }
  });

  it("wraps around for indices outside [0, palette size)", () => {
    expect(branchColorVar(BRANCH_PALETTE_SIZE)).toBe(branchColorVar(0));
    expect(branchColorVar(-1)).toBe(branchColorVar(BRANCH_PALETTE_SIZE - 1));
  });

  it("branchColorForName(name) === branchColorVar(branchSlotForName(name))", () => {
    for (const name of ["main", "alpha", "release/2.0"]) {
      expect(branchColorForName(name)).toBe(branchColorVar(branchSlotForName(name)));
    }
  });

  it("empty string is handled gracefully (no NaN, no out-of-range)", () => {
    const slot = branchSlotForName("");
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(slot).toBeLessThan(BRANCH_PALETTE_SIZE);
  });
});
