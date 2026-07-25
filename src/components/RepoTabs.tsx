import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useMemo, useState, type DragEvent } from "react";
import { X, Plus, Pin, PinOff } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useApp } from "@/stores/app";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ContextMenu, type ContextMenuPos, type MenuItem } from "@/components/ContextMenu";

/**
 * v0.13.5 — Tabs v2. Adds pinning, drag-to-reorder, right-click context menu,
 * and survives across restarts via the persistence subscriber in the store.
 *
 * Layout invariant: pinned tabs render before any non-pinned ones. Dragging
 * across the boundary toggles the moved tab's `pinned` flag (handled
 * inside `reorderTabs`). Pinned tabs hide their close button — users have
 * to right-click → Unpin first.
 */
export function RepoTabs() {
  const t = useT();
  const tabs = useApp((s) => s.tabs);
  const activeTabId = useApp((s) => s.activeTabId);
  const switchTab = useApp((s) => s.switchTab);
  const closeTab = useApp((s) => s.closeTab);
  const renameTab = useApp((s) => s.renameTab);
  const newBlankTab = useApp((s) => s.newBlankTab);
  const openRepo = useApp((s) => s.openRepo);
  const togglePinTab = useApp((s) => s.togglePinTab);
  const reorderTab = useApp((s) => s.reorderTab);
  const closeOtherTabs = useApp((s) => s.closeOtherTabs);
  const closeRightTabs = useApp((s) => s.closeRightTabs);

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ pos: ContextMenuPos; tabId: string } | null>(null);

  // Compute menu items unconditionally so React's hook order stays stable
  // even when we early-return below for the empty-tab-bar case.
  const menuItems = useMemo<MenuItem[]>(() => {
    if (!menu) return [];
    const tab = tabs.find((x) => x.id === menu.tabId);
    if (!tab) return [];
    const idx = tabs.findIndex((x) => x.id === tab.id);
    const hasNonPinnedRight = tabs.slice(idx + 1).some((x) => !x.pinned);
    const hasOthersToClose = tabs.some((x) => x.id !== tab.id && !x.pinned);
    return [
      {
        label: tab.pinned ? t("tabs.unpin") : t("tabs.pin"),
        onClick: () => togglePinTab(tab.id),
      },
      { separator: true, label: "" },
      {
        label: t("tabs.close"),
        onClick: () => closeTab(tab.id),
        disabled: tab.pinned,
      },
      {
        label: t("tabs.closeOthers"),
        onClick: () => closeOtherTabs(tab.id),
        disabled: !hasOthersToClose,
      },
      {
        label: t("tabs.closeRight"),
        onClick: () => closeRightTabs(tab.id),
        disabled: !hasNonPinnedRight,
      },
    ];
  }, [menu, tabs, t, togglePinTab, closeTab, closeOtherTabs, closeRightTabs]);

  // Hide entirely when there are no tabs at all (welcome page state).
  if (tabs.length === 0) return null;

  const onAdd = async () => {
    const id = newBlankTab();
    try {
      const dir = await openDialog({ directory: true, multiple: false });
      if (typeof dir === "string") {
        await openRepo(dir);
      }
    } catch {
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

  // ---------- drag & drop ----------

  const onDragStart = (id: string) => (e: DragEvent<HTMLDivElement>) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = "move";
    // Required by Firefox to actually fire `dragend`.
    e.dataTransfer.setData("text/plain", id);
  };

  const onDragOverTab = (idx: number) => (e: DragEvent<HTMLDivElement>) => {
    if (draggingId === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    // Drop on the right half of a tab → insert *after* that tab.
    const r = e.currentTarget.getBoundingClientRect();
    const targetIdx = e.clientX - r.left > r.width / 2 ? idx + 1 : idx;
    setDragOverIdx(targetIdx);
  };

  const onDropTab = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (draggingId === null || dragOverIdx === null) {
      setDraggingId(null);
      setDragOverIdx(null);
      return;
    }
    const fromIdx = tabs.findIndex((tab) => tab.id === draggingId);
    if (fromIdx >= 0) reorderTab(fromIdx, dragOverIdx);
    setDraggingId(null);
    setDragOverIdx(null);
  };

  const onDragEnd = () => {
    setDraggingId(null);
    setDragOverIdx(null);
  };

  // ---------- context menu ----------

  return (
    <>
      <div
        className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border bg-card"
        onDragOver={(e) => {
          // When dragging past the last tab, target the very end.
          if (draggingId && dragOverIdx === null) {
            e.preventDefault();
            setDragOverIdx(tabs.length);
          }
        }}
        onDrop={onDropTab}
      >
        {tabs.map((tab, idx) => {
          const active = tab.id === activeTabId;
          const isEditing = editing === tab.id;
          const showLeftMarker =
            dragOverIdx === idx && draggingId !== null && draggingId !== tab.id;
          return (
            <div
              key={tab.id}
              draggable={!isEditing}
              onDragStart={onDragStart(tab.id)}
              onDragOver={onDragOverTab(idx)}
              onDragEnd={onDragEnd}
              onClick={() => !isEditing && switchTab(tab.id)}
              onDoubleClick={() => startRename(tab.id, tab.label)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ pos: { x: e.clientX, y: e.clientY }, tabId: tab.id });
              }}
              title={tab.repoPath || t("tabs.blank")}
              className={cn(
                "group relative flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-border px-3 text-[12px]",
                active
                  ? "bg-background text-foreground"
                  : "bg-card text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                draggingId === tab.id && "opacity-50",
              )}
            >
              {showLeftMarker && (
                <div className="pointer-events-none absolute left-0 top-0 h-full w-0.5 bg-primary" />
              )}
              {tab.pinned && <Pin className="h-3 w-3 shrink-0 text-muted-foreground" />}
              {isEditing ? (
                <Input
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
                  className="h-5 w-32 px-1 text-[11.5px]"
                />
              ) : (
                <span className="max-w-[200px] truncate font-mono">{tab.label}</span>
              )}
              {!tab.pinned ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  title={t("tabs.close")}
                  className={active ? "opacity-70 hover:opacity-100" : "opacity-0 group-hover:opacity-70"}
                >
                  <X className="h-3 w-3" />
                </Button>
              ) : (
                // For pinned tabs, swap X for an "unpin" affordance so the
                // user can still get it off-screen without diving into the
                // context menu. Same slot, different glyph.
                <Button
                  variant="ghost"
                  size="icon-xs"
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePinTab(tab.id);
                  }}
                  title={t("tabs.unpin")}
                  className={active ? "opacity-70 hover:opacity-100" : "opacity-0 group-hover:opacity-70"}
                >
                  <PinOff className="h-3 w-3" />
                </Button>
              )}
            </div>
          );
        })}
        {/* End-of-list drop marker so the user can drag a tab past the
            last entry and drop it at the very end. */}
        {dragOverIdx === tabs.length && draggingId !== null && (
          <div className="relative w-0">
            <div className="pointer-events-none absolute left-0 top-0 h-full w-0.5 bg-primary" />
          </div>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          type="button"
          onClick={onAdd}
          title={t("tabs.add")}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <ContextMenu pos={menu?.pos ?? null} items={menuItems} onClose={() => setMenu(null)} />
    </>
  );
}
