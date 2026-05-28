import { useMemo, useState } from "react";
import { useApp } from "@/stores/app";
import { fullDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { ContextMenu, type ContextMenuPos, type MenuItem } from "@/components/ContextMenu";
import { toast } from "@/lib/toast";
import {
  AlertTriangle,
  Check,
  Copy,
  GitBranch,
  HelpCircle,
  KeyRound,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Tag,
} from "lucide-react";
import {
  git,
  type CommitSignatureInfo,
  type CommitSummary,
  type FileChange,
  type VerifyResult,
} from "@/ipc/git";

const STATUS_LABEL: Record<FileChange["status"], string> = {
  added: "A",
  deleted: "D",
  modified: "M",
  renamed: "R",
  copied: "C",
  typechange: "T",
};

const STATUS_COLOR: Record<FileChange["status"], string> = {
  added: "text-[hsl(var(--diff-added-fg))]",
  deleted: "text-[hsl(var(--diff-removed-fg))]",
  modified: "text-[hsl(var(--diff-modified-fg))]",
  renamed: "text-[hsl(var(--branch-2))]",
  copied: "text-[hsl(var(--branch-2))]",
  typechange: "text-[hsl(var(--branch-3))]",
};

/** Copy text to clipboard with a tiny success toast. */
async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`Copied ${label}`);
  } catch {
    // navigator.clipboard fails on insecure contexts; fall back silently.
  }
}

