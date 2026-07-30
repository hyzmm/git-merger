import { useEffect, useMemo } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { useApp } from "@/stores/app";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { RepoTabs } from "@/components/RepoTabs";
import { StatusBar } from "@/components/StatusBar";
import { OutputPanel } from "@/components/OutputPanel";
import { CredentialDialog } from "@/components/CredentialDialog";
import { useIpcLog } from "@/lib/ipcLog";
import { CommandPalette } from "@/components/CommandPalette";
import { RecentFilesPalette } from "@/components/RecentFilesPalette";
import { ToastContainer } from "@/components/ToastContainer";
import { HistoryPage } from "@/pages/HistoryPage";
import { BlamePage } from "@/pages/BlamePage";
import { ChangesPage } from "@/pages/ChangesPage";
import { StashPage } from "@/pages/StashPage";
import { ReflogPage } from "@/pages/ReflogPage";
import { SubmodulesPage } from "@/pages/SubmodulesPage";
import { RebasePage } from "@/pages/RebasePage";
import { FileHistoryPage } from "@/pages/FileHistoryPage";
import { WorktreesPage } from "@/pages/WorktreesPage";
import { GitignorePage } from "@/pages/GitignorePage";
import { SearchPage } from "@/pages/SearchPage";
import { TagsPage } from "@/pages/TagsPage";
import { StatsPage } from "@/pages/StatsPage";
import { WelcomePage } from "@/pages/WelcomePage";
import { useShortcuts } from "@/lib/useShortcuts";
import { isAppErrorThrown } from "@/ipc/invoke";
import { formatAppError } from "@/lib/appError";
import { toast } from "@/lib/toast";

