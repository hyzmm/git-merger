import { useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdateState {
  /** Current state of the updater. */
  status: "idle" | "checking" | "available" | "downloading" | "ready" | "error";
  /** New version string when status is "available" or later. */
  available: { version: string; notes: string | null } | null;
  /** Bytes downloaded / total during download. */
  progress: { downloaded: number; total: number | null } | null;
  /** Last error, if any. */
  error: string | null;
}

const initial: UpdateState = {
  status: "idle",
  available: null,
  progress: null,
  error: null,
};

/**
 * Wraps tauri-plugin-updater for a small UI. Auto-runs `check()` once on
 * mount; exposes `download()` and `apply()` for manual control.
 */
export function useUpdater() {
  const [state, setState] = useState<UpdateState>(initial);
  // Hold the Update handle so we can call .download/.install after check().
  const updateRef = useRef<Update | null>(null);
  // Don't auto-check more than once per mount.
  const checkedRef = useRef(false);

  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;
    void runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runCheck() {
    setState((s) => ({ ...s, status: "checking", error: null }));
    try {
      const u = await check();
      if (!u) {
        setState({ ...initial, status: "idle" });
        return;
      }
      updateRef.current = u;
      setState({
        status: "available",
        available: { version: u.version, notes: u.body ?? null },
        progress: null,
        error: null,
      });
    } catch (e) {
      // In dev / unsigned builds the updater will fail — that's expected.
      setState({ ...initial, status: "error", error: String(e) });
    }
  }

  async function downloadAndInstall() {
    const u = updateRef.current;
    if (!u) return;
    setState((s) => ({ ...s, status: "downloading", progress: { downloaded: 0, total: null } }));
    try {
      let downloaded = 0;
      let contentLength: number | null = null;
      await u.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? null;
            setState((s) => ({
              ...s,
              progress: { downloaded: 0, total: contentLength },
            }));
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            setState((s) => ({
              ...s,
              progress: { downloaded, total: contentLength },
            }));
            break;
          case "Finished":
            setState((s) => ({ ...s, status: "ready" }));
            break;
        }
      });
    } catch (e) {
      setState((s) => ({ ...s, status: "error", error: String(e) }));
    }
  }

  async function apply() {
    try {
      await relaunch();
    } catch (e) {
      setState((s) => ({ ...s, status: "error", error: String(e) }));
    }
  }

  return { state, runCheck, downloadAndInstall, apply };
}