export function CommitDetails() {
  const commit = useApp((s) => {
    const oid = s.history.selectedOid;
    return s.history.commits.find((c) => c.oid === oid) ?? null;
  });
  const meta = useApp((s) => s.history.meta);
  const metaLoading = useApp((s) => s.history.metaLoading);
  const allCommits = useApp((s) => s.history.commits);
  const files = useApp((s) => s.history.files);
  const filesLoading = useApp((s) => s.history.filesLoading);
  const repoPath = useApp((s) => s.repo?.path ?? null);
  const openDiff = useApp((s) => s.openDiff);
  const openBlame = useApp((s) => s.openBlame);
  const openFileHistory = useApp((s) => s.openFileHistory);
  const selectCommit = useApp((s) => s.selectCommit);

  const [menu, setMenu] = useState<{ pos: ContextMenuPos; items: MenuItem[] } | null>(null);

  // Signature status (v0.13.19) ships inside `commit_meta` as of the post-
  // release perf cleanup — one fewer Tauri round-trip per commit selection
  // and zero extra `Repository::discover` calls. Falls back to `null`
  // until meta finishes loading so the row stays hidden rather than
  // briefly showing "Not signed".
  const sigInfo: CommitSignatureInfo | null = meta?.signature ?? null;

  // Children = commits in the currently-loaded history window whose `parents`
  // include this commit's oid. This is purely client-side — no extra IPC —
  // and always faithful to what the user can see.
  const children: CommitSummary[] = useMemo(() => {
    if (!commit) return [];
    return allCommits.filter((c) => c.parents.includes(commit.oid));
  }, [commit, allCommits]);

  // Prefer the rich meta when it's loaded (full message + committer + the
  // contained-in lists); fall back to the summary fields from the log row
  // while meta is still in flight, so the panel never goes blank.
  const fullMessage = meta?.message?.trimEnd() ?? commit?.summary ?? "";
  const isMergeCommit = (commit?.parents.length ?? 0) > 1;
  const committerDiffersFromAuthor =
    !!meta &&
    (meta.committer_name !== meta.author_name ||
      meta.committer_email !== meta.author_email ||
      meta.committer_time !== meta.author_time);

  if (!commit) {
    return (
      <aside className="flex h-full items-center justify-center border-l border-border bg-card text-xs text-muted-foreground">
        Select a commit
      </aside>
    );
  }

  return (
    <aside className="flex h-full min-w-0 flex-col border-l border-border bg-card">
      <div className="border-b border-border p-3.5">
        {/* Subject + quick copy actions */}
        <div className="mb-2 flex items-start gap-2">
          <div className="flex-1 text-[13.5px] font-semibold leading-snug">{commit.summary}</div>
          <CopyBtn
            label="message"
            text={meta?.message ?? commit.summary}
            title="Copy full message (subject + body)"
          />
        </div>

        <div className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-1 text-xs">
          <span className="text-muted-foreground">Commit</span>
          <span className="flex items-center gap-1.5">
            <span className="break-all font-mono text-[11.5px]">{commit.oid}</span>
            <CopyBtn label="full SHA" text={commit.oid} title="Copy full 40-char SHA" compact />
            <CopyBtn
              label="short SHA"
              text={commit.short_oid || commit.oid.slice(0, 7)}
              title="Copy 7-char short SHA"
              compact
            />
          </span>

          <span className="text-muted-foreground">
            {isMergeCommit ? `Parents (${commit.parents.length})` : "Parent"}
          </span>
          <span className="flex flex-wrap gap-1 font-mono text-[11.5px]">
            {commit.parents.length === 0
              ? "(root)"
              : commit.parents.map((p) => (
                  <RefChip
                    key={p}
                    text={p.slice(0, 7)}
                    title={`Jump to parent ${p}`}
                    onClick={() => void selectCommit(p)}
                  />
                ))}
          </span>

          {children.length > 0 && (
            <>
              <span className="text-muted-foreground">
                {children.length === 1 ? "Child" : `Children (${children.length})`}
              </span>
              <span className="flex flex-wrap gap-1 font-mono text-[11.5px]">
                {children.map((c) => (
                  <RefChip
                    key={c.oid}
                    text={c.short_oid || c.oid.slice(0, 7)}
                    title={`Jump to child — ${c.summary}`}
                    onClick={() => void selectCommit(c.oid)}
                  />
                ))}
              </span>
            </>
          )}

          <span className="text-muted-foreground">Author</span>
          <span className="font-mono text-[11.5px]">
            {commit.author_name}
            {commit.author_email && ` <${commit.author_email}>`}
          </span>

          <span className="text-muted-foreground">Date</span>
          <span className="text-[11.5px]">{fullDate(commit.time)}</span>

          {sigInfo?.signed && (
            <>
              <span className="text-muted-foreground">Signature</span>
              <span className="flex items-center gap-1.5 text-[11.5px]">
                <SignatureBadge
                  key={commit.oid}
                  info={sigInfo}
                  repoPath={repoPath}
                  oid={commit.oid}
                />
              </span>
            </>
          )}

          {committerDiffersFromAuthor && meta && (
            <>
              <span
                className="text-muted-foreground"
                title="Different from the author — likely cherry-picked or rebased."
              >
                Committer
              </span>
              <span className="font-mono text-[11.5px]">
                {meta.committer_name}
                {meta.committer_email && ` <${meta.committer_email}>`}
                {meta.committer_time !== meta.author_time && (
                  <span className="ml-1 text-muted-foreground">
                    · {fullDate(meta.committer_time)}
                  </span>
                )}
              </span>
            </>
          )}

          {commit.refs.length > 0 && (
            <>
              <span className="text-muted-foreground">Refs</span>
              <span className="flex flex-wrap gap-1">
                {commit.refs.map((r) => (
                  <span
                    key={r}
                    className="inline-flex h-[18px] items-center rounded-full border border-border bg-secondary px-2 text-[10.5px]"
                  >
                    {r}
                  </span>
                ))}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {/* Contained-in section — appears above the file list because the
            answer to "what released this fix?" is more often what the user
            comes here for than the changed-files diff. */}
        {meta && (meta.containing_branches.length > 0 || meta.containing_tags.length > 0) && (
          <ContainedIn branches={meta.containing_branches} tags={meta.containing_tags} />
        )}
        {metaLoading && !meta && (
          <div className="px-3.5 py-2 text-[10.5px] italic text-muted-foreground">
            Computing containing branches & tags…
          </div>
        )}

        <div className="px-3.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          Changed files {files.length > 0 && `(${files.length})`}
        </div>
        {filesLoading && (
          <div className="px-3.5 py-2 text-xs text-muted-foreground">Loading...</div>
        )}
        {!filesLoading &&
          files.map((f) => (
            <div
              key={`${f.old_path ?? ""}->${f.path}`}
              onClick={() => commit && openDiff(commit.oid, f.path, files)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!commit) return;
                const items: MenuItem[] = [
                  {
                    label: "Open diff at this commit",
                    onClick: () => openDiff(commit.oid, f.path, files),
                  },
                  {
                    label: "Show file history (follows renames)",
                    onClick: () => void openFileHistory(f.path),
                  },
                  {
                    label: "Blame current version",
                    onClick: () => void openBlame(f.path),
                  },
                  { separator: true, label: "" },
                  {
                    label: `Copy path (${f.path.split("/").pop()})`,
                    onClick: () => void copyText(f.path, "path"),
                  },
                ];
                setMenu({ pos: { x: e.clientX, y: e.clientY }, items });
              }}
              className="flex cursor-pointer items-center gap-2 px-3.5 py-1 hover:bg-accent/50"
            >
              <span
                className={cn(
                  "w-3.5 text-center font-mono text-[11px] font-bold",
                  STATUS_COLOR[f.status],
                )}
              >
                {STATUS_LABEL[f.status]}
              </span>
              <span className="flex-1 truncate font-mono text-xs">
                {f.old_path && f.old_path !== f.path ? `${f.old_path} → ${f.path}` : f.path}
              </span>
              <span className="font-mono text-[10.5px] text-muted-foreground">
                {f.insertions > 0 && (
                  <span className="text-[hsl(var(--diff-added-fg))]">+{f.insertions}</span>
                )}
                {f.insertions > 0 && f.deletions > 0 && " "}
                {f.deletions > 0 && (
                  <span className="text-[hsl(var(--diff-removed-fg))]">-{f.deletions}</span>
                )}
              </span>
            </div>
          ))}
        {!filesLoading && files.length === 0 && (
          <div className="px-3.5 py-2 text-xs text-muted-foreground">No file changes.</div>
        )}

        <div className="px-3.5 pb-1 pt-4 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          Message
        </div>
        <pre className="whitespace-pre-wrap px-3.5 pb-4 font-mono text-[11.5px] text-muted-foreground">
          {fullMessage}
        </pre>
      </div>
      <ContextMenu
        pos={menu?.pos ?? null}
        items={menu?.items ?? []}
        onClose={() => setMenu(null)}
      />
    </aside>
  );
}

