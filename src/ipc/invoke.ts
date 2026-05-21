/**
 * Single Tauri-invoke chokepoint.
 *
 * The ergonomic value-add over the raw `@tauri-apps/api/core` import:
 *
 * 1. **Typed errors** — every rejected invoke is converted to a typed
 *    `AppError` (mirroring Rust's `crate::error::AppError`). Existing
 *    `catch (e) { setError(String(e)) }` call sites still work because
 *    the wrapper attaches a `toString` that yields a human-readable line.
 *
 * 2. **Optional auto-toast** — pass `{ toastOnError: true }` (or use the
 *    convenience `toastingInvoke`) to surface failures to the user via the
 *    central `useToasts` queue without writing a manual `try/catch` block.
 *
 * Migrating call sites is opt-in: `ipc/git.ts` upgraded to the typed-error
 * path so every backend call now rejects with `AppError`-shaped values.
 */

import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { type AppError, formatAppError, parseAppError } from "../lib/appError";
import { toast } from "../lib/toast";

export interface InvokeOptions {
  /** When true, a failure also pushes an `error` toast before rejecting. */
  toastOnError?: boolean;
  /** Override the auto-toast title; falls back to the formatted error. */
  toastTitle?: string;
}

/**
 * `Error` subclass carrying the typed `AppError` payload. Throwing this
 * instead of a plain object means call sites can do either:
 *   - `catch (e) { String(e) }` → still readable
 *   - `catch (e) { if (isAppErrorThrown(e)) handle(e.appError.kind) }`
 */
export class AppErrorThrown extends Error {
  readonly appError: AppError;

  constructor(appError: AppError) {
    super(formatAppError(appError));
    this.name = "AppError";
    this.appError = appError;
  }
}

export function isAppErrorThrown(e: unknown): e is AppErrorThrown {
  return e instanceof AppErrorThrown;
}

/**
 * Drop-in replacement for `@tauri-apps/api/core`'s `invoke<T>` that
 * normalises the rejection path to `AppErrorThrown`.
 */
export async function invoke<T>(cmd: string, args?: InvokeArgs, opts?: InvokeOptions): Promise<T> {
  try {
    return await tauriInvoke<T>(cmd, args);
  } catch (raw) {
    const appError = parseAppError(raw);
    if (opts?.toastOnError) {
      toast.error(opts.toastTitle ?? formatAppError(appError));
    }
    throw new AppErrorThrown(appError);
  }
}

/**
 * Convenience wrapper for fire-and-toast call sites: shows an error toast on
 * failure and resolves to `null` instead of rejecting. Returns `null` so the
 * caller can early-return without a `try/catch`.
 */
export async function toastingInvoke<T>(cmd: string, args?: InvokeArgs): Promise<T | null> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    const message = isAppErrorThrown(e) ? formatAppError(e.appError) : String(e);
    toast.error(message);
    return null;
  }
}
