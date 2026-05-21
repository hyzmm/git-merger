/**
 * Reflog → quick action mapping.
 *
 * The reflog records every HEAD movement, but only a subset of those
 * movements are meaningful candidates for a "one-click undo" workflow.
 * For example: a plain `commit:` entry can be amended out, but offering
 * a one-click undo that silently drops the commit is dangerous.
 * Conversely a `reset:` or `merge:` entry is a textbook undo target.
 *
 * `classifyAction` parses a reflog message and returns:
 *   - kind: high-level category for icons / colours / labels
 *   - undoable: whether we surface a one-click "Undo" entry for it
 *   - undoLabel: short i18n-key-friendly label, e.g. "Undo merge"
 *
 * Pure function — easy to unit test and reuse from anywhere.
 */

import type { ReflogEntry } from "@/ipc/git";

export type ActionKind =
  | "commit"
  | "amend"
  | "reset"
  | "checkout"
  | "merge"
  | "rebase"
  | "pull"
  | "push"
  | "cherry-pick"
  | "revert"
  | "stash"
  | "branch"
  | "other";

export interface ClassifiedAction {
  kind: ActionKind;
  /** Short label to put in a chip ("reset", "merge", …). */
  label: string;
  /** True when offering a one-click reverse makes sense. */
  undoable: boolean;
  /**
   * Short verb phrase for the Undo button tooltip. Matches the action
   * the user will undo, e.g. "merge", "pull", "reset --hard".
   */
  verb: string;
}

const lc = (s: string): string => s.toLowerCase();

export function classifyAction(message: string): ClassifiedAction {
  const m = lc(message).trim();

  // commit: ... / commit (amend): ... / commit (initial): ...
  if (/^commit\s*\(amend\)/.test(m)) {
    return { kind: "amend", label: "amend", undoable: true, verb: "amend" };
  }
  if (/^commit\b/.test(m)) {
    // Plain commits are not auto-undoable — use Reflog view for that;
    // we don't want users one-click-discarding their work by accident.
    return { kind: "commit", label: "commit", undoable: false, verb: "commit" };
  }

  if (/^reset\b/.test(m)) {
    // Detect hard / mixed / soft from the message tail when libgit2 leaks it.
    const isHard = /\bhard\b/.test(m) || /reset:\s*moving to .*\(hard\)/.test(m);
    return {
      kind: "reset",
      label: "reset",
      undoable: true,
      verb: isHard ? "reset --hard" : "reset",
    };
  }

  if (/^merge\b/.test(m)) {
    return { kind: "merge", label: "merge", undoable: true, verb: "merge" };
  }

  if (/^rebase\b/.test(m) || /^rebase \(/.test(m)) {
    // Only the initial "rebase (start)" / final "rebase (finish)" entries
    // are useful undo targets — intermediate "rebase (pick)" steps would
    // leave the rebase in a half-state. We surface the start/finish.
    const isFinish = /\(finish\)/.test(m);
    const isStart = /\(start\)/.test(m);
    return {
      kind: "rebase",
      label: "rebase",
      undoable: isFinish || isStart,
      verb: "rebase",
    };
  }

  if (/^pull\b/.test(m)) {
    return { kind: "pull", label: "pull", undoable: true, verb: "pull" };
  }
  if (/^push\b/.test(m)) {
    // Push doesn't move HEAD locally — but reflog occasionally records
    // it. Not a useful local undo.
    return { kind: "push", label: "push", undoable: false, verb: "push" };
  }
  if (/^cherry-?pick\b/.test(m)) {
    return { kind: "cherry-pick", label: "cherry-pick", undoable: true, verb: "cherry-pick" };
  }
  if (/^revert\b/.test(m)) {
    return { kind: "revert", label: "revert", undoable: true, verb: "revert" };
  }
  if (/^stash\b/.test(m)) {
    return { kind: "stash", label: "stash", undoable: false, verb: "stash" };
  }
  if (/^checkout\b/.test(m)) {
    // Branch switches don't usually need undoing — the "previous"
    // branch is one keystroke away.
    return { kind: "checkout", label: "checkout", undoable: false, verb: "checkout" };
  }
  if (/^branch\b/.test(m)) {
    return { kind: "branch", label: "branch", undoable: false, verb: "branch" };
  }
  return { kind: "other", label: "other", undoable: false, verb: "action" };
}

export interface QuickUndoCandidate {
  /** Reflog index of the entry being undone (always the most recent useful one). */
  index: number;
  /** OID HEAD pointed to BEFORE this action — i.e. the state we'd restore. */
  targetOid: string;
  /** Short OID for display. */
  shortTargetOid: string;
  /** Classification of the action being undone. */
  action: ClassifiedAction;
  /** Original reflog message. */
  message: string;
}

/**
 * Find the most recent reflog entry that is meaningfully undoable.
 * Returns null when nothing on top of the reflog qualifies, so the
 * Topbar button can hide.
 *
 * The walk stops at the first **commit** with no useful action above it,
 * because by that point any undo would mean rolling back authored work.
 */
export function findQuickUndo(entries: ReflogEntry[]): QuickUndoCandidate | null {
  for (const e of entries) {
    const action = classifyAction(e.message);
    if (action.undoable) {
      return {
        index: e.index,
        targetOid: e.old_oid,
        shortTargetOid: e.short_old_oid,
        action,
        message: e.message,
      };
    }
    // Stop scanning past plain commits — once you've committed, an
    // earlier mistake stops being "the last thing I did".
    if (action.kind === "commit") break;
  }
  return null;
}

/**
 * Top-N undoable entries for the dropdown menu. Skips non-undoable
 * actions (plain commit / checkout / branch / push / stash / other).
 */
export function listUndoables(entries: ReflogEntry[], limit = 8): QuickUndoCandidate[] {
  const out: QuickUndoCandidate[] = [];
  for (const e of entries) {
    if (out.length >= limit) break;
    const action = classifyAction(e.message);
    if (!action.undoable) continue;
    out.push({
      index: e.index,
      targetOid: e.old_oid,
      shortTargetOid: e.short_old_oid,
      action,
      message: e.message,
    });
  }
  return out;
}
