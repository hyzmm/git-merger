import {
  History,
  GitCompare,
  GitMerge,
  FilePlus2,
  Archive,
  Undo2,
  Box,
  ListOrdered,
  Trees,
  FileX,
  Search,
  Tag,
  BarChart3,
} from "lucide-react";
import { useApp, type ViewKey } from "@/stores/app";
import { useT, type TKey } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const items: { key: ViewKey; labelKey: TKey; Icon: typeof History }[] = [
  { key: "history", labelKey: "sidebar.history", Icon: History },
  { key: "changes", labelKey: "sidebar.changes", Icon: FilePlus2 },
  { key: "stash", labelKey: "sidebar.stash", Icon: Archive },
  { key: "reflog", labelKey: "sidebar.reflog", Icon: Undo2 },
  { key: "submodules", labelKey: "sidebar.submodules", Icon: Box },
  { key: "rebase", labelKey: "sidebar.rebase", Icon: ListOrdered },
  { key: "worktrees", labelKey: "sidebar.worktrees", Icon: Trees },
  { key: "gitignore", labelKey: "sidebar.gitignore", Icon: FileX },
  { key: "search", labelKey: "sidebar.search", Icon: Search },
  { key: "tags", labelKey: "sidebar.tags", Icon: Tag },
  { key: "diff", labelKey: "sidebar.diff", Icon: GitCompare },
  { key: "merge", labelKey: "sidebar.merge", Icon: GitMerge },
  { key: "stats", labelKey: "sidebar.stats", Icon: BarChart3 },
];

export function Sidebar() {
  const { view, setView, repo } = useApp();
  const t = useT();
  return (
    <aside className="flex w-14 flex-col items-center gap-1 border-r border-border bg-card py-3">
      {items.map(({ key, labelKey, Icon }) => {
        const active = view === key;
        return (
          <Button
            key={key}
            variant="ghost"
            size="icon"
            onClick={() => setView(key)}
            disabled={!repo}
            title={t(labelKey)}
            className={cn(
              active && "bg-accent text-accent-foreground",
            )}
          >
            <Icon className="h-5 w-5" />
          </Button>
        );
      })}
    </aside>
  );
}
