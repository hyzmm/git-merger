/**
 * .gitignore editor — three-column layout:
 *   - Left: starter templates (click to append to draft)
 *   - Center: large textarea for the file contents + Save / Preview / Reset toolbar
 *   - Right: live preview of which working-tree paths the candidate text
 *           starts / stops ignoring relative to the on-disk file.
 *
 * The preview is computed on-demand (Preview button) — it walks the
 * working tree on the Rust side via libgit2's `is_path_ignored`, so for
 * very large repositories we don't auto-run on every keystroke.
 */
import { useEffect } from "react";
import { Save, Eye, RotateCcw, FileText, Plus, AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/stores/app";
import { useT } from "@/lib/i18n";
import type { IgnorePreview } from "@/ipc/git";

export function GitignorePage() {
  const repo = useApp((s) => s.repo);
  const view = useApp((s) => s.gitignore);
  const load = useApp((s) => s.loadGitignore);
  const setDraft = useApp((s) => s.setGitignoreDraft);
  const save = useApp((s) => s.saveGitignore);
  const preview = useApp((s) => s.previewGitignore);
  const append = useApp((s) => s.appendGitignoreTemplate);
  const t = useT();

  useEffect(() => {
    if (repo) void load();
  }, [repo, load]);

  const dirty = view.draft !== view.saved;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card px-3 text-xs">
        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-mono text-foreground">.gitignore</span>
        {view.loading && <span className="text-muted-foreground">· {t("gitignore.loading")}</span>}
        {view.busy && <span className="text-muted-foreground">· {t("gitignore.working")}</span>}
        {dirty && (
          <span className="rounded bg-[hsl(var(--branch-3)/.18)] px-1.5 text-[10px] uppercase tracking-wider text-[hsl(var(--branch-3))]">
            {t("gitignore.unsaved")}
          </span>
        )}
        {view.status && !dirty && (
          <span className="flex items-center gap-1 text-[hsl(var(--branch-1))]">
            <Check className="h-3 w-3" />
            {view.status}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            onClick={() => void preview()}
            disabled={!repo || view.busy}
            variant="secondary"
            size="sm"
            title={t("gitignore.previewTitle")}
          >
            <Eye className="h-3 w-3" />
            {t("gitignore.preview")}
          </Button>
          <Button
            onClick={() => setDraft(view.saved)}
            disabled={!repo || !dirty || view.busy}
            variant="secondary"
            size="sm"
            title={t("gitignore.resetTitle")}
          >
            <RotateCcw className="h-3 w-3" />
            {t("gitignore.reset")}
          </Button>
          <Button
            onClick={() => void save()}
            disabled={!repo || !dirty || view.busy}
            variant="default"
            size="sm"
            title={t("gitignore.saveTitle")}
          >
            <Save className="h-3 w-3" />
            {t("gitignore.save")}
          </Button>
        </div>
      </div>

      {view.error && (
        <div className="border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
          {view.error}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Left — templates */}
        <aside className="flex w-44 shrink-0 flex-col border-r border-border bg-card/40">
          <div className="border-b border-border px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {t("gitignore.templates")}
          </div>
          <div className="min-h-0 flex-1 overflow-auto py-1">
            {view.templates.map((tpl) => (
              <Button
                key={tpl.id}
                onClick={() => append(tpl.id)}
                disabled={view.busy}
                variant="ghost"
                size="sm"
                className="flex w-full"
                title={t("gitignore.appendTitle").replace("{name}", tpl.label)}
              >
                <Plus className="h-3 w-3 text-muted-foreground" />
                {tpl.label}
              </Button>
            ))}
          </div>
        </aside>

        {/* Center — textarea editor */}
        <div className="flex min-w-0 flex-1 flex-col">
          <textarea
            value={view.draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none bg-background px-3 py-2 font-mono text-[11.5px] leading-relaxed text-foreground focus:outline-none"
            placeholder={t("gitignore.placeholder")}
          />
          <div className="border-t border-border bg-card px-3 py-1 font-mono text-[10px] text-muted-foreground">
            {view.draft.split("\n").length} {t("gitignore.lines")} · {view.draft.length}{" "}
            {t("gitignore.chars")}
          </div>
        </div>

        {/* Right — preview */}
        <aside className="flex w-72 shrink-0 flex-col border-l border-border bg-card/40">
          <div className="border-b border-border px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {t("gitignore.previewPanel")}
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-3 py-2 text-[11px]">
            {!view.preview ? (
              <div className="text-muted-foreground">{t("gitignore.previewHint")}</div>
            ) : (
              <PreviewBody preview={view.preview} />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function PreviewBody({ preview }: { preview: IgnorePreview }) {
  const t = useT();
  const noChange = preview.newly_ignored.length === 0 && preview.no_longer_ignored.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[10.5px] text-muted-foreground">
        {t("gitignore.scanned")}: {preview.scanned}
      </div>

      {noChange ? (
        <div className="rounded border border-border bg-secondary/40 px-2 py-1.5 text-[10.5px] text-muted-foreground">
          {t("gitignore.noChange")}
        </div>
      ) : null}

      {preview.newly_ignored.length > 0 && (
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-[hsl(var(--branch-3))]">
            <AlertTriangle className="h-3 w-3" />
            <span className="text-[10.5px] font-medium uppercase tracking-wider">
              {t("gitignore.newlyIgnored")} ({preview.newly_ignored.length})
            </span>
          </div>
          <ul className="flex flex-col gap-0.5 font-mono text-[10.5px]">
            {preview.newly_ignored.map((p) => (
              <li key={`+${p}`} className="truncate text-foreground" title={p}>
                + {p}
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview.no_longer_ignored.length > 0 && (
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-[hsl(var(--branch-1))]">
            <Check className="h-3 w-3" />
            <span className="text-[10.5px] font-medium uppercase tracking-wider">
              {t("gitignore.noLongerIgnored")} ({preview.no_longer_ignored.length})
            </span>
          </div>
          <ul className="flex flex-col gap-0.5 font-mono text-[10.5px]">
            {preview.no_longer_ignored.map((p) => (
              <li key={`-${p}`} className="truncate text-foreground" title={p}>
                − {p}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
