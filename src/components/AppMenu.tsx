/**
 * Topbar app menu — the hamburger ☰ at the very left.
 *
 * Houses low-frequency global commands that don't deserve a permanent
 * Topbar button: Open repository, Recent repositories submenu, Close
 * repository, About. High-frequency actions (Refresh / Fetch / Pull /
 * Push / Search / Settings) stay as dedicated buttons.
 */
import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { exit } from "@tauri-apps/plugin-process";
import { Folder, FolderOpen, Info, LogOut, Menu, Square, X, Plus } from "lucide-react";
import { useApp } from "@/stores/app";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const MAX_RECENT = 8;
const APP_VERSION = __APP_VERSION__;

export function AppMenu() {
  const repo = useApp((s) => s.repo);
  const openRepo = useApp((s) => s.openRepo);
  const reset = useApp((s) => s.reset);
  const newBlankTab = useApp((s) => s.newBlankTab);
  const recentRepos = useApp((s) => s.recentRepos);
  const removeRecent = useApp((s) => s.removeRecentRepo);
  const t = useT();

  const [open_, setOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Esc.
  useEffect(() => {
    if (!open_) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open_]);

  async function pickRepo() {
    setOpen(false);
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") await openRepo(dir);
  }

  async function openPath(path: string) {
    setOpen(false);
    await openRepo(path);
  }

  function closeRepo() {
    setOpen(false);
    reset();
  }

  async function quit() {
    setOpen(false);
    await exit(0);
  }

  return (
    <>
      <div ref={ref} className="relative">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setOpen((v) => !v)}
          title={t("topbar.menu")}
        >
          <Menu className="h-4 w-4" />
        </Button>

        {open_ && (
          <div className="absolute left-0 top-9 z-50 w-72 rounded-md border border-border bg-popover py-1 text-sm text-popover-foreground shadow-lg">
            <Item
              icon={<FolderOpen className="h-3.5 w-3.5" />}
              label={t("menu.openRepo")}
              shortcut="Ctrl+O"
              onClick={pickRepo}
            />
            <Item
              icon={<Plus className="h-3.5 w-3.5" />}
              label={t("menu.newTab")}
              shortcut="Ctrl+T"
              onClick={() => {
                setOpen(false);
                newBlankTab();
              }}
            />

            {recentRepos.length > 0 && (
              <>
                <Divider />
                <Heading label={t("menu.recent")} />
                <div className="max-h-64 overflow-auto">
                  {recentRepos.slice(0, MAX_RECENT).map((r) => {
                    const name = pathTail(r.path);
                    const isCurrent = repo?.path === r.path;
                    return (
                      <div
                        key={r.path}
                        className={cn(
                          "group flex items-center gap-2 px-2.5 py-1 text-xs hover:bg-accent",
                          isCurrent && "bg-accent/40",
                        )}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void openPath(r.path)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          title={r.path}
                        >
                          <Folder className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="truncate">{name}</span>
                          <span className="ml-auto truncate font-mono text-[10px] text-muted-foreground">
                            {shortPath(r.path)}
                          </span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeRecent(r.path);
                          }}
                          title={t("menu.recent.remove")}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {repo && (
              <>
                <Divider />
                <Item
                  icon={<Square className="h-3.5 w-3.5" />}
                  label={t("menu.closeRepo")}
                  onClick={closeRepo}
                />
              </>
            )}

            <Divider />
            <Item
              icon={<Info className="h-3.5 w-3.5" />}
              label={t("menu.about")}
              onClick={() => {
                setOpen(false);
                setAboutOpen(true);
              }}
            />
            <Item
              icon={<LogOut className="h-3.5 w-3.5" />}
              label={t("menu.quit")}
              shortcut="Alt+F4"
              onClick={quit}
            />
          </div>
        )}
      </div>

      {aboutOpen && <AboutDialog version={APP_VERSION} onClose={() => setAboutOpen(false)} />}
    </>
  );
}

function Item({
  icon,
  label,
  shortcut,
  onClick,
  danger,
}: {
  icon?: React.ReactNode;
  label: string;
  shortcut?: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={cn("w-full text-left", danger && "text-destructive")}
    >
      {icon && <span className="shrink-0 text-muted-foreground">{icon}</span>}
      <span className="flex-1 truncate">{label}</span>
      {shortcut && <kbd className="font-mono text-[10px] text-muted-foreground">{shortcut}</kbd>}
    </Button>
  );
}

function Heading({ label }: { label: string }) {
  return (
    <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {label}
    </div>
  );
}

function Divider() {
  return <div className="my-1 h-px bg-border" />;
}

/** Last path segment (foldername). */
function pathTail(p: string): string {
  const cleaned = p.replace(/[/\\]+$/, "");
  const m = cleaned.split(/[/\\]/);
  return m[m.length - 1] || cleaned;
}

/** Truncate to ~32 chars from the start. */
function shortPath(p: string): string {
  if (p.length <= 36) return p;
  return "…" + p.slice(-34);
}

function AboutDialog({ version, onClose }: { version: string; onClose: () => void }) {
  const t = useT();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-lg border border-border bg-card text-card-foreground shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">{t("menu.about")}</h2>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="space-y-2 px-4 py-4 text-xs">
          <div className="flex items-baseline gap-2">
            <span className="text-base font-semibold text-foreground">Git Tools</span>
            <span className="font-mono text-muted-foreground">v{version}</span>
          </div>
          <p className="text-muted-foreground">{t("welcome.subtitle")}</p>
          <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <dt>Tauri</dt>
            <dd className="font-mono">2.x</dd>
            <dt>React</dt>
            <dd className="font-mono">19.x</dd>
            <dt>libgit2</dt>
            <dd className="font-mono">vendored via git2-rs</dd>
            <dt>{t("about.repo")}</dt>
            <dd className="font-mono">
              <a
                href="https://github.com/hyzmm/git-merger"
                target="_blank"
                rel="noreferrer"
                className="text-[hsl(var(--branch-1))] hover:underline"
              >
                github.com/hyzmm/git-merger
              </a>
            </dd>
          </dl>
        </div>
        <div className="flex justify-end border-t border-border px-4 py-2">
          <Button
            variant="default"
            size="sm"
            onClick={onClose}
          >
            {t("common.dismiss")}
          </Button>
        </div>
      </div>
    </div>
  );
}
