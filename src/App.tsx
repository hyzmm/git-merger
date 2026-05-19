import { useApp } from "@/stores/app";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { HistoryPage } from "@/pages/HistoryPage";
import { DiffPage } from "@/pages/DiffPage";
import { MergePage } from "@/pages/MergePage";
import { WelcomePage } from "@/pages/WelcomePage";

export default function App() {
  const { repo, view } = useApp();

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
          ) : (
            <MergePage />
          )}
        </main>
      </div>
    </div>
  );
}
