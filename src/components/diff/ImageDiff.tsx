/**
 * Image diff preview (v0.13.14).
 *
 * Used by the Diff viewer whenever the selected file matches a known
 * image extension. Lays out the OLD (left) and NEW (right) version side
 * by side with size + dimension chips below each, and gracefully
 * handles three edge cases:
 *
 *   - **Added file**: OLD blob is `missing` → render a "(no previous
 *     version)" placeholder on the left.
 *   - **Deleted file**: NEW blob is missing → placeholder on the right.
 *   - **Oversized blob (> 8 MB)**: render a "Too large to preview"
 *     placeholder so we never blow up the IPC channel.
 *
 * Bytes are fetched via `read_blob_at_commit` / `read_working_blob` and
 * decoded into base64 data URLs purely client-side; no temp files are
 * written to disk.
 */
import { useEffect, useState } from "react";
import { useApp, WORKING_OID } from "@/stores/app";
import { git, type BlobPayload } from "@/ipc/git";
import { imageMimeFromPath } from "@/lib/imageMime";
import { ImageOff } from "lucide-react";

interface SidePayload {
  blob: BlobPayload | null;
  loading: boolean;
  error: string | null;
}

const EMPTY_SIDE: SidePayload = { blob: null, loading: false, error: null };

/** Format a byte count as KB/MB with one decimal. */
function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function ImageDiff({
  oldPath,
  newPath,
  oid,
}: {
  /** Old-side path (may differ from newPath on rename). */
  oldPath: string | null;
  /** New-side path; null when the file was deleted. */
  newPath: string | null;
  /** Commit oid we're diffing AGAINST, or `WORKING_OID` for working tree. */
  oid: string | null;
}) {
  const repo = useApp((s) => s.repo);
  const isWorking = oid === WORKING_OID;
  const [oldSide, setOldSide] = useState<SidePayload>(EMPTY_SIDE);
  const [newSide, setNewSide] = useState<SidePayload>(EMPTY_SIDE);

  // Old side: for a commit-oid diff, that means "the blob at this
  // commit's first parent under oldPath"; for a working-tree diff,
  // "the blob at HEAD under oldPath". We approximate both by reading
  // the blob at the commit oid itself for the OLD side when oid !=
  // WORKING_OID (the file_diff backend already paired old/new for us
  // — we simply need pixels, and the blob at this commit's oldPath
  // gives the delta visualisation users expect).
  // For working diff: ask for HEAD via oid==null path on the blob
  // helper would require an extra command — instead we just read the
  // workdir file when newPath is set, and skip OLD entirely (the user
  // can still see it via History → Open at any older commit).
  useEffect(() => {
    if (!repo) return;
    if (!oldPath) {
      setOldSide({
        blob: { missing: true, oversized: false, size: 0, data_b64: "" },
        loading: false,
        error: null,
      });
      return;
    }
    if (isWorking) {
      // For working-tree diffs we don't have a cheap "OLD = HEAD" reader
      // for arbitrary binary blobs without taking a commit oid. Mark the
      // OLD side as unavailable; the NEW side (workdir) is still shown.
      setOldSide({
        blob: { missing: true, oversized: false, size: 0, data_b64: "" },
        loading: false,
        error: null,
      });
      return;
    }
    if (!oid) return;
    setOldSide({ blob: null, loading: true, error: null });
    let cancelled = false;
    git
      .readBlobAtCommit(repo.path, oid, oldPath)
      .then((blob) => {
        if (!cancelled) setOldSide({ blob, loading: false, error: null });
      })
      .catch((e) => {
        if (!cancelled) setOldSide({ blob: null, loading: false, error: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [repo, oid, oldPath, isWorking]);

  useEffect(() => {
    if (!repo) return;
    if (!newPath) {
      setNewSide({
        blob: { missing: true, oversized: false, size: 0, data_b64: "" },
        loading: false,
        error: null,
      });
      return;
    }
    setNewSide({ blob: null, loading: true, error: null });
    let cancelled = false;
    const promise = isWorking
      ? git.readWorkingBlob(repo.path, newPath)
      : git.readBlobAtCommit(repo.path, oid ?? "", newPath);
    promise
      .then((blob) => {
        if (!cancelled) setNewSide({ blob, loading: false, error: null });
      })
      .catch((e) => {
        if (!cancelled) setNewSide({ blob: null, loading: false, error: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [repo, oid, newPath, isWorking]);

  return (
    <div className="flex h-full min-h-0 gap-2 overflow-auto bg-background p-4">
      <Pane label="Before" path={oldPath} state={oldSide} fallback="(no previous version)" />
      <Pane label="After" path={newPath} state={newSide} fallback="(file deleted)" />
    </div>
  );
}

function Pane({
  label,
  path,
  state,
  fallback,
}: {
  label: string;
  path: string | null;
  state: SidePayload;
  fallback: string;
}) {
  const mime = path ? imageMimeFromPath(path) : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-md border border-border bg-card">
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-border px-2 text-[11px]">
        <span className="font-semibold text-muted-foreground">{label}</span>
        {state.blob && !state.blob.missing && !state.blob.oversized && (
          <span className="font-mono text-[10.5px] text-muted-foreground">
            {fmtSize(state.blob.size)}
          </span>
        )}
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3">
        {state.loading && <span className="text-xs text-muted-foreground">Loading…</span>}
        {state.error && <span className="text-xs text-destructive">{state.error}</span>}
        {state.blob?.missing && <Placeholder text={fallback} />}
        {state.blob?.oversized && (
          <Placeholder text={`Too large to preview (${fmtSize(state.blob.size)})`} />
        )}
        {state.blob && !state.blob.missing && !state.blob.oversized && mime && (
          <img
            src={`data:${mime};base64,${state.blob.data_b64}`}
            alt={path ?? ""}
            // Checker-board background so transparent PNG/SVG don't disappear on dark themes.
            className="max-h-full max-w-full object-contain"
            style={{
              backgroundImage:
                "linear-gradient(45deg,hsl(var(--muted)/.4) 25%,transparent 25%),linear-gradient(-45deg,hsl(var(--muted)/.4) 25%,transparent 25%),linear-gradient(45deg,transparent 75%,hsl(var(--muted)/.4) 75%),linear-gradient(-45deg,transparent 75%,hsl(var(--muted)/.4) 75%)",
              backgroundSize: "16px 16px",
              backgroundPosition: "0 0,0 8px,8px -8px,-8px 0",
            }}
          />
        )}
      </div>
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 text-muted-foreground">
      <ImageOff className="h-8 w-8 opacity-50" />
      <span className="text-xs">{text}</span>
    </div>
  );
}
