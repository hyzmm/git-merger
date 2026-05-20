import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useApp } from "@/stores/app";
import { cn } from "@/lib/utils";
import { ContextMenu, type ContextMenuPos, type MenuItem } from "@/components/ContextMenu";
import type { RefEntry } from "@/ipc/git";

const KIND_LABEL: Record<string, string> = {
  local_branch: "Local",
  remote_branch: "Remote",
  tag: "Tags",
};

const HUE_VARS = [
  "var(--branch-1)",
  "var(--branch-2)",
  "var(--branch-3)",
  "var(--branch-4)",
  "var(--branch-5)",
];

function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return HUE_VARS[Math.abs(h) % HUE_VARS.length];
}

interface MenuState {
  pos: ContextMenuPos;
  items: MenuItem[];
}

export function RefsPane() {
  const refs = useApp((s) => s.history.refs);
  const checkoutBranch = useApp((s) => s.checkoutBranch);
  const deleteBranch = useApp((s) => s.deleteBranch);
  const renameBranch = useApp((s) => s.renameBranch);
  const createBranchAct = useApp((s) => s.createBranch);
  const deleteTagAct = useApp((s) => s.deleteTag);

  const [menu, setMenu] = useState<MenuState | null>(null);

  const grouped = useMemo(() => {
    const g: Record<string, typeof refs> = {
      local_branch: [],
      remote_branch: [],
      tag: [],
    };
    for (const r of refs) g[r.kind]?.push(r);
    return g;
  }, [refs]);

  const onNewBranch = () => {
    const head = refs.find((r) => r.is_head);
    const start = head?.name ?? "HEAD";
    const name = window.prompt(`New branch name (from ${start}):`, "")?.trim();
    if (!name) return;
    const checkout = window.confirm(
      `Checkout new branch '${name}' immediately? (Cancel = create only)`,
    );
    void createBranchAct(name, start, checkout);
  };

  const onContextMenu = (e: React.MouseEvent, ref: RefEntry) => {
    e.preventDefault();
    const items: MenuItem[] = [];
    if (ref.kind === "local_branch") {
      items.push(
        { label: ref.name, heading: true },
        {
          label: ref.is_head ? "Already checked out" : "Checkout",
          disabled: ref.is_head,
          onClick: () => void checkoutBranch(ref.name),
        },
        {
          label: "New branch from here…",
          onClick: () => {
            const name = window.prompt(`New branch name (from ${ref.name}):`, "")?.trim();
            if (!name) return;
            const ck = window.confirm(`Checkout new branch '${name}' immediately?`);
            void createBranchAct(name, ref.name, ck);
          },
        },
        {
          label: "Rename…",
          disabled: ref.is_head,
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
          disabled: ref.is_head,
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
            void createBranchAct(name, ref.name, true);
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
            const ck = window.confirm(`Checkout new branch '${name}' immediately?`);
            void createBranchAct(name, ref.name, ck);
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
        {(["local_branch", "remote_branch", "tag"] as const).map((kind) => {
          const list = grouped[kind] ?? [];
          if (list.length === 0) return null;
          return (
            <div key={kind}>
              <div className="px-3 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                {KIND_LABEL[kind]}
              </div>
              {list.map((r) => {
                const color = colorFor(r.name);
                return (
                  <div
                    key={`${kind}:${r.name}`}
                    onContextMenu={(e) => onContextMenu(e, r)}
                    onDoubleClick={() => {
                      if (r.kind === "local_branch" && !r.is_head) void checkoutBranch(r.name);
                    }}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 px-3 py-1 text-xs",
                      "hover:bg-accent/50",
                      r.is_head && "bg-accent",
                    )}
                    style={r.is_head ? { borderLeft: `2px solid hsl(${color})` } : undefined}
                    title={
                      r.kind === "local_branch"
                        ? "Double-click to checkout · right-click for more"
                        : "Right-click for actions"
                    }
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: `hsl(${color})` }}
                    />
                    <span className="flex-1 truncate font-mono">{r.name}</span>
                    {r.is_head && (
                      <span className="text-[10px] uppercase text-muted-foreground">HEAD</span>
                    )}
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
