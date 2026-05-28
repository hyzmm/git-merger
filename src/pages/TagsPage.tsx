/**
 * Dedicated Tags management panel (v0.13.12).
 *
 * Surfaces every tag in the repo (annotated + lightweight), sorted
 * newest-first. Per-row actions:
 *   - Push   →  `git push <remote> <tag>`
 *   - Force  →  `git push <remote> +<tag>`  (overwrites a moved/recreated tag)
 *   - Local  →  `git tag -d <tag>`          (delete just locally)
 *   - Remote →  `git push <remote> :refs/tags/<tag>` (untouched local copy)
 *
 * The "Push all tags" toolbar button mirrors `git push <remote> --tags`.
 *
 * Annotated tags expand inline to show the message + tagger; lightweight
 * tags only show the commit they point at.
 */
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Tag, Trash2, Upload, UploadCloud } from "lucide-react";
import { useApp } from "@/stores/app";
import { cn } from "@/lib/utils";
import type { TagInfo } from "@/ipc/git";

function fmtTime(t: number): string {
  if (!t) return "";
  return new Date(t * 1000).toLocaleString();
}

export function TagsPage() {
  const repo = useApp((s) => s.repo);
  const entries = useApp((s) => s.tags.entries);
  const loading = useApp((s) => s.tags.loading);
  const busy = useApp((s) => s.tags.busy);
  const error = useApp((s) => s.tags.error);
  const status = useApp((s) => s.tags.status);

  const loadTags = useApp((s) => s.loadTags);
  const pushTag = useApp((s) => s.pushTag);
  const pushAllTags = useApp((s) => s.pushAllTags);
  const deleteRemoteTag = useApp((s) => s.deleteRemoteTag);
  const deleteLocalTag = useApp((s) => s.deleteTag);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (repo) void loadTags();
  }, [repo, loadTags]);

  const toggle = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card px-3 text-xs">
        <Tag className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">{entries.length} tags</span>
        {loading && <span className="text-muted-foreground">· loading…</span>}
        {busy && <span className="text-muted-foreground">· working…</span>}
        {status && <span className="text-[hsl(var(--branch-1))]">· {status}</span>}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => void pushAllTags()}
            disabled={busy || entries.length === 0}
            title="git push --tags (every local tag → origin)"
            className={cn(
              "flex h-7 items-center gap-1 rounded-md border border-border bg-secondary px-2.5 text-[11px] hover:bg-accent",
              (busy || entries.length === 0) && "cursor-not-allowed opacity-60",
            )}
          >
            <UploadCloud className="h-3.5 w-3.5" />
            Push all tags
          </button>
        </div>
      </div>

      {error && (
        <div className="border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {!loading && entries.length === 0 && (
          <div className="p-6 text-center text-xs text-muted-foreground">
            No tags yet. Right-click any commit in History →{" "}
            <span className="font-mono">Create tag here…</span> to make one.
          </div>
        )}
        {entries.map((tag) => (
          <TagRow
            key={tag.name}
            tag={tag}
            expanded={expanded.has(tag.name)}
            busy={busy}
            onToggle={() => toggle(tag.name)}
            onPush={(force) => void pushTag(tag.name, { force })}
            onDeleteLocal={() => void deleteLocalTag(tag.name)}
            onDeleteRemote={() => void deleteRemoteTag(tag.name)}
          />
        ))}
      </div>
    </div>
  );
}

