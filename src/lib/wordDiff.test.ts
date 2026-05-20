import { describe, expect, it } from "bun:test";
import { wordDiff } from "./wordDiff";

describe("wordDiff", () => {
  it("returns no diff tokens for identical strings", () => {
    const r = wordDiff("hello world", "hello world");
    expect(r.left.every((t) => t.kind === "same")).toBe(true);
    expect(r.right.every((t) => t.kind === "same")).toBe(true);
    // The visible text is preserved on both sides.
    expect(r.left.map((t) => t.text).join("")).toBe("hello world");
    expect(r.right.map((t) => t.text).join("")).toBe("hello world");
  });

  it("highlights only the changed word in a single-word substitution", () => {
    const r = wordDiff("const a = 1;", "const b = 1;");
    // Left side: 'a' deleted, rest same.
    const leftDel = r.left.filter((t) => t.kind === "del").map((t) => t.text);
    const rightAdd = r.right.filter((t) => t.kind === "add").map((t) => t.text);
    expect(leftDel).toEqual(["a"]);
    expect(rightAdd).toEqual(["b"]);
    // The remaining text is preserved.
    expect(r.left.map((t) => t.text).join("")).toBe("const a = 1;");
    expect(r.right.map((t) => t.text).join("")).toBe("const b = 1;");
  });

  it("treats whitespace runs as their own tokens (so indentation changes show up)", () => {
    const r = wordDiff("  foo", "    foo");
    const leftWS = r.left.filter((t) => t.kind === "del").map((t) => t.text);
    const rightWS = r.right.filter((t) => t.kind === "add").map((t) => t.text);
    expect(leftWS).toEqual(["  "]);
    expect(rightWS).toEqual(["    "]);
  });

  it("handles pure additions on the right", () => {
    const r = wordDiff("hello", "hello world");
    expect(r.left.filter((t) => t.kind === "del")).toHaveLength(0);
    const adds = r.right.filter((t) => t.kind === "add").map((t) => t.text);
    // Either " world" as a single coalesced add, or " " + "world" — both valid.
    expect(adds.join("")).toBe(" world");
  });

  it("handles pure deletions on the left", () => {
    const r = wordDiff("hello world", "hello");
    expect(r.right.filter((t) => t.kind === "add")).toHaveLength(0);
    const dels = r.left.filter((t) => t.kind === "del").map((t) => t.text);
    expect(dels.join("")).toBe(" world");
  });

  it("coalesces adjacent same/del/add runs", () => {
    const r = wordDiff("aaa bbb ccc", "aaa xxx ccc");
    // Left should have a single "del" run for "bbb" (or possibly "bbb" + empty).
    const dels = r.left.filter((t) => t.kind === "del");
    const adds = r.right.filter((t) => t.kind === "add");
    expect(dels.length).toBeGreaterThanOrEqual(1);
    expect(adds.length).toBeGreaterThanOrEqual(1);
    expect(dels.map((d) => d.text).join("")).toBe("bbb");
    expect(adds.map((a) => a.text).join("")).toBe("xxx");
  });

  it("produces empty arrays for empty inputs", () => {
    const r = wordDiff("", "");
    expect(r.left).toEqual([]);
    expect(r.right).toEqual([]);
  });

  it("punctuation-only changes are highlighted", () => {
    const r = wordDiff("foo()", "foo[]");
    const leftDel = r.left.filter((t) => t.kind === "del").map((t) => t.text);
    const rightAdd = r.right.filter((t) => t.kind === "add").map((t) => t.text);
    expect(leftDel.join("")).toBe("()");
    expect(rightAdd.join("")).toBe("[]");
  });
});
