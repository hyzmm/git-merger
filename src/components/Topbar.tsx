import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Cloud,
  GitBranch,
  RefreshCw,
  Search,
  Settings,
  X,
} from "lucide-react";
import { useApp } from "@/stores/app";
import { git, type ProgressEvent, type RemoteOpResult } from "@/ipc/git";
import { isAppErrorThrown } from "@/ipc/invoke";
import { useT, type TKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { AppMenu } from "@/components/AppMenu";
import { UndoButton } from "@/components/UndoButton";
import { SettingsDialog } from "@/components/SettingsDialog";
import { UpdateBadge } from "@/components/UpdateBadge";

type RemoteOp = "fetch" | "pull" | "push";

/**
 * Structured progress snapshot for an in-flight fetch / pull / push.
 *
 * The backend emits a stream of phase events on `git://progress` (started →
 * sideband / receiving / indexing / pushing → done | cancelled), each tagged
 * with an `op_id`. We collapse the most recent of each phase into a single
 * snapshot so the UI can render a single progress bar + status line per op.
 */
interface OpProgress {
  opId: number;
  op: RemoteOp;
  /** Current phase shown to the user (last non-`started` phase wins). */
  phase: "starting" | "sideband" | "receiving" | "indexing" | "pushing" | "push-status";
  /** 0..1 ratio for the active phase, or null if the phase has no total. */
  ratio: number | null;
  /** Inline status detail — sideband line, "received N/M", etc. */
  detail: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function Topbar() {
  const repo = useApp((s) => s.repo);
  const refresh = useApp((s) => s.refresh);
  const loadHistory = useApp((s) => s.loadHistory);
  const loadChanges = useApp((s) => s.loadChanges);
  const loading = useApp((s) => s.loading);
  const error = useApp((s) => s.error);
  const openPalette = useApp((s) => s.openPalette);
  const t = useT();

  const [running, setRunning] = useState<RemoteOp | null>(null);
  const [opResult, setOpResult] = useState<{
    op: RemoteOp;
    ok: boolean;
    message: string;
    details: string[];
  } | null>(null);
  const [progress, setProgress] = useState<OpProgress | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Subscribe to backend progress events. We always update our local
  // snapshot when the event's op_id matches the current one (or when a
  // fresh `started` event opens a new op).
  useEffect(() => {
    const un = listen<ProgressEvent>("git://progress", (ev) => {
      const p = ev.payload;
      setProgress((cur) => {
        // Lifecycle events
        if (p.phase === "started") {
          return {
            opId: p.op_id,
            op: p.op,
            phase: "starting",
            ratio: null,
            detail: t("topbar.progress.starting"),
          };
        }
        if (p.phase === "done" || p.phase === "cancelled") {
          // Clear our snapshot only if it belongs to this op — never
          // clobber a newer op's state with a stale event.
          if (cur && cur.opId !== p.op_id) return cur;
          return null;
        }
        // Stream events: ignore mismatched op_id (defensive — should be
        // impossible since we serialise remote ops, but events from a
        // previous op can still arrive late after `done`).
        if (cur && cur.opId !== p.op_id) return cur;
        const opId = p.op_id;
        const op = cur?.op ?? "fetch";
        switch (p.phase) {
          case "sideband":
            if (!p.message) return cur;
            return { opId, op, phase: "sideband", ratio: null, detail: p.message };
          case "receiving":
            return {
              opId,
              op,
              phase: "receiving",
              ratio: p.total > 0 ? p.received / p.total : null,
              detail:
                p.total > 0
                  ? `${t("topbar.progress.receiving")} ${p.received}/${p.total} · ${formatBytes(p.bytes)}`
                  : `${t("topbar.progress.receiving")} · ${formatBytes(p.bytes)}`,
            };
          case "indexing":
            return {
              opId,
              op,
              phase: "indexing",
              ratio: p.total > 0 ? p.indexed / p.total : null,
              detail:
                p.total > 0
                  ? `${t("topbar.progress.indexing")} ${p.indexed}/${p.total}`
                  : t("topbar.progress.indexing"),
            };
          case "pushing":
            return {
              opId,
              op,
              phase: "pushing",
              ratio: p.total > 0 ? p.pushed / p.total : null,
              detail:
                p.total > 0
                  ? `${t("topbar.progress.pushing")} ${p.pushed}/${p.total}`
                  : t("topbar.progress.pushing"),
            };
          case "push-status":
            // Per-ref response; only surface failures (success refs are
            // implicit from the eventual Done summary).
            if (!p.status) return cur;
            return {
              opId,
              op,
              phase: "push-status",
              ratio: cur?.ratio ?? null,
              detail: `${p.refname}: ${p.status}`,
            };
          default:
            return cur;
        }
      });
    });
    return () => {
      void un.then((f) => f());
    };
  }, [t]);

  // Esc cancels an in-flight op. We attach this directly to the window
  // (not via useShortcuts) so it fires even when the focus is on a
  // form input — cancelling is exactly the kind of thing you want to
  // be possible mid-typing.
  useEffect(() => {
    if (!running || !progress) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !cancelling) {
        e.preventDefault();
        void requestCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, progress, cancelling]);

  async function requestCancel() {
    if (!progress || cancelling) return;
    setCancelling(true);
    try {
      await git.cancelRemoteOp(progress.opId);
    } catch {
      // The backend op likely finished between our event and our call.
      // Either way, the next `done`/`cancelled` event will clear state.
    }
  }

  async function runRemote(op: RemoteOp) {
    if (!repo || running) return;
    setRunning(op);
    setOpResult(null);
    setProgress(null);
    setCancelling(false);
    try {
      let result: RemoteOpResult;
      if (op === "fetch") result = await git.fetch(repo.path);
      else if (op === "pull") result = await git.pull(repo.path);
      else result = await git.push(repo.path);
      setOpResult({ op, ok: result.success, message: result.message, details: result.details });
      if (result.success) {
        void loadHistory();
        void loadChanges();
      }
    } catch (e) {
      // For known remote-op shapes, surface a more pointed banner title than
      // a raw libgit2 message. The full text still goes into `details` so the
      // user can copy the original for bug reports.
      const original = String(e);
      let message = original;
      if (isAppErrorThrown(e)) {
        const ae = e.appError;
        if (ae.kind === "NonFastForward") {
          message = "Remote has diverged from your branch — open the Merge view or rebase first.";
        } else if (ae.kind === "Auth") {
          message = "Authentication failed — check your credentials or SSH key.";
        } else if (ae.kind === "UserCancelled") {
          message = "Cancelled.";
        } else {
          message = ae.message;
        }
      }
      setOpResult({
        op,
        ok: false,
        message,
        details: original === message ? [] : [original],
      });
    } finally {
      setRunning(null);
      setCancelling(false);
      // Don't force-clear `progress` here — the backend's `done` /
      // `cancelled` event will already have cleared it via the listener.
      // If for some reason we missed it, leave the last frame visible
      // for one more render rather than blink it away.
    }
  }

  return (
    <>
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
        <AppMenu />

        {repo && (
          <>
            <button
              onClick={() => refresh()}
              disabled={loading}
              title={t("topbar.refresh")}
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                loading && "animate-spin",
              )}
            >
              <RefreshCw className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <GitBranch className="h-4 w-4" />
              <span className="font-mono">{repo.head ?? t("topbar.detached")}</span>
              <span className="text-xs opacity-70">{repo.path}</span>
            </div>

            <div className="ml-3 flex items-center gap-1">
              <RemoteBtn
                op="fetch"
                running={running}
                Icon={Cloud}
                onClick={() => runRemote("fetch")}
                title={t("topbar.fetch")}
              />
              <RemoteBtn
                op="pull"
                running={running}
                Icon={ArrowDownToLine}
                onClick={() => runRemote("pull")}
                title={t("topbar.pull")}
              />
              <RemoteBtn
                op="push"
                running={running}
                Icon={ArrowUpFromLine}
                onClick={() => runRemote("push")}
                title={t("topbar.push")}
              />
            </div>

            <div className="ml-2 flex items-center">
              <UndoButton />
            </div>
          </>
        )}

        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {repo && (
            <button
              onClick={openPalette}
              title={t("topbar.search")}
              className="hidden h-7 items-center gap-2 rounded-md border border-border bg-secondary px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground sm:flex"
            >
              <Search className="h-3 w-3" />
              <span>{t("topbar.search")}</span>
              <kbd className="ml-2 rounded border border-border bg-background px-1 font-mono text-[10px]">
                Ctrl+K
              </kbd>
            </button>
          )}
          {progress && (
            <ProgressIndicator
              progress={progress}
              cancelling={cancelling}
              onCancel={requestCancel}
              t={t}
            />
          )}
          {loading && !progress && <span>{t("topbar.loading")}</span>}
          {error && <span className="text-destructive">{error}</span>}
          <UpdateBadge />
          <button
            onClick={() => setSettingsOpen(true)}
            title={t("topbar.settings")}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </header>

      {opResult && <RemoteResultBanner result={opResult} onDismiss={() => setOpResult(null)} />}

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}

function RemoteBtn({
  op,
  running,
  Icon,
  onClick,
  title,
}: {
  op: RemoteOp;
  running: RemoteOp | null;
  Icon: typeof Cloud;
  onClick: () => void;
  title: string;
}) {
  const isRunning = running === op;
  const disabled = running !== null;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        disabled && !isRunning && "opacity-50",
        isRunning && "bg-accent text-accent-foreground",
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", isRunning && "animate-pulse")} />
      <span className="capitalize">{op}</span>
    </button>
  );
}

