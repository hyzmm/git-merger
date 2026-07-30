import { create } from "zustand";
import {
  git,
  type BlameLine,
  type CommitSummary,
  type CommitMeta,
  type ConflictContent,
  type ConflictFile,
  type FileChange,
  type FileDiff,
  type FileHistoryEntry,
  type MergeState,
  type RebaseStateInfo,
  type RebaseStatus,
  type RebaseStep,
  type RefEntry,
  type ReflogEntry,
  type RepoInfo,
  type StashEntry,
  type SubmoduleInfo,
  type TagInfo,
  type WorkingFile,
  type WorktreeInfo,
  type GitignoreTemplate,
  type IgnorePreview,
  type SearchHit,
  type SearchMode,
  type PatternKind,
} from "@/ipc/git";
import {
  joinChunks,
  parseConflicts,
  resolveText,
  type Chunk,
  type ConflictChunk,
  type Resolution,
} from "@/lib/conflictParser";
import { loadRecent, pushRecent, removeRecent, type RecentRepo } from "@/lib/recentRepos";
import {
  loadFor as loadRecentFiles,
  saveFor as saveRecentFiles,
  pushRecent as pushRecentFile,
  removeRecent as removeRecentFile,
  type RecentFile,
  type RecentAction,
} from "@/lib/recentFiles";
import {
  loadRecents as loadSearchRecents,
  loadSaved as loadSearchSaved,
  pushRecent as pushSearchRecent,
  removeSaved as removeSearchSaved,
  saveRecents as saveSearchRecents,
  saveSaved as saveSearchSaved,
  upsertSaved as upsertSearchSaved,
  type SavedSearch,
  type SearchSnapshot,
} from "@/lib/searchPersist";
import {
  loadTabs,
  saveTabs,
  reorderTabs as reorderTabsList,
  togglePin as togglePinList,
  stablePartitionPinned,
  nextTabId,
} from "@/lib/tabsPersist";
import { toast } from "@/lib/toast";
import { buildSubsetPatch, reversePatch, selectionKey } from "@/lib/subsetPatch";
import { searchDiff, type DiffMatch } from "@/lib/diffSearch";
import { confirm } from "@/lib/confirm";

/**
 * Module-scoped scratch buffer for the v0.13.20 amend toggle: when the
 * user flips amend ON we stash their in-progress message here keyed by
 * repo path, so flipping OFF restores it. Cleared after a successful
 * commit. Lives outside Zustand state because it's purely UX recovery.
 */
const draftBeforeAmend = new Map<string, string>();

export type ViewKey =
  | "history"
  | "diff"
  | "merge"
  | "blame"
  | "changes"
  | "stash"
  | "reflog"
  | "submodules"
  | "rebase"
  | "worktrees"
  | "gitignore"
  | "search"
  | "tags"
  | "fileHistory"
  | "stats";
export type DiffMode = "sbs" | "unified";

interface HistoryState {
  commits: CommitSummary[];
  refs: RefEntry[];
  selectedOid: string | null;
  /**
   * v0.13.26 — multi-selection set for batch operations (cherry-pick is the
   * first user). `selectedOid` (singular) above is the *focus* — the row
   * whose CommitDetails panel is shown — and is always also a member of
   * `selectedOids`. The two stay in sync:
   *   - plain click   → set = { oid }, focus = oid, anchor = oid
   *   - ctrl/cmd-click → toggle oid in set, focus = oid (if added) or
   *                      anchor stays put if removed; anchor = oid
   *   - shift-click   → set ∪= range(anchor, oid); focus = oid; anchor unchanged
   * Empty set means "nothing explicitly multi-selected"; in practice we
   * always keep at least the focused oid in the set when there is one.
   */
  selectedOids: Set<string>;
  /** v0.13.26 — anchor for shift-click range selection. Null until the
   *  first click. Updated on plain-click and ctrl/cmd-click; stable on
   *  shift-click (so multiple shift-clicks all extend from the same point). */
  anchorOid: string | null;
  files: FileChange[];
  filesLoading: boolean;
  /**
   * Rich metadata for the selected commit (full message, committer info,
   * containing branches + tags). Populated lazily after `selectCommit`.
   * v0.13.13.
   */
  meta: CommitMeta | null;
  metaLoading: boolean;
  filter: string;
  /** Author name filter (exact match against `author_name`). null = all. */
  authorFilter: string | null;
  /** Inclusive UNIX-seconds lower bound. null = no bound. */
  sinceFilter: number | null;
  /** Exclusive UNIX-seconds upper bound. null = no bound. */
  untilFilter: number | null;
  /** Pathspec — when set, the backend filters the walk to commits touching this. */
  pathspec: string;
  loading: boolean;
  /** Loading the next page on top of an already-populated `commits`. */
  loadingMore: boolean;
  /** True when the backend signalled there are more commits beyond `commits`. */
  hasMore: boolean;
  /** OID cursor for the next `git_log_page` call (oid of the current last commit). */
  nextCursor: string | null;
  /**
   * v0.13.16 — graph reachability highlight. When set, every row whose
   * oid is NOT in `highlightSet` is dimmed in the UI. The set is the
   * source of truth; `highlightOid` / `highlightMode` are kept around
   * for the toolbar banner ("Highlighting ancestors of abc1234").
   */
  highlightOid: string | null;
  highlightMode: "ancestors" | "descendants" | null;
  highlightSet: Set<string>;
  highlightLoading: boolean;
  error: string | null;
}

interface DiffState {
  oid: string | null;
  files: FileChange[];
  selectedFile: string | null;
  fileDiff: FileDiff | null;
  loading: boolean;
  mode: DiffMode;
  showWhitespace: boolean;
  ignoreWhitespace: boolean;
  error: string | null;
  /**
   * Bidirectional editor sub-state. Only engaged when `oid === WORKING_OID`
   * (i.e. when viewing a working-tree file from the Changes view).
   */
  edit: WorkingEditState;
  /**
   * v0.13.25 — line-level staging selection. Each entry is the result
   * of {@link import("@/lib/subsetPatch").selectionKey}, i.e.
   * `"<hunkIdx>:<lineIdx>"`. Only meaningful when `oid === WORKING_OID`
   * (HEAD diffs are read-only). Cleared whenever `selectedFile` changes
   * or the diff is reloaded.
   *
   * Why a `Set<string>` instead of a `Set<{hunk, line}>`? React/Zustand
   * compare set membership by reference, so primitive keys keep equality
   * checks cheap and let us serialise to localStorage later if needed.
   */
  selectedLines: Set<string>;
  /**
   * v0.13.25 — anchor for shift-click range selection in the Unified
   * view. Stored as the same `"hunkIdx:lineIdx"` selection key that
   * `selectedLines` uses, so we don't need a separate flat-index lookup
   * to decode it. `null` until the user makes a first click.
   */
  selectionAnchor: string | null;
  /**
   * v0.13.34 — In-pane content search (Ctrl/Cmd+F). The bar is mounted
   * lazily — when `open=false`, the rest of the fields are dormant
   * (matches=[], activeIdx=-1) but kept around so reopening preserves
   * the user's last query/case/regex toggles.
   *
   * `matches` is recomputed by the openDiffSearch / setDiffQuery actions
   * (synchronously from `fileDiff`, no IPC); the components that render
   * matches read from this single source of truth.
   *
   * `activeIdx` is the cursor — the match that's highlighted strongest
   * (orange vs yellow) and that scrollIntoView targets. -1 means
   * "no current match" (e.g. empty query).
   */
  search: DiffSearchState;
}

interface DiffSearchState {
  open: boolean;
  query: string;
  caseSensitive: boolean;
  regex: boolean;
  matches: DiffMatch[];
  /** Index into `matches`; -1 when there are no matches. */
  activeIdx: number;
}

/**
 * Sentinel `oid` used to mark a "working tree" diff (vs HEAD). The diff
 * payload comes from `git.workingDiff` instead of `git.fileDiff`, and the
 * SideBySide view enables an editable right pane when this is set.
 */
export const WORKING_OID = "WORKING";

interface WorkingEditState {
  /** When true, the right pane is in editable mode. */
  active: boolean;
  /** Read-only HEAD reference text shown in the left pane. `null` while loading. */
  headText: string | null;
  /** Editable buffer (right pane). `null` while loading. */
  buffer: string | null;
  /** Last text saved to disk — used to detect the dirty state. */
  savedText: string | null;
  /** True when an async load / save is in flight. */
  busy: boolean;
  /** Last error from a load / save attempt. */
  error: string | null;
}

interface MergeView {
  state: MergeState;
  conflicts: ConflictFile[];
  selectedFile: string | null;
  /** Raw three-way content for the selected file. */
  content: ConflictContent | null;
  /** Parsed working-tree text into chunks for the editor. */
  chunks: Chunk[];
  /** Files that have been resolved & staged via resolve_conflict. */
  resolvedFiles: Set<string>;
  loading: boolean;
  error: string | null;
}

interface BlameView {
  file: string | null;
  /** When set, blame was computed at this revision (a historical commit).
   *  When null, blame was computed against the working tree at HEAD. */
  revision: string | null;
  /** Stack of previous (file, revision) pairs we can pop back to.
   *  Newest entry is the one openBlame() was called from originally. */
  history: { file: string; revision: string | null }[];
  lines: BlameLine[];
  loading: boolean;
  /** Available "previous" entry (path + commit) that user can jump to. */
  prev: { file: string; revision: string } | null;
  error: string | null;
}

interface ChangesView {
  files: WorkingFile[];
  selected: Set<string>;
  message: string;
  loading: boolean;
  committing: boolean;
  error: string | null;
  /** v0.13.20 — `git commit --amend` mode: replace HEAD instead of chaining. */
  amend: boolean;
  /** v0.13.20 — append `Signed-off-by:` trailer (per-commit override; default
   *  comes from the persisted UI setting). */
  signoff: boolean;
  /** v0.13.20 — bypass pre-commit / commit-msg / post-commit hooks
   *  (`git commit --no-verify`). Off by default, opt-in per commit. */
  skipHooks: boolean;

  // ---- Phase 1: file tree ----
  /** Group by "directory" (tree) or "status" (staged/unstaged/conflicts). */
  groupBy: "directory" | "status";
  /** Set of directory paths currently expanded in the tree. */
  expandedDirs: Set<string>;
  /** Live filter string for the file list (matches against path). */
  fileFilter: string;

  // ---- Phase 2: inline diff preview ----
  /** Path of the file currently previewed in the inline diff pane. */
  previewFile: string | null;
  /** Working-diff result for `previewFile`. */
  previewDiff: import("@/ipc/git").FileDiff | null;
  /** True while the preview diff is loading. */
  previewLoading: boolean;
  previewError: string | null;

  // ---- Phase 3: commit enhancements ----
  /** Recent commit messages, newest first. Persisted to localStorage. */
  messageHistory: string[];
  /** Override commit author in "Name <email>" format. */
  authorOverride: string | null;
  /** Whether the advanced-options panel is expanded. */
  showAdvancedOptions: boolean;
}

interface StashView {
  entries: StashEntry[];
  loading: boolean;
  busy: boolean;
  error: string | null;
  /** Last successful action message, shown briefly. */
  status: string | null;
  // ----- v0.13.24 inline preview -----
  /**
   * Stack index of the currently-selected stash entry, or `null` when no
   * row is selected (= the right-hand preview pane shows an empty state).
   * Cleared automatically after `loadStash` returns no matching entry.
   */
  selectedIndex: number | null;
  /**
   * File-level changes for the selected stash, computed via
   * `commit_files(stashEntry.oid)` — works because libgit2 stores every
   * stash as a real commit whose first parent is the working-tree state
   * at stash time, so the existing parent-vs-tree diff machinery
   * answers "what does this stash change?" with zero backend code.
   */
  files: FileChange[];
  filesLoading: boolean;
  /** Path of the file the user picked from `files`. `null` until they pick one. */
  selectedFile: string | null;
  /** FileDiff for `selectedFile` of the selected stash. */
  fileDiff: FileDiff | null;
  diffLoading: boolean;
}

interface ReflogView {
  entries: ReflogEntry[];
  loading: boolean;
  error: string | null;
}

interface SubmodulesView {
  entries: SubmoduleInfo[];
  loading: boolean;
  busy: boolean;
  status: string | null;
  error: string | null;
}

interface TagsView {
  entries: TagInfo[];
  loading: boolean;
  /** True while a push / delete-remote / delete-local op is running. */
  busy: boolean;
  status: string | null;
  error: string | null;
}

interface WorktreesView {
  entries: WorktreeInfo[];
  loading: boolean;
  busy: boolean;
  status: string | null;
  error: string | null;
}

interface GitignoreView {
  /** Saved-on-disk content of repository root .gitignore (initial load). */
  saved: string;
  /** Live editor buffer (may be ahead of `saved`). */
  draft: string;
  templates: GitignoreTemplate[];
  preview: IgnorePreview | null;
  loading: boolean;
  /** Saving / previewing / template-loading. */
  busy: boolean;
  status: string | null;
  error: string | null;
}

interface SearchView {
  /** Live editor field — what the user is currently typing. */
  query: string;
  mode: SearchMode;
  patternKind: PatternKind;
  caseSensitive: boolean;
  pathspec: string;
  /** Actual results returned by the most recently dispatched search. */
  hits: SearchHit[];
  /** Hit currently shown in the right preview panel. */
  selectedOid: string | null;
  /** Number of commits walked by the most recent search. */
  scanned: number;
  /** True when the backend stopped before exhausting the DAG. */
  truncated: boolean;
  /** True while a search is in flight. */
  busy: boolean;
  /** Echo of the query that produced the current `hits`. */
  appliedQuery: string;
  error: string | null;
  /**
   * v0.13.4 — how the result list should be rendered.
   * - "commit": one row per commit (legacy v0.11 layout).
   * - "file":   commits rolled up by file path (Find-in-Path style).
   */
  groupBy: "commit" | "file";
  /** Most-recent search snapshots, head = most recent. Persisted to localStorage. */
  recents: SearchSnapshot[];
  /** User-named saved searches. Persisted to localStorage. */
  saved: SavedSearch[];
}

interface RebaseView {
  /** Drafted plan before `start` is invoked. Empty when no plan is open. */
  plan: RebaseStep[];
  /** Base commit oid the plan is built against. */
  baseOid: string | null;
  /** Persistent backend state during execution; null between sessions. */
  state: RebaseStateInfo | null;
  /** UI flag: backend reported the last step left conflicts. */
  conflicted: boolean;
  busy: boolean;
  status: string | null;
  error: string | null;
}

interface PaletteState {
  open: boolean;
  /** Cached HEAD-tree file list, lazily loaded the first time the palette opens. */
  files: string[];
  filesLoadedFor: string | null;
}

interface FileHistoryView {
  /** Path the user originally asked for; UI shows this in the toolbar. */
  startPath: string | null;
  entries: FileHistoryEntry[];
  /** Index of currently-selected entry (drives the right-side diff). */
  selectedIdx: number;
  /** Diff of the selected entry. */
  fileDiff: FileDiff | null;
  diffLoading: boolean;
  loading: boolean;
  error: string | null;
}

interface AppState {
  repo: RepoInfo | null;
  view: ViewKey;
  loading: boolean;
  error: string | null;

  history: HistoryState;
  diff: DiffState;
  merge: MergeView;
  blame: BlameView;
  changes: ChangesView;
  stash: StashView;
  reflog: ReflogView;
  submodules: SubmodulesView;
  tags: TagsView;
  rebase: RebaseView;
  palette: PaletteState;
  fileHistory: FileHistoryView;
  worktrees: WorktreesView;
  gitignore: GitignoreView;
  search: SearchView;

  recentRepos: RecentRepo[];
  /**
   * v0.13.8 — MRU file list for the **currently open** repo. Persisted
   * per-repo to localStorage (key = `gittools.recent-files.v1.<hash>`)
   * via the `recentFiles` helper module. Reset on `openRepo` /
   * `switchTab`; bumped by `noteRecentFile`, which the four file-open
   * actions call on user-initiated entry.
   */
  recentFiles: RecentFile[];
  /** v0.13.8 — Recent Files palette open/closed state. */
  recentFilesOpen: boolean;

  /** Settings dialog open/closed state. */
  settingsOpen: boolean;

  // Multi-tab session model. The active tab's state is mirrored at the top
  // level of this store (so existing selectors keep working); inactive tabs
  // have their state parked in `sessionsById`. See snapshotSession /
  // emptySession in the implementation.
  tabs: RepoTab[];
  activeTabId: string | null;
  sessionsById: Record<string, SessionSnapshot>;

  setView: (v: ViewKey) => void;
  openRepo: (path: string) => Promise<void>;
  reset: () => void;
  refresh: () => Promise<void>;
  removeRecentRepo: (path: string) => void;
  /** v0.13.8 — bump a file in the recent list (called by open* actions). */
  noteRecentFile: (file: string, action: RecentAction) => void;
  /** v0.13.8 — open / close the Recent Files palette (`Ctrl+E`). */
  openRecentFiles: () => void;
  closeRecentFiles: () => void;

  /** Open / close the Settings dialog. */
  openSettings: () => void;
  closeSettings: () => void;

  /** v0.13.8 — drop a single entry, e.g. via the palette's row-hover X button. */
  forgetRecentFile: (path: string) => void;

  // tabs
  addTab: (path?: string) => Promise<string>;
  switchTab: (id: string) => void;
  closeTab: (id: string) => void;
  renameTab: (id: string, label: string) => void;
  /** Open a new blank tab pointed at the welcome page (no repo). */
  newBlankTab: () => string;
  /** v0.13.5 — toggle pinned state and re-partition the bar. */
  togglePinTab: (id: string) => void;
  /** v0.13.5 — drag-and-drop reorder. `toIdx` is "drop before original index". */
  reorderTab: (fromIdx: number, toIdx: number) => void;
  /** v0.13.5 — close every tab except `keepId` (pinned tabs are kept too). */
  closeOtherTabs: (keepId: string) => void;
  /** v0.13.5 — close every non-pinned tab to the right of `id`. */
  closeRightTabs: (id: string) => void;
  /** v0.13.5 — cycle to the next/prev tab (wraps). */
  cycleTab: (dir: 1 | -1) => void;

