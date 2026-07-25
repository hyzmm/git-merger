import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  Cloud,
  GitBranch,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useApp } from "@/stores/app";
import { git, type ProgressEvent, type RemoteOpResult } from "@/ipc/git";
import { isAppErrorThrown } from "@/ipc/invoke";
import { useT, type TKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { confirm } from "@/lib/confirm";
import { Button } from "@/components/ui/button";
import { AppMenu } from "@/components/AppMenu";
import { UndoButton } from "@/components/UndoButton";
import { SettingsDialog } from "@/components/SettingsDialog";
import { UpdateBadge } from "@/components/UpdateBadge";

type RemoteOp = "fetch" | "pull" | "push";

/**
 * v0.13.21 — push variants surfaced via the push button's dropdown.
 *
 * - "plain":  plain non-forced push (default).
 * - "lease":  `force-with-lease` — backend probes the remote tip first; if
 *             it matches what we last saw, it promotes to a forced refspec,
 *             otherwise it returns a `StaleLease` error and we route the
 *             user to "Fetch + retry".
 * - "force":  unconditional `git push --force`. Gated behind a confirmation
 *             dialog and an explicit dropdown choice — there is no shortcut.
 */
type PushVariant = "plain" | "lease" | "force";

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
  const refs = useApp((s) => s.history.refs);
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
    /** v0.13.21 — when set, the banner shows a "Fetch + retry" button. */
    staleLease?: {
      variant: PushVariant;
    };
  } | null>(null);
  const [progress, setProgress] = useState<OpProgress | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [pushMenuOpen, setPushMenuOpen] = useState(false);
  const pushMenuRef = useRef<HTMLDivElement | null>(null);

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

  /**
   * Best-effort lookup of the remote-tracking ref for the current HEAD.
   * Used to compute the `expectedRemoteOid` for a force-with-lease push.
   *
   * Returns `null` when:
   *   - HEAD is detached or unknown,
   *   - we can't find a matching `<remote>/<branch>` in the refs list (e.g.
   *     the branch hasn't been pushed yet),
   *   - the matching ref has no target oid.
   *
   * In any of those cases the caller should treat lease-push as a "first
   * time push" — the backend will detect the absent remote ref and fall
   * back to a plain create.
   */
  function leaseExpectedOid(): string | null {
    const branch = repo?.head;
    if (!branch) return null;
    const remoteRef = refs.find((r) => r.kind === "remote_branch" && r.name.endsWith(`/${branch}`));
    return remoteRef?.target ?? null;
  }

  async function runRemote(op: RemoteOp, pushVariant: PushVariant = "plain") {
    if (!repo || running) return;

    // v0.13.22 — every remote op that mutates the local or remote state must
    // pass through ConfirmDialog before firing. Fetch is read-only (just
    // updates remote-tracking refs and the object DB), so it's exempt; pull
    // (rewrites HEAD), plain push (mutates the remote), force/lease push
    // (already gated on the dropdown / confirm path) all confirm. The lease
    // variant doesn't add a *second* dialog because the dropdown click is
    // already an explicit choice and the failure path has its own banner.
    if (op === "pull") {
      const ok = await confirm({
        level: "warning",
        title: "Pull?",
        message:
          "Fetches the upstream of the current branch and fast-forwards. Refuses on a non-fast-forward; use the Merge view to integrate diverging history.",
        detail: `git pull (fast-forward only) on ${repo.head ?? "HEAD"}`,
        confirmLabel: "Pull",
      });
      if (!ok) return;
    } else if (op === "push" && pushVariant === "plain") {
      const ok = await confirm({
        level: "warning",
        title: "Push current branch?",
        message:
          "Sends the current branch to its upstream. Plain (non-forced) push refuses on a non-fast-forward.",
        detail: `git push${repo.head ? ` origin ${repo.head}` : ""}`,
        confirmLabel: "Push",
      });
      if (!ok) return;
    }

    setRunning(op);
    setOpResult(null);
    setProgress(null);
    setCancelling(false);
    try {
      let result: RemoteOpResult;
      if (op === "fetch") {
        result = await git.fetch(repo.path);
      } else if (op === "pull") {
        result = await git.pull(repo.path);
      } else {
        // Push variant decides what we send to the backend:
        //  - plain:  no force, no lease.
        //  - lease:  no force, expected_remote_oid = current remote-tracking ref.
        //  - force:  force=true (skips lease check entirely).
        const opts: Parameters<typeof git.push>[1] =
          pushVariant === "force"
            ? { force: true }
            : pushVariant === "lease"
              ? { expectedRemoteOid: leaseExpectedOid() }
              : {};
        result = await git.push(repo.path, opts);
      }
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
      let staleLease: { variant: PushVariant } | undefined;
      if (isAppErrorThrown(e)) {
        const ae = e.appError;
        if (ae.kind === "NonFastForward") {
          message = "Remote has diverged from your branch — open the Merge view or rebase first.";
        } else if (ae.kind === "StaleLease") {
          // v0.13.21 — surface a dedicated banner with a one-click
          // "Fetch + retry" action instead of the raw libgit2 detail.
          message = t("topbar.push.staleLease.message");
          staleLease = { variant: pushVariant };
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
        staleLease,
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

  // Close push menu on outside click / Esc.
  useEffect(() => {
    if (!pushMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (pushMenuRef.current && !pushMenuRef.current.contains(e.target as Node)) {
        setPushMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPushMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pushMenuOpen]);

  async function onForcePushClicked() {
    setPushMenuOpen(false);
    const ok = await confirm({
      level: "danger",
      title: t("topbar.push.forceConfirm.title"),
      message: t("topbar.push.forceConfirm.message"),
      detail: `git push --force ${repo?.head ? `origin ${repo.head}` : ""}`.trim(),
      confirmLabel: t("topbar.push.forceConfirm.confirmLabel"),
    });
    if (!ok) return;
    void runRemote("push", "force");
  }

  async function onFetchAndRetryStaleLease(variant: PushVariant) {
    // The user fetched the remote out-of-band by clicking "Fetch + retry":
    // do the fetch, refresh refs (so leaseExpectedOid() picks up the new
    // tip), and re-attempt the same variant of push.
    setOpResult(null);
    try {
      await git.fetch(repo!.path);
      // Refresh the in-memory refs so the next leaseExpectedOid() reads the
      // updated remote-tracking oid. Cheaper than a full loadHistory.
      void loadHistory();
    } catch {
      // If fetch fails, the next push attempt will surface its own error.
    }
    void runRemote("push", variant);
  }

  return (
    <>
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
        <AppMenu />

        {repo && (
          <>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => refresh()}
              disabled={loading}
              title={t("topbar.refresh")}
              className={cn(loading && "animate-spin")}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>

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
              {/* v0.13.21 — push split-button: main click = plain push,
                  the chevron flyout offers force-with-lease + force. */}
              <div ref={pushMenuRef} className="relative flex items-center">
                <RemoteBtn
                  op="push"
                  running={running}
                  Icon={ArrowUpFromLine}
                  onClick={() => runRemote("push", "plain")}
                  title={t("topbar.push")}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  type="button"
                  onClick={() => setPushMenuOpen((v) => !v)}
                  disabled={running !== null}
                  title={t("topbar.push.menu")}
                  className={cn(
                    running !== null && "cursor-not-allowed opacity-50",
                    pushMenuOpen && "bg-accent text-accent-foreground",
                  )}
                >
                  <ChevronDown className="h-3 w-3" />
                </Button>
                {pushMenuOpen && (
                  <div
                    className="absolute left-0 top-9 z-50 w-72 rounded-md border border-border bg-popover py-1 text-xs text-popover-foreground shadow-lg"
                    role="menu"
                  >
                    <PushMenuItem
                      label={t("topbar.push.plain")}
                      hint={t("topbar.push.plainHint")}
                      onClick={() => {
                        setPushMenuOpen(false);
                        void runRemote("push", "plain");
                      }}
                    />
                    <PushMenuItem
                      label={t("topbar.push.lease")}
                      hint={t("topbar.push.leaseHint")}
                      onClick={() => {
                        setPushMenuOpen(false);
                        void runRemote("push", "lease");
                      }}
                    />
                    <div className="my-1 h-px bg-border" />
                    <PushMenuItem
                      label={t("topbar.push.force")}
                      hint={t("topbar.push.forceHint")}
                      danger
                      onClick={() => void onForcePushClicked()}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="ml-2 flex items-center">
              <UndoButton />
            </div>
          </>
        )}

        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {repo && (
            <Button
              variant="secondary"
              size="sm"
              onClick={openPalette}
              title={t("topbar.search")}
              className="hidden sm:flex items-center gap-2"
            >
              <Search className="h-3 w-3" />
              <span>{t("topbar.search")}</span>
              <kbd className="ml-2 rounded border border-border bg-background px-1 font-mono text-[10px]">
                Ctrl+K
              </kbd>
            </Button>
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
          <SettingsDialog />
        </div>
      </header>

      {opResult && (
        <RemoteResultBanner
          result={opResult}
          onDismiss={() => setOpResult(null)}
          onFetchAndRetry={
            opResult.staleLease
              ? () => void onFetchAndRetryStaleLease(opResult.staleLease!.variant)
              : undefined
          }
          t={t}
        />
      )}
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
      <Button
        variant="ghost"
        size="sm"
        onClick={onClick}
        disabled={disabled}
        title={title}
        className={cn(
          disabled && !isRunning && "opacity-50",
          isRunning && "bg-accent text-accent-foreground",
        )}
      >
        <Icon className={cn("h-3.5 w-3.5", isRunning && "animate-pulse")} />
        <span className="capitalize">{op}</span>
      </Button>
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
      <Button
        variant="ghost"
        size="xs"
        type="button"
        onClick={onCancel}
        disabled={cancelling}
        title={t("topbar.cancelTitle")}
        className={cn(
          "border border-border",
          cancelling && "cursor-wait opacity-60",
        )}
      >
        <X className="h-3 w-3" />
        {cancelling ? t("topbar.cancelling") : t("topbar.cancel")}
      </Button>
    </div>
  );
}

function RemoteResultBanner({
  result,
  onDismiss,
  onFetchAndRetry,
  t,
}: {
  result: {
    op: RemoteOp;
    ok: boolean;
    message: string;
    details: string[];
    staleLease?: { variant: PushVariant };
  };
  onDismiss: () => void;
  /** v0.13.21 — when the failure was a stale lease, this is wired to a
   *  one-click "fetch + retry the same push variant" handler. */
  onFetchAndRetry?: () => void;
  t: (key: TKey) => string;
}) {
  const isStaleLease = !!result.staleLease;
  return (
    <div
      className={cn(
        "flex shrink-0 items-start gap-2 border-b border-border px-3 py-1.5 text-[11px]",
        result.ok
          ? "bg-[hsl(142_70%_55%/.10)] text-[hsl(142_70%_55%)]"
          : isStaleLease
            ? "bg-[hsl(38_90%_55%/.10)] text-[hsl(38_90%_55%)]"
            : "bg-[hsl(0_72%_51%/.10)] text-[hsl(0_72%_65%)]",
      )}
    >
      <span className="shrink-0 font-semibold uppercase tracking-wider">
        {isStaleLease
          ? t("topbar.push.staleLease.title")
          : `${result.op} ${result.ok ? "ok" : "failed"}`}
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
      {onFetchAndRetry && (
        <Button
          variant="ghost"
          size="xs"
          type="button"
          onClick={onFetchAndRetry}
          className="border border-border"
        >
          {t("topbar.push.staleLease.fetch")}
        </Button>
      )}
      <Button
        variant="ghost"
        size="xs"
        onClick={onDismiss}
      >
        Dismiss
      </Button>
    </div>
  );
}

function PushMenuItem({
  label,
  hint,
  danger,
  onClick,
}: {
  label: string;
  hint?: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      onClick={onClick}
      role="menuitem"
      className={cn(
        "w-full flex-col items-start gap-0.5",
        danger && "text-destructive",
      )}
    >
      <span className="text-xs">{label}</span>
      {hint && <span className="text-[10.5px] text-muted-foreground">{hint}</span>}
    </Button>
  );
}
