import { useMemo } from "react";
import { useApp } from "@/stores/app";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { HistoryPage } from "@/pages/HistoryPage";
import { DiffPage } from "@/pages/DiffPage";
import { MergePage } from "@/pages/MergePage";
import { BlamePage } from "@/pages/BlamePage";
import { ChangesPage } from "@/pages/ChangesPage";
import { WelcomePage } from "@/pages/WelcomePage";
import { useShortcuts } from "@/lib/useShortcuts";

export default function App() {
  const { repo, view } = useApp();
  const setView = useApp((s) => s.setView);
  const refresh = useApp((s) => s.refresh);
  const applyResolution = useApp((s) => s.applyResolution);
  const chunks = useApp((s) => s.merge.chunks);

  const firstPendingIdx = useMemo(() => {
    for (const c of chunks) {
      if (c.kind === "conflict" && c.resolution === "pending") return c.index;
    }
    return null;
  }, [chunks]);

  const shortcutMap = useMemo(
    () => ({
      "ctrl+1": () => repo && setView("history"),
      "ctrl+2": () => repo && setView("diff"),
      "ctrl+3": () => repo && setView("merge"),
      "ctrl+4": () => repo && setView("changes"),
      f5: () => void refresh(),
      "ctrl+r": () => void refresh(),
      "alt+1": () => firstPendingIdx !== null && applyResolution(firstPendingIdx, "left"),
      "alt+2": () => firstPendingIdx !== null && applyResolution(firstPendingIdx, "right"),
      "alt+3": () => firstPendingIdx !== null && applyResolution(firstPendingIdx, "both"),
    }),
    [repo, setView, refresh, firstPendingIdx, applyResolution],
  );

  useShortcuts(shortcutMap);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
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
          ) : (
            <BlamePage />
          )}
        </main>
      </div>
    </div>
  );
}
