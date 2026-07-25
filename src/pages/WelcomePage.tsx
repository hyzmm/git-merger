import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/stores/app";
import { useT } from "@/lib/i18n";

export function WelcomePage() {
  const openRepo = useApp((s) => s.openRepo);
  const recent = useApp((s) => s.recentRepos);
  const removeRecent = useApp((s) => s.removeRecentRepo);
  const t = useT();

  async function pick() {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") await openRepo(dir);
  }

  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="grid w-full max-w-3xl grid-cols-1 gap-8 md:grid-cols-[1fr_1fr]">
        {/* Welcome card */}
        <div className="flex flex-col items-start gap-4">
          <h1 className="text-2xl font-semibold">{t("welcome.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("welcome.subtitle")}</p>
          <Button
            onClick={pick}
            variant="default"
          >
            <FolderOpen className="h-4 w-4" />
            {t("welcome.openButton")}
          </Button>
          <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
            <ShortcutLine combo="Ctrl+1 .. 7" desc="Switch view" />
            <ShortcutLine combo="F5 or Ctrl+R" desc="Refresh current view" />
            <ShortcutLine combo="N / P (in Diff)" desc="Next / prev hunk" />
            <ShortcutLine combo="Alt+1 / 2 / 3 (in Merge)" desc="Accept Left / Right / Both" />
          </div>
        </div>

        {/* Recent repos */}
        <div className="min-w-0">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("welcome.recent")}
          </h2>
          {recent.length === 0 && (
            <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              {t("welcome.noRecent")}
            </div>
          )}
          <div className="flex flex-col gap-1">
            {recent.map((r) => (
              <div
                key={r.path}
                className="group flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 hover:border-border hover:bg-accent/40"
              >
                <Button
                  onClick={() => openRepo(r.path)}
                  variant="ghost"
                  size="sm"
                  className="flex min-w-0 flex-1"
                >
                  <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="truncate font-mono text-sm">{basename(r.path)}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{r.path}</div>
                  </div>
                </Button>
                <Button
                  onClick={() => removeRecent(r.path)}
                  variant="ghost"
                  size="icon-sm"
                  className="invisible group-hover:inline-flex"
                  title="Remove from list"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ShortcutLine({ combo, desc }: { combo: string; desc: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px]">
        {combo}
      </span>
      <span>{desc}</span>
    </div>
  );
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i === -1 ? p : p.slice(i + 1);
}