/** Tiny copy-to-clipboard button with brief "Copied" tick feedback. */
function CopyBtn({
  text,
  label,
  title,
  compact = false,
}: {
  text: string;
  label: string;
  title: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    await copyText(text, label);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "flex shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground",
        compact ? "h-5 w-5" : "h-6 w-6",
      )}
    >
      {copied ? (
        <Check className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
      ) : (
        <Copy className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
      )}
    </button>
  );
}

function RefChip({ text, title, onClick }: { text: string; title: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="inline-flex h-[18px] items-center rounded border border-border bg-secondary px-1.5 text-[10.5px] hover:bg-accent"
    >
      {text}
    </button>
  );
}

/**
 * Signature badge with **on-demand** trust verification (v0.13.20).
 *
 * Defaults to "header present, not verified" — same as v0.13.19. Clicking
 * the badge fires `verify_commit_signature`, which shells out to gpg /
 * ssh-keygen and surfaces a structured outcome:
 *   - good   → green shield with the signer's identity in the tooltip
 *   - no_key → amber shield (we don't have the public key locally)
 *   - bad    → red triangle (signature does NOT match the payload)
 *   - error  → grey question mark (verifier itself failed — gpg missing, …)
 *
 * The verify result is cached per commit oid for the lifetime of the
 * panel; switching commits resets it (parent component remounts the badge
 * via `key={commit.oid}` when oid changes — actually we rely on local
 * useState being scoped per render, since CommitDetails itself rebuilds
 * sigInfo from the meta payload).
 */
