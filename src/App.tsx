import { useMemo } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useApp } from "@/stores/app";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { RepoTabs } from "@/components/RepoTabs";
import { CredentialDialog } from "@/components/CredentialDialog";
import { CommandPalette } from "@/components/CommandPalette";
import { HistoryPage } from "@/pages/HistoryPage";
import { DiffPage } from "@/pages/DiffPage";
import { MergePage } from "@/pages/MergePage";
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
import { WelcomePage } from "@/pages/WelcomePage";
import { useShortcuts } from "@/lib/useShortcuts";

export default function App() {
  const { repo, view } = useApp();
  const setView = useApp((s) => s.setView);
  const refresh = useApp((s) => s.refresh);
  const applyResolution = useApp((s) => s.applyResolution);
  const chunks = useApp((s) => s.merge.chunks);
  const openPalette = useApp((s) => s.openPalette);
  const openRepo = useApp((s) => s.openRepo);
  const newBlankTab = useApp((s) => s.newBlankTab);
  const closeTab = useApp((s) => s.closeTab);
  const activeTabId = useApp((s) => s.activeTabId);

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
      "ctrl+6": () => repo && setView("diff"),
      "ctrl+7": () => repo && setView("merge"),
      "ctrl+8": () => repo && setView("rebase"),
      "ctrl+9": () => repo && setView("worktrees"),
      "ctrl+0": () => repo && setView("gitignore"),
      "ctrl+shift+f": () => repo && setView("search"),
      "ctrl+t": () => {
        newBlankTab();
      },
      "ctrl+w": () => {
        if (activeTabId) closeTab(activeTabId);
      },
      "ctrl+k": () => repo && openPalette(),
      "ctrl+p": () => repo && openPalette(),
      "ctrl+o": async () => {
        const dir = await open({ directory: true, multiple: false });
        if (typeof dir === "string") await openRepo(dir);
      },
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
      openRepo,
      newBlankTab,
      closeTab,
      activeTabId,
    ],
  );

  useShortcuts(shortcutMap);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <RepoTabs />
        <Topbar />
        <main className="min-h-0 flex-1 overflow-hidden">
          {!repo ? (
            <WelcomePage />
          ) : view === "history" ? (
            <HistoryPage />
          ) : view === "diff" ? (
            <DiffPage />
          ) : view === "merge" ? (
            <MergePage />
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
          ) : view === "fileHistory" ? (
            <FileHistoryPage />
          ) : (
            <BlamePage />
          )}
        </main>
      </div>
      <CredentialDialog />
      <CommandPalette />
    </div>
  );
}