export default function App() {
  const { repo, view } = useApp();
  const setView = useApp((s) => s.setView);
  const refresh = useApp((s) => s.refresh);
  const applyResolution = useApp((s) => s.applyResolution);
  const chunks = useApp((s) => s.merge.chunks);
  const openPalette = useApp((s) => s.openPalette);
  const openRecentFiles = useApp((s) => s.openRecentFiles);
  const openRepo = useApp((s) => s.openRepo);
  const openSettings = useApp((s) => s.openSettings);
  const newBlankTab = useApp((s) => s.newBlankTab);
  const closeTab = useApp((s) => s.closeTab);
  const activeTabId = useApp((s) => s.activeTabId);
  const tabs = useApp((s) => s.tabs);
  const cycleTab = useApp((s) => s.cycleTab);

  const panelOpen = useIpcLog((s) => s.panelOpen);

  const firstPendingIdx = useMemo(() => {
    for (const c of chunks) {
      if (c.kind === "conflict" && c.resolution === "pending") return c.index;
    }
    return null;
  }, [chunks]);

  const shortcutMap = useMemo(
    () => ({
      "ctrl+1": () => repo && setView("history"),
      "ctrl+2": () => repo && setView("changes"),
      "ctrl+3": () => repo && setView("stash"),
      "ctrl+4": () => repo && setView("reflog"),
      "ctrl+5": () => repo && setView("submodules"),
      "ctrl+8": () => repo && setView("rebase"),
      "ctrl+9": () => repo && setView("worktrees"),
      "ctrl+0": () => repo && setView("gitignore"),
      "ctrl+shift+f": () => repo && setView("search"),
      "ctrl+t": () => {
        newBlankTab();
      },
      "ctrl+w": () => {
        // v0.13.5 — refuse to close pinned tabs via the keyboard. The user
        // has to right-click → Unpin (or click the inline unpin glyph)
        // first, matching VS Code / browsers.
        if (!activeTabId) return;
        const cur = tabs.find((t) => t.id === activeTabId);
        if (cur?.pinned) return;
        closeTab(activeTabId);
      },
      // v0.13.5 — cycle through tabs in either direction. Ctrl+PageDown is
      // the platform-standard "next tab" combo (browsers, terminal apps).
      "ctrl+pagedown": () => cycleTab(1),
      "ctrl+pageup": () => cycleTab(-1),
      "ctrl+k": () => repo && openPalette(),
      "ctrl+p": () => repo && openPalette(),
      "ctrl+e": () => repo && openRecentFiles(),
      "ctrl+o": async () => {
        const dir = await open({ directory: true, multiple: false });
        if (typeof dir === "string") await openRepo(dir);
      },
      "ctrl+,": () => openSettings(),
      f5: () => void refresh(),
      "ctrl+r": () => void refresh(),
      "alt+1": () => firstPendingIdx !== null && applyResolution(firstPendingIdx, "left"),
      "alt+2": () => firstPendingIdx !== null && applyResolution(firstPendingIdx, "right"),
      "alt+3": () => firstPendingIdx !== null && applyResolution(firstPendingIdx, "both"),
    }),
    [
      repo,
      setView,
      refresh,
      firstPendingIdx,
      applyResolution,
      openPalette,
      openRecentFiles,
      openRepo,
      openSettings,
      newBlankTab,
      closeTab,
      activeTabId,
      tabs,
      cycleTab,
    ],
  );

  useShortcuts(shortcutMap);

  // Listen for native system menu events (e.g. macOS Cmd+, → Settings…)
  useEffect(() => {
    const unlisten = listen("menu-open-settings", () => {
      openSettings();
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [openSettings]);

  // Bottom-line safety net: any backend rejection that nobody else handled
  // pops a toast so users get *some* feedback. Local catch blocks that already
  // route into per-pane error state still take precedence (the rejection is
  // consumed before bubbling up).
  useEffect(() => {
    const onRejection = (ev: PromiseRejectionEvent) => {
      const reason = ev.reason;
      if (isAppErrorThrown(reason)) {
        toast.error(formatAppError(reason.appError));
        ev.preventDefault();
      }
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);

  // v0.13.5 — lazy-load the active tab's repo on first paint after a
  // restart. Tab order/labels/pinned-state come from localStorage but the
  // session payload (history, refs, …) does not, so we kick off the
  // initial openRepo() here. Subsequent tab switches handle their own
  // lazy-load via switchTab → openRepo. Run exactly once at mount.
  useEffect(() => {
    const st = useApp.getState();
    if (!st.repo && st.activeTabId) {
      const t = st.tabs.find((x) => x.id === st.activeTabId);
      if (t && t.repoPath) {
        void st.openRepo(t.repoPath);
      }
    }
  }, []);

  return (
    <TooltipProvider>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
        <div className="flex min-h-0 flex-1">
          <SidebarProvider className="flex min-h-0 flex-1">
            <Sidebar />
            <SidebarInset>
              <RepoTabs />
              <Topbar />
              <main className="min-h-0 flex-1 overflow-hidden">
                {!repo ? (
                  <WelcomePage />
                ) : view === "history" ? (
                  <HistoryPage />
                ) : view === "changes" ? (
                  <ChangesPage />
                ) : view === "stash" ? (
                  <StashPage />
                ) : view === "reflog" ? (
                  <ReflogPage />
                ) : view === "submodules" ? (
                  <SubmodulesPage />
                ) : view === "rebase" ? (
                  <RebasePage />
                ) : view === "worktrees" ? (
                  <WorktreesPage />
                ) : view === "gitignore" ? (
                  <GitignorePage />
                ) : view === "search" ? (
                  <SearchPage />
                ) : view === "tags" ? (
                  <TagsPage />
                ) : view === "fileHistory" ? (
                  <FileHistoryPage />
                ) : view === "stats" ? (
                  <StatsPage />
                ) : (
                  <BlamePage />
                )}
              </main>
            </SidebarInset>
          </SidebarProvider>
        </div>
        {panelOpen && (
          <div className="h-48 shrink-0">
            <OutputPanel />
          </div>
        )}
        <StatusBar />
        <CredentialDialog />
        <CommandPalette />
        <RecentFilesPalette />
        <ToastContainer />
      </div>
    </TooltipProvider>
  );
}
