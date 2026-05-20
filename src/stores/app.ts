import { create } from "zustand";
import {
  git,
  type BlameLine,
  type CommitSummary,
  type ConflictContent,
  type ConflictFile,
  type FileChange,
  type FileDiff,
  type MergeState,
  type RefEntry,
  type ReflogEntry,
  type RepoInfo,
  type StashEntry,
  type WorkingFile,
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

export type ViewKey = "history" | "diff" | "merge" | "blame" | "changes" | "stash" | "reflog";
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
  lines: BlameLine[];
  loading: boolean;
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

  recentRepos: RecentRepo[];

  setView: (v: ViewKey) => void;
  openRepo: (path: string) => Promise<void>;
  reset: () => void;
  refresh: () => Promise<void>;
  removeRecentRepo: (path: string) => void;

  // history
  loadHistory: () => Promise<void>;
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
  lines: [],
  loading: false,
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

  recentRepos: loadRecent(),

  setView: (v) => {
    set({ view: v });
    if (v === "merge") void get().loadMerge();
    if (v === "changes") void get().loadChanges();
    if (v === "stash") void get().loadStash();
    if (v === "reflog") void get().loadReflog();
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
      });
      void get().loadHistory();
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
    }
  },

  removeRecentRepo: (path) => set({ recentRepos: removeRecent(path) }),

  // ---------- History ----------
  loadHistory: async () => {
    const repo = get().repo;
    if (!repo) return;
    set((s) => ({ history: { ...s.history, loading: true, error: null } }));
    try {
      const pathspec = get().history.pathspec.trim();
      const [commits, refs] = await Promise.all([
        git.log(repo.path, { limit: 5000, skip: 0, pathspec: pathspec || undefined }),
        git.listRefs(repo.path),
      ]);
      set((s) => ({
        history: {
          ...s.history,
          commits,
          refs,
          loading: false,
          selectedOid: commits[0]?.oid ?? null,
        },
      }));
      const first = commits[0];
      if (first) void get().selectCommit(first.oid);
    } catch (e) {
      set((s) => ({ history: { ...s.history, loading: false, error: String(e) } }));
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
      blame: { ...s.blame, file, loading: true, error: null, lines: [] },
    }));
    try {
      const lines = await git.blameFile(repo.path, file);
      set((s) => (s.blame.file === file ? { blame: { ...s.blame, lines, loading: false } } : s));
    } catch (e) {
      set((s) => ({ blame: { ...s.blame, loading: false, error: String(e) } }));
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
}));