function SignatureBadge({
  info,
  repoPath,
  oid,
}: {
  info: CommitSignatureInfo;
  repoPath: string | null;
  oid: string;
}) {
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [busy, setBusy] = useState(false);

  const isPgp = info.format === "openpgp";
  const isSsh = info.format === "ssh";
  const formatLabel = isPgp ? "GPG" : isSsh ? "SSH" : "Signed";

  // Tone + icon are derived from the verify state when we have one;
  // otherwise we fall back to the v0.13.19 "header-only" green shield.
  const effective: {
    tone: "ok" | "warn" | "bad" | "neutral";
    icon: React.ReactNode;
    label: string;
  } = (() => {
    if (!verify) {
      return {
        tone: "neutral",
        icon: isSsh ? <KeyRound className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />,
        label: formatLabel,
      };
    }
    switch (verify.state) {
      case "good":
        return {
          tone: "ok",
          icon: <ShieldCheck className="h-3 w-3" />,
          label: `${formatLabel} ✓`,
        };
      case "no_key":
        return {
          tone: "warn",
          icon: <HelpCircle className="h-3 w-3" />,
          label: `${formatLabel} no key`,
        };
      case "bad":
        return {
          tone: "bad",
          icon: <ShieldAlert className="h-3 w-3" />,
          label: `${formatLabel} BAD`,
        };
      case "error":
        return {
          tone: "warn",
          icon: <AlertTriangle className="h-3 w-3" />,
          label: `${formatLabel} ?`,
        };
      case "unsigned":
      default:
        return {
          tone: "neutral",
          icon: <ShieldCheck className="h-3 w-3" />,
          label: formatLabel,
        };
    }
  })();

  const toneClass = {
    ok: "border-[hsl(var(--branch-1)/.4)] bg-[hsl(var(--branch-1)/.10)] text-[hsl(var(--branch-1))]",
    warn: "border-[hsl(var(--branch-3)/.4)] bg-[hsl(var(--branch-3)/.10)] text-[hsl(var(--branch-3))]",
    bad: "border-[hsl(var(--destructive)/.4)] bg-[hsl(var(--destructive)/.10)] text-[hsl(var(--destructive))]",
    neutral:
      "border-[hsl(var(--branch-1)/.4)] bg-[hsl(var(--branch-1)/.10)] text-[hsl(var(--branch-1))]",
  }[effective.tone];

  const tooltip = verify
    ? buildVerifyTooltip(verify)
    : `${info.summary} — click to verify against your keyring / allowed-signers file.`;

  const onClick = async () => {
    if (!repoPath || busy) return;
    setBusy(true);
    try {
      const r = await git.verifyCommitSignature(repoPath, oid);
      setVerify(r);
    } catch (e) {
      // Surface as `error` state so the badge tone reflects the failure
      // even when the verifier itself blew up before we could parse it.
      setVerify({
        state: "error",
        format: info.format,
        signer: null,
        output: String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || !repoPath}
      title={tooltip}
      className={cn(
        "inline-flex h-[18px] items-center gap-1 rounded-full border px-1.5 text-[10.5px] font-medium hover:opacity-80",
        toneClass,
        (busy || !repoPath) && "cursor-not-allowed",
      )}
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : effective.icon}
      <span className="font-mono">{busy ? "verify…" : effective.label}</span>
    </button>
  );
}

/** Multiline tooltip describing a verify result. Trimmed so libgit2 / gpg
 *  walls of text don't overflow the OS tooltip box. */
function buildVerifyTooltip(v: VerifyResult): string {
  const lines: string[] = [];
  switch (v.state) {
    case "good":
      lines.push("Signature verified against your keyring.");
      if (v.signer) lines.push(`Signer: ${v.signer}`);
      break;
    case "no_key":
      lines.push("Signature is well-formed, but no matching public key in your trust store.");
      break;
    case "bad":
      lines.push("BAD signature — the signature does NOT match the commit payload.");
      break;
    case "unsigned":
      lines.push("This commit is not signed.");
      break;
    case "error":
      lines.push("Verifier failed to run — see details below.");
      break;
  }
  if (v.output) {
    const trimmed = v.output.length > 400 ? `${v.output.slice(0, 400)}…` : v.output;
    lines.push("");
    lines.push(trimmed);
  }
  return lines.join("\n");
}

/** "Contained in" panel — branches + tags that include this commit. */
function ContainedIn({ branches, tags }: { branches: string[]; tags: string[] }) {
  // Local branches first, then remote (heuristic: contains a `/`).
  const local = branches.filter((b) => !b.includes("/"));
  const remote = branches.filter((b) => b.includes("/"));

  return (
    <div className="border-b border-border/60 bg-card/60 px-3.5 py-2">
      <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        Contained in
      </div>
      {local.length > 0 && (
        <Row
          icon={<GitBranch className="h-3 w-3 text-[hsl(var(--branch-2))]" />}
          items={local}
          chipCls="border-[hsl(var(--branch-2)/.4)] bg-[hsl(var(--branch-2)/.10)] text-[hsl(var(--branch-2))]"
        />
      )}
      {remote.length > 0 && (
        <Row
          icon={<GitBranch className="h-3 w-3 text-muted-foreground" />}
          items={remote}
          chipCls="border-border bg-secondary text-muted-foreground"
        />
      )}
      {tags.length > 0 && (
        <Row
          icon={<Tag className="h-3 w-3 text-[hsl(var(--branch-3))]" />}
          items={tags}
          chipCls="border-[hsl(var(--branch-3)/.4)] bg-[hsl(var(--branch-3)/.10)] text-[hsl(var(--branch-3))]"
        />
      )}
    </div>
  );
}

function Row({
  icon,
  items,
  chipCls,
}: {
  icon: React.ReactNode;
  items: string[];
  chipCls: string;
}) {
  return (
    <div className="mb-1 flex items-start gap-1.5 last:mb-0">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="flex flex-wrap gap-1">
        {items.map((it) => (
          <span
            key={it}
            className={cn(
              "inline-flex h-[18px] items-center rounded-full border px-2 font-mono text-[10.5px]",
              chipCls,
            )}
          >
            {it}
          </span>
        ))}
      </span>
    </div>
  );
}
