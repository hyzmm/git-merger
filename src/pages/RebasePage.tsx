/**
 * Interactive Rebase planner + executor.
 *
 * Two modes:
 *   - draft: plan steps before starting (reorder ↑/↓, change action, edit
 *     reword/squash messages). Click "Start rebase".
 *   - executing: backend has begun replaying. We show a progress bar and the
 *     remaining steps; on conflict we route the user to the Merge view.
 */
import { useEffect } from "react";
import { ArrowDown, ArrowUp, GitMerge, RotateCcw } from "lucide-react";
import { useApp } from "@/stores/app";
import type { RebaseAction, RebaseStep } from "@/ipc/git";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const ACTION_TONES: Record<RebaseAction, string> = {
  pick: "bg-secondary text-foreground",
  reword: "bg-[hsl(var(--branch-2)/.20)] text-[hsl(var(--branch-2))]",
  squash: "bg-[hsl(var(--branch-3)/.20)] text-[hsl(var(--branch-3))]",
  fixup: "bg-[hsl(var(--branch-4)/.20)] text-[hsl(var(--branch-4))]",
  drop: "bg-[hsl(var(--destructive)/.18)] text-[hsl(var(--destructive))] line-through",
};

export function RebasePage() {
  const repo = useApp((s) => s.repo);
  const rebase = useApp((s) => s.rebase);
  const setView = useApp((s) => s.setView);
  const updateStep = useApp((s) => s.updateRebaseStep);
  const moveStep = useApp((s) => s.moveRebaseStep);
  const startRebase = useApp((s) => s.startRebase);
  const continueRebase = useApp((s) => s.rebaseContinue);
  const abortRebase = useApp((s) => s.rebaseAbort);
  const closePlan = useApp((s) => s.closeRebasePlan);
  const refreshStatus = useApp((s) => s.refreshRebaseStatus);
  const t = useT();

  const inProgress = rebase.state !== null;
  const conflicted = rebase.conflicted;

  useEffect(() => {
    if (repo) void refreshStatus();
  }, [repo, refreshStatus]);

  if (!repo) return null;

  if (rebase.plan.length === 0 && !inProgress) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
        <div className="text-center">
          <GitMerge className="mx-auto mb-3 h-8 w-8 opacity-60" />
          <p>{t("rebase.empty.title")}</p>
          <p className="mt-1 text-xs opacity-80">{t("rebase.empty.subtitle")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Header
        inProgress={inProgress}
        conflicted={conflicted}
        done={rebase.state?.done ?? 0}
        total={rebase.state?.total ?? rebase.plan.length}
        busy={rebase.busy}
        onStart={() => void startRebase()}
        onContinue={() => void continueRebase()}
        onAbort={() => void abortRebase()}
        onClose={closePlan}
        onGoMerge={() => setView("merge")}
      />

      {rebase.error && (
        <div className="border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
          {rebase.error}
        </div>
      )}
      {rebase.status && (
        <div className="border-b border-border bg-[hsl(142_70%_55%/.10)] px-3 py-1.5 text-[11px] text-[hsl(142_70%_55%)]">
          {rebase.status}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <ol className="divide-y divide-border/40">
          {rebase.plan.map((step, i) => (
            <PlanRow
              key={`${step.oid}-${i}`}
              index={i}
              step={step}
              total={rebase.plan.length}
              disabled={inProgress}
              isCurrent={inProgress && i === 0}
              onChange={(patch) => updateStep(i, patch)}
              onMoveUp={() => moveStep(i, -1)}
              onMoveDown={() => moveStep(i, 1)}
            />
          ))}
        </ol>
      </div>
    </div>
  );
}

function Header({
  inProgress,
  conflicted,
  done,
  total,
  busy,
  onStart,
  onContinue,
  onAbort,
  onClose,
  onGoMerge,
}: {
  inProgress: boolean;
  conflicted: boolean;
  done: number;
  total: number;
  busy: boolean;
  onStart: () => void;
  onContinue: () => void;
  onAbort: () => void;
  onClose: () => void;
  onGoMerge: () => void;
}) {
  const t = useT();
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border bg-card px-3 text-xs">
      <GitMerge className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="font-medium">
        {inProgress ? t("rebase.header.inProgress") : t("rebase.header.draft")}
      </span>
      {inProgress && (
        <>
          <span className="text-muted-foreground">
            · {done}/{total} ({pct}%)
          </span>
          <div className="h-1.5 w-32 overflow-hidden rounded-full bg-secondary">
            <div
              className={cn(
                "h-full transition-all",
                conflicted ? "bg-[hsl(var(--destructive))]" : "bg-primary",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </>
      )}
      {conflicted && (
        <span className="text-[hsl(var(--destructive))]">· {t("rebase.header.conflicted")}</span>
      )}

      <div className="ml-auto flex items-center gap-2">
        {!inProgress && (
          <>
            <button
              onClick={onClose}
              disabled={busy}
              className="h-7 rounded-md border border-border bg-secondary px-3 text-xs hover:bg-accent disabled:opacity-50"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={onStart}
              disabled={busy}
              className="h-7 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {t("rebase.start")}
            </button>
          </>
        )}
        {inProgress && conflicted && (
          <>
            <button
              onClick={onGoMerge}
              className="h-7 rounded-md border border-border bg-secondary px-3 text-xs hover:bg-accent"
            >
              {t("rebase.goMerge")}
            </button>
            <button
              onClick={onContinue}
              disabled={busy}
              className="h-7 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {t("rebase.continue")}
            </button>
          </>
        )}
        {inProgress && (
          <button
            onClick={onAbort}
            disabled={busy}
            title={t("rebase.abort")}
            className="flex h-7 items-center gap-1 rounded-md border border-[hsl(var(--destructive)/.4)] bg-[hsl(var(--destructive)/.10)] px-2.5 text-[11px] text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/.18)] disabled:opacity-50"
          >
            <RotateCcw className="h-3 w-3" />
            {t("rebase.abort")}
          </button>
        )}
      </div>
    </div>
  );
}

const ALL_ACTIONS: RebaseAction[] = ["pick", "reword", "squash", "fixup", "drop"];

function PlanRow({
  index,
  step,
  total,
  disabled,
  isCurrent,
  onChange,
  onMoveUp,
  onMoveDown,
}: {
  index: number;
  step: RebaseStep;
  total: number;
  disabled: boolean;
  isCurrent: boolean;
  onChange: (patch: Partial<RebaseStep>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const t = useT();
  const showMessage = step.action === "reword" || step.action === "squash";

  return (
    <li
      className={cn(
        "px-3 py-2",
        isCurrent && "bg-[hsl(var(--branch-1)/.10)]",
        step.action === "drop" && "opacity-60",
      )}
    >
      <div className="flex items-center gap-2">
        <div className="flex flex-col">
          <button
            onClick={onMoveUp}
            disabled={disabled || index === 0}
            title={t("rebase.moveUp")}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
          >
            <ArrowUp className="h-3 w-3" />
          </button>
          <button
            onClick={onMoveDown}
            disabled={disabled || index === total - 1}
            title={t("rebase.moveDown")}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
          >
            <ArrowDown className="h-3 w-3" />
          </button>
        </div>

        <select
          value={step.action}
          disabled={disabled}
          onChange={(e) => onChange({ action: e.target.value as RebaseAction })}
          className={cn(
            "h-6 rounded border border-border px-1.5 text-[10.5px] font-medium uppercase tracking-wider outline-none",
            ACTION_TONES[step.action],
            disabled && "cursor-not-allowed opacity-70",
          )}
        >
          {ALL_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>

        <span className="font-mono text-[11px] text-[hsl(var(--branch-1))]">{step.short_oid}</span>
        <span
          className={cn(
            "flex-1 truncate text-xs",
            step.action === "drop" && "line-through opacity-70",
          )}
        >
          {step.summary}
        </span>
      </div>

      {showMessage && (
        <textarea
          value={step.new_message}
          disabled={disabled}
          onChange={(e) => onChange({ new_message: e.target.value })}
          placeholder={
            step.action === "reword"
              ? t("rebase.reword.placeholder")
              : t("rebase.squash.placeholder")
          }
          rows={3}
          className="mt-1.5 ml-12 w-[calc(100%-3rem)] resize-y rounded border border-border bg-background px-2 py-1.5 font-mono text-[11px] outline-none focus:border-primary disabled:opacity-60"
        />
      )}
    </li>
  );
}
