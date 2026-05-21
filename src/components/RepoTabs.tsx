import { useState } from "react";
import { X, Plus } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useApp } from "@/stores/app";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function RepoTabs() {
  const t = useT();
  const tabs = useApp((s) => s.tabs);
  const activeTabId = useApp((s) => s.activeTabId);
  const switchTab = useApp((s) => s.switchTab);
  const closeTab = useApp((s) => s.closeTab);
  const renameTab = useApp((s) => s.renameTab);
  const newBlankTab = useApp((s) => s.newBlankTab);
  const openRepo = useApp((s) => s.openRepo);

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  // Hide the bar entirely when the user only has 0 or 1 tab — no point
  // taking vertical space in the common single-repo workflow.
  if (tabs.length <= 1) return null;

  const onAdd = async () => {
    // Create a blank tab first so existing one isn't disturbed, then
    // prompt for a repo path.
    const id = newBlankTab();
    try {
      const dir = await openDialog({ directory: true, multiple: false });
      if (typeof dir === "string") {
        await openRepo(dir);
      }
    } catch {
      // User cancelled; tab stays blank — which is fine, they can pick a
      // repo from the welcome page.
      void id;
    }
  };

  const startRename = (id: string, current: string) => {
    setEditing(id);
    setDraft(current);
  };

  const commitRename = (id: string) => {
    if (draft.trim() && draft !== "") renameTab(id, draft);
    setEditing(null);
    setDraft("");
  };

  return (
    <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border bg-card">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        const isEditing = editing === tab.id;
        return (
          <div
            key={tab.id}
            onClick={() => !isEditing && switchTab(tab.id)}
            onDoubleClick={() => startRename(tab.id, tab.label)}
            title={tab.repoPath || t("tabs.blank")}
            className={cn(
              "group flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-border px-3 text-[12px]",
              active
                ? "bg-background text-foreground"
                : "bg-card text-muted-foreground hover:bg-accent/40 hover:text-foreground",
            )}
          >
            {isEditing ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commitRename(tab.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(tab.id);
                  else if (e.key === "Escape") {
                    setEditing(null);
                    setDraft("");
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                className="h-5 w-32 rounded border border-border bg-background px-1 text-[11.5px] outline-none focus:border-primary"
              />
            ) : (
              <span className="max-w-[200px] truncate font-mono">{tab.label}</span>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              title={t("tabs.close")}
              className={cn(
                "flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-destructive/20 hover:text-destructive",
                active ? "opacity-70 hover:opacity-100" : "opacity-0 group-hover:opacity-70",
              )}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={onAdd}
        title={t("tabs.add")}
        className="flex shrink-0 items-center justify-center px-2 text-muted-foreground hover:bg-accent/40 hover:text-foreground"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
