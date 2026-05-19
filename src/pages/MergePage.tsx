import { useApp } from "@/stores/app";
import { ConflictsList } from "@/components/merge/ConflictsList";
import { ThreeWayEditor } from "@/components/merge/ThreeWayEditor";

const STATE_LABEL: Record<string, string> = {
  clean: "Clean — no merge in progress",
  merge: "Merge in progress",
  rebase: "Rebase in progress",
  rebase_interactive: "Interactive rebase in progress",
  rebase_merge: "Rebase merge in progress",
  cherry_pick: "Cherry-pick in progress",
  revert: "Revert in progress",
  bisect: "Bisect in progress",
  apply_mailbox: "Applying mailbox patches",
  apply_mailbox_or_rebase: "Applying mailbox / rebase",
};

export function MergePage() {
  const state = useApp((s) => s.merge.state);
  const conflicts = useApp((s) => s.merge.conflicts);
  const error = useApp((s) => s.merge.error);
  const loading = useApp((s) => s.merge.loading);

  if (state === "clean" && conflicts.length === 0 && !loading) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card px-3 text-xs">
          <span className="text-muted-foreground">No merge in progress</span>
          {error && <span className="ml-auto text-destructive">{error}</span>}
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
          <div>Repository is clean — there are no conflicts to resolve.</div>
          <div className="text-xs">
            Run <code className="rounded bg-secondary px-1.5 py-0.5">git merge</code> /{" "}
            <code className="rounded bg-secondary px-1.5 py-0.5">git rebase</code> /{" "}
            <code className="rounded bg-secondary px-1.5 py-0.5">git cherry-pick</code> outside and
            come back here when there&apos;s a conflict.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card px-3 text-xs">
        <span
          className="inline-flex h-5 items-center rounded-full border px-2 text-[10.5px]"
          style={{
            color: "hsl(0 72% 65%)",
            borderColor: "hsl(0 72% 51% / .4)",
            background: "hsl(0 72% 51% / .12)",
          }}
        >
          {STATE_LABEL[state] ?? state}
        </span>
        <span className="text-muted-foreground">{conflicts.length} conflict files</span>
        {loading && <span className="text-muted-foreground">· loading...</span>}
        {error && <span className="ml-auto text-destructive">{error}</span>}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr]">
        <div className="min-h-0 border-r border-border">
          <ConflictsList />
        </div>
        <div className="min-w-0">
          <ThreeWayEditor />
        </div>
      </div>
    </div>
  );
}
