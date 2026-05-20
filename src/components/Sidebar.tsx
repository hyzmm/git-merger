import { History, GitCompare, GitMerge, FilePlus2, Archive, Undo2, Box } from "lucide-react";
import { useApp, type ViewKey } from "@/stores/app";
import { cn } from "@/lib/utils";

const items: { key: ViewKey; label: string; Icon: typeof History }[] = [
  { key: "history", label: "History", Icon: History },
  { key: "changes", label: "Changes (working tree)", Icon: FilePlus2 },
  { key: "stash", label: "Stash", Icon: Archive },
  { key: "reflog", label: "Reflog (HEAD history)", Icon: Undo2 },
  { key: "submodules", label: "Submodules", Icon: Box },
  { key: "diff", label: "Diff", Icon: GitCompare },
  { key: "merge", label: "Merge", Icon: GitMerge },
];

export function Sidebar() {
  const { view, setView, repo } = useApp();
  return (
    <aside className="flex w-14 flex-col items-center gap-1 border-r border-border bg-card py-3">
      {items.map(({ key, label, Icon }) => {
        const active = view === key;
        return (
          <button
            key={key}
            onClick={() => setView(key)}
            disabled={!repo}
            title={label}
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-md transition-colors",
              "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              "disabled:cursor-not-allowed disabled:opacity-40",
              active && "bg-accent text-accent-foreground",
            )}
          >
            <Icon className="h-5 w-5" />
          </button>
        );
      })}
    </aside>
  );
}
