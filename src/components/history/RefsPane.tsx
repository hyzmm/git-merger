import { useMemo, useState } from "react";
import { GitBranch, Plus } from "lucide-react";
import { useApp } from "@/stores/app";
import { cn } from "@/lib/utils";
import { branchColorForName } from "@/lib/branchColors";
import { ContextMenu, type ContextMenuPos, type MenuItem } from "@/components/ContextMenu";
import type { RefEntry } from "@/ipc/git";

const KIND_LABEL: Record<string, string> = {
  local_branch: "Local",
  remote_branch: "Remote",
  tag: "Tags",
};

// v0.13.23 — palette + hashing now live in `@/lib/branchColors` so the
// RefsPane left dot, the GraphRow commit dot, and the lane lines all
// agree on what color a given branch is. The previous local `colorFor`
// hashed into a 5-slot list that didn't match GraphRow's 6-slot list.

interface MenuState {
  pos: ContextMenuPos;
  items: MenuItem[];
}

export function RefsPane() {
  const refs = useApp((s) => s.history.refs);
  const repo = useApp((s) => s.repo);
  const selectCommit = useApp((s) => s.selectCommit);
  const checkoutBranch = useApp((s) => s.checkoutBranch);
  const deleteBranch = useApp((s) => s.deleteBranch);
  const renameBranch = useApp((s) => s.renameBranch);
  const createBranchAct = useApp((s) => s.createBranch);
  const deleteTagAct = useApp((s) => s.deleteTag);
  const confirm = useApp((s) => s.confirm);

  const [menu, setMenu] = useState<MenuState | null>(null);

  const headBranch = useMemo(
    () => refs.find((r) => r.kind === "local_branch" && r.is_head) ?? null,
    [refs],
  );

  const grouped = useMemo(() => {
    const g: Record<string, typeof refs> = {
      local_branch: [],
      remote_branch: [],
      tag: [],
    };
    for (const r of refs) {
      // The currently checked-out local branch is already rendered in the
      // HEAD pin at the top of the pane (with its short oid), so skip the
      // duplicate row in the Local section. In detached state, no local
      // branch is `is_head`, so this filter has no effect there.
      if (r.kind === "local_branch" && r.is_head) continue;
      g[r.kind]?.push(r);
    }
    return g;
  }, [refs]);

  const onNewBranch = async () => {
    const head = refs.find((r) => r.is_head);
    const start = head?.name ?? "HEAD";
    const name = window.prompt(`New branch name (from ${start}):`, "")?.trim();
    if (!name) return;
    const checkout = await confirm({
      level: "warning",
      title: `Checkout '${name}' after creating?`,
      message: `OK = create + checkout (working tree switches). Cancel = just create the ref, stay on '${start}'.`,
      confirmLabel: "Create + checkout",
      cancelLabel: "Create only",
    });
    void createBranchAct(name, start, checkout);
  };

  const onContextMenu = (e: React.MouseEvent, ref: RefEntry) => {
    e.preventDefault();
    const items: MenuItem[] = [];
    if (ref.kind === "local_branch") {
      items.push(
        { label: ref.name, heading: true },
        {
          label: "Checkout…",
          onClick: () => {
            void (async () => {
              // v0.13.22 — checkout is a destructive op (working tree
              // switches, in-flight unsaved buffers may be lost). Always
              // route through the unified ConfirmDialog so it's never a
              // "one click and you're on a different branch" mistake.
              const ok = await confirm({
                level: "warning",
                title: `Checkout '${ref.name}'?`,
                message:
                  "Switches the working tree to this branch. Unsaved edits in the in-app editor will not migrate; commit or stash first if you care about them.",
                detail: `git checkout ${ref.name}`,
                confirmLabel: "Checkout",
              });
              if (ok) void checkoutBranch(ref.name);
            })();
          },
        },
        {
          label: "New branch from here…",
          onClick: () => {
            const name = window.prompt(`New branch name (from ${ref.name}):`, "")?.trim();
            if (!name) return;
            void (async () => {
              const ck = await confirm({
                level: "warning",
                title: `Checkout '${name}' after creating?`,
                message: `OK = create + checkout. Cancel = just create the ref, stay on the current branch.`,
                confirmLabel: "Create + checkout",
                cancelLabel: "Create only",
              });
              void createBranchAct(name, ref.name, ck);
            })();
          },
        },
        {
          label: "Rename…",
          onClick: () => {
            const next = window.prompt(`Rename '${ref.name}' to:`, ref.name)?.trim();
            if (!next || next === ref.name) return;
            void renameBranch(ref.name, next);
          },
        },
        { separator: true, label: "" },
        {
          label: "Delete…",
          danger: true,
          onClick: () => void deleteBranch(ref.name),
        },
      );
    } else if (ref.kind === "remote_branch") {
      items.push(
        { label: ref.name, heading: true },
        {
          label: "Checkout as new local branch…",
          onClick: () => {
            // Default local name strips "origin/" or similar.
            const slash = ref.name.indexOf("/");
            const def = slash >= 0 ? ref.name.slice(slash + 1) : ref.name;
            const name = window
              .prompt(`New local branch name (tracking ${ref.name}):`, def)
              ?.trim();
            if (!name) return;
            // createBranch with checkout=true is a destructive op (working
            // tree switches); funnel it through the same confirm path so
            // it can never happen on a single accidental click.
            void (async () => {
              const ok = await confirm({
                level: "warning",
                title: `Create '${name}' tracking ${ref.name} and check it out?`,
                message:
                  "Creates a local branch that tracks this remote branch and switches the working tree to it.",
                detail: `git checkout -b ${name} ${ref.name}`,
                confirmLabel: "Create + checkout",
              });
              if (ok) void createBranchAct(name, ref.name, true);
            })();
          },
        },
      );
    } else if (ref.kind === "tag") {
      items.push(
        { label: ref.name, heading: true },
        {
          label: "New branch from this tag…",
          onClick: () => {
            const name = window.prompt(`New branch name (from tag ${ref.name}):`, "")?.trim();
            if (!name) return;
            void (async () => {
              const ck = await confirm({
                level: "warning",
                title: `Checkout '${name}' after creating?`,
                message: `OK = create + checkout. Cancel = just create the ref, stay on the current branch.`,
                confirmLabel: "Create + checkout",
                cancelLabel: "Create only",
              });
              void createBranchAct(name, ref.name, ck);
            })();
          },
        },
        { separator: true, label: "" },
        { label: "Delete tag…", danger: true, onClick: () => void deleteTagAct(ref.name) },
      );
    }
    setMenu({ pos: { x: e.clientX, y: e.clientY }, items });
  };

  return (
    <aside className="flex h-full flex-col overflow-hidden bg-card">
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          Branches
        </span>
        <button
          onClick={onNewBranch}
          title="New branch from HEAD"
          className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {/* HEAD pinned to the top — always visible, unconditional. */}
        <div className="px-3 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          HEAD
        </div>
        {(() => {
          const isDetached = headBranch === null;
          const headLabel = headBranch?.name ?? repo?.head ?? "(unknown)";
          const headTarget = headBranch?.target ?? null;
          // `branchColorForName` already returns a full `hsl(var(--branch-N))`
          // expression so it can drop straight into a CSS property.
          const color = headBranch
            ? branchColorForName(headBranch.name)
            : "hsl(var(--muted-foreground))";
          return (
            <div
              onClick={() => {
                if (headTarget) void selectCommit(headTarget);
              }}
              className={cn(
                "flex cursor-pointer items-center gap-2 px-3 py-1 text-xs",
                "hover:bg-accent/50",
                "bg-accent/30",
                !headTarget && "cursor-default opacity-80",
              )}
              style={{ borderLeft: `2px solid ${color}` }}
              title={
                isDetached ? "HEAD is detached" : `HEAD → ${headLabel} (click to jump to its tip)`
              }
            >
              <GitBranch className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate font-mono">
                {isDetached ? `${headLabel} (detached)` : headLabel}
              </span>
              {headTarget && (
                <span className="font-mono text-[10px] text-muted-foreground">
                  {headTarget.slice(0, 7)}
                </span>
              )}
            </div>
          );
        })()}

        {(["local_branch", "remote_branch", "tag"] as const).map((kind) => {
          const list = grouped[kind] ?? [];
          if (list.length === 0) return null;
          return (
            <div key={kind}>
              <div className="px-3 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                {KIND_LABEL[kind]}
              </div>
              {list.map((r) => {
                const color = branchColorForName(r.name);
                return (
                  <div
                    key={`${kind}:${r.name}`}
                    onClick={() => {
                      // v0.13.22 — clicking a ref is a *read-only* navigation:
                      // jump the History view to the ref's tip. Anything
                      // destructive (checkout, delete, rename) lives in the
                      // right-click context menu and goes through ConfirmDialog.
                      if (r.target) void selectCommit(r.target);
                    }}
                    onContextMenu={(e) => onContextMenu(e, r)}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 px-3 py-1 text-xs",
                      "hover:bg-accent/50",
                    )}
                    title="Click: jump to tip · right-click: actions"
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
                    <span className="flex-1 truncate font-mono">{r.name}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
        {refs.length === 0 && <div className="p-6 text-xs text-muted-foreground">No refs.</div>}
      </div>

      <ContextMenu
        pos={menu?.pos ?? null}
        items={menu?.items ?? []}
        onClose={() => setMenu(null)}
      />
    </aside>
  );
}
