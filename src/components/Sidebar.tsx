import {
  History,
  GitCompare,
  GitMerge,
  FilePlus2,
  Archive,
  Undo2,
  Box,
  ListOrdered,
} from "lucide-react";
import { useApp, type ViewKey } from "@/stores/app";
import { useT, type TKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const items: { key: ViewKey; labelKey: TKey; Icon: typeof History }[] = [
  { key: "history", labelKey: "sidebar.history", Icon: History },
  { key: "changes", labelKey: "sidebar.changes", Icon: FilePlus2 },
  { key: "stash", labelKey: "sidebar.stash", Icon: Archive },
  { key: "reflog", labelKey: "sidebar.reflog", Icon: Undo2 },
  { key: "submodules", labelKey: "sidebar.submodules", Icon: Box },
  { key: "rebase", labelKey: "sidebar.rebase", Icon: ListOrdered },
  { key: "diff", labelKey: "sidebar.diff", Icon: GitCompare },
  { key: "merge", labelKey: "sidebar.merge", Icon: GitMerge },
];

export function Sidebar() {
  const { view, setView, repo } = useApp();
  const t = useT();
  return (
    <aside className="flex w-14 flex-col items-center gap-1 border-r border-border bg-card py-3">
      {items.map(({ key, labelKey, Icon }) => {
        const active = view === key;
        return (
          <button
            key={key}
            onClick={() => setView(key)}
            disabled={!repo}
            title={t(labelKey)}
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
