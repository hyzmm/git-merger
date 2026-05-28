/**
 * Typed mirror of Rust's `crate::error::AppError`.
 *
 * Backend commands serialise this as `{ kind, message, code?, class? }`.
 * `parseAppError` upgrades any `unknown` thrown across the Tauri boundary
 * (object | string | Error) into a stable shape so callers can branch on
 * `kind` without parsing free-form messages.
 *
 * Legacy invariant: many call sites still do `String(e)` and expect a
 * human-readable string, so `AppError` instances *also* override `toString`
 * via `formatAppError` — see `wrapInvokeError` in `ipc/invoke.ts`.
 */

export type AppErrorKind =
  | "NotFound"
  | "MergeConflict"
  | "NonFastForward"
  | "Auth"
  | "UserCancelled"
  /** v0.13.21 — `force-with-lease` push refused: the remote ref no longer
   *  points where we expected it. Caller should fetch and reconfirm. */
  | "StaleLease"
  | "InvalidArgument"
  | "Git"
  | "Io"
  | "Internal"
  | "Other";

export interface AppError {
  kind: AppErrorKind;
  message: string;
  /** Stringified `git2::ErrorCode` when the source was a libgit2 error. */
  code?: string;
  /** Stringified `git2::ErrorClass` when the source was a libgit2 error. */
  class?: string;
}

const KNOWN_KINDS: ReadonlySet<AppErrorKind> = new Set<AppErrorKind>([
  "NotFound",
  "MergeConflict",
  "NonFastForward",
  "Auth",
  "UserCancelled",
  "StaleLease",
  "InvalidArgument",
  "Git",
  "Io",
  "Internal",
  "Other",
]);

function isAppErrorKind(x: unknown): x is AppErrorKind {
  return typeof x === "string" && KNOWN_KINDS.has(x as AppErrorKind);
}

/**
 * Promote any thrown value into a typed `AppError`.
 *
 * - Object with `{ kind, message }` from Rust → kept as-is (after validation).
 * - Plain string → `{ kind: "Other", message }`.
 * - Native `Error` → `{ kind: "Other", message: e.message }`.
 * - Anything else → `{ kind: "Other", message: String(e) }`.
 */
export function parseAppError(e: unknown): AppError {
  if (e && typeof e === "object") {
    const obj = e as Record<string, unknown>;
    const kindRaw = obj.kind;
    const message = typeof obj.message === "string" ? obj.message : "";
    if (isAppErrorKind(kindRaw) && message.length > 0) {
      const out: AppError = { kind: kindRaw, message };
      if (typeof obj.code === "string") out.code = obj.code;
      if (typeof obj.class === "string") out.class = obj.class;
      return out;
    }
    // Native Error
    if (typeof obj.message === "string" && obj.message.length > 0) {
      return { kind: "Other", message: obj.message };
    }
  }
  if (typeof e === "string") {
    return { kind: "Other", message: e };
  }
  return { kind: "Other", message: String(e) };
}

/**
 * Render an `AppError` for display. Matches the legacy `String(e)` look on
 * old call sites — `kind` is prepended only when it adds information beyond
 * the bare message (`Other` is the legacy default and gets hidden).
 */
export function formatAppError(e: AppError): string {
  if (e.kind === "Other") return e.message;
  return `${e.kind}: ${e.message}`;
}

/**
 * `kind`-based predicates used by callers that want to react to specific
 * shapes (e.g. show a non-FF guide instead of a toast).
 */
export const isAppError = (e: unknown): e is AppError =>
  !!e && typeof e === "object" && isAppErrorKind((e as { kind?: unknown }).kind);

export const isErrorOfKind = (e: unknown, kind: AppErrorKind): boolean =>
  isAppError(e) && e.kind === kind;