function TagRow({
  tag,
  expanded,
  busy,
  onToggle,
  onPush,
  onDeleteLocal,
  onDeleteRemote,
}: {
  tag: TagInfo;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onPush: (force: boolean) => void;
  onDeleteLocal: () => void;
  onDeleteRemote: () => void;
}) {
  const annotated = tag.is_annotated;
  const confirm = useApp((s) => s.confirm);
  // v0.13.22 — every "git" button below funnels through ConfirmDialog so a
  // mis-click can't push, delete on remote, or wipe the local ref. Force-push
  // already had this dialog from v0.13.12; the rest get their own copy here.
  const askPush = async () => {
    const ok = await confirm({
      level: "warning",
      title: `Push tag '${tag.name}'?`,
      message:
        "Sends this tag to the remote. Existing tags with the same name will not be overwritten — use Force for that.",
      detail: `git push origin refs/tags/${tag.name}:refs/tags/${tag.name}`,
      confirmLabel: "Push tag",
    });
    if (ok) onPush(false);
  };
  const askDeleteLocal = async () => {
    const ok = await confirm({
      level: "danger",
      title: `Delete local tag '${tag.name}'?`,
      message:
        "Removes this tag locally. The remote copy is left untouched — use the Remote button if you also want to delete it on the server.",
      detail: `git tag -d ${tag.name}`,
      confirmLabel: "Delete locally",
    });
    if (ok) onDeleteLocal();
  };
  const askDeleteRemote = async () => {
    const ok = await confirm({
      level: "danger",
      title: `Delete remote tag '${tag.name}'?`,
      message:
        "Removes the tag on the remote. Anyone who already fetched the tag still has their local copy until they manually re-fetch with --prune-tags.",
      detail: `git push origin :refs/tags/${tag.name}`,
      confirmLabel: "Delete on remote",
    });
    if (ok) onDeleteRemote();
  };
  return (
    <div className="border-b border-border/40">
      <div className="flex items-center gap-3 px-3 py-2 hover:bg-accent/30">
        <button
          onClick={onToggle}
          aria-label={expanded ? "Collapse" : "Expand"}
          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
        <span
          className={cn(
            "min-w-[2.5rem] shrink-0 rounded px-1.5 text-center text-[10px] uppercase tracking-wider",
            annotated
              ? "bg-[hsl(var(--branch-2)/.20)] text-[hsl(var(--branch-2))]"
              : "bg-secondary text-muted-foreground",
          )}
          title={
            annotated ? "Annotated tag (has message + tagger)" : "Lightweight tag (a plain ref)"
          }
        >
          {annotated ? "annot" : "light"}
        </span>
        <span className="font-mono text-xs text-foreground">{tag.name}</span>
        <span className="font-mono text-[10.5px] text-[hsl(var(--branch-1))]">
          {tag.target_short_oid}
        </span>
        <span
          className="flex-1 truncate text-[11px] text-muted-foreground"
          title={tag.commit_summary}
        >
          {tag.commit_summary}
        </span>
        <span className="shrink-0 text-[10.5px] text-muted-foreground">{fmtTime(tag.time)}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={() => void askPush()}
            disabled={busy}
            title={`git push origin ${tag.name}`}
            className={cn(
              "flex h-6 items-center gap-1 rounded-md border border-border bg-secondary px-2 text-[10.5px] hover:bg-accent",
              busy && "cursor-not-allowed opacity-60",
            )}
          >
            <Upload className="h-3 w-3" />
            Push…
          </button>
          <button
            onClick={() => {
              void (async () => {
                const ok = await confirm({
                  level: "danger",
                  title: `Force-push tag '${tag.name}'?`,
                  message:
                    "Overwrites a moved or recreated tag on the remote. Anyone who already fetched the previous tag will keep their stale copy until they manually re-fetch.",
                  detail: `git push origin +refs/tags/${tag.name}:refs/tags/${tag.name}`,
                  confirmLabel: "Force push",
                });
                if (ok) onPush(true);
              })();
            }}
            disabled={busy}
            title="Force push (overwrites a moved/recreated tag on the remote)"
            className={cn(
              "h-6 rounded-md border border-[hsl(var(--branch-3)/.4)] bg-[hsl(var(--branch-3)/.10)] px-2 text-[10.5px] text-[hsl(var(--branch-3))] hover:bg-[hsl(var(--branch-3)/.18)]",
              busy && "cursor-not-allowed opacity-60",
            )}
          >
            Force…
          </button>
          <span className="mx-0.5 h-3 w-px bg-border" aria-hidden />
          <button
            onClick={() => void askDeleteLocal()}
            disabled={busy}
            title="Delete the local tag (does not touch the remote)"
            className={cn(
              "flex h-6 items-center gap-1 rounded-md border border-border px-2 text-[10.5px] hover:bg-accent",
              busy && "cursor-not-allowed opacity-60",
            )}
          >
            <Trash2 className="h-3 w-3" />
            Local…
          </button>
          <button
            onClick={() => void askDeleteRemote()}
            disabled={busy}
            title="Delete the tag on the remote (`git push origin :refs/tags/<name>`)"
            className={cn(
              "flex h-6 items-center gap-1 rounded-md border border-[hsl(var(--destructive)/.4)] bg-[hsl(var(--destructive)/.10)] px-2 text-[10.5px] text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)/.18)]",
              busy && "cursor-not-allowed opacity-60",
            )}
          >
            <Trash2 className="h-3 w-3" />
            Remote…
          </button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-1 border-t border-border/30 bg-card/50 px-10 py-2 text-[11px]">
          <div className="flex gap-3">
            <span className="w-20 shrink-0 text-muted-foreground">Tag oid</span>
            <span className="font-mono">{tag.tag_oid ?? tag.target_oid}</span>
          </div>
          <div className="flex gap-3">
            <span className="w-20 shrink-0 text-muted-foreground">Commit</span>
            <span className="font-mono">{tag.target_oid}</span>
          </div>
          {annotated && (
            <>
              <div className="flex gap-3">
                <span className="w-20 shrink-0 text-muted-foreground">Tagger</span>
                <span>
                  {tag.tagger_name ?? "(unknown)"}
                  {tag.tagger_email ? ` <${tag.tagger_email}>` : ""}
                </span>
              </div>
              <div className="flex gap-3">
                <span className="w-20 shrink-0 text-muted-foreground">Message</span>
                <pre className="whitespace-pre-wrap font-sans">
                  {tag.message?.trim() || "(empty)"}
                </pre>
              </div>
            </>
          )}
          {!annotated && (
            <div className="text-muted-foreground italic">
              Lightweight tag — a plain ref pointing at the commit. No own message or tagger.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
