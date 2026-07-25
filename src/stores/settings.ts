import { create } from "zustand";

const KEY = "gittools.settings.v1";

export type ThemeMode = "auto" | "light" | "dark";

/**
 * Graph display mode for the history view's lane chart (v0.13.6).
 *
 * Heavily-forked repos can blow the lane count past 15-20, which under the
 * legacy "graph column = max lanes × 14px" rule leaves no room for the
 * commit summary. Users can pick:
 *   - "normal":  14 px / lane (legacy default), with a hard column cap
 *   - "compact":  9 px / lane + smaller dots, ~36 % narrower
 *   - "hidden":  graph column removed entirely; summary takes the space
 */
export type GraphMode = "normal" | "compact" | "hidden";

export interface UiSettings {
  theme: ThemeMode;
  /** Base font size in px. Applied to <html> root. */
  fontSize: number;
  /** CSS tab-size for monospace blocks. 2 / 4 / 8 typical. */
  tabSize: number;
  /** History graph rendering mode. */
  graphMode: GraphMode;
  /**
   * v0.13.34 — HistoryPage left column (RefsPane) width in px.
   * Resizable by dragging the divider between RefsPane and CommitList.
   * Clamped to [HISTORY_LEFT_MIN, HISTORY_LEFT_MAX] on load.
   */
  historyLeftWidth: number;
  /**
   * v0.13.34 — HistoryPage right column (CommitDetails) width in px.
   * Resizable by dragging the divider between CommitList and CommitDetails.
   * Clamped to [HISTORY_RIGHT_MIN, HISTORY_RIGHT_MAX] on load.
   */
  historyRightWidth: number;
  /**
   * When true, stats pages group authors by name (case-insensitive)
   * instead of email, merging different email addresses that share the
   * same display name into a single author entry.
   */
  mergeAuthorsByName: boolean;
}

/**
 * v0.13.34 — Allowed range for the HistoryPage column widths. Floors
 * keep the panes usable (anything narrower truncates branch names /
 * commit subjects too aggressively); ceilings keep the centre commit
 * list from being squeezed below ~400 px on a 1280-wide window.
 */
export const HISTORY_LEFT_MIN = 160;
export const HISTORY_LEFT_MAX = 480;
export const HISTORY_RIGHT_MIN = 280;
export const HISTORY_RIGHT_MAX = 720;

const DEFAULT: UiSettings = {
  theme: "dark",
  fontSize: 14,
  tabSize: 4,
  graphMode: "normal",
  historyLeftWidth: 220,
  historyRightWidth: 380,
  mergeAuthorsByName: false,
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function load(): UiSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT };
    const parsed = JSON.parse(raw) as Partial<UiSettings>;
    return {
      theme: (["auto", "light", "dark"] as const).includes(parsed.theme as ThemeMode)
        ? (parsed.theme as ThemeMode)
        : DEFAULT.theme,
      fontSize:
        typeof parsed.fontSize === "number" && parsed.fontSize >= 10 && parsed.fontSize <= 24
          ? parsed.fontSize
          : DEFAULT.fontSize,
      tabSize:
        typeof parsed.tabSize === "number" && parsed.tabSize >= 1 && parsed.tabSize <= 16
          ? parsed.tabSize
          : DEFAULT.tabSize,
      graphMode: (["normal", "compact", "hidden"] as const).includes(parsed.graphMode as GraphMode)
        ? (parsed.graphMode as GraphMode)
        : DEFAULT.graphMode,
      historyLeftWidth:
        typeof parsed.historyLeftWidth === "number"
          ? clamp(parsed.historyLeftWidth, HISTORY_LEFT_MIN, HISTORY_LEFT_MAX)
          : DEFAULT.historyLeftWidth,
      historyRightWidth:
        typeof parsed.historyRightWidth === "number"
          ? clamp(parsed.historyRightWidth, HISTORY_RIGHT_MIN, HISTORY_RIGHT_MAX)
          : DEFAULT.historyRightWidth,
      mergeAuthorsByName:
        typeof parsed.mergeAuthorsByName === "boolean"
          ? parsed.mergeAuthorsByName
          : DEFAULT.mergeAuthorsByName,
    };
  } catch {
    return { ...DEFAULT };
  }
}

function save(s: UiSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore quota errors */
  }
}

/** Apply settings to the DOM. Idempotent. */
export function applySettings(s: UiSettings) {
  const html = document.documentElement;
  const dark =
    s.theme === "dark" ||
    (s.theme === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  html.classList.toggle("dark", dark);
  html.style.fontSize = `${s.fontSize}px`;
  html.style.setProperty("--tab-size", String(s.tabSize));
}

export interface SettingsStore extends UiSettings {
  set: (patch: Partial<UiSettings>) => void;
  reset: () => void;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  ...load(),

  set: (patch) => {
    const next = { ...get(), ...patch };
    save({
      theme: next.theme,
      fontSize: next.fontSize,
      tabSize: next.tabSize,
      graphMode: next.graphMode,
      historyLeftWidth: next.historyLeftWidth,
      historyRightWidth: next.historyRightWidth,
      mergeAuthorsByName: next.mergeAuthorsByName,
    });
    applySettings(next);
    set(next);
  },

  reset: () => {
    save(DEFAULT);
    applySettings(DEFAULT);
    set({ ...DEFAULT });
  },
}));

// Listen to OS theme changes when in "auto" mode.
if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", () => {
    const s = useSettings.getState();
    if (s.theme === "auto") applySettings(s);
  });
}
