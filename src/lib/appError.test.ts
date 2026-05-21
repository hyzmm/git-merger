import { describe, expect, test } from "bun:test";
import {
  formatAppError,
  isAppError,
  isErrorOfKind,
  parseAppError,
  type AppError,
} from "./appError";

describe("parseAppError", () => {
  test("preserves a well-formed backend AppError", () => {
    const raw = {
      kind: "NotFound",
      message: "ref does not exist",
      code: "NotFound",
      class: "Reference",
    };
    const e = parseAppError(raw);
    expect(e.kind).toBe("NotFound");
    expect(e.message).toBe("ref does not exist");
    expect(e.code).toBe("NotFound");
    expect(e.class).toBe("Reference");
  });

  test("AppError without optional code/class still parses", () => {
    const raw = { kind: "InvalidArgument", message: "bad oid" };
    const e = parseAppError(raw);
    expect(e.kind).toBe("InvalidArgument");
    expect(e.message).toBe("bad oid");
    expect(e.code).toBeUndefined();
    expect(e.class).toBeUndefined();
  });

  test("unknown kind falls back to Other", () => {
    const raw = { kind: "WeirdNewKind", message: "huh" };
    const e = parseAppError(raw);
    expect(e.kind).toBe("Other");
    expect(e.message).toBe("huh");
  });

  test("native Error falls back to Other with the original message", () => {
    const e = parseAppError(new Error("network unreachable"));
    expect(e.kind).toBe("Other");
    expect(e.message).toBe("network unreachable");
  });

  test("plain string error wraps as Other", () => {
    const e = parseAppError("oops");
    expect(e.kind).toBe("Other");
    expect(e.message).toBe("oops");
  });

  test("nullish thrown value becomes a stringified Other", () => {
    const e1 = parseAppError(null);
    expect(e1.kind).toBe("Other");
    expect(e1.message).toBe("null");
    const e2 = parseAppError(undefined);
    expect(e2.kind).toBe("Other");
    expect(e2.message).toBe("undefined");
  });

  test("all known kinds round-trip", () => {
    const kinds: AppError["kind"][] = [
      "NotFound",
      "MergeConflict",
      "NonFastForward",
      "Auth",
      "UserCancelled",
      "InvalidArgument",
      "Git",
      "Io",
      "Internal",
      "Other",
    ];
    for (const k of kinds) {
      const e = parseAppError({ kind: k, message: "x" });
      expect(e.kind).toBe(k);
    }
  });
});

describe("formatAppError", () => {
  test("hides redundant Other prefix", () => {
    expect(formatAppError({ kind: "Other", message: "boom" })).toBe("boom");
  });
  test("prepends kind for non-Other errors", () => {
    expect(formatAppError({ kind: "NotFound", message: "x" })).toBe("NotFound: x");
    expect(formatAppError({ kind: "Auth", message: "creds rejected" })).toBe(
      "Auth: creds rejected",
    );
  });
});

describe("predicates", () => {
  test("isAppError accepts well-formed objects", () => {
    expect(isAppError({ kind: "Git", message: "x" })).toBe(true);
  });
  test("isAppError rejects malformed shapes", () => {
    expect(isAppError(null)).toBe(false);
    expect(isAppError({})).toBe(false);
    expect(isAppError({ kind: "X", message: "y" })).toBe(false);
    expect(isAppError("just a string")).toBe(false);
  });
  test("isErrorOfKind discriminates", () => {
    const e = { kind: "NonFastForward", message: "x" };
    expect(isErrorOfKind(e, "NonFastForward")).toBe(true);
    expect(isErrorOfKind(e, "Auth")).toBe(false);
    expect(isErrorOfKind("plain string", "Other")).toBe(false);
  });
});
