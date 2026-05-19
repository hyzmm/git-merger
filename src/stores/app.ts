import { create } from "zustand";
import { git, type CommitSummary, type FileChange, type RefEntry, type RepoInfo } from "@/ipc/git";

export type ViewKey = "history" | "diff" | "merge";

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

interface AppState {
  repo: RepoInfo | null;
  view: ViewKey;
  loading: boolean;
  error: string | null;

  history: HistoryState;

  setView: (v: ViewKey) => void;
  openRepo: (path: string) => Promise<void>;
  reset: () => void;

  // history actions
  loadHistory: () => Promise<void>;
  selectCommit: (oid: string) => Promise<void>;
  setFilter: (q: string) => void;
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

export const useApp = create<AppState>((set, get) => ({
  repo: null,
  view: "history",
  loading: false,
  error: null,

  history: { ...emptyHistory },

  setView: (v) => set({ view: v }),

  openRepo: async (path) => {
    set({ loading: true, error: null });
    try {
      const repo = await git.openRepo(path);
      set({ repo, loading: false, history: { ...emptyHistory } });
      void get().loadHistory();
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  reset: () => set({ repo: null, error: null, history: { ...emptyHistory } }),

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
      set((s) => ({
        history: { ...s.history, loading: false, error: String(e) },
      }));
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
      set((s) => ({
        history: { ...s.history, filesLoading: false, error: String(e) },
      }));
    }
  },

  setFilter: (q) => set((s) => ({ history: { ...s.history, filter: q } })),
}));
