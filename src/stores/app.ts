import { create } from "zustand";
import {
  git,
  type CommitSummary,
  type ConflictContent,
  type ConflictFile,
  type FileChange,
  type FileDiff,
  type MergeState,
  type RefEntry,
  type RepoInfo,
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

export type ViewKey = "history" | "diff" | "merge";
export type DiffMode = "sbs" | "unified";

interface HistoryState {
  commits: CommitSummary[];
  refs: RefEntry[];
  selectedOid: string | null;
  files: FileChange[];
  filesLoading: boolean;
  filter: string;
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

interface AppState {
  repo: RepoInfo | null;
  view: ViewKey;
  loading: boolean;
  error: string | null;

  history: HistoryState;
  diff: DiffState;
  merge: MergeView;

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

  // diff
  openDiff: (oid: string, file: string, files?: FileChange[]) => Promise<void>;
  selectDiffFile: (file: string) => Promise<void>;
  setDiffMode: (m: DiffMode) => void;
  toggleWhitespace: () => void;

  // merge
  loadMerge: () => Promise<void>;
  selectConflict: (file: string) => Promise<void>;
  applyResolution: (chunkIndex: number, choice: Resolution) => void;
  setResultText: (chunkIndex: number, text: string) => void;
  resolveCurrentFile: () => Promise<void>;
}

const emptyHistory: HistoryState = {
  commits: [],
  refs: [],
  selectedOid: null,
  files: [],
  filesLoading: false,
  filter: "",
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

export const useApp = create<AppState>((set, get) => ({
  repo: null,
  view: "history",
  loading: false,
  error: null,
  history: { ...emptyHistory },
  diff: { ...emptyDiff },
  merge: { ...emptyMerge, resolvedFiles: new Set() },

  recentRepos: loadRecent(),

  setView: (v) => {
    set({ view: v });
    if (v === "merge") void get().loadMerge();
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
    }
  },

  removeRecentRepo: (path) => set({ recentRepos: removeRecent(path) }),

  // ---------- History ----------
  loadHistory: async () => {
    const repo = get().repo;
    if (!repo) return;
    set((s) => ({ history: { ...s.history, loading: true, error: null } }));
    try {
      const [commits, refs] = await Promise.all([
        git.log(repo.path, 500, 0),
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
      const fd = await git.fileDiff(repo.path, oid, file);
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
}));