  // history
  loadHistory: () => Promise<void>;
  loadMoreHistory: () => Promise<void>;
  /** v0.13.21 — incremental "top-up" refresh: only fetch commits newer than
   *  the current list head, prepend them, and refresh refs. Falls back to a
   *  full `loadHistory` when the cursor is orphaned (force-push / reset) or
   *  when a pathspec filter is active. */
  topUpHistory: () => Promise<void>;
  selectCommit: (oid: string) => Promise<void>;
  /**
   * v0.13.26 — multi-selection click handler for the history list. The
   * three modifier modes mirror IntelliJ's commit table:
   *   - "single": replaces the set with `{oid}`; anchor = oid.
   *   - "ctrl":   toggles `oid` in the set; anchor = oid.
   *   - "shift":  unions the [anchor..oid] range into the set; anchor
   *               unchanged. When there's no anchor (first click is
   *               shift-click) we fall back to "single".
   *
   * Always also drives `selectCommit` for the focused oid so the
   * CommitDetails panel and existing single-selection consumers (e.g.
   * the visualisation graph's auto-scroll, RefsPane head highlight)
   * stay in sync.
   */
  selectCommitMulti: (oid: string, mode: "single" | "ctrl" | "shift") => Promise<void>;
  /** v0.13.26 — clear the multi-selection back to nothing. Useful when
   *  the user presses Esc or clicks an empty area. */
  clearCommitMultiSelect: () => void;
  setFilter: (q: string) => void;
  setAuthorFilter: (a: string | null) => void;
  setDateRange: (since: number | null, until: number | null) => void;
  setPathspec: (p: string) => void;
  resetHistoryFilters: () => void;
  /** v0.13.16 — Highlight every commit reachable from `oid` walking backwards through parents. */
  highlightAncestors: (oid: string) => Promise<void>;
  /** v0.13.16 — Highlight every commit reachable from `oid` walking forwards through children. */
  highlightDescendants: (oid: string) => Promise<void>;
  /** v0.13.16 — Drop the highlight set so every row is rendered at full opacity again. */
  clearHighlight: () => void;

  // diff
  openDiff: (oid: string, file: string, files?: FileChange[]) => Promise<void>;
  selectDiffFile: (file: string) => Promise<void>;
  setDiffMode: (m: DiffMode) => void;
  toggleWhitespace: () => void;
  toggleIgnoreWhitespace: () => void;
  /** Open the working-tree diff for `file` and load HEAD reference + buffer. */
  openWorkingDiff: (file: string) => Promise<void>;
  /** Toggle the editable right pane (only meaningful when oid===WORKING_OID). */
  setEditActive: (active: boolean) => Promise<void>;
  /** Update the editor buffer (drives dirty state). */
  setEditBuffer: (buffer: string) => void;
  /** Persist the buffer to disk via `write_working_file`. */
  saveEditBuffer: () => Promise<void>;
  /** Discard buffer edits and restore the on-disk version. */
  resetEditBuffer: () => Promise<void>;

  // ---- v0.13.25 line-level staging ----
  /** Toggle a single +/− line into the selection. Resets the shift-click
   *  anchor to this line. No-op for context lines (which can't be staged). */
  toggleDiffLine: (hunkIdx: number, lineIdx: number) => void;
  /** Extend the selection from the current anchor to (hunkIdx, lineIdx),
   *  inclusive on both ends. Adds every +/− line in that range to the
   *  selection; doesn't change the anchor. No-op when there's no anchor
   *  yet (caller should fall back to `toggleDiffLine`). */
  extendDiffLineRangeTo: (hunkIdx: number, lineIdx: number) => void;
  /** Drop the selection (e.g. user pressed Esc / clicked outside the diff). */
  clearDiffLineSelection: () => void;
  /** Stage the selected +/− lines (sub-patch → apply to Index). */
  stageSelectedLines: () => Promise<void>;
  /** Unstage the selected +/− lines (reversed sub-patch → apply to Index). */
  unstageSelectedLines: () => Promise<void>;
  /** Discard the selected +/− lines from the working tree (reversed sub-patch → WorkDir). */
  discardSelectedLines: () => Promise<void>;

  // ---- v0.13.34 in-pane diff search (Ctrl/Cmd+F) ----
  /** Open the search bar. If already open, focuses without resetting. */
  openDiffSearch: () => void;
  /** Close the search bar and clear matches (but keep query/toggles
   *  for the next time the user opens it). */
  closeDiffSearch: () => void;
  /** Update the query string and recompute matches synchronously. */
  setDiffSearchQuery: (query: string) => void;
  /** Toggle case-sensitive matching and rerun the search. */
  toggleDiffSearchCase: () => void;
  /** Toggle regex mode and rerun the search. */
  toggleDiffSearchRegex: () => void;
  /** Move the active match cursor by `dir` (+1 = next, -1 = prev),
   *  wrapping at the ends so the user can keep tapping Enter. */
  stepDiffSearch: (dir: 1 | -1) => void;

  // merge
  loadMerge: () => Promise<void>;
  selectConflict: (file: string) => Promise<void>;
  applyResolution: (chunkIndex: number, choice: Resolution) => void;
  /** v0.13.18 — Apply the same resolution to every conflict block in the current file. */
  applyAllResolutions: (choice: "left" | "right" | "both") => void;
  /** v0.13.18 — Reset every block to "pending" (drops any prior accept / manual edits). */
  resetAllResolutions: () => void;
  setResultText: (chunkIndex: number, text: string) => void;
  resolveCurrentFile: () => Promise<void>;
  abortMerge: () => Promise<void>;
  commitMerge: (message?: string) => Promise<void>;

  // blame
  openBlame: (file: string) => Promise<void>;
  blameAt: (file: string, revision: string) => Promise<void>;
  blameFollowRename: () => Promise<void>;
  /** v0.13.17 — Re-blame the current file at the parent of `oid` (i.e. one
   *  commit *before* the change that introduced the line). Mirrors IntelliJ's
   *  "Annotate Revision Before This Change" action. */
  blameBeforeCommit: (oid: string) => Promise<void>;
  blameBack: () => Promise<void>;

  // changes (working tree)
  loadChanges: () => Promise<void>;
  toggleChange: (path: string) => void;
  selectAllChanges: () => void;
  clearChangeSelection: () => void;
  stageSelected: () => Promise<void>;
  unstageSelected: () => Promise<void>;
  discardSelected: () => Promise<void>;
  setCommitMessage: (m: string) => void;
  /** v0.13.20 — toggle amend mode; pre-fills the message input with the
   *  HEAD commit's existing message when turned on, and restores the
   *  previously typed draft when turned off. */
  setAmend: (on: boolean) => Promise<void>;
  /** v0.13.20 — per-commit override of the persisted "Sign-off by default" setting. */
  setSignoff: (on: boolean) => void;
  /** v0.13.20 — `git commit --no-verify` toggle; opt-in per commit. */
  setSkipHooks: (on: boolean) => void;
  commitWorking: () => Promise<void>;

  // ---- Phase 1: file tree actions ----
  setChangesGroupBy: (mode: "directory" | "status") => void;
  toggleDirExpand: (dir: string) => void;
  expandAllDirs: () => void;
  collapseAllDirs: () => void;
  setChangesFileFilter: (query: string) => void;
  /** Select/deselect all files currently visible (respects filter). */
  selectFilteredChanges: () => void;

  // ---- Phase 2: inline diff preview ----
  previewChangesFile: (file: string) => Promise<void>;
  clearChangesPreview: () => void;

  // ---- Phase 3: commit enhancements ----
  /** Add a message to history (called after successful commit). */
  pushCommitMessage: (msg: string) => void;
  setAuthorOverride: (author: string | null) => void;
  setShowAdvancedOptions: (show: boolean) => void;

  // stash
  loadStash: () => Promise<void>;
  saveStash: (opts?: {
    message?: string;
    includeUntracked?: boolean;
    keepIndex?: boolean;
  }) => Promise<void>;
  applyStash: (index: number) => Promise<void>;
  popStash: (index: number) => Promise<void>;
  dropStash: (index: number) => Promise<void>;
  /** v0.13.24 — pick a stash entry to preview; loads its file list (and
   *  auto-selects the first file). Pass `null` to clear the selection. */
  selectStashEntry: (index: number | null) => Promise<void>;
  /** v0.13.24 — pick a file in the currently-selected stash to load its diff. */
  selectStashFile: (file: string) => Promise<void>;

  // ref ops (branch / tag)
  createBranch: (name: string, startPoint: string, checkout?: boolean) => Promise<void>;
  checkoutBranch: (name: string) => Promise<void>;
  checkoutCommit: (oid: string) => Promise<void>;
  deleteBranch: (name: string) => Promise<void>;
  renameBranch: (oldName: string, newName: string) => Promise<void>;
  createTag: (name: string, target: string, message?: string) => Promise<void>;
  deleteTag: (name: string) => Promise<void>;

  // tags panel (v0.13.12)
  loadTags: () => Promise<void>;
  pushTag: (tagName: string, opts?: { remote?: string; force?: boolean }) => Promise<void>;
  pushAllTags: (opts?: { remote?: string; force?: boolean }) => Promise<void>;
  deleteRemoteTag: (tagName: string, opts?: { remote?: string }) => Promise<void>;

  // commit ops
  cherryPick: (oid: string) => Promise<void>;
  /**
   * v0.13.26 — batch cherry-pick. Caller passes oids in *any* order;
   * the action sorts them oldest-first using the current history list
   * (commits is newest-first, so it's just a filter+reverse). Confirms,
   * runs `cherry_pick_sequence`, and on a `Stopped` outcome routes to
   * the merge view + remembers the pending tail in `s.history.error`
   * (read by the toolbar) so the user can finish manually after
   * resolving the conflict. */
  cherryPickMany: (oids: string[]) => Promise<void>;
  revertCommit: (oid: string) => Promise<void>;
  resetTo: (oid: string, mode: "soft" | "mixed" | "hard") => Promise<void>;

  // reflog
  loadReflog: () => Promise<void>;

  // submodules
  loadSubmodules: () => Promise<void>;
  initSubmodule: (name: string) => Promise<void>;
  updateSubmodule: (name: string) => Promise<void>;
  /** v0.13.11 — recursively update a submodule and any of its own submodules. */
  updateSubmoduleRecursive: (name: string) => Promise<void>;
  syncSubmodule: (name: string) => Promise<void>;

  // worktrees
  loadWorktrees: () => Promise<void>;
  addWorktree: (name: string, targetPath: string, branch?: string) => Promise<void>;
  removeWorktree: (name: string, force?: boolean) => Promise<void>;
  pruneWorktrees: () => Promise<void>;

  // gitignore
  loadGitignore: () => Promise<void>;
  setGitignoreDraft: (text: string) => void;
  saveGitignore: () => Promise<void>;
  previewGitignore: () => Promise<void>;
  appendGitignoreTemplate: (id: string) => void;

  // search
  setSearchQuery: (q: string) => void;
  setSearchMode: (m: SearchMode) => void;
  setSearchPatternKind: (k: PatternKind) => void;
  toggleSearchCase: () => void;
  setSearchPathspec: (p: string) => void;
  selectSearchHit: (oid: string | null) => void;
  runSearch: () => Promise<void>;
  clearSearch: () => void;
  /** v0.13.4: switch the result rendering mode. */
  setSearchGroupBy: (g: "commit" | "file") => void;
  /** Apply a stored snapshot (recents row click or saved-search load). */
  applySearchSnapshot: (s: SearchSnapshot) => void;
  /** Persist the current search axes under a user-given name. */
  saveCurrentSearch: (name: string) => void;
  /** Drop a saved search by name. */
  deleteSavedSearch: (name: string) => void;
  /** Wipe the recent-queries list (does NOT touch saved searches). */
  clearSearchRecents: () => void;

  // interactive rebase
  openRebasePlan: (baseOid: string) => Promise<void>;
  setRebasePlan: (plan: RebaseStep[]) => void;
  updateRebaseStep: (index: number, patch: Partial<RebaseStep>) => void;
  moveRebaseStep: (index: number, dir: -1 | 1) => void;
  startRebase: () => Promise<void>;
  rebaseAdvance: () => Promise<void>;
  rebaseContinue: () => Promise<void>;
  rebaseAbort: () => Promise<void>;
  refreshRebaseStatus: () => Promise<void>;
  closeRebasePlan: () => void;

  // command palette
  openPalette: () => void;
  closePalette: () => void;
  ensureTrackedFiles: () => Promise<void>;

  // file history
  openFileHistory: (file: string) => Promise<void>;
  selectFileHistoryEntry: (idx: number) => Promise<void>;
}

function dedupAppend(prev: CommitSummary[], next: CommitSummary[]): CommitSummary[] {
  if (next.length === 0) return prev;
  if (prev.length === 0) return next;
  const seen = new Set(prev.map((c) => c.oid));
  const merged = prev.slice();
  for (const c of next) {
    if (!seen.has(c.oid)) {
      merged.push(c);
      seen.add(c.oid);
    }
  }
  return merged;
}

const emptyHistory: HistoryState = {
  commits: [],
  refs: [],
  selectedOid: null,
  // v0.13.26 — multi-selection.
  selectedOids: new Set<string>(),
  anchorOid: null,
  files: [],
  filesLoading: false,
  meta: null,
  metaLoading: false,
  filter: "",
  authorFilter: null,
  sinceFilter: null,
  untilFilter: null,
  pathspec: "",
  loading: false,
  loadingMore: false,
  hasMore: false,
  nextCursor: null,
  highlightOid: null,
  highlightMode: null,
  highlightSet: new Set<string>(),
  highlightLoading: false,
  error: null,
};

const emptyEdit: WorkingEditState = {
  active: false,
  headText: null,
  buffer: null,
  savedText: null,
  busy: false,
  error: null,
};

const emptyDiffSearch: DiffSearchState = {
  open: false,
  query: "",
  caseSensitive: false,
  regex: false,
  matches: [],
  activeIdx: -1,
};

const emptyDiff: DiffState = {
  oid: null,
  files: [],
  selectedFile: null,
  fileDiff: null,
  loading: false,
  mode: "sbs",
  showWhitespace: false,
  ignoreWhitespace: false,
  error: null,
  edit: { ...emptyEdit },
  selectedLines: new Set<string>(),
  selectionAnchor: null,
  search: { ...emptyDiffSearch },
};

const emptyMerge: MergeView = {
  state: "clean",
  conflicts: [],
  selectedFile: null,
  content: null,
  chunks: [],
  resolvedFiles: new Set(),
  loading: false,
  error: null,
};

const emptyBlame: BlameView = {
  file: null,
  revision: null,
  history: [],
  lines: [],
  loading: false,
  prev: null,
  error: null,
};

const emptyChanges: ChangesView = {
  files: [],
  selected: new Set(),
  message: "",
  loading: false,
  committing: false,
  error: null,
  amend: false,
  signoff: false,
  skipHooks: false,
  groupBy: "directory",
  expandedDirs: new Set(),
  fileFilter: "",
  previewFile: null,
  previewDiff: null,
  previewLoading: false,
  previewError: null,
  messageHistory: [],
  authorOverride: null,
  showAdvancedOptions: false,
};

const emptyStash: StashView = {
  entries: [],
  loading: false,
  busy: false,
  error: null,
  status: null,
  // v0.13.24 — inline preview state.
  selectedIndex: null,
  files: [],
  filesLoading: false,
  selectedFile: null,
  fileDiff: null,
  diffLoading: false,
};

const emptyReflog: ReflogView = {
  entries: [],
  loading: false,
  error: null,
};

const emptySubmodules: SubmodulesView = {
  entries: [],
  loading: false,
  busy: false,
  status: null,
  error: null,
};

const emptyTags: TagsView = {
  entries: [],
  loading: false,
  busy: false,
  status: null,
  error: null,
};

const emptyWorktrees: WorktreesView = {
  entries: [],
  loading: false,
  busy: false,
  status: null,
  error: null,
};

const emptyGitignore: GitignoreView = {
  saved: "",
  draft: "",
  templates: [],
  preview: null,
  loading: false,
  busy: false,
  status: null,
  error: null,
};

const emptySearch: SearchView = {
  query: "",
  mode: "both",
  patternKind: "literal",
  caseSensitive: false,
  pathspec: "",
  hits: [],
  selectedOid: null,
  scanned: 0,
  truncated: false,
  busy: false,
  appliedQuery: "",
  error: null,
  groupBy: "commit",
  // Recents + saved are seeded from localStorage on store creation; tabs that
  // copy this template after the fact will pick the latest live values via
  // `mergeSearchPersisted` below instead of these placeholders.
  recents: [],
  saved: [],
};

const emptyRebase: RebaseView = {
  plan: [],
  baseOid: null,
  state: null,
  conflicted: false,
  busy: false,
  status: null,
  error: null,
};

const emptyPalette: PaletteState = {
  open: false,
  files: [],
  filesLoadedFor: null,
};

const emptyFileHistory: FileHistoryView = {
  startPath: null,
  entries: [],
  selectedIdx: 0,
  fileDiff: null,
  diffLoading: false,
  loading: false,
  error: null,
};

// ---------------------------------------------------------------------------
// Multi-tab session model (v0.12.0)
// ---------------------------------------------------------------------------
// Each repository the user opens lives in its own *tab*. The *active* tab's
// state is mirrored at the top level of the store (so all existing selectors
// `useApp(s => s.history.commits)` keep working unchanged); inactive tabs
// have their state stashed in `sessionsById` until the user switches back.
//
// Switching tabs does a single batch swap: snapshot the current top-level
// fields into `sessionsById[oldActive]`, then apply the new tab's snapshot
// onto the top level. Two tabs with the same repo path are allowed (e.g.
// two views into the same monorepo) but discouraged via the "already open"
// short-circuit in `addTab`.

export interface RepoTab {
  id: string;
  /** Repo workdir path (or empty string when the tab is brand-new without a repo). */
  repoPath: string;
  /** Display label — last segment of `repoPath` by default. */
  label: string;
  /** v0.13.5 — pinned tabs sort to the front and refuse Ctrl+W. */
  pinned: boolean;
}

