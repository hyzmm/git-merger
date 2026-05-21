import { create } from "zustand";
import {
  git,
  type BlameLine,
  type CommitSummary,
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
  | "fileHistory";
export type DiffMode = "sbs" | "unified";

interface HistoryState {
  commits: CommitSummary[];
  refs: RefEntry[];
  selectedOid: string | null;
  files: FileChange[];
  filesLoading: boolean;
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
}

interface StashView {
  entries: StashEntry[];
  loading: boolean;
  busy: boolean;
  error: string | null;
  /** Last successful action message, shown briefly. */
  status: string | null;
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
  rebase: RebaseView;
  palette: PaletteState;
  fileHistory: FileHistoryView;
  worktrees: WorktreesView;
  gitignore: GitignoreView;
  search: SearchView;

  recentRepos: RecentRepo[];

  setView: (v: ViewKey) => void;
  openRepo: (path: string) => Promise<void>;
  reset: () => void;
  refresh: () => Promise<void>;
  removeRecentRepo: (path: string) => void;

  // history
  loadHistory: () => Promise<void>;
  loadMoreHistory: () => Promise<void>;
  selectCommit: (oid: string) => Promise<void>;
  setFilter: (q: string) => void;
  setAuthorFilter: (a: string | null) => void;
  setDateRange: (since: number | null, until: number | null) => void;
  setPathspec: (p: string) => void;
  resetHistoryFilters: () => void;

  // diff
  openDiff: (oid: string, file: string, files?: FileChange[]) => Promise<void>;
  selectDiffFile: (file: string) => Promise<void>;
  setDiffMode: (m: DiffMode) => void;
  toggleWhitespace: () => void;
  toggleIgnoreWhitespace: () => void;

  // merge
  loadMerge: () => Promise<void>;
  selectConflict: (file: string) => Promise<void>;
  applyResolution: (chunkIndex: number, choice: Resolution) => void;
  setResultText: (chunkIndex: number, text: string) => void;
  resolveCurrentFile: () => Promise<void>;
  abortMerge: () => Promise<void>;
  commitMerge: (message?: string) => Promise<void>;

  // blame
  openBlame: (file: string) => Promise<void>;
  blameAt: (file: string, revision: string) => Promise<void>;
  blameFollowRename: () => Promise<void>;
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
  commitWorking: () => Promise<void>;

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

  // ref ops (branch / tag)
  createBranch: (name: string, startPoint: string, checkout?: boolean) => Promise<void>;
  checkoutBranch: (name: string) => Promise<void>;
  checkoutCommit: (oid: string) => Promise<void>;
  deleteBranch: (name: string) => Promise<void>;
  renameBranch: (oldName: string, newName: string) => Promise<void>;
  createTag: (name: string, target: string, message?: string) => Promise<void>;
  deleteTag: (name: string) => Promise<void>;

  // commit ops
  cherryPick: (oid: string) => Promise<void>;
  revertCommit: (oid: string) => Promise<void>;
  resetTo: (oid: string, mode: "soft" | "mixed" | "hard") => Promise<void>;

  // reflog
  loadReflog: () => Promise<void>;

  // submodules
  loadSubmodules: () => Promise<void>;
  initSubmodule: (name: string) => Promise<void>;
  updateSubmodule: (name: string) => Promise<void>;
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
  files: [],
  filesLoading: false,
  filter: "",
  authorFilter: null,
  sinceFilter: null,
  untilFilter: null,
  pathspec: "",
  loading: false,
  loadingMore: false,
  hasMore: false,
  nextCursor: null,
  error: null,
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
};

const emptyStash: StashView = {
  entries: [],
  loading: false,
  busy: false,
  error: null,
  status: null,
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
  rebase: { ...emptyRebase },
  palette: { ...emptyPalette },
  fileHistory: { ...emptyFileHistory },
  worktrees: { ...emptyWorktrees },
  gitignore: { ...emptyGitignore },
  search: { ...emptySearch },

  recentRepos: loadRecent(),

  setView: (v) => {
    set({ view: v });
    if (v === "merge") void get().loadMerge();
    if (v === "changes") void get().loadChanges();
    if (v === "stash") void get().loadStash();
    if (v === "reflog") void get().loadReflog();
    if (v === "submodules") void get().loadSubmodules();
    if (v === "rebase") void get().refreshRebaseStatus();
    if (v === "worktrees") void get().loadWorktrees();
    if (v === "gitignore") void get().loadGitignore();
  },

  openRepo: async (path) => {
    set({ loading: true, error: null });
    try {
      const repo = await git.openRepo(path);
      const recentRepos = pushRecent(repo.path);
      set({
        repo,
        loading: false,
        recentRepos,
        history: { ...emptyHistory },
        diff: { ...emptyDiff },
        merge: { ...emptyMerge, resolvedFiles: new Set() },
        stash: { ...emptyStash },
        reflog: { ...emptyReflog },
        submodules: { ...emptySubmodules },
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

  reset: () =>
    set({
      repo: null,
      error: null,
      history: { ...emptyHistory },
      diff: { ...emptyDiff },
      merge: { ...emptyMerge, resolvedFiles: new Set() },
      stash: { ...emptyStash },
      reflog: { ...emptyReflog },
      submodules: { ...emptySubmodules },
      rebase: { ...emptyRebase },
      palette: { ...emptyPalette },
      fileHistory: { ...emptyFileHistory },
      worktrees: { ...emptyWorktrees },
      gitignore: { ...emptyGitignore },
      search: { ...emptySearch },
    }),

  refresh: async () => {
    const { view, repo, diff } = get();
    if (!repo) return;
    if (view === "history") {
      await get().loadHistory();
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
    } else if (view === "worktrees") {
      await get().loadWorktrees();
    } else if (view === "gitignore") {
      await get().loadGitignore();
    }
  },

  removeRecentRepo: (path) => set({ recentRepos: removeRecent(path) }),

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

  selectCommit: async (oid: string) => {
    const repo = get().repo;
    if (!repo) return;
    set((s) => ({
      history: { ...s.history, selectedOid: oid, filesLoading: true, files: [] },
    }));
    try {
      const files = await git.commitFiles(repo.path, oid);
      set((s) =>
        s.history.selectedOid === oid
          ? { history: { ...s.history, files, filesLoading: false } }
          : s,
      );
    } catch (e) {
      set((s) => ({ history: { ...s.history, filesLoading: false, error: String(e) } }));
    }
  },

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
      },
    }));
    void get().loadHistory();
  },

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
      },
    }));
    try {
      const fd = await git.fileDiff(repo.path, oid, file, get().diff.ignoreWhitespace);
      set((s) =>
        s.diff.oid === oid && s.diff.selectedFile === file
          ? { diff: { ...s.diff, fileDiff: fd, loading: false } }
          : s,
      );
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
    if (!confirm(`Discard ${changes.selected.size} file(s)? This cannot be undone.`)) return;
    try {
      await git.discardFiles(repo.path, Array.from(changes.selected));
      void get().loadChanges();
    } catch (e) {
      set((s) => ({ changes: { ...s.changes, error: String(e) } }));
    }
  },

  setCommitMessage: (m) => set((s) => ({ changes: { ...s.changes, message: m } })),

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
      await git.commitChanges(repo.path, changes.message);
      set((s) => ({
        changes: {
          ...s.changes,
          message: "",
          selected: new Set(),
          committing: false,
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

  // ---------- Stash ----------
  loadStash: async () => {
    const repo = get().repo;
    if (!repo) return;
    set((s) => ({ stash: { ...s.stash, loading: true, error: null } }));
    try {
      const entries = await git.stashList(repo.path);
      set((s) => ({ stash: { ...s.stash, entries, loading: false } }));
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
    if (!confirm(`Drop stash@{${index}}? This cannot be undone.`)) return;
    set((s) => ({ stash: { ...s.stash, busy: true, error: null, status: null } }));
    try {
      await git.stashDrop(repo.path, index);
      set((s) => ({ stash: { ...s.stash, busy: false, status: `Dropped stash@{${index}}.` } }));
      void get().loadStash();
    } catch (e) {
      set((s) => ({ stash: { ...s.stash, busy: false, error: String(e) } }));
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
    if (
      !confirm(
        `Checkout ${oid.slice(0, 7)} in detached HEAD state?\n\nYou will not be on any branch after this.`,
      )
    )
      return;
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
    if (!confirm(`Delete branch '${name}'?`)) return;
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
    } catch (e) {
      set({ error: String(e) });
    }
  },

  deleteTag: async (name) => {
    const repo = get().repo;
    if (!repo) return;
    if (!confirm(`Delete tag '${name}'?`)) return;
    try {
      await git.deleteTag(repo.path, name);
      void get().loadHistory();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  // ---------- Commit ops ----------
  cherryPick: async (oid) => {
    const repo = get().repo;
    if (!repo) return;
    if (!confirm(`Cherry-pick ${oid.slice(0, 7)} onto current HEAD?`)) return;
    try {
      await git.cherryPick(repo.path, oid);
      void get().loadHistory();
      // If cherry-pick produced conflicts, switch to merge view to resolve them.
      const ms = await git.mergeState(repo.path);
      if (ms !== "clean") set({ view: "merge" });
      void get().loadMerge();
      void get().loadChanges();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  revertCommit: async (oid) => {
    const repo = get().repo;
    if (!repo) return;
    if (!confirm(`Revert ${oid.slice(0, 7)}? An inverse commit will be staged on HEAD.`)) return;
    try {
      await git.revertCommit(repo.path, oid);
      void get().loadHistory();
      const ms = await git.mergeState(repo.path);
      if (ms !== "clean") set({ view: "merge" });
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
    if (!confirm(`Reset to ${oid.slice(0, 7)}?\n\n${warnings[mode]}`)) return;
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
    set((s) => ({ submodules: { ...s.submodules, busy: true, status: null, error: null } }));
    try {
      await git.submoduleUpdate(repo.path, name, true);
      set((s) => ({ submodules: { ...s.submodules, busy: false, status: `Updated ${name}` } }));
      void get().loadSubmodules();
    } catch (e) {
      set((s) => ({ submodules: { ...s.submodules, busy: false, error: String(e) } }));
    }
  },

  syncSubmodule: async (name) => {
    const repo = get().repo;
    if (!repo) return;
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
      set((s) => ({
        search: {
          ...s.search,
          hits: summary.hits,
          scanned: summary.scanned,
          truncated: summary.truncated,
          appliedQuery: query,
          busy: false,
          // Auto-select the first hit so the preview pane has something to show.
          selectedOid: summary.hits[0]?.oid ?? null,
        },
      }));
    } catch (e) {
      set((s) => ({
        search: { ...s.search, busy: false, error: String(e), hits: [] },
      }));
    }
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
    if (!confirm("Abort the rebase and restore the original branch tip?")) return;
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
    useApp.setState((s) => ({ view: s.view === "rebase" ? s.view : ("merge" as ViewKey) }));
    void get().loadMerge();
    void get().loadChanges();
  }
}
