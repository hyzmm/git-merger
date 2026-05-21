import { afterEach, describe, expect, test } from "bun:test";
import { toast, useToasts } from "./toast";

afterEach(() => {
  useToasts.getState().clear();
});

describe("useToasts", () => {
  test("push appends to the queue and returns an id", () => {
    const id = useToasts.getState().push("info", "hello");
    expect(id).toMatch(/^toast-/);
    const toasts = useToasts.getState().toasts;
    expect(toasts.length).toBe(1);
    expect(toasts[0]?.message).toBe("hello");
    expect(toasts[0]?.variant).toBe("info");
  });

  test("dismiss removes by id", () => {
    const a = useToasts.getState().push("info", "a");
    const b = useToasts.getState().push("info", "b");
    useToasts.getState().dismiss(a);
    const ids = useToasts.getState().toasts.map((t) => t.id);
    expect(ids).toEqual([b]);
  });

  test("clear empties the queue", () => {
    useToasts.getState().push("info", "x");
    useToasts.getState().push("info", "y");
    useToasts.getState().clear();
    expect(useToasts.getState().toasts.length).toBe(0);
  });

  test("queue caps at MAX_VISIBLE (oldest drops first)", () => {
    for (let i = 0; i < 7; i++) useToasts.getState().push("info", `t${i}`);
    const messages = useToasts.getState().toasts.map((t) => t.message);
    // MAX_VISIBLE is 4 — we keep the four most recent.
    expect(messages).toEqual(["t3", "t4", "t5", "t6"]);
  });

  test("error variant gets a longer default duration than info", () => {
    useToasts.getState().push("info", "i");
    useToasts.getState().push("error", "e");
    const [iT, eT] = useToasts.getState().toasts;
    expect(eT?.durationMs).toBeGreaterThan(iT?.durationMs ?? 0);
  });

  test("explicit durationMs overrides the default", () => {
    useToasts.getState().push("error", "boom", { durationMs: 1234 });
    expect(useToasts.getState().toasts[0]?.durationMs).toBe(1234);
  });

  test("detail copy is preserved", () => {
    useToasts.getState().push("warning", "main", { detail: "extra context" });
    expect(useToasts.getState().toasts[0]?.detail).toBe("extra context");
  });

  test("module helpers fire the right variant", () => {
    toast.success("ok");
    toast.warning("careful");
    toast.error("nope");
    const variants = useToasts.getState().toasts.map((t) => t.variant);
    expect(variants).toEqual(["success", "warning", "error"]);
  });
});