interface SessionSnapshot {
  repo: RepoInfo | null;
  view: ViewKey;
  history: HistoryState;
  diff: DiffState;
  merge: MergeView;
  blame: BlameView;
  changes: ChangesView;
  stash: StashView;
  reflog: ReflogView;
  submodules: SubmodulesView;
  tags: TagsView;
  rebase: RebaseView;
  fileHistory: FileHistoryView;
  worktrees: WorktreesView;
  gitignore: GitignoreView;
  search: SearchView;
}

function emptySession(): SessionSnapshot {
  return {
    repo: null,
    view: "history",
    history: { ...emptyHistory },
    diff: { ...emptyDiff },
    merge: { ...emptyMerge, resolvedFiles: new Set() },
    blame: { ...emptyBlame },
    changes: { ...emptyChanges, selected: new Set() },
    stash: { ...emptyStash },
    reflog: { ...emptyReflog },
    submodules: { ...emptySubmodules },
    tags: { ...emptyTags },
    rebase: { ...emptyRebase },
    fileHistory: { ...emptyFileHistory },
    worktrees: { ...emptyWorktrees },
    gitignore: { ...emptyGitignore },
    search: { ...emptySearch },
  };
}

function snapshotSession(s: AppState): SessionSnapshot {
  return {
    repo: s.repo,
    view: s.view,
    history: s.history,
    diff: s.diff,
    merge: s.merge,
    blame: s.blame,
    changes: s.changes,
    stash: s.stash,
    reflog: s.reflog,
    submodules: s.submodules,
    tags: s.tags,
    rebase: s.rebase,
    fileHistory: s.fileHistory,
    worktrees: s.worktrees,
    gitignore: s.gitignore,
    search: s.search,
  };
}

function tabLabelFromPath(p: string): string {
  if (!p) return "(empty)";
  const norm = p.replace(/\\/g, "/").replace(/\/+$/, "");
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(idx + 1) || norm : norm;
}

