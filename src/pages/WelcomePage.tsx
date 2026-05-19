import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import { useApp } from "@/stores/app";

export function WelcomePage() {
  const { openRepo } = useApp();
  async function pick() {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") await openRepo(dir);
  }
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-semibold">Git Tools</h1>
        <p className="text-sm text-muted-foreground">
          IDEA-style History, Diff and Merge for any local Git repository.
        </p>
        <button
          onClick={pick}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <FolderOpen className="h-4 w-4" />
          Open Repository
        </button>
      </div>
    </div>
  );
}