function ProgressIndicator({
  progress,
  cancelling,
  onCancel,
  t,
}: {
  progress: OpProgress;
  cancelling: boolean;
  onCancel: () => void;
  t: (key: TKey) => string;
}) {
  // Indeterminate phases (sideband / push-status without a ratio) get a
  // pulsing bar instead of a fill so the user still sees "something is
  // happening" without a misleading 0 %.
  const determinate = progress.ratio !== null;
  const pct = determinate ? Math.round((progress.ratio ?? 0) * 100) : null;

  return (
    <div
      className="flex items-center gap-2 text-[11px]"
      title={progress.detail}
      aria-label={`${progress.op} progress: ${progress.detail}`}
    >
      <div className="flex items-center gap-1.5">
        <span className="font-semibold uppercase tracking-wider text-muted-foreground">
          {progress.op}
        </span>
        <div
          className="relative h-1.5 w-24 overflow-hidden rounded-full bg-secondary"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={determinate ? 100 : undefined}
          aria-valuenow={pct ?? undefined}
        >
          {determinate ? (
            <div
              className="h-full rounded-full bg-[hsl(var(--branch-1))] transition-[width] duration-150"
              style={{ width: `${pct}%` }}
            />
          ) : (
            // Indeterminate: subtle shimmer using a CSS animation that's
            // already part of Tailwind's preflight (`animate-pulse`).
            <div className="h-full w-full animate-pulse bg-[hsl(var(--branch-1)/.45)]" />
          )}
        </div>
        {determinate && <span className="w-9 text-right font-mono text-foreground/80">{pct}%</span>}
      </div>
      <span className="hidden max-w-[180px] truncate font-mono text-[11px] text-foreground/70 lg:inline">
        {progress.detail}
      </span>
      <button
        type="button"
        onClick={onCancel}
        disabled={cancelling}
        title={t("topbar.cancelTitle")}
        className={cn(
          "flex h-5 items-center gap-0.5 rounded border border-border px-1.5 text-[10.5px]",
          "text-muted-foreground hover:bg-destructive/15 hover:text-destructive",
          cancelling && "cursor-wait opacity-60",
        )}
      >
        <X className="h-3 w-3" />
        {cancelling ? t("topbar.cancelling") : t("topbar.cancel")}
      </button>
    </div>
  );
}

function RemoteResultBanner({
  result,
  onDismiss,
}: {
  result: { op: RemoteOp; ok: boolean; message: string; details: string[] };
  onDismiss: () => void;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-start gap-2 border-b border-border px-3 py-1.5 text-[11px]",
        result.ok
          ? "bg-[hsl(142_70%_55%/.10)] text-[hsl(142_70%_55%)]"
          : "bg-[hsl(0_72%_51%/.10)] text-[hsl(0_72%_65%)]",
      )}
    >
      <span className="shrink-0 font-semibold uppercase tracking-wider">
        {result.op} {result.ok ? "ok" : "failed"}
      </span>
      <div className="m-0 max-h-24 flex-1 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-foreground/85">
        <div>{result.message}</div>
        {result.details.length > 0 && (
          <ul className="mt-1 list-disc pl-4 opacity-80">
            {result.details.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="shrink-0 rounded px-2 py-0.5 text-[10.5px] text-muted-foreground hover:bg-accent"
      >
        Dismiss
      </button>
    </div>
  );
}