function newTabId(): string {
  return `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useApp = create<AppState>((set, get) => ({
  repo: null,
  view: "history",
  loading: false,
  error: null,
  history: { ...emptyHistory },
  diff: { ...emptyDiff },
  merge: { ...emptyMerge, resolvedFiles: new Set() },
  blame: { ...emptyBlame },
  changes: { ...emptyChanges, selected: new Set() },
  stash: { ...emptyStash },
  reflog: { ...emptyReflog },
  submodules: { ...emptySubmodules },
  tags: { ...emptyTags },
  rebase: { ...emptyRebase },
  palette: { ...emptyPalette },
  fileHistory: { ...emptyFileHistory },
  worktrees: { ...emptyWorktrees },
  gitignore: { ...emptyGitignore },
  search: {
    ...emptySearch,
    // v0.13.4: hydrate persisted recent + saved lists once at store
    // creation. Each tab inherits a snapshot of these on switch via
    // `snapshotSession` — but the **live** lists are mutated through
    // `useApp.getState().search.{recents,saved}` so persistence remains
    // single-sourced no matter which tab is active.
    recents: loadSearchRecents(),
    saved: loadSearchSaved(),
  },

  recentRepos: loadRecent(),

  // v0.13.8 — Recent Files MRU. Empty until a repo is opened
  // (openRepo / switchTab will rehydrate from localStorage for the
  // newly active repo).
  recentFiles: [],
  recentFilesOpen: false,

  settingsOpen: false,

  // v0.13.5 — restore the list of open tabs from localStorage at start-up.
  // Sessions are NOT persisted; each restored tab starts in the "lazy" state
  // (its session will be built from scratch the first time the user
  // switches to it via switchTab → openRepo).
  ...(() => {
    const persisted = loadTabs();
    return {
      tabs: persisted.tabs.map(
        (t): RepoTab => ({
          id: t.id,
          repoPath: t.repoPath,
          label: t.label,
          pinned: t.pinned,
        }),
      ),
      activeTabId: persisted.activeTabId,
    };
  })(),
  sessionsById: {},

  setView: (v) => {
    set({ view: v });
    if (v === "merge") void get().loadMerge();
    if (v === "changes") void get().loadChanges();
    if (v === "stash") void get().loadStash();
    if (v === "reflog") void get().loadReflog();
    if (v === "submodules") void get().loadSubmodules();
    if (v === "tags") void get().loadTags();
    if (v === "rebase") void get().refreshRebaseStatus();
    if (v === "worktrees") void get().loadWorktrees();
    if (v === "gitignore") void get().loadGitignore();
  },

  openRepo: async (path) => {
    set({ loading: true, error: null });
    try {
      const repo = await git.openRepo(path);
      const recentRepos = pushRecent(repo.path);

      // ---------- multi-tab routing ----------
      // 1) If some other tab already owns this repo, snapshot the current
      //    session into the active tab and just switch to that one — no
      //    point in opening the same repo twice.
      const cur = get();
      const existing = cur.tabs.find((t) => t.repoPath === repo.path && t.id !== cur.activeTabId);
      if (existing) {
        set({ loading: false });
        get().switchTab(existing.id);
        return;
      }

      // 2) If there is no active tab yet, create one for this repo.
      // 3) Otherwise reuse the active tab and update its label/path.
      let { tabs, activeTabId } = cur;
      if (!activeTabId) {
        const id = newTabId();
        const tab: RepoTab = {
          id,
          repoPath: repo.path,
          label: tabLabelFromPath(repo.path),
          pinned: false,
        };
        tabs = [...tabs, tab];
        activeTabId = id;
      } else {
        tabs = tabs.map((t) =>
          t.id === activeTabId
            ? { ...t, repoPath: repo.path, label: tabLabelFromPath(repo.path) }
            : t,
        );
      }

      set({
        repo,
        loading: false,
        recentRepos,
        // v0.13.8 — rehydrate the per-repo MRU now that we know which
        // repo is active. Empty list is fine when this is a fresh repo.
        recentFiles: loadRecentFiles(repo.path),
        recentFilesOpen: false,
        tabs,
        activeTabId,
        view: "history",
        history: { ...emptyHistory },
        diff: { ...emptyDiff },
        merge: { ...emptyMerge, resolvedFiles: new Set() },
        blame: { ...emptyBlame },
        changes: { ...emptyChanges, selected: new Set() },
        stash: { ...emptyStash },
        reflog: { ...emptyReflog },
        submodules: { ...emptySubmodules },
        tags: { ...emptyTags },
        rebase: { ...emptyRebase },
        palette: { ...emptyPalette },
        fileHistory: { ...emptyFileHistory },
        worktrees: { ...emptyWorktrees },
        gitignore: { ...emptyGitignore },
        search: { ...emptySearch },
      });
      void get().loadHistory();
      void get().refreshRebaseStatus();
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  reset: () => {
    const { activeTabId } = get();
    if (activeTabId) {
      get().closeTab(activeTabId);
    } else {
      // No tabs at all — nothing to close, but make sure the top-level
      // session fields are blanked.
      const blank = emptySession();
      set({
        repo: blank.repo,
        view: blank.view,
        error: null,
        history: blank.history,
        diff: blank.diff,
        merge: blank.merge,
        blame: blank.blame,
        changes: blank.changes,
        stash: blank.stash,
        reflog: blank.reflog,
        submodules: blank.submodules,
        rebase: blank.rebase,
        palette: { ...emptyPalette },
        fileHistory: blank.fileHistory,
        worktrees: blank.worktrees,
        gitignore: blank.gitignore,
        search: blank.search,
        recentFiles: [],
        recentFilesOpen: false,
      });
    }
  },

  // ---------- Tabs ----------
  addTab: async (path) => {
    if (!path) return get().newBlankTab();
    // Same-repo short-circuit handled inside openRepo below; first create a
    // blank tab so the new repo's session lands there instead of stomping
    // the currently active tab.
    const id = get().newBlankTab();
    await get().openRepo(path);
    return id;
  },

  newBlankTab: () => {
    const cur = get();
    // Stash the currently-active session before creating a new empty one.
    const newTabIdValue = newTabId();
    const newTab: RepoTab = {
      id: newTabIdValue,
      repoPath: "",
      label: "(new)",
      pinned: false,
    };
    let nextSessions = cur.sessionsById;
    if (cur.activeTabId) {
      nextSessions = { ...cur.sessionsById, [cur.activeTabId]: snapshotSession(cur) };
    }
    const tabs = [...cur.tabs, newTab];
    const blank = emptySession();
    set({
      tabs,
      activeTabId: newTabIdValue,
      sessionsById: nextSessions,
      repo: blank.repo,
      view: blank.view,
      error: null,
      history: blank.history,
      diff: blank.diff,
      merge: blank.merge,
      blame: blank.blame,
      changes: blank.changes,
      stash: blank.stash,
      reflog: blank.reflog,
      submodules: blank.submodules,
      rebase: blank.rebase,
      fileHistory: blank.fileHistory,
      worktrees: blank.worktrees,
      gitignore: blank.gitignore,
      search: blank.search,
      recentFiles: [],
      recentFilesOpen: false,
    });
    return newTabIdValue;
  },

  switchTab: (id) => {
    const cur = get();
    if (id === cur.activeTabId) return;
    const targetTab = cur.tabs.find((t) => t.id === id);
    if (!targetTab) return;

    // 1) Stash the currently-active session (if any).
    const nextSessions = { ...cur.sessionsById };
    if (cur.activeTabId) {
      nextSessions[cur.activeTabId] = snapshotSession(cur);
    }

    // 2) Pop the target session off `sessionsById` and apply it to the top
    //    level. If the target was never visited (e.g. just created via
    //    addTab), fall back to a fresh empty session — and if it has a
    //    repoPath, lazy-load the repo *after* the swap.
    const stored = nextSessions[id];
    delete nextSessions[id];
    const session = stored ?? emptySession();
    const needsLazyLoad = !stored && targetTab.repoPath !== "";

    set({
      activeTabId: id,
      sessionsById: nextSessions,
      repo: session.repo,
      view: session.view,
      error: null,
      history: session.history,
      diff: session.diff,
      merge: session.merge,
      blame: session.blame,
      changes: session.changes,
      stash: session.stash,
      reflog: session.reflog,
      submodules: session.submodules,
      rebase: session.rebase,
      fileHistory: session.fileHistory,
      worktrees: session.worktrees,
      gitignore: session.gitignore,
      search: session.search,
      // v0.13.8 — rehydrate the per-repo MRU for the surfacing tab.
      // For a lazy tab `session.repo` is null and openRepo (kicked off
      // below) will rehydrate; for a re-surfaced tab we read directly.
      recentFiles: session.repo ? loadRecentFiles(session.repo.path) : [],
      recentFilesOpen: false,
    });

    if (needsLazyLoad) {
      void get().openRepo(targetTab.repoPath);
    }
  },

  closeTab: (id) => {
    const cur = get();
    const idx = cur.tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const remaining = cur.tabs.filter((t) => t.id !== id);
    const nextSessions = { ...cur.sessionsById };
    delete nextSessions[id];

    if (id !== cur.activeTabId) {
      // Closing a background tab: just drop it.
      set({ tabs: remaining, sessionsById: nextSessions });
      return;
    }

    // Closing the currently-active tab: pick a neighbour to surface (prefer
    // the tab to the right, fall back to the left).
    const fallback = remaining[idx] ?? remaining[idx - 1] ?? null;
    if (!fallback) {
      // Was the last tab — go back to the empty welcome state.
      const blank = emptySession();
      set({
        tabs: [],
        activeTabId: null,
        sessionsById: nextSessions,
        repo: blank.repo,
        view: blank.view,
        error: null,
        history: blank.history,
        diff: blank.diff,
        merge: blank.merge,
        blame: blank.blame,
        changes: blank.changes,
        stash: blank.stash,
        reflog: blank.reflog,
        submodules: blank.submodules,
        rebase: blank.rebase,
        fileHistory: blank.fileHistory,
        worktrees: blank.worktrees,
        gitignore: blank.gitignore,
        search: blank.search,
        recentFiles: [],
        recentFilesOpen: false,
      });
      return;
    }

    // Switch to the fallback. We've already dropped the closed tab from
    // remaining + nextSessions; switchTab itself will snapshot the (now
    // dead) active session, but we don't want that — so do the swap
    // manually here.
    const stored = nextSessions[fallback.id];
    delete nextSessions[fallback.id];
    const session = stored ?? emptySession();
    const needsLazyLoad = !stored && fallback.repoPath !== "";
    set({
      tabs: remaining,
      activeTabId: fallback.id,
      sessionsById: nextSessions,
      repo: session.repo,
      view: session.view,
      error: null,
      history: session.history,
      diff: session.diff,
      merge: session.merge,
      blame: session.blame,
      changes: session.changes,
      stash: session.stash,
      reflog: session.reflog,
      submodules: session.submodules,
      rebase: session.rebase,
      fileHistory: session.fileHistory,
      worktrees: session.worktrees,
      gitignore: session.gitignore,
      search: session.search,
      // v0.13.8 — same per-tab MRU rehydration as in switchTab. Lazy
      // fallback tabs get their MRU loaded inside openRepo below.
      recentFiles: session.repo ? loadRecentFiles(session.repo.path) : [],
      recentFilesOpen: false,
    });
    if (needsLazyLoad) void get().openRepo(fallback.repoPath);
  },

  renameTab: (id, label) => {
    const cur = get();
    const trimmed = label.trim();
    if (!trimmed) return;
    const tabs = cur.tabs.map((t) => (t.id === id ? { ...t, label: trimmed } : t));
    set({ tabs });
  },

  togglePinTab: (id) => {
    const cur = get();
    if (!cur.tabs.some((t) => t.id === id)) return;
    set({ tabs: togglePinList(cur.tabs, id) });
  },

  reorderTab: (fromIdx, toIdx) => {
    const cur = get();
    set({ tabs: reorderTabsList(cur.tabs, fromIdx, toIdx) });
  },

  closeOtherTabs: (keepId) => {
    // Closes every non-pinned tab whose id !== keepId. The kept tab plus
    // any pinned tabs survive; pinned tabs are preserved on purpose because
    // the user explicitly opted-in to keeping them across this kind of bulk
    // operation. We chain through closeTab so the activeTabId / session
    // bookkeeping stays correct even when the active tab is among those
    // being closed.
    const targets = get()
      .tabs.filter((t) => t.id !== keepId && !t.pinned)
      .map((t) => t.id);
    for (const id of targets) get().closeTab(id);
  },

  closeRightTabs: (id) => {
    const cur = get();
    const idx = cur.tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const targets = cur.tabs
      .slice(idx + 1)
      .filter((t) => !t.pinned)
      .map((t) => t.id);
    for (const tid of targets) get().closeTab(tid);
  },

  cycleTab: (dir) => {
    const cur = get();
    const id = nextTabId(cur.tabs, cur.activeTabId, dir);
    if (id && id !== cur.activeTabId) get().switchTab(id);
  },

  refresh: async () => {
    const { view, repo, diff } = get();
    if (!repo) return;
    if (view === "history") {
      // v0.13.21 — prefer the incremental top-up walk so a refresh doesn't
      // discard the user's scroll position / virtualizer cache for the
      // common "I just made a commit" case. Falls back to a full reload
      // when the cursor is orphaned or a pathspec filter is active.
      await get().topUpHistory();
    } else if (view === "diff") {
      if (diff.oid && diff.selectedFile) {
        await get().openDiff(diff.oid, diff.selectedFile);
      }
    } else if (view === "merge") {
      await get().loadMerge();
    } else if (view === "changes") {
      await get().loadChanges();
    } else if (view === "stash") {
      await get().loadStash();
    } else if (view === "reflog") {
      await get().loadReflog();
    } else if (view === "submodules") {
      await get().loadSubmodules();
    } else if (view === "tags") {
      await get().loadTags();
    } else if (view === "worktrees") {
      await get().loadWorktrees();
    } else if (view === "gitignore") {
      await get().loadGitignore();
    }
  },

  removeRecentRepo: (path) => set({ recentRepos: removeRecent(path) }),

  // v0.13.8 — Recent Files (Ctrl+E palette) -----------------------------
  noteRecentFile: (file, action) => {
    const repo = get().repo;
    if (!repo || !file) return;
    const next = pushRecentFile(get().recentFiles, {
      path: file,
      action,
      openedAt: Date.now(),
    });
    saveRecentFiles(repo.path, next);
    set({ recentFiles: next });
  },

  openRecentFiles: () => {
    if (!get().repo) return;
    set({ recentFilesOpen: true });
  },

  closeRecentFiles: () => set({ recentFilesOpen: false }),

  openSettings: () => set({ settingsOpen: true }),

  closeSettings: () => set({ settingsOpen: false }),

  forgetRecentFile: (path) => {
    const repo = get().repo;
    if (!repo) return;
    const next = removeRecentFile(get().recentFiles, path);
    saveRecentFiles(repo.path, next);
    set({ recentFiles: next });
  },

  // ---------- History ----------
  loadHistory: async () => {
    const repo = get().repo;
    if (!repo) return;
    set((s) => ({
      history: {
        ...s.history,
        loading: true,
        error: null,
        // Reset paging state for the fresh walk.
        commits: [],
        hasMore: false,
        nextCursor: null,
        // v0.13.16 — a fresh walk invalidates any active highlight set.
        highlightOid: null,
        highlightMode: null,
        highlightSet: new Set<string>(),
        highlightLoading: false,
      },
    }));
    try {
      const pathspec = get().history.pathspec.trim();
      const [page, refs] = await Promise.all([
        git.logPage(repo.path, { limit: 1000, pathspec: pathspec || undefined }),
        git.listRefs(repo.path),
      ]);
      set((s) => ({
        history: {
          ...s.history,
          commits: page.commits,
          hasMore: page.has_more,
          nextCursor: page.next_cursor,
          refs,
          loading: false,
          selectedOid: page.commits[0]?.oid ?? null,
        },
      }));
      const first = page.commits[0];
      if (first) void get().selectCommit(first.oid);
    } catch (e) {
      set((s) => ({ history: { ...s.history, loading: false, error: String(e) } }));
    }
  },

  loadMoreHistory: async () => {
    const repo = get().repo;
    if (!repo) return;
    const h = get().history;
    if (h.loadingMore || h.loading || !h.hasMore || !h.nextCursor) return;
    set((s) => ({ history: { ...s.history, loadingMore: true, error: null } }));
    try {
      const pathspec = h.pathspec.trim();
      const page = await git.logPage(repo.path, {
        after: h.nextCursor,
        limit: 1000,
        pathspec: pathspec || undefined,
      });
      set((s) => ({
        history: {
          ...s.history,
          // Backend guarantees the cursor commit itself is not yielded again,
          // but defensively de-dup by oid in case the user reloaded mid-walk.
          commits: dedupAppend(s.history.commits, page.commits),
          hasMore: page.has_more,
          nextCursor: page.next_cursor ?? s.history.nextCursor,
          loadingMore: false,
        },
      }));
    } catch (e) {
      set((s) => ({ history: { ...s.history, loadingMore: false, error: String(e) } }));
    }
  },

  /**
   * v0.13.21 — incremental refresh. When the user clicks the Topbar Refresh
   * button while the History view is already populated, we don't want to
   * blow the in-memory commit list away and pay the cost of a full `logPage`
   * reload. Instead we ask the backend for *only* the commits added since
   * the head of our current list and prepend them, while still refreshing
   * the refs map in parallel (cheap).
   *
   * Falls back to a full `loadHistory` when:
   *   - the list was empty to begin with (nothing to top up against),
   *   - the user has an active pathspec filter (top-up walk is unfiltered),
   *   - the current head oid is no longer reachable (force-push / reset
   *     rewrote history; backend signals this with `null`).
   */
  topUpHistory: async () => {
    const repo = get().repo;
    if (!repo) return;
    const h = get().history;
    // Anything that would make the top-up math unreliable → just full reload.
    if (h.loading || h.loadingMore) return;
    if (h.commits.length === 0) {
      await get().loadHistory();
      return;
    }
    if (h.pathspec.trim() !== "") {
      // The pathspec filter is applied on the backend per-page, so a top-up
      // walk would need to re-do the same filter. Easier + correct: full
      // reload. Path-filtered views are rare relative to the default view.
      await get().loadHistory();
      return;
    }
    const currentHead = h.commits[0]?.oid;
    if (!currentHead) {
      await get().loadHistory();
      return;
    }
    set((s) => ({ history: { ...s.history, loading: true, error: null } }));
    try {
      const [added, refs] = await Promise.all([
        git.logSince(repo.path, currentHead),
        git.listRefs(repo.path),
      ]);
      if (added === null) {
        // Backend told us the cursor is orphaned — fall back. Don't clear
        // refs we already fetched; loadHistory will refetch anyway.
        set((s) => ({ history: { ...s.history, loading: false } }));
        await get().loadHistory();
        return;
      }
      // Defensively de-dup by oid in case a parallel `loadMoreHistory`
      // raced us. `added` is newest-first, then existing list.
      set((s) => {
        const seen = new Set(s.history.commits.map((c) => c.oid));
        const fresh = added.filter((c) => !seen.has(c.oid));
        return {
          history: {
            ...s.history,
            commits: fresh.length > 0 ? [...fresh, ...s.history.commits] : s.history.commits,
            refs,
            loading: false,
          },
        };
      });
    } catch (e) {
      set((s) => ({ history: { ...s.history, loading: false, error: String(e) } }));
    }
  },

  selectCommit: async (oid: string) => {
    const repo = get().repo;
    if (!repo) return;
    set((s) => ({
      history: {
        ...s.history,
        selectedOid: oid,
        // v0.13.26 — single-select implies the multi-selection collapses
        // to just this oid. Anchor moves to the new focus so a follow-up
        // shift-click extends from here.
        selectedOids: new Set([oid]),
        anchorOid: oid,
        filesLoading: true,
        files: [],
        // Reset the meta payload so the side panel shows "loading…" rather
        // than stale data from the previously selected commit.
        meta: null,
        metaLoading: true,
      },
    }));
    // Files and meta are independent — fire them in parallel and let each
    // settle with its own race-check against the latest `selectedOid`.
    void (async () => {
      try {
        const files = await git.commitFiles(repo.path, oid);
        set((s) =>
          s.history.selectedOid === oid
            ? { history: { ...s.history, files, filesLoading: false } }
            : s,
        );
      } catch (e) {
        set((s) =>
          s.history.selectedOid === oid
            ? { history: { ...s.history, filesLoading: false, error: String(e) } }
            : s,
        );
      }
    })();
    void (async () => {
      try {
        const meta = await git.commitMeta(repo.path, oid);
        set((s) =>
          s.history.selectedOid === oid
            ? { history: { ...s.history, meta, metaLoading: false } }
            : s,
        );
      } catch (e) {
        set((s) =>
          s.history.selectedOid === oid
            ? { history: { ...s.history, metaLoading: false, error: String(e) } }
            : s,
        );
      }
    })();
  },

  selectCommitMulti: async (oid, mode) => {
    // Three-way decision tree — see the type-doc on `selectCommitMulti`.
    // We compute the new {set, anchor} synchronously, then defer the
    // CommitDetails refresh to `selectCommit` (or its inline equivalent
    // when the focus stays on the same oid).
    const cur = get().history;
    let nextSet: Set<string>;
    let nextAnchor: string | null;
    if (mode === "shift" && cur.anchorOid !== null) {
      // Range from anchor to oid, inclusive on both ends. Use the
      // *filtered* history view's order is overkill here — work directly
      // on `commits` (filter agnosticism is a non-goal: shift-click only
      // makes sense between two visible rows, and in practice the user
      // is only shift-clicking inside what they can see). The list is
      // newest-first; we walk it once and gather any oid whose index
      // falls between the two endpoints.
      const fromIdx = cur.commits.findIndex((c) => c.oid === cur.anchorOid);
      const toIdx = cur.commits.findIndex((c) => c.oid === oid);
      if (fromIdx < 0 || toIdx < 0) {
        // Anchor or target is off-list (e.g. anchor scrolled out of the
        // pagination window). Fall back to plain single-select.
        nextSet = new Set([oid]);
        nextAnchor = oid;
      } else {
        const lo = Math.min(fromIdx, toIdx);
        const hi = Math.max(fromIdx, toIdx);
        nextSet = new Set(cur.selectedOids);
        for (let i = lo; i <= hi; i++) {
          const c = cur.commits[i];
          if (c) nextSet.add(c.oid);
        }
        nextAnchor = cur.anchorOid; // shift doesn't move the anchor
      }
    } else if (mode === "ctrl") {
      nextSet = new Set(cur.selectedOids);
      if (nextSet.has(oid)) nextSet.delete(oid);
      else nextSet.add(oid);
      // Make sure the focused oid stays selected — if the user just
      // toggled the focused oid off, fall back to whatever's still in
      // the set as the new focus, else the just-clicked oid.
      nextAnchor = oid;
    } else {
      // "single" — or "shift" with no anchor.
      nextSet = new Set([oid]);
      nextAnchor = oid;
    }
    // Always update the multi-selection synchronously so the UI repaints
    // even if the focus oid didn't change.
    set((s) => ({
      history: {
        ...s.history,
        selectedOids: nextSet,
        anchorOid: nextAnchor,
      },
    }));
    // Drive the CommitDetails refresh through the existing single-select
    // path. Note: `selectCommit` itself also resets selectedOids to
    // {oid} — that's wrong for ctrl/shift, so we re-apply our nextSet
    // *after* selectCommit completes. We accept the tiny flicker here
    // because the alternative is duplicating the entire CommitDetails
    // load logic.
    await get().selectCommit(oid);
    set((s) => ({
      history: {
        ...s.history,
        selectedOids: nextSet,
        anchorOid: nextAnchor,
      },
    }));
  },

  clearCommitMultiSelect: () =>
    set((s) => ({
      history: {
        ...s.history,
        selectedOids: s.history.selectedOid ? new Set([s.history.selectedOid]) : new Set<string>(),
        anchorOid: s.history.selectedOid,
      },
    })),

  setFilter: (q) => set((s) => ({ history: { ...s.history, filter: q } })),
  setAuthorFilter: (a) => set((s) => ({ history: { ...s.history, authorFilter: a } })),
  setDateRange: (since, until) =>
    set((s) => ({ history: { ...s.history, sinceFilter: since, untilFilter: until } })),
  setPathspec: (p) => {
    set((s) => ({ history: { ...s.history, pathspec: p } }));
    void get().loadHistory();
  },
  resetHistoryFilters: () => {
    set((s) => ({
      history: {
        ...s.history,
        filter: "",
        authorFilter: null,
        sinceFilter: null,
        untilFilter: null,
        pathspec: "",
        highlightOid: null,
        highlightMode: null,
        highlightSet: new Set<string>(),
        highlightLoading: false,
      },
    }));
    void get().loadHistory();
  },

  // ---------- History highlight (v0.13.16) ----------
  highlightAncestors: async (oid) => {
    const repo = get().repo;
    if (!repo) return;
    set((s) => ({
      history: {
        ...s.history,
        highlightOid: oid,
        highlightMode: "ancestors",
        highlightLoading: true,
        // Keep the previous set visible while we recompute, otherwise
        // every row flashes to full opacity for a frame.
      },
    }));
    try {
      const oids = await git.commitAncestors(repo.path, oid);
      // The user may have switched the highlight or cleared it while we
      // were computing — only commit the result if we're still the latest.
      if (get().history.highlightOid !== oid || get().history.highlightMode !== "ancestors") {
        return;
      }
      set((s) => ({
        history: {
          ...s.history,
          highlightSet: new Set(oids),
          highlightLoading: false,
        },
      }));
    } catch (e) {
      set((s) => ({
        history: { ...s.history, highlightLoading: false, error: String(e) },
      }));
    }
  },

  highlightDescendants: async (oid) => {
    const repo = get().repo;
    if (!repo) return;
    set((s) => ({
      history: {
        ...s.history,
        highlightOid: oid,
        highlightMode: "descendants",
        highlightLoading: true,
      },
    }));
    try {
      const oids = await git.commitDescendants(repo.path, oid);
      if (get().history.highlightOid !== oid || get().history.highlightMode !== "descendants") {
        return;
      }
      set((s) => ({
        history: {
          ...s.history,
          highlightSet: new Set(oids),
          highlightLoading: false,
        },
      }));
    } catch (e) {
      set((s) => ({
        history: { ...s.history, highlightLoading: false, error: String(e) },
      }));
    }
  },

  clearHighlight: () =>
    set((s) => ({
      history: {
        ...s.history,
        highlightOid: null,
        highlightMode: null,
        highlightSet: new Set<string>(),
        highlightLoading: false,
      },
    })),

  // ---------- Diff ----------
  openDiff: async (oid, file, files) => {
    const repo = get().repo;
    if (!repo) return;
    let fileList = files ?? get().diff.files;
    if (!fileList || fileList.length === 0 || get().diff.oid !== oid) {
      try {
        fileList = await git.commitFiles(repo.path, oid);
      } catch (e) {
        set((s) => ({ diff: { ...s.diff, error: String(e) } }));
        return;
      }
    }
    set((s) => ({
      view: "diff",
      diff: {
        ...s.diff,
        oid,
        files: fileList,
        selectedFile: file,
        fileDiff: null,
        loading: true,
        error: null,
        // v0.13.25 — switching files / commits invalidates the line
        // selection from the previous diff.
        selectedLines: new Set<string>(),
        selectionAnchor: null,
        // v0.13.34 — close the search bar on file switch. Keep query
        // / toggles around in case the user wants the same search on
        // the next file (just press Ctrl+F again).
        search: { ...s.diff.search, open: false, matches: [], activeIdx: -1 },
      },
    }));
    try {
      const fd = await git.fileDiff(repo.path, oid, file, get().diff.ignoreWhitespace);
      set((s) =>
        s.diff.oid === oid && s.diff.selectedFile === file
          ? {
              diff: {
                ...s.diff,
                fileDiff: fd,
                loading: false,
                // v0.13.34 — recompute matches against the just-loaded
                // diff. The bar is closed so this is a no-op for the
                // hidden state, but keeps things consistent if someone
                // reopens search later (openDiffSearch will see fresh
                // matches without an extra computation).
                search: {
                  ...s.diff.search,
                  matches: s.diff.search.query
                    ? searchDiff(fd, s.diff.search.query, {
                        caseSensitive: s.diff.search.caseSensitive,
                        regex: s.diff.search.regex,
                      })
                    : [],
                  activeIdx: -1,
                },
              },
            }
          : s,
      );
      // v0.13.8 — bump in the recent-files MRU. We do this on success only
      // so transient errors (file removed, oid garbage-collected) don't
      // pollute the list with rows that won't reopen anyway.
      get().noteRecentFile(file, "diff");
    } catch (e) {
      set((s) => ({ diff: { ...s.diff, loading: false, error: String(e) } }));
    }
  },

  selectDiffFile: async (file) => {
    const { diff } = get();
    if (!diff.oid) return;
    await get().openDiff(diff.oid, file, diff.files);
  },

  setDiffMode: (m) => set((s) => ({ diff: { ...s.diff, mode: m } })),
  toggleWhitespace: () =>
    set((s) => ({ diff: { ...s.diff, showWhitespace: !s.diff.showWhitespace } })),
  toggleIgnoreWhitespace: () => {
    set((s) => ({ diff: { ...s.diff, ignoreWhitespace: !s.diff.ignoreWhitespace } }));
    const { diff } = get();
    if (diff.oid && diff.selectedFile) {
      void get().openDiff(diff.oid, diff.selectedFile, diff.files);
    }
  },

  // ---------- Working-tree Diff editor (v0.13.3) ----------
  //
  // The editor's left pane shows the HEAD blob (read-only); the right pane
  // shows the on-disk working-tree text in an editable buffer. Actions:
  //  - openWorkingDiff: load both and switch to the Diff view in non-edit mode
  //  - setEditActive: toggle the editable right pane on/off
  //  - setEditBuffer: receive keystrokes
  //  - saveEditBuffer: write buffer back via write_working_file
  //  - resetEditBuffer: re-read on-disk text, discarding edits

  openWorkingDiff: async (file) => {
    const repo = get().repo;
    if (!repo) return;
    set((s) => ({
      view: "changes",
      diff: {
        ...s.diff,
        oid: WORKING_OID,
        selectedFile: file,
        fileDiff: null,
        loading: true,
        error: null,
        edit: { ...emptyEdit },
        // v0.13.25 — switching files invalidates the line selection.
        selectedLines: new Set<string>(),
        selectionAnchor: null,
        // v0.13.34 — close search bar on file switch (see openDiff).
        search: { ...s.diff.search, open: false, matches: [], activeIdx: -1 },
      },
    }));
    try {
      const [fd, head, working] = await Promise.all([
        git.workingDiff(repo.path, file, get().diff.ignoreWhitespace),
        git.readHeadFile(repo.path, file),
        git.readWorkingFile(repo.path, file),
      ]);
      set((s) =>
        s.diff.oid === WORKING_OID && s.diff.selectedFile === file
          ? {
              diff: {
                ...s.diff,
                fileDiff: fd,
                loading: false,
                edit: {
                  active: false,
                  headText: head.missing ? "" : head.content,
                  buffer: working.missing ? "" : working.content,
                  savedText: working.missing ? "" : working.content,
                  busy: false,
                  error: null,
                },
                // v0.13.34 — recompute matches against the just-loaded diff.
                search: {
                  ...s.diff.search,
                  matches: s.diff.search.query
                    ? searchDiff(fd, s.diff.search.query, {
                        caseSensitive: s.diff.search.caseSensitive,
                        regex: s.diff.search.regex,
                      })
                    : [],
                  activeIdx: -1,
                },
              },
            }
          : s,
      );
      // v0.13.8 — bump in the recent-files MRU.
      get().noteRecentFile(file, "working");
    } catch (e) {
      set((s) =>
        s.diff.oid === WORKING_OID && s.diff.selectedFile === file
          ? { diff: { ...s.diff, loading: false, error: String(e) } }
          : s,
      );
    }
  },

  setEditActive: async (active) => {
    const repo = get().repo;
    const { diff } = get();
    // Refuse to enable editing in any context other than a working-tree diff.
    if (active && (diff.oid !== WORKING_OID || !diff.selectedFile || !repo)) {
      return;
    }
    // If buffers haven't been loaded yet (race against openWorkingDiff), do
    // a fresh fetch — keeps the toggle resilient against stale state.
    if (active && (diff.edit.buffer === null || diff.edit.headText === null)) {
      set((s) => ({ diff: { ...s.diff, edit: { ...s.diff.edit, busy: true, error: null } } }));
      try {
        const [head, working] = await Promise.all([
          git.readHeadFile(repo!.path, diff.selectedFile!),
          git.readWorkingFile(repo!.path, diff.selectedFile!),
        ]);
        set((s) => ({
          diff: {
            ...s.diff,
            edit: {
              active: true,
              headText: head.missing ? "" : head.content,
              buffer: working.missing ? "" : working.content,
              savedText: working.missing ? "" : working.content,
              busy: false,
              error: null,
            },
          },
        }));
      } catch (e) {
        set((s) => ({
          diff: { ...s.diff, edit: { ...s.diff.edit, busy: false, error: String(e) } },
        }));
      }
      return;
    }
    set((s) => ({ diff: { ...s.diff, edit: { ...s.diff.edit, active } } }));
  },

  setEditBuffer: (buffer) => {
    set((s) => ({ diff: { ...s.diff, edit: { ...s.diff.edit, buffer } } }));
  },

  saveEditBuffer: async () => {
    const repo = get().repo;
    const { diff } = get();
    if (!repo || diff.oid !== WORKING_OID || !diff.selectedFile || diff.edit.buffer === null) {
      return;
    }
    set((s) => ({ diff: { ...s.diff, edit: { ...s.diff.edit, busy: true, error: null } } }));
    try {
      const buffer = diff.edit.buffer;
      await git.writeWorkingFile(repo.path, diff.selectedFile, buffer);
      // Re-fetch the diff so the hunk preview updates against the new
      // working-tree text. HEAD didn't change, so leave headText alone.
      const fd = await git.workingDiff(repo.path, diff.selectedFile, diff.ignoreWhitespace);
      set((s) =>
        s.diff.oid === WORKING_OID && s.diff.selectedFile === diff.selectedFile
          ? {
              diff: {
                ...s.diff,
                fileDiff: fd,
                edit: {
                  ...s.diff.edit,
                  busy: false,
                  savedText: buffer,
                  // `buffer` may be more recent than what we just wrote if
                  // the user kept typing during the save round-trip — keep
                  // their newer keystrokes instead of clobbering them.
                  buffer: s.diff.edit.buffer ?? buffer,
                  error: null,
                },
              },
            }
          : s,
      );
      // Refresh the changes list so Stash / Commit views see the new state.
      void get().loadChanges();
    } catch (e) {
      set((s) => ({
        diff: { ...s.diff, edit: { ...s.diff.edit, busy: false, error: String(e) } },
      }));
    }
  },

  resetEditBuffer: async () => {
    const repo = get().repo;
    const { diff } = get();
    if (!repo || diff.oid !== WORKING_OID || !diff.selectedFile) return;
    set((s) => ({ diff: { ...s.diff, edit: { ...s.diff.edit, busy: true, error: null } } }));
    try {
      const working = await git.readWorkingFile(repo.path, diff.selectedFile);
      const text = working.missing ? "" : working.content;
      set((s) => ({
        diff: {
          ...s.diff,
          edit: {
            ...s.diff.edit,
            buffer: text,
            savedText: text,
            busy: false,
            error: null,
          },
        },
      }));
    } catch (e) {
      set((s) => ({
        diff: { ...s.diff, edit: { ...s.diff.edit, busy: false, error: String(e) } },
      }));
    }
  },

  // ---------- Line-level staging (v0.13.25) ----------
  //
  // The picker UI lives in the Unified diff view; these actions mutate
  // `diff.selectedLines` (a `Set<"hunkIdx:lineIdx">`) and feed it into
  // `buildSubsetPatch` to synthesise the smallest valid patch carrying
  // exactly those edits.
  //
  // Three apply paths share the same patch-building front half:
  //   - stageSelectedLines    → forward patch  → Index
  //   - unstageSelectedLines  → reversed patch → Index
  //   - discardSelectedLines  → reversed patch → WorkDir
  //
  // We dry-run with `apply_patch_check` first so a malformed sub-patch
  // (e.g. user picked a `-` from a hunk we already invalidated) surfaces
  // as a structured error before clobbering anything.

  toggleDiffLine: (hunkIdx, lineIdx) => {
    const k = selectionKey(hunkIdx, lineIdx);
    set((s) => {
      // No-op for context lines: the +/- check is the caller's
      // responsibility (UI doesn't fire onClick on " " rows), but
      // we belt-and-brace it here too.
      const fd = s.diff.fileDiff;
      const ln = fd?.hunks[hunkIdx]?.lines[lineIdx];
      if (!ln || ln.origin === " ") return s;
      const next = new Set(s.diff.selectedLines);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return { diff: { ...s.diff, selectedLines: next, selectionAnchor: k } };
    });
  },

  extendDiffLineRangeTo: (hunkIdx, lineIdx) => {
    const cur = get().diff;
    if (!cur.fileDiff || cur.selectionAnchor === null) return;
    // Decode the anchor key.
    const [aHi, aLi] = cur.selectionAnchor.split(":").map((n) => parseInt(n, 10));
    if (aHi === undefined || aLi === undefined || Number.isNaN(aHi) || Number.isNaN(aLi)) return;
    // Walk the hunks newest-first and collect all (hunkIdx, lineIdx)
    // pairs of +/- lines whose flat index falls inside [from, to]. We
    // compute the flat index by counting every line (any origin) in
    // hunks order; this matches the visual order of the Unified view.
    const flat: { hunk: number; line: number; origin: " " | "+" | "-" }[] = [];
    for (let hi = 0; hi < cur.fileDiff.hunks.length; hi++) {
      const h = cur.fileDiff.hunks[hi]!;
      for (let li = 0; li < h.lines.length; li++) {
        flat.push({ hunk: hi, line: li, origin: h.lines[li]!.origin });
      }
    }
    const idxOf = (hi: number, li: number) => flat.findIndex((e) => e.hunk === hi && e.line === li);
    const fromFlat = idxOf(aHi, aLi);
    const toFlat = idxOf(hunkIdx, lineIdx);
    if (fromFlat < 0 || toFlat < 0) return;
    const lo = Math.min(fromFlat, toFlat);
    const hi = Math.max(fromFlat, toFlat);
    const next = new Set(cur.selectedLines);
    for (let f = lo; f <= hi; f++) {
      const e = flat[f]!;
      if (e.origin === "+" || e.origin === "-") {
        next.add(selectionKey(e.hunk, e.line));
      }
    }
    set((s) => ({ diff: { ...s.diff, selectedLines: next } }));
  },

  clearDiffLineSelection: () =>
    set((s) => ({
      diff: { ...s.diff, selectedLines: new Set<string>(), selectionAnchor: null },
    })),

  stageSelectedLines: async () => {
    const repo = get().repo;
    const { diff } = get();
    if (!repo || diff.oid !== WORKING_OID || !diff.fileDiff) return;
    if (diff.selectedLines.size === 0) return;
    const patch = buildSubsetPatch(diff.fileDiff, diff.selectedLines);
    if (!patch) return;
    try {
      await git.applyPatchCheck(repo.path, patch, { location: "index" });
      await git.applyPatch(repo.path, patch, { location: "index" });
      // Refresh the diff so staged lines disappear from the unstaged view
      // (working_diff is HEAD→workdir, so freshly-staged lines now show
      // up as both "in index" and "in workdir" but the workdir delta
      // against HEAD is unchanged — we still want to clear the
      // selection though, the user is done with these lines).
      const fd = await git.workingDiff(repo.path, diff.selectedFile!, get().diff.ignoreWhitespace);
      set((s) => ({
        diff: {
          ...s.diff,
          fileDiff: fd,
          selectedLines: new Set<string>(),
          selectionAnchor: null,
        },
      }));
      void get().loadChanges();
      toast.success("Staged selected lines.");
    } catch (e) {
      toast.error(`Stage selected lines failed: ${String(e)}`);
    }
  },

  unstageSelectedLines: async () => {
    const repo = get().repo;
    const { diff } = get();
    if (!repo || diff.oid !== WORKING_OID || !diff.fileDiff) return;
    if (diff.selectedLines.size === 0) return;
    const fwd = buildSubsetPatch(diff.fileDiff, diff.selectedLines);
    if (!fwd) return;
    const rev = reversePatch(fwd);
    try {
      await git.applyPatchCheck(repo.path, rev, { location: "index" });
      await git.applyPatch(repo.path, rev, { location: "index" });
      const fd = await git.workingDiff(repo.path, diff.selectedFile!, get().diff.ignoreWhitespace);
      set((s) => ({
        diff: {
          ...s.diff,
          fileDiff: fd,
          selectedLines: new Set<string>(),
          selectionAnchor: null,
        },
      }));
      void get().loadChanges();
      toast.success("Unstaged selected lines.");
    } catch (e) {
      toast.error(`Unstage selected lines failed: ${String(e)}`);
    }
  },

  discardSelectedLines: async () => {
    const repo = get().repo;
    const { diff } = get();
    if (!repo || diff.oid !== WORKING_OID || !diff.fileDiff) return;
    if (diff.selectedLines.size === 0) return;
    // v0.13.22 policy — destructive op must confirm.
    const ok = await confirm({
      level: "danger",
      title: `Discard ${diff.selectedLines.size} line${diff.selectedLines.size === 1 ? "" : "s"}?`,
      message:
        "Reverts the selected +/− lines in the working tree. The index isn't touched. This cannot be undone.",
      detail: diff.selectedFile ?? "",
      confirmLabel: "Discard lines",
    });
    if (!ok) return;
    const fwd = buildSubsetPatch(diff.fileDiff, diff.selectedLines);
    if (!fwd) return;
    const rev = reversePatch(fwd);
    try {
      await git.applyPatchCheck(repo.path, rev, { location: "work_dir" });
      await git.applyPatch(repo.path, rev, { location: "work_dir" });
      // Re-read the working file to refresh the editor buffer (if open)
      // and then refresh the diff itself.
      const [fd, working] = await Promise.all([
        git.workingDiff(repo.path, diff.selectedFile!, get().diff.ignoreWhitespace),
        git.readWorkingFile(repo.path, diff.selectedFile!),
      ]);
      set((s) => ({
        diff: {
          ...s.diff,
          fileDiff: fd,
          selectedLines: new Set<string>(),
          selectionAnchor: null,
          edit: {
            ...s.diff.edit,
            buffer: working.missing ? "" : working.content,
            savedText: working.missing ? "" : working.content,
          },
        },
      }));
      void get().loadChanges();
      toast.success("Discarded selected lines.");
    } catch (e) {
      toast.error(`Discard selected lines failed: ${String(e)}`);
    }
  },

  // ---------- v0.13.34 in-pane diff search ----------
  // All six actions are pure synchronous mutations — searchDiff() is fast
  // enough to run on every keystroke for any reasonable diff size.

  openDiffSearch: () => {
    set((s) => {
      // Reopening with an existing query: re-derive matches so the bar
      // shows the same M-of-N counter the user saw before closing it.
      // The toggles (case/regex) and query string are preserved.
      const matches = searchDiff(s.diff.fileDiff, s.diff.search.query, {
        caseSensitive: s.diff.search.caseSensitive,
        regex: s.diff.search.regex,
      });
      return {
        diff: {
          ...s.diff,
          search: {
            ...s.diff.search,
            open: true,
            matches,
            // Preserve activeIdx if it's still in range; otherwise reset to 0.
            activeIdx:
              matches.length === 0
                ? -1
                : s.diff.search.activeIdx >= 0 && s.diff.search.activeIdx < matches.length
                  ? s.diff.search.activeIdx
                  : 0,
          },
        },
      };
    });
  },

  closeDiffSearch: () => {
    // Drop matches/activeIdx but keep query/case/regex so reopening
    // restores the user's last search context.
    set((s) => ({
      diff: {
        ...s.diff,
        search: {
          ...s.diff.search,
          open: false,
          matches: [],
          activeIdx: -1,
        },
      },
    }));
  },

  setDiffSearchQuery: (query) => {
    set((s) => {
      const matches = searchDiff(s.diff.fileDiff, query, {
        caseSensitive: s.diff.search.caseSensitive,
        regex: s.diff.search.regex,
      });
      return {
        diff: {
          ...s.diff,
          search: {
            ...s.diff.search,
            query,
            matches,
            // Reset to first match on every query edit so Enter immediately
            // jumps somewhere visible. If the user wants to stay put they
            // can just stop typing.
            activeIdx: matches.length === 0 ? -1 : 0,
          },
        },
      };
    });
  },

  toggleDiffSearchCase: () => {
    set((s) => {
      const caseSensitive = !s.diff.search.caseSensitive;
      const matches = searchDiff(s.diff.fileDiff, s.diff.search.query, {
        caseSensitive,
        regex: s.diff.search.regex,
      });
      return {
        diff: {
          ...s.diff,
          search: {
            ...s.diff.search,
            caseSensitive,
            matches,
            activeIdx: matches.length === 0 ? -1 : 0,
          },
        },
      };
    });
  },

  toggleDiffSearchRegex: () => {
    set((s) => {
      const regex = !s.diff.search.regex;
      const matches = searchDiff(s.diff.fileDiff, s.diff.search.query, {
        caseSensitive: s.diff.search.caseSensitive,
        regex,
      });
      return {
        diff: {
          ...s.diff,
          search: {
            ...s.diff.search,
            regex,
            matches,
            activeIdx: matches.length === 0 ? -1 : 0,
          },
        },
      };
    });
  },

  stepDiffSearch: (dir) => {
    set((s) => {
      const n = s.diff.search.matches.length;
      if (n === 0) return {} as Partial<typeof s>; // nothing to step through
      // Wrap-around: pressing Next at the last match jumps back to the
      // first; pressing Prev at the first match jumps to the last.
      // This matches Chrome/VS Code/IDEA find-bar behaviour.
      const cur = s.diff.search.activeIdx;
      const next = cur < 0 ? (dir === 1 ? 0 : n - 1) : (cur + dir + n) % n;
      return {
        diff: { ...s.diff, search: { ...s.diff.search, activeIdx: next } },
      };
    });
  },

  // ---------- Merge ----------
  loadMerge: async () => {
    const repo = get().repo;
    if (!repo) return;
    set((s) => ({ merge: { ...s.merge, loading: true, error: null } }));
    try {
      const [state, conflicts] = await Promise.all([
        git.mergeState(repo.path),
        git.conflicts(repo.path),
      ]);
      set((s) => ({
        merge: {
          ...s.merge,
          state,
          conflicts,
          loading: false,
        },
      }));
      // auto-select first unresolved file
      const next = conflicts.find((c) => !get().merge.resolvedFiles.has(c.path)) ?? conflicts[0];
      if (next) void get().selectConflict(next.path);
    } catch (e) {
      set((s) => ({ merge: { ...s.merge, loading: false, error: String(e) } }));
    }
  },

  selectConflict: async (file) => {
    const repo = get().repo;
    if (!repo) return;
    set((s) => ({
      merge: { ...s.merge, selectedFile: file, content: null, chunks: [], loading: true },
    }));
    try {
      const content = await git.conflictContent(repo.path, file);
      const chunks = content.working ? parseConflicts(content.working) : [];
      set((s) =>
        s.merge.selectedFile === file
          ? { merge: { ...s.merge, content, chunks, loading: false } }
          : s,
      );
    } catch (e) {
      set((s) => ({ merge: { ...s.merge, loading: false, error: String(e) } }));
    }
  },

  applyResolution: (chunkIndex, choice) =>
    set((s) => {
      const chunks = s.merge.chunks.map((c) => {
        if (c.kind !== "conflict" || c.index !== chunkIndex) return c;
        const conflict = c as ConflictChunk;
        const result = resolveText(conflict, choice);
        return { ...conflict, resolution: choice, result };
      });
      return { merge: { ...s.merge, chunks } };
    }),

  applyAllResolutions: (choice) =>
    set((s) => {
      const chunks = s.merge.chunks.map((c) => {
        if (c.kind !== "conflict") return c;
        const conflict = c as ConflictChunk;
        const result = resolveText(conflict, choice);
        return { ...conflict, resolution: choice, result };
      });
      return { merge: { ...s.merge, chunks } };
    }),

  resetAllResolutions: () =>
    set((s) => {
      const chunks = s.merge.chunks.map((c) => {
        if (c.kind !== "conflict") return c;
        const conflict = c as ConflictChunk;
        // Bring the block back to "pending" — the result text is reset to a
        // sentinel that combines both sides so users can still see the
        // upstream content; they'll need to pick a side (or hand-edit) to
        // mark it resolved. We deliberately don't try to re-derive the
        // original conflict-marker text — once the user has applied any
        // choice we lose that information; making `pending` simply
        // disable the "Mark resolved" button is the simplest correct
        // behaviour.
        return {
          ...conflict,
          resolution: "pending" as Resolution,
          result: conflict.ours,
        };
      });
      return { merge: { ...s.merge, chunks } };
    }),

  setResultText: (chunkIndex, text) =>
    set((s) => {
      const chunks = s.merge.chunks.map((c) => {
        if (c.kind !== "conflict" || c.index !== chunkIndex) return c;
        return { ...c, resolution: "manual" as Resolution, result: text };
      });
      return { merge: { ...s.merge, chunks } };
    }),

  resolveCurrentFile: async () => {
    const repo = get().repo;
    const { merge } = get();
    if (!repo || !merge.selectedFile) return;
    const text = joinChunks(merge.chunks);
    try {
      await git.resolveConflict(repo.path, merge.selectedFile, text);
      const resolved = new Set(merge.resolvedFiles);
      resolved.add(merge.selectedFile);
      set((s) => ({ merge: { ...s.merge, resolvedFiles: resolved } }));
      // refresh conflicts list (the resolved file should drop out)
      void get().loadMerge();
    } catch (e) {
      set((s) => ({ merge: { ...s.merge, error: String(e) } }));
    }
  },

  abortMerge: async () => {
    const repo = get().repo;
    if (!repo) return;
    const ok = await confirm({
      level: "danger",
      title: "Abort merge?",
      message:
        "The merge in progress will be cancelled and the working tree restored to its pre-merge state. Any conflict resolutions you've already made will be lost.",
      confirmLabel: "Abort merge",
    });
    if (!ok) return;
    set((s) => ({ merge: { ...s.merge, loading: true, error: null } }));
    try {
      await git.abortMerge(repo.path);
      set({
        merge: { ...emptyMerge, resolvedFiles: new Set() },
      });
      void get().loadMerge();
      void get().loadHistory();
    } catch (e) {
      set((s) => ({ merge: { ...s.merge, loading: false, error: String(e) } }));
    }
  },

  commitMerge: async (message?: string) => {
    const repo = get().repo;
    if (!repo) return;
    set((s) => ({ merge: { ...s.merge, loading: true, error: null } }));
    try {
      await git.commitMerge(repo.path, message);
      set({
        merge: { ...emptyMerge, resolvedFiles: new Set() },
      });
      void get().loadMerge();
      void get().loadHistory();
    } catch (e) {
      set((s) => ({ merge: { ...s.merge, loading: false, error: String(e) } }));
    }
  },

  openBlame: async (file: string) => {
    const repo = get().repo;
    if (!repo) return;
    set((s) => ({
      view: "blame",
      blame: {
        ...s.blame,
        file,
        revision: null,
        history: [],
        lines: [],
        loading: true,
        prev: null,
        error: null,
      },
    }));
    try {
      const lines = await git.blameFile(repo.path, file);
      // Try to find the previous (renamed) filename from HEAD.
      let prev: { file: string; revision: string } | null = null;
      try {
        const p = await git.previousFilename(repo.path, file, "HEAD");
        if (p) prev = { file: p.path, revision: p.oid };
      } catch {
        // ignore — repo may have no parents on this commit
      }
      set((s) =>
        s.blame.file === file && s.blame.revision === null
          ? { blame: { ...s.blame, lines, loading: false, prev } }
          : s,
      );
      // v0.13.8 — bump in the recent-files MRU.
      get().noteRecentFile(file, "blame");
    } catch (e) {
      set((s) => ({ blame: { ...s.blame, loading: false, error: String(e) } }));
    }
  },

  blameAt: async (file: string, revision: string) => {
    const repo = get().repo;
    if (!repo) return;
    const cur = get().blame;
    set((s) => ({
      view: "blame",
      blame: {
        ...s.blame,
        // Push current state onto the history stack so user can go back.
        history:
          cur.file !== null
            ? [...s.blame.history, { file: cur.file, revision: cur.revision }]
            : s.blame.history,
        file,
        revision,
        lines: [],
        loading: true,
        prev: null,
        error: null,
      },
    }));
    try {
      const lines = await git.blameAtRevision(repo.path, file, revision);
      let prev: { file: string; revision: string } | null = null;
      try {
        const p = await git.previousFilename(repo.path, file, revision);
        if (p) prev = { file: p.path, revision: p.oid };
      } catch {
        /* ignore */
      }
      set((s) =>
        s.blame.file === file && s.blame.revision === revision
          ? { blame: { ...s.blame, lines, loading: false, prev } }
          : s,
      );
    } catch (e) {
      set((s) => ({ blame: { ...s.blame, loading: false, error: String(e) } }));
    }
  },

  blameFollowRename: async () => {
    const { blame } = get();
    if (!blame.prev) return;
    await get().blameAt(blame.prev.file, blame.prev.revision);
  },

  blameBeforeCommit: async (oid: string) => {
    // Re-blame the current file at <oid>^. libgit2's `revparse_single`
    // accepts the caret syntax natively, so we just hand the suffix
    // through to the existing `blameAt` action — which also takes care
    // of pushing the current view onto the back-stack.
    const { blame } = get();
    if (!blame.file) return;
    try {
      await get().blameAt(blame.file, `${oid}^`);
    } catch (e) {
      // The most common failure is "commit has no parent" (root commit).
      // Surface that into the blame error slot rather than throwing.
      set((s) => ({ blame: { ...s.blame, error: String(e), loading: false } }));
    }
  },

  blameBack: async () => {
    const { blame } = get();
    const top = blame.history[blame.history.length - 1];
    if (!top) return;
    const newHistory = blame.history.slice(0, -1);
    set((s) => ({ blame: { ...s.blame, history: newHistory } }));
    if (top.revision === null) {
      await get().openBlame(top.file);
    } else {
      // Rebuild from popped entry without pushing onto history again.
      const repo = get().repo;
      if (!repo) return;
      set((s) => ({
        blame: {
          ...s.blame,
          file: top.file,
          revision: top.revision,
          lines: [],
          loading: true,
          prev: null,
          error: null,
        },
      }));
      try {
        const lines = await git.blameAtRevision(repo.path, top.file, top.revision);
        let prev: { file: string; revision: string } | null = null;
        try {
          const p = await git.previousFilename(repo.path, top.file, top.revision);
          if (p) prev = { file: p.path, revision: p.oid };
        } catch {
          /* ignore */
        }
        set((s) => ({ blame: { ...s.blame, lines, loading: false, prev } }));
      } catch (e) {
        set((s) => ({ blame: { ...s.blame, loading: false, error: String(e) } }));
      }
    }
  },

  // ---------- Changes (working tree) ----------
  loadChanges: async () => {
    const repo = get().repo;
    if (!repo) return;
    set((s) => ({ changes: { ...s.changes, loading: true, error: null } }));
    try {
      const files = await git.workingChanges(repo.path);
      const valid = new Set(files.map((f) => f.path));
      const newSelected = new Set(Array.from(get().changes.selected).filter((p) => valid.has(p)));
      set((s) => ({
        changes: { ...s.changes, files, selected: newSelected, loading: false },
      }));
    } catch (e) {
      set((s) => ({ changes: { ...s.changes, loading: false, error: String(e) } }));
    }
  },

  toggleChange: (path: string) =>
    set((s) => {
      const next = new Set(s.changes.selected);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return { changes: { ...s.changes, selected: next } };
    }),

  selectAllChanges: () =>
    set((s) => ({
      changes: {
        ...s.changes,
        selected: new Set(s.changes.files.map((f) => f.path)),
      },
    })),

  clearChangeSelection: () => set((s) => ({ changes: { ...s.changes, selected: new Set() } })),

  stageSelected: async () => {
    const repo = get().repo;
    const { changes } = get();
    if (!repo || changes.selected.size === 0) return;
    try {
      await git.stageFiles(repo.path, Array.from(changes.selected));
      void get().loadChanges();
    } catch (e) {
      set((s) => ({ changes: { ...s.changes, error: String(e) } }));
    }
  },

  unstageSelected: async () => {
    const repo = get().repo;
    const { changes } = get();
    if (!repo || changes.selected.size === 0) return;
    try {
      await git.unstageFiles(repo.path, Array.from(changes.selected));
      void get().loadChanges();
    } catch (e) {
      set((s) => ({ changes: { ...s.changes, error: String(e) } }));
    }
  },

  discardSelected: async () => {
    const repo = get().repo;
    const { changes } = get();
    if (!repo || changes.selected.size === 0) return;
    const list = Array.from(changes.selected);
    const ok = await confirm({
      level: "danger",
      title: `Discard ${list.length} file${list.length === 1 ? "" : "s"}?`,
      message:
        "Working-tree changes for the selected files will be reverted to HEAD. This cannot be undone.",
      detail:
        list.slice(0, 20).join("\n") + (list.length > 20 ? `\n…and ${list.length - 20} more` : ""),
      confirmLabel: "Discard",
    });
    if (!ok) return;
    try {
      await git.discardFiles(repo.path, list);
      void get().loadChanges();
    } catch (e) {
      set((s) => ({ changes: { ...s.changes, error: String(e) } }));
    }
  },

  setCommitMessage: (m) => set((s) => ({ changes: { ...s.changes, message: m } })),

  // ---- v0.13.20 amend / signoff / skip-hooks toggles ----
  //
  // Amend toggle is async because turning it ON pre-fills the message
  // editor with HEAD's commit message (matching `git commit --amend`'s
  // editor behaviour). Turning it OFF restores whatever the user was
  // typing before — we stash that in `_draftBeforeAmend` so a misclick
  // doesn't lose work.
  setAmend: async (on) => {
    const repo = get().repo;
    const { changes } = get();
    if (changes.amend === on) return;
    if (on) {
      // Snapshot the current draft into a local closure cell, prefill with
      // HEAD's message. We keep the snapshot on the store object via a
      // module-scoped Map keyed by repo path so multiple tabs don't cross-
      // contaminate.
      if (changes.message) draftBeforeAmend.set(repo?.path ?? "", changes.message);
      let prefill = changes.message;
      if (repo) {
        try {
          // Use the already-loaded HEAD commit summary if the user has
          // history selected; fall back to a fresh meta lookup otherwise.
          const head = get().history.commits[0];
          if (head) {
            const meta = await git.commitMeta(repo.path, head.oid);
            prefill = (meta.message || head.summary).trimEnd();
          }
        } catch {
          /* leave prefill = current draft */
        }
      }
      set((s) => ({ changes: { ...s.changes, amend: true, message: prefill } }));
    } else {
      const restored = draftBeforeAmend.get(repo?.path ?? "") ?? "";
      draftBeforeAmend.delete(repo?.path ?? "");
      set((s) => ({ changes: { ...s.changes, amend: false, message: restored } }));
    }
  },

  setSignoff: (on) => set((s) => ({ changes: { ...s.changes, signoff: on } })),

  setSkipHooks: (on) => set((s) => ({ changes: { ...s.changes, skipHooks: on } })),

  commitWorking: async () => {
    const repo = get().repo;
    const { changes } = get();
    if (!repo) return;
    if (!changes.message.trim()) {
      set((s) => ({ changes: { ...s.changes, error: "Commit message is required." } }));
      return;
    }
    set((s) => ({ changes: { ...s.changes, committing: true, error: null } }));
    try {
      const outcome = await git.commitChanges(repo.path, changes.message, {
        amend: changes.amend,
        signoff: changes.signoff,
        run_hooks: !changes.skipHooks,
        author: changes.authorOverride ?? undefined,
      });
      // Surface a small toast when the post-commit hook ran, so users
      // wiring up notification scripts get feedback.
      if (outcome.post_commit_ran) {
        toast.info("post-commit hook ran");
      }
      // Push message to history so it's available for reuse.
      get().pushCommitMessage(changes.message);
      // Clear amend draft snapshot after a successful commit.
      draftBeforeAmend.delete(repo.path);
      set((s) => ({
        changes: {
          ...s.changes,
          message: "",
          selected: new Set(),
          committing: false,
          amend: false,
          authorOverride: null,
        },
      }));
      void get().loadChanges();
      void get().loadHistory();
    } catch (e) {
      set((s) => ({
        changes: { ...s.changes, committing: false, error: String(e) },
      }));
    }
  },

  // ---- Phase 1: file tree actions ----
  setChangesGroupBy: (mode) =>
    set((s) => ({ changes: { ...s.changes, groupBy: mode } })),

  toggleDirExpand: (dir) =>
    set((s) => {
      const next = new Set(s.changes.expandedDirs);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return { changes: { ...s.changes, expandedDirs: next } };
    }),

  expandAllDirs: () =>
    set((s) => {
      const dirs = new Set<string>();
      for (const f of s.changes.files) {
        const parts = f.path.split("/");
        for (let i = 1; i < parts.length; i++) {
          dirs.add(parts.slice(0, i).join("/"));
        }
      }
      return { changes: { ...s.changes, expandedDirs: dirs } };
    }),

  collapseAllDirs: () =>
    set((s) => ({ changes: { ...s.changes, expandedDirs: new Set() } })),

  setChangesFileFilter: (query) =>
    set((s) => ({ changes: { ...s.changes, fileFilter: query } })),

  selectFilteredChanges: () =>
    set((s) => {
      const { files, fileFilter } = s.changes;
      const q = fileFilter.toLowerCase();
      const matching = files.filter((f) => !q || f.path.toLowerCase().includes(q));
      return {
        changes: { ...s.changes, selected: new Set(matching.map((f) => f.path)) },
      };
    }),

  // ---- Phase 2: inline diff preview ----
  previewChangesFile: async (file) => {
    const repo = get().repo;
    if (!repo) return;
    set((s) => ({
      changes: { ...s.changes, previewFile: file, previewLoading: true, previewError: null },
    }));
    try {
      const fd = await git.workingDiff(repo.path, file);
      set((s) =>
        s.changes.previewFile === file
          ? { changes: { ...s.changes, previewDiff: fd, previewLoading: false } }
          : s,
      );
    } catch (e) {
      set((s) =>
        s.changes.previewFile === file
          ? { changes: { ...s.changes, previewLoading: false, previewError: String(e) } }
          : s,
      );
    }
  },

  clearChangesPreview: () =>
    set((s) => ({
      changes: { ...s.changes, previewFile: null, previewDiff: null, previewError: null },
    })),

  // ---- Phase 3: commit enhancements ----
  pushCommitMessage: (msg) =>
    set((s) => {
      const prev = s.changes.messageHistory;
      const deduped = [msg, ...prev.filter((m) => m !== msg)].slice(0, 20);
      try {
        localStorage.setItem("gittools.commit-msg-history", JSON.stringify(deduped));
      } catch {
        /* quota exceeded – silently drop */
      }
      return { changes: { ...s.changes, messageHistory: deduped } };
    }),

  setAuthorOverride: (author) =>
    set((s) => ({ changes: { ...s.changes, authorOverride: author } })),

  setShowAdvancedOptions: (show) =>
    set((s) => ({ changes: { ...s.changes, showAdvancedOptions: show } })),

  // ---------- Stash ----------
  loadStash: async () => {
    const repo = get().repo;
    if (!repo) return;
    set((s) => ({ stash: { ...s.stash, loading: true, error: null } }));
    try {
      const entries = await git.stashList(repo.path);
      // v0.13.24 — keep the inline preview consistent with the new list:
      //   - if the previously-selected index is still in range AND points
      //     at the same oid, keep it (the file list & diff are still valid);
      //   - otherwise clear the preview state so we don't show stale files
      //     against a different stash.
      const prev = get().stash;
      const stillValid =
        prev.selectedIndex !== null &&
        prev.selectedIndex < entries.length &&
        entries[prev.selectedIndex]?.oid === prev.entries[prev.selectedIndex]?.oid;
      set((s) => ({
        stash: {
          ...s.stash,
          entries,
          loading: false,
          ...(stillValid
            ? {}
            : {
                selectedIndex: null,
                files: [],
                filesLoading: false,
                selectedFile: null,
                fileDiff: null,
                diffLoading: false,
              }),
        },
      }));
    } catch (e) {
      set((s) => ({ stash: { ...s.stash, loading: false, error: String(e) } }));
    }
  },

  saveStash: async (opts) => {
    const repo = get().repo;
    if (!repo) return;
    set((s) => ({ stash: { ...s.stash, busy: true, error: null, status: null } }));
    try {
      await git.stashSave(repo.path, opts);
      set((s) => ({ stash: { ...s.stash, busy: false, status: "Stashed working changes." } }));
      void get().loadStash();
      void get().loadChanges();
    } catch (e) {
      set((s) => ({ stash: { ...s.stash, busy: false, error: String(e) } }));
    }
  },

  applyStash: async (index) => {
    const repo = get().repo;
    if (!repo) return;
    // v0.13.22 — apply is destructive (working-tree merge with possible
    // conflicts) so it must never happen on a single click. Same dialog
    // shape as the rest of the unified ConfirmDialog usage.
    const ok = await confirm({
      level: "warning",
      title: `Apply stash@{${index}}?`,
      message:
        "Re-applies the stashed changes onto the working tree. Existing edits stay; conflicts will route you to the Merge view.",
      detail: `git stash apply stash@{${index}}`,
      confirmLabel: "Apply",
    });
    if (!ok) return;
    set((s) => ({ stash: { ...s.stash, busy: true, error: null, status: null } }));
    try {
      await git.stashApply(repo.path, index);
      set((s) => ({ stash: { ...s.stash, busy: false, status: `Applied stash@{${index}}.` } }));
      void get().loadChanges();
    } catch (e) {
      set((s) => ({ stash: { ...s.stash, busy: false, error: String(e) } }));
    }
  },

  popStash: async (index) => {
    const repo = get().repo;
    if (!repo) return;
    // v0.13.22 — pop both *applies* (destructive: conflicts possible) AND
    // *removes* the stash entry. The combined nature is what makes a "did
    // you mean apply?" mistake painful; force a confirmation.
    const ok = await confirm({
      level: "warning",
      title: `Pop stash@{${index}}?`,
      message:
        "Applies the stashed changes onto the working tree AND removes the stash entry. If apply produces conflicts the entry is kept; otherwise it's gone.",
      detail: `git stash pop stash@{${index}}`,
      confirmLabel: "Pop",
    });
    if (!ok) return;
    set((s) => ({ stash: { ...s.stash, busy: true, error: null, status: null } }));
    try {
      await git.stashPop(repo.path, index);
      set((s) => ({ stash: { ...s.stash, busy: false, status: `Popped stash@{${index}}.` } }));
      void get().loadStash();
      void get().loadChanges();
    } catch (e) {
      set((s) => ({ stash: { ...s.stash, busy: false, error: String(e) } }));
    }
  },

  dropStash: async (index) => {
    const repo = get().repo;
    if (!repo) return;
    const ok = await confirm({
      level: "danger",
      title: `Drop stash@{${index}}?`,
      message: "The stashed changes will be deleted permanently. This cannot be undone.",
      confirmLabel: "Drop",
    });
    if (!ok) return;
    set((s) => ({ stash: { ...s.stash, busy: true, error: null, status: null } }));
    try {
      await git.stashDrop(repo.path, index);
      set((s) => ({ stash: { ...s.stash, busy: false, status: `Dropped stash@{${index}}.` } }));
      void get().loadStash();
    } catch (e) {
      set((s) => ({ stash: { ...s.stash, busy: false, error: String(e) } }));
    }
  },

  // v0.13.24 — inline stash preview. Each stash is stored by libgit2 as a
  // real commit whose first parent captures the working-tree state at
  // stash time, so `commit_files(stashOid)` and `file_diff(stashOid, …)`
  // already do the right thing without any new backend code: the existing
  // parent-vs-tree machinery answers "what does this stash change?" and
  // "what does it change in this one file?" for free.
  selectStashEntry: async (index) => {
    const repo = get().repo;
    if (!repo) return;
    if (index === null) {
      set((s) => ({
        stash: {
          ...s.stash,
          selectedIndex: null,
          files: [],
          filesLoading: false,
          selectedFile: null,
          fileDiff: null,
          diffLoading: false,
        },
      }));
      return;
    }
    const entry = get().stash.entries[index];
    if (!entry) return;
    set((s) => ({
      stash: {
        ...s.stash,
        selectedIndex: index,
        files: [],
        filesLoading: true,
        selectedFile: null,
        fileDiff: null,
        diffLoading: false,
        error: null,
      },
    }));
    try {
      const files = await git.commitFiles(repo.path, entry.oid);
      // Race-check: only commit results if the user hasn't moved on. We
      // identify the request by the stash *oid* rather than its index,
      // because a concurrent loadStash could have shifted indices around
      // (e.g. the user dropped a different entry).
      const cur = get().stash;
      const stillThis =
        cur.selectedIndex !== null && cur.entries[cur.selectedIndex]?.oid === entry.oid;
      if (!stillThis) return;
      const first = files[0]?.path ?? null;
      set((s) => ({
        stash: {
          ...s.stash,
          files,
          filesLoading: false,
          selectedFile: first,
          fileDiff: null,
          diffLoading: first !== null,
        },
      }));
      if (first) void get().selectStashFile(first);
    } catch (e) {
      set((s) => ({
        stash: { ...s.stash, filesLoading: false, error: String(e) },
      }));
    }
  },

  selectStashFile: async (file) => {
    const repo = get().repo;
    const cur = get().stash;
    if (!repo || cur.selectedIndex === null) return;
    const entry = cur.entries[cur.selectedIndex];
    if (!entry) return;
    set((s) => ({
      stash: {
        ...s.stash,
        selectedFile: file,
        fileDiff: null,
        diffLoading: true,
      },
    }));
    try {
      // `false` = don't ignore whitespace; the StashPage doesn't expose a
      // toggle for it (the global Diff view's toggle lives on a separate
      // state slice), and "show every change as-is" is the safer default
      // for the preview-before-apply use case anyway.
      const fd = await git.fileDiff(repo.path, entry.oid, file, false);
      const after = get().stash;
      const sameStash =
        after.selectedIndex !== null && after.entries[after.selectedIndex]?.oid === entry.oid;
      if (!sameStash || after.selectedFile !== file) return;
      set((s) => ({
        stash: { ...s.stash, fileDiff: fd, diffLoading: false },
      }));
    } catch (e) {
      set((s) => ({
        stash: { ...s.stash, diffLoading: false, error: String(e) },
      }));
    }
  },

  // ---------- Branch / Tag operations ----------
  createBranch: async (name, startPoint, checkout = false) => {
    const repo = get().repo;
    if (!repo) return;
    try {
      await git.createBranch(repo.path, name, startPoint, checkout);
      void get().loadHistory();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  checkoutBranch: async (name) => {
    const repo = get().repo;
    if (!repo) return;
    try {
      await git.checkoutBranch(repo.path, name);
      void get().loadHistory();
      void get().loadChanges();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  checkoutCommit: async (oid) => {
    const repo = get().repo;
    if (!repo) return;
    const ok = await confirm({
      level: "warning",
      title: `Checkout ${oid.slice(0, 7)} (detached HEAD)?`,
      message:
        "You will not be on any branch after this. New commits made on a detached HEAD can only be recovered via reflog. Create a branch first if you want to keep working from here.",
      confirmLabel: "Checkout",
    });
    if (!ok) return;
    try {
      await git.checkoutCommit(repo.path, oid);
      void get().loadHistory();
      void get().loadChanges();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  deleteBranch: async (name) => {
    const repo = get().repo;
    if (!repo) return;
    const ok = await confirm({
      level: "danger",
      title: `Delete branch '${name}'?`,
      message:
        "The local branch ref will be removed. Unmerged commits not reachable from another ref may become unreachable (still recoverable via reflog for ~90 days).",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await git.deleteBranch(repo.path, name);
      void get().loadHistory();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  renameBranch: async (oldName, newName) => {
    const repo = get().repo;
    if (!repo) return;
    try {
      await git.renameBranch(repo.path, oldName, newName);
      void get().loadHistory();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  createTag: async (name, target, message) => {
    const repo = get().repo;
    if (!repo) return;
    try {
      await git.createTag(repo.path, name, target, message);
      void get().loadHistory();
      // Keep the Tags panel in sync if the user happens to be looking at
      // it (or visits it next).
      void get().loadTags();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  deleteTag: async (name) => {
    const repo = get().repo;
    if (!repo) return;
    const ok = await confirm({
      level: "danger",
      title: `Delete tag '${name}'?`,
      message:
        "The local tag ref will be removed. The remote copy is left untouched — use the Tags panel's 'Remote' button to delete the remote tag too.",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await git.deleteTag(repo.path, name);
      void get().loadHistory();
      void get().loadTags();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  // ---------- Tags panel (v0.13.12) ----------
  loadTags: async () => {
    const repo = get().repo;
    if (!repo) return;
    set((s) => ({ tags: { ...s.tags, loading: true, error: null } }));
    try {
      const entries = await git.listTags(repo.path);
      set((s) => ({ tags: { ...s.tags, entries, loading: false } }));
    } catch (e) {
      set((s) => ({ tags: { ...s.tags, loading: false, error: String(e) } }));
    }
  },

  pushTag: async (tagName, opts) => {
    const repo = get().repo;
    if (!repo) return;
    set((s) => ({ tags: { ...s.tags, busy: true, error: null, status: null } }));
    try {
      const r = await git.pushTag(repo.path, tagName, opts);
      set((s) => ({
        tags: {
          ...s.tags,
          busy: false,
          status: r.message ?? `Pushed tag ${tagName}`,
        },
      }));
    } catch (e) {
      set((s) => ({ tags: { ...s.tags, busy: false, error: String(e) } }));
    }
  },

  pushAllTags: async (opts) => {
    const repo = get().repo;
    if (!repo) return;
    const tagCount = get().tags.entries.length;
    const ok = await confirm({
      level: "warning",
      title: `Push all ${tagCount} tag${tagCount === 1 ? "" : "s"}?`,
      message:
        "Mirrors every local tag to the remote in one shot. Use this for release pushes; for an individual tag prefer the per-row Push button.",
      detail: `git push ${opts?.remote ?? "origin"} ${opts?.force ? "+" : ""}refs/tags/*:refs/tags/*`,
      confirmLabel: "Push all tags",
    });
    if (!ok) return;
    set((s) => ({ tags: { ...s.tags, busy: true, error: null, status: null } }));
    try {
      const r = await git.pushAllTags(repo.path, opts);
      set((s) => ({
        tags: { ...s.tags, busy: false, status: r.message ?? "Pushed all tags" },
      }));
    } catch (e) {
      set((s) => ({ tags: { ...s.tags, busy: false, error: String(e) } }));
    }
  },

  deleteRemoteTag: async (tagName, opts) => {
    const repo = get().repo;
    if (!repo) return;
    const ok = await confirm({
      level: "danger",
      title: `Delete remote tag '${tagName}'?`,
      message:
        "The local tag stays put; only the remote copy is removed. Anyone who already fetched the tag still has it locally.",
      detail: `git push ${opts?.remote ?? "origin"} :refs/tags/${tagName}`,
      confirmLabel: "Delete on remote",
    });
    if (!ok) return;
    set((s) => ({ tags: { ...s.tags, busy: true, error: null, status: null } }));
    try {
      const r = await git.deleteRemoteTag(repo.path, tagName, opts);
      set((s) => ({
        tags: {
          ...s.tags,
          busy: false,
          status: r.message ?? `Deleted remote tag ${tagName}`,
        },
      }));
    } catch (e) {
      set((s) => ({ tags: { ...s.tags, busy: false, error: String(e) } }));
    }
  },

  // ---------- Commit ops ----------
  cherryPick: async (oid) => {
    const repo = get().repo;
    if (!repo) return;
    const ok = await confirm({
      level: "warning",
      title: `Cherry-pick ${oid.slice(0, 7)} onto HEAD?`,
      message:
        "A new commit replaying these changes will be created on top of the current branch. Conflicts will route you to the Merge view.",
      confirmLabel: "Cherry-pick",
    });
    if (!ok) return;
    try {
      await git.cherryPick(repo.path, oid);
      void get().loadHistory();
      // If cherry-pick produced conflicts, switch to merge view to resolve them.
      const ms = await git.mergeState(repo.path);
      if (ms !== "clean") set({ view: "changes" });
      void get().loadMerge();
      void get().loadChanges();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  cherryPickMany: async (oids) => {
    const repo = get().repo;
    if (!repo) return;
    if (oids.length === 0) return;
    if (oids.length === 1) {
      // Defer to the single-shot path (which already has its own
      // confirm + error handling).
      await get().cherryPick(oids[0]!);
      return;
    }
    // Sort the user's selection by topo position (oldest first), since
    // git is happiest applying parents before children. The history
    // list is newest-first; filter+reverse gives us the right order.
    const cur = get().history.commits;
    const indexByOid = new Map<string, number>();
    cur.forEach((c, i) => indexByOid.set(c.oid, i));
    const ordered = oids
      .filter((o) => indexByOid.has(o))
      .sort((a, b) => indexByOid.get(b)! - indexByOid.get(a)!) // newest-first → push oldest to the front
      .map((o) => o); // identity, just for readability
    if (ordered.length === 0) {
      // None of the selected oids are in the loaded history window.
      // Punt rather than guess the order.
      set({ error: "Cannot cherry-pick: selected commits are not in the loaded history." });
      return;
    }

    const ok = await confirm({
      level: "warning",
      title: `Cherry-pick ${ordered.length} commits onto HEAD?`,
      message: `Each commit will be replayed in turn (oldest first). The first conflict pauses the sequence and routes you to the Merge view; remaining commits stay queued.`,
      detail:
        ordered
          .slice(0, 8)
          .map((o) => `  ${o.slice(0, 7)}`)
          .join("\n") + (ordered.length > 8 ? `\n  … and ${ordered.length - 8} more` : ""),
      confirmLabel: `Cherry-pick ${ordered.length}`,
    });
    if (!ok) return;

    try {
      const outcome = await git.cherryPickSequence(repo.path, ordered);
      void get().loadHistory();
      void get().loadChanges();
      if (outcome.kind === "stopped") {
        // Stop on first conflict — switch to merge view, surface a
        // structured message saying which oid stuck and how many are
        // still pending. We deliberately do NOT auto-resume after the
        // user resolves: the next `cherryPick` / `cherryPickMany` is
        // their explicit choice (matches IntelliJ's behaviour).
        set({ view: "changes" });
        void get().loadMerge();
        const remaining = outcome.pending.length;
        set((s) => ({
          history: {
            ...s.history,
            error: `Cherry-pick stopped at ${outcome.failed_oid.slice(0, 7)} (${outcome.applied} applied, ${remaining} pending). Resolve in the Merge view, then continue manually.`,
          },
        }));
      } else {
        // Done: clear any stale error banner from a previous attempt.
        set((s) => ({ history: { ...s.history, error: null } }));
      }
    } catch (e) {
      set({ error: String(e) });
    }
  },

  revertCommit: async (oid) => {
    const repo = get().repo;
    if (!repo) return;
    const ok = await confirm({
      level: "warning",
      title: `Revert ${oid.slice(0, 7)}?`,
      message:
        "An inverse commit undoing this change will be staged on the current branch. Conflicts (e.g. the change has already been edited again) route you to the Merge view.",
      confirmLabel: "Revert",
    });
    if (!ok) return;
    try {
      await git.revertCommit(repo.path, oid);
      void get().loadHistory();
      const ms = await git.mergeState(repo.path);
      if (ms !== "clean") set({ view: "changes" });
      void get().loadMerge();
      void get().loadChanges();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  resetTo: async (oid, mode) => {
    const repo = get().repo;
    if (!repo) return;
    const warnings: Record<typeof mode, string> = {
      soft: "Soft reset: HEAD moves; index and working tree are kept.",
      mixed: "Mixed reset: HEAD and index move; working tree is kept.",
      hard: "HARD reset: HEAD, index AND working tree all reset. Uncommitted changes will be LOST.",
    };
    const ok = await confirm({
      level: mode === "hard" ? "danger" : "warning",
      title: `Reset to ${oid.slice(0, 7)} (${mode})?`,
      message: warnings[mode],
      confirmLabel: mode === "hard" ? "Hard reset" : "Reset",
    });
    if (!ok) return;
    try {
      await git.resetTo(repo.path, oid, mode);
      void get().loadHistory();
      void get().loadChanges();
      void get().loadReflog();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  // ---------- Reflog ----------
  loadReflog: async () => {
    const repo = get().repo;
    if (!repo) return;
    set((s) => ({ reflog: { ...s.reflog, loading: true, error: null } }));
    try {
      const entries = await git.reflogList(repo.path);
      set((s) => ({ reflog: { ...s.reflog, entries, loading: false } }));
    } catch (e) {
      set((s) => ({ reflog: { ...s.reflog, loading: false, error: String(e) } }));
    }
  },

  // ---------- Submodules ----------
  loadSubmodules: async () => {
    const repo = get().repo;
    if (!repo) return;
    set((s) => ({ submodules: { ...s.submodules, loading: true, error: null } }));
    try {
      const entries = await git.submoduleList(repo.path);
      set((s) => ({ submodules: { ...s.submodules, entries, loading: false } }));
    } catch (e) {
      set((s) => ({ submodules: { ...s.submodules, loading: false, error: String(e) } }));
    }
  },

  initSubmodule: async (name) => {
    const repo = get().repo;
    if (!repo) return;
    // v0.13.22 — uniform "any write op confirms" policy. Init only writes
    // .git/config so the blast radius is small, but a single click should
    // still never silently mutate the user's repo.
    const ok = await confirm({
      level: "warning",
      title: `Initialize submodule '${name}'?`,
      message:
        "Copies the URL from .gitmodules into .git/config so this submodule is registered locally. Doesn't fetch or check out anything yet — use Update for that.",
      detail: `git submodule init -- ${name}`,
      confirmLabel: "Init",
    });
    if (!ok) return;
    set((s) => ({ submodules: { ...s.submodules, busy: true, status: null, error: null } }));
    try {
      await git.submoduleInit(repo.path, name);
      set((s) => ({ submodules: { ...s.submodules, busy: false, status: `Initialized ${name}` } }));
      void get().loadSubmodules();
    } catch (e) {
      set((s) => ({ submodules: { ...s.submodules, busy: false, error: String(e) } }));
    }
  },

  updateSubmodule: async (name) => {
    const repo = get().repo;
    if (!repo) return;
    const ok = await confirm({
      level: "warning",
      title: `Update submodule '${name}'?`,
      message:
        "Checks out the SHA pinned by the parent repo. Uncommitted changes inside the submodule's working tree may be overwritten.",
      confirmLabel: "Update",
    });
    if (!ok) return;
    set((s) => ({ submodules: { ...s.submodules, busy: true, status: null, error: null } }));
    try {
      await git.submoduleUpdate(repo.path, name, true);
      set((s) => ({ submodules: { ...s.submodules, busy: false, status: `Updated ${name}` } }));
      void get().loadSubmodules();
    } catch (e) {
      set((s) => ({ submodules: { ...s.submodules, busy: false, error: String(e) } }));
    }
  },

  updateSubmoduleRecursive: async (name) => {
    const repo = get().repo;
    if (!repo) return;
    const ok = await confirm({
      level: "warning",
      title: `Recursively update '${name}'?`,
      message:
        "Equivalent to `git submodule update --init --recursive`. Checks out the pinned SHA in this submodule and every nested submodule beneath it. Uncommitted changes anywhere along the chain may be overwritten.",
      confirmLabel: "Update recursively",
    });
    if (!ok) return;
    set((s) => ({ submodules: { ...s.submodules, busy: true, status: null, error: null } }));
    try {
      await git.submoduleUpdateRecursive(repo.path, name, true);
      set((s) => ({
        submodules: { ...s.submodules, busy: false, status: `Updated ${name} (recursive)` },
      }));
      void get().loadSubmodules();
    } catch (e) {
      set((s) => ({ submodules: { ...s.submodules, busy: false, error: String(e) } }));
    }
  },

  syncSubmodule: async (name) => {
    const repo = get().repo;
    if (!repo) return;
    // v0.13.22 — same policy: any write op confirms.
    const ok = await confirm({
      level: "warning",
      title: `Sync submodule URL for '${name}'?`,
      message:
        "Copies the current URL from .gitmodules into .git/config. Useful when the upstream repository moved and you've already updated .gitmodules.",
      detail: `git submodule sync -- ${name}`,
      confirmLabel: "Sync",
    });
    if (!ok) return;
    set((s) => ({ submodules: { ...s.submodules, busy: true, status: null, error: null } }));
    try {
      await git.submoduleSync(repo.path, name);
      set((s) => ({
        submodules: { ...s.submodules, busy: false, status: `Synced URL for ${name}` },
      }));
      void get().loadSubmodules();
    } catch (e) {
      set((s) => ({ submodules: { ...s.submodules, busy: false, error: String(e) } }));
    }
  },

  // ---------- Worktrees ----------
  loadWorktrees: async () => {
    const repo = get().repo;
    if (!repo) return;
    set((s) => ({ worktrees: { ...s.worktrees, loading: true, error: null } }));
    try {
      const entries = await git.worktreeList(repo.path);
      set((s) => ({ worktrees: { ...s.worktrees, entries, loading: false } }));
    } catch (e) {
      set((s) => ({ worktrees: { ...s.worktrees, loading: false, error: String(e) } }));
    }
  },

  addWorktree: async (name, targetPath, branch) => {
    const repo = get().repo;
    if (!repo) return;
    set((s) => ({ worktrees: { ...s.worktrees, busy: true, status: null, error: null } }));
    try {
      const wt = await git.worktreeAdd(repo.path, name, targetPath, branch);
      set((s) => ({
        worktrees: { ...s.worktrees, busy: false, status: `Added worktree ${wt.name}` },
      }));
      void get().loadWorktrees();
    } catch (e) {
      set((s) => ({ worktrees: { ...s.worktrees, busy: false, error: String(e) } }));
    }
  },

  removeWorktree: async (name, force = false) => {
    const repo = get().repo;
    if (!repo) return;
    const ok = await confirm({
      level: force ? "danger" : "warning",
      title: force ? `Force-remove worktree '${name}'?` : `Remove worktree '${name}'?`,
      message: force
        ? "Drops the worktree even if it has locally-modified files. Any uncommitted changes inside that worktree directory will be unrecoverable."
        : "Detaches the worktree from this repository. Refuses if the worktree is dirty — switch to Force in that case.",
      confirmLabel: force ? "Force remove" : "Remove",
    });
    if (!ok) return;
    set((s) => ({ worktrees: { ...s.worktrees, busy: true, status: null, error: null } }));
    try {
      await git.worktreeRemove(repo.path, name, force);
      set((s) => ({
        worktrees: { ...s.worktrees, busy: false, status: `Removed worktree ${name}` },
      }));
      void get().loadWorktrees();
    } catch (e) {
      set((s) => ({ worktrees: { ...s.worktrees, busy: false, error: String(e) } }));
    }
  },

  pruneWorktrees: async () => {
    const repo = get().repo;
    if (!repo) return;
    // v0.13.22 — prune is destructive: removes the .git/worktrees/<name>
    // metadata for every worktree libgit2 considers stale. Always confirm.
    const ok = await confirm({
      level: "warning",
      title: "Prune stale worktrees?",
      message:
        "Removes .git/worktrees/<name> metadata for every linked worktree whose working directory is gone. The actual files are not touched (they're already gone); this just cleans up the bookkeeping.",
      detail: "git worktree prune",
      confirmLabel: "Prune",
    });
    if (!ok) return;
    set((s) => ({ worktrees: { ...s.worktrees, busy: true, status: null, error: null } }));
    try {
      const pruned = await git.worktreePrune(repo.path);
      set((s) => ({
        worktrees: {
          ...s.worktrees,
          busy: false,
          status: pruned.length === 0 ? "Nothing to prune" : `Pruned ${pruned.length} worktree(s)`,
        },
      }));
      void get().loadWorktrees();
    } catch (e) {
      set((s) => ({ worktrees: { ...s.worktrees, busy: false, error: String(e) } }));
    }
  },

  // ---------- .gitignore editor ----------
  loadGitignore: async () => {
    const repo = get().repo;
    if (!repo) return;
    set((s) => ({ gitignore: { ...s.gitignore, loading: true, error: null } }));
    try {
      const [saved, templates] = await Promise.all([
        git.gitignoreRead(repo.path),
        git.gitignoreTemplates(),
      ]);
      set((s) => ({
        gitignore: {
          ...s.gitignore,
          saved,
          // Only overwrite the draft when it had no unsaved edits, so a
          // user who re-enters the view after typing keeps their work.
          draft:
            s.gitignore.draft && s.gitignore.draft !== s.gitignore.saved
              ? s.gitignore.draft
              : saved,
          templates,
          loading: false,
          preview: null,
        },
      }));
    } catch (e) {
      set((s) => ({ gitignore: { ...s.gitignore, loading: false, error: String(e) } }));
    }
  },

  setGitignoreDraft: (text) =>
    set((s) => ({
      gitignore: { ...s.gitignore, draft: text, status: null, preview: null },
    })),

  saveGitignore: async () => {
    const repo = get().repo;
    if (!repo) return;
    const draft = get().gitignore.draft;
    set((s) => ({ gitignore: { ...s.gitignore, busy: true, status: null, error: null } }));
    try {
      await git.gitignoreWrite(repo.path, draft);
      set((s) => ({
        gitignore: { ...s.gitignore, busy: false, saved: draft, status: "Saved" },
      }));
      // After saving, refresh working-tree status so Changes view picks
      // up newly ignored / un-ignored files.
      void get().loadChanges();
    } catch (e) {
      set((s) => ({ gitignore: { ...s.gitignore, busy: false, error: String(e) } }));
    }
  },

  previewGitignore: async () => {
    const repo = get().repo;
    if (!repo) return;
    const draft = get().gitignore.draft;
    set((s) => ({
      gitignore: { ...s.gitignore, busy: true, status: null, error: null },
    }));
    try {
      const preview = await git.gitignorePreview(repo.path, draft);
      set((s) => ({ gitignore: { ...s.gitignore, busy: false, preview } }));
    } catch (e) {
      set((s) => ({ gitignore: { ...s.gitignore, busy: false, error: String(e) } }));
    }
  },

  appendGitignoreTemplate: (id) =>
    set((s) => {
      const tpl = s.gitignore.templates.find((t) => t.id === id);
      if (!tpl) return s;
      const sep = s.gitignore.draft.length > 0 && !s.gitignore.draft.endsWith("\n") ? "\n\n" : "\n";
      const merged = s.gitignore.draft + (s.gitignore.draft ? sep : "") + tpl.content;
      return {
        gitignore: {
          ...s.gitignore,
          draft: merged,
          status: `Appended ${tpl.label}`,
          preview: null,
        },
      };
    }),

  // ---------- Cross-history search ----------
  setSearchQuery: (q) => set((s) => ({ search: { ...s.search, query: q, error: null } })),

  setSearchMode: (m) => set((s) => ({ search: { ...s.search, mode: m } })),

  setSearchPatternKind: (k) => set((s) => ({ search: { ...s.search, patternKind: k } })),

  toggleSearchCase: () =>
    set((s) => ({ search: { ...s.search, caseSensitive: !s.search.caseSensitive } })),

  setSearchPathspec: (p) => set((s) => ({ search: { ...s.search, pathspec: p } })),

  selectSearchHit: (oid) => set((s) => ({ search: { ...s.search, selectedOid: oid } })),

  clearSearch: () =>
    set((s) => ({
      search: {
        ...emptySearch,
        // Preserve the user's mode / kind / case preferences across clears
        // since changing those is way less frequent than running a new query.
        mode: s.search.mode,
        patternKind: s.search.patternKind,
        caseSensitive: s.search.caseSensitive,
        pathspec: s.search.pathspec,
        // v0.13.4: persisted side-state survives a clear too — these are
        // session-level, not "this query"-level.
        groupBy: s.search.groupBy,
        recents: s.search.recents,
        saved: s.search.saved,
      },
    })),

  runSearch: async () => {
    const repo = get().repo;
    if (!repo) return;
    const sv = get().search;
    const query = sv.query.trim();
    if (!query) {
      set((s) => ({
        search: {
          ...s.search,
          hits: [],
          appliedQuery: "",
          scanned: 0,
          truncated: false,
          selectedOid: null,
          error: null,
        },
      }));
      return;
    }
    set((s) => ({ search: { ...s.search, busy: true, error: null } }));
    try {
      const summary = await git.searchCommits(repo.path, query, {
        mode: sv.mode,
        patternKind: sv.patternKind,
        caseSensitive: sv.caseSensitive,
        pathspec: sv.pathspec.trim() || undefined,
      });
      set((s) => {
        const snapshot: SearchSnapshot = {
          query,
          mode: sv.mode,
          patternKind: sv.patternKind,
          caseSensitive: sv.caseSensitive,
          pathspec: sv.pathspec,
        };
        const recents = pushSearchRecent(s.search.recents, snapshot);
        saveSearchRecents(recents);
        return {
          search: {
            ...s.search,
            hits: summary.hits,
            scanned: summary.scanned,
            truncated: summary.truncated,
            appliedQuery: query,
            busy: false,
            // Auto-select the first hit so the preview pane has something to show.
            selectedOid: summary.hits[0]?.oid ?? null,
            recents,
          },
        };
      });
    } catch (e) {
      set((s) => ({
        search: { ...s.search, busy: false, error: String(e), hits: [] },
      }));
    }
  },

  setSearchGroupBy: (g) => set((s) => ({ search: { ...s.search, groupBy: g } })),

  applySearchSnapshot: (snap) =>
    set((s) => ({
      search: {
        ...s.search,
        query: snap.query,
        mode: snap.mode,
        patternKind: snap.patternKind,
        caseSensitive: snap.caseSensitive,
        pathspec: snap.pathspec,
        // Don't auto-run — just populate the form. Call sites that want
        // to immediately fire the search can `void runSearch()` afterwards.
      },
    })),

  saveCurrentSearch: (name) => {
    const sv = get().search;
    const entry: SavedSearch = {
      name,
      query: sv.query,
      mode: sv.mode,
      patternKind: sv.patternKind,
      caseSensitive: sv.caseSensitive,
      pathspec: sv.pathspec,
      savedAt: Date.now(),
    };
    let nextSaved: SavedSearch[] = [];
    try {
      nextSaved = upsertSearchSaved(sv.saved, entry);
    } catch (err) {
      // Empty name etc. — surface to the user via the slice's error field.
      set((s) => ({ search: { ...s.search, error: String(err) } }));
      return;
    }
    saveSearchSaved(nextSaved);
    set((s) => ({ search: { ...s.search, saved: nextSaved, error: null } }));
  },

  deleteSavedSearch: (name) => {
    const next = removeSearchSaved(get().search.saved, name);
    saveSearchSaved(next);
    set((s) => ({ search: { ...s.search, saved: next } }));
  },

  clearSearchRecents: () => {
    saveSearchRecents([]);
    set((s) => ({ search: { ...s.search, recents: [] } }));
  },

  // ---------- Interactive Rebase ----------
  openRebasePlan: async (baseOid: string) => {
    const repo = get().repo;
    if (!repo) return;
    set((s) => ({ view: "rebase", rebase: { ...s.rebase, busy: true, error: null } }));
    try {
      const plan = await git.rebasePlan(repo.path, baseOid);
      set((s) => ({
        rebase: {
          ...s.rebase,
          plan,
          baseOid,
          busy: false,
          status: null,
          state: null,
          conflicted: false,
          error: plan.length === 0 ? "Nothing to rebase — HEAD is already at base." : null,
        },
      }));
    } catch (e) {
      set((s) => ({ rebase: { ...s.rebase, busy: false, error: String(e) } }));
    }
  },

  setRebasePlan: (plan) => set((s) => ({ rebase: { ...s.rebase, plan } })),

  updateRebaseStep: (index, patch) =>
    set((s) => ({
      rebase: {
        ...s.rebase,
        plan: s.rebase.plan.map((p, i) => (i === index ? { ...p, ...patch } : p)),
      },
    })),

  moveRebaseStep: (index, dir) =>
    set((s) => {
      const plan = s.rebase.plan.slice();
      const j = index + dir;
      if (j < 0 || j >= plan.length) return s;
      [plan[index], plan[j]] = [plan[j], plan[index]];
      return { rebase: { ...s.rebase, plan } };
    }),

  startRebase: async () => {
    const repo = get().repo;
    const { rebase } = get();
    if (!repo || !rebase.baseOid || rebase.plan.length === 0) return;
    // v0.13.22 — rebase rewrites history. The plan is already on screen
    // (the user reordered / picked actions explicitly), but the actual
    // commit-rewriting still needs a final go/no-go acknowledgement.
    const stepCount = rebase.plan.filter((p) => p.action !== "drop").length;
    const dropCount = rebase.plan.length - stepCount;
    const ok = await confirm({
      level: "warning",
      title: `Start rebase: ${rebase.plan.length} step${rebase.plan.length === 1 ? "" : "s"}?`,
      message:
        "Replays the plan above on top of the base commit. Conflicts will pause execution and route you to the Merge view; you can Continue or Abort from there.",
      detail: `${stepCount} pick/reword/squash/fixup, ${dropCount} drop, base = ${rebase.baseOid.slice(0, 7)}`,
      confirmLabel: "Start rebase",
    });
    if (!ok) return;
    set((s) => ({ rebase: { ...s.rebase, busy: true, error: null, status: null } }));
    try {
      const status = await git.rebaseStart(repo.path, rebase.baseOid, rebase.plan);
      applyRebaseStatus(set, get, status);
      // Drive the plan forward step-by-step until we hit a conflict, finish,
      // or get cancelled.
      void get().rebaseAdvance();
    } catch (e) {
      set((s) => ({ rebase: { ...s.rebase, busy: false, error: String(e) } }));
    }
  },

  rebaseAdvance: async () => {
    const repo = get().repo;
    if (!repo) return;
    // Run steps in a loop, yielding to React between each so the UI updates.
    while (true) {
      const r = get().rebase;
      if (r.conflicted || !r.state || r.state.remaining.length === 0) break;
      try {
        const status = await git.rebaseNext(repo.path);
        applyRebaseStatus(set, get, status);
        if (status.kind !== "running") break;
      } catch (e) {
        set((s) => ({ rebase: { ...s.rebase, busy: false, error: String(e) } }));
        return;
      }
    }
  },

  rebaseContinue: async () => {
    const repo = get().repo;
    if (!repo) return;
    set((s) => ({ rebase: { ...s.rebase, busy: true, error: null } }));
    try {
      const status = await git.rebaseContinue(repo.path);
      applyRebaseStatus(set, get, status);
      if (status.kind === "running") void get().rebaseAdvance();
    } catch (e) {
      set((s) => ({ rebase: { ...s.rebase, busy: false, error: String(e) } }));
    }
  },

  rebaseAbort: async () => {
    const repo = get().repo;
    if (!repo) return;
    const ok = await confirm({
      level: "danger",
      title: "Abort rebase?",
      message:
        "The branch tip will be restored to where the rebase started. Any conflict resolutions you've already finished will be discarded.",
      confirmLabel: "Abort rebase",
    });
    if (!ok) return;
    set((s) => ({ rebase: { ...s.rebase, busy: true, error: null } }));
    try {
      await git.rebaseAbort(repo.path);
      set((s) => ({
        rebase: { ...emptyRebase, status: "Rebase aborted." },
        view: s.view === "rebase" ? "history" : s.view,
      }));
      void get().loadHistory();
      void get().loadChanges();
      void get().loadMerge();
    } catch (e) {
      set((s) => ({ rebase: { ...s.rebase, busy: false, error: String(e) } }));
    }
  },

  refreshRebaseStatus: async () => {
    const repo = get().repo;
    if (!repo) return;
    try {
      const status = await git.rebaseStatus(repo.path);
      applyRebaseStatus(set, get, status);
    } catch {
      // ignore — repo may not be openable yet.
    }
  },

  closeRebasePlan: () =>
    set((s) => ({
      rebase: { ...emptyRebase },
      view: s.view === "rebase" ? "history" : s.view,
    })),

  // ---------- Command Palette ----------
  openPalette: () => {
    set((s) => ({ palette: { ...s.palette, open: true } }));
    void get().ensureTrackedFiles();
  },

  closePalette: () => set((s) => ({ palette: { ...s.palette, open: false } })),

  ensureTrackedFiles: async () => {
    const repo = get().repo;
    if (!repo) return;
    const { palette } = get();
    if (palette.filesLoadedFor === repo.path) return;
    try {
      const files = await git.trackedFiles(repo.path);
      set((s) => ({
        palette: { ...s.palette, files, filesLoadedFor: repo.path },
      }));
    } catch {
      // ignore — palette will just show no file results
    }
  },

  // ---------- File History ----------
  openFileHistory: async (file: string) => {
    const repo = get().repo;
    if (!repo) return;
    set({
      view: "fileHistory",
      fileHistory: {
        ...emptyFileHistory,
        startPath: file,
        loading: true,
      },
    });
    try {
      const entries = await git.fileHistory(repo.path, file);
      set((s) => ({
        fileHistory: {
          ...s.fileHistory,
          entries,
          loading: false,
          selectedIdx: 0,
        },
      }));
      // v0.13.8 — bump in the recent-files MRU.
      get().noteRecentFile(file, "history");
      if (entries.length > 0) await get().selectFileHistoryEntry(0);
    } catch (e) {
      set((s) => ({
        fileHistory: { ...s.fileHistory, loading: false, error: String(e) },
      }));
    }
  },

  selectFileHistoryEntry: async (idx: number) => {
    const repo = get().repo;
    const fh = get().fileHistory;
    const entry = fh.entries[idx];
    if (!repo || !entry) return;
    set((s) => ({
      fileHistory: {
        ...s.fileHistory,
        selectedIdx: idx,
        fileDiff: null,
        diffLoading: true,
        error: null,
      },
    }));
    try {
      const fd = await git.fileDiff(
        repo.path,
        entry.commit.oid,
        entry.path_at_commit,
        get().diff.ignoreWhitespace,
      );
      set((s) =>
        s.fileHistory.selectedIdx === idx
          ? { fileHistory: { ...s.fileHistory, fileDiff: fd, diffLoading: false } }
          : s,
      );
    } catch (e) {
      set((s) => ({
        fileHistory: { ...s.fileHistory, diffLoading: false, error: String(e) },
      }));
    }
  },
}));

// Helper used by the rebase actions to fold a backend status into the store.
// Uses `useApp.setState` directly so we get Zustand's permissive partial type
// rather than rolling our own.
function applyRebaseStatus(_set: unknown, get: () => AppState, status: RebaseStatus) {
  if (status.kind === "idle") {
    useApp.setState((s) => ({
      rebase: { ...s.rebase, state: null, conflicted: false, busy: false },
    }));
    return;
  }
  if (status.kind === "done") {
    useApp.setState((s) => ({
      rebase: {
        ...emptyRebase,
        status: `Rebase complete — rewrote ${status.rewritten} commit(s).`,
      },
      view: s.view === "rebase" ? ("history" as ViewKey) : s.view,
    }));
    void get().loadHistory();
    void get().loadChanges();
    void get().loadMerge();
    return;
  }
  // running | conflicted
  useApp.setState((s) => ({
    rebase: {
      ...s.rebase,
      state: status.state,
      // Keep the planner UI in sync with the executor's remaining list so
      // users always see "what's next".
      plan: status.state.remaining,
      conflicted: status.kind === "conflicted",
      busy: status.kind === "running",
      error: null,
    },
  }));
  if (status.kind === "conflicted") {
    // Surface the merge view so the user can resolve.
    useApp.setState((s) => ({ view: s.view === "rebase" ? s.view : ("changes" as ViewKey) }));
    void get().loadMerge();
    void get().loadChanges();
  }
}

// ---------------------------------------------------------------------------
// v0.13.5 — Tabs v2 persistence subscriber
// ---------------------------------------------------------------------------
// Whenever the tab list or the active id changes, mirror the new shape to
// localStorage. We deliberately don't persist `sessionsById` (too heavy and
// rebuilds cheaply on switchTab → openRepo), and we strip out blank tabs at
// write time so a restart doesn't resurrect "(new)" tabs the user never
// bound to a repo.
if (typeof window !== "undefined") {
  let lastSnapshot = "";
  useApp.subscribe((s) => {
    // Cheap structural diff so we only hit localStorage when something
    // actually moved — Zustand fires for every set() regardless of which
    // slice changed.
    const persistable = stablePartitionPinned(s.tabs.filter((t) => t.repoPath.length > 0)).map(
      (t) => ({
        id: t.id,
        repoPath: t.repoPath,
        label: t.label,
        pinned: t.pinned,
      }),
    );
    const key = JSON.stringify({ tabs: persistable, activeTabId: s.activeTabId });
    if (key === lastSnapshot) return;
    lastSnapshot = key;
    saveTabs({ tabs: persistable, activeTabId: s.activeTabId });
  });
}
