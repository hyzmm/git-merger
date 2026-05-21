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
} from "lucide-react";
import { useApp } from "@/stores/app";
import { git, type ProgressEvent, type RemoteOpResult } from "@/ipc/git";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { AppMenu } from "@/components/AppMenu";
import { UndoButton } from "@/components/UndoButton";
import { SettingsDialog } from "@/components/SettingsDialog";
import { UpdateBadge } from "@/components/UpdateBadge";

type RemoteOp = "fetch" | "pull" | "push";

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
  const [progress, setProgress] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Subscribe to backend progress events.
  useEffect(() => {
    const un = listen<ProgressEvent>("git://progress", (ev) => {
      const p = ev.payload;
      switch (p.phase) {
        case "sideband":
          if (p.message) setProgress(p.message);
          break;
        case "receiving":
          setProgress(
            p.total > 0
              ? `${t("topbar.progress.receiving")} ${p.received}/${p.total}`
              : t("topbar.progress.receiving"),
          );
          break;
        case "indexing":
          setProgress(
            p.total > 0
              ? `${t("topbar.progress.indexing")} ${p.indexed}/${p.total}`
              : t("topbar.progress.indexing"),
          );
          break;
        case "pushing":
          setProgress(
            p.total > 0
              ? `${t("topbar.progress.pushing")} ${p.pushed}/${p.total}`
              : t("topbar.progress.pushing"),
          );
          break;
        case "push-status":
          if (p.status) setProgress(`${p.refname}: ${p.status}`);
          break;
        case "done":
          setProgress(null);
          break;
      }
    });
    return () => {
      void un.then((f) => f());
    };
  }, [t]);

  async function runRemote(op: RemoteOp) {
    if (!repo || running) return;
    setRunning(op);
    setOpResult(null);
    setProgress(null);
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
      setOpResult({
        op,
        ok: false,
        message: String(e),
        details: [],
      });
    } finally {
      setRunning(null);
      setProgress(null);
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
            <span className="max-w-[260px] truncate font-mono text-[11px] text-foreground/80">
              {progress}
            </span>
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
