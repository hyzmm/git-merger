/**
 * Lightweight, typed i18n.
 *
 * Why not i18next?
 *   We need ~50 strings, English + Chinese, and runtime swap. A 50-line
 *   Zustand-backed dictionary lookup costs ~1 kB; i18next + plugins is 50 kB.
 */
import { create } from "zustand";
import { en, type Dict } from "./locales/en";
import { zh } from "./locales/zh";

export type Locale = "en" | "zh";

const KEY = "gittools.locale.v1";

const DICTS: Record<Locale, Dict> = { en, zh };

function load(): Locale {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "en" || v === "zh") return v;
    // Auto-detect from browser/system on first run.
    if (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("zh")) {
      return "zh";
    }
  } catch {
    /* ignore */
  }
  return "en";
}

interface I18nStore {
  locale: Locale;
  setLocale: (l: Locale) => void;
}

export const useI18n = create<I18nStore>((set) => ({
  locale: load(),
  setLocale: (l) => {
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = l === "zh" ? "zh-CN" : "en";
    set({ locale: l });
  },
}));

// Apply lang attribute on first import.
if (typeof document !== "undefined") {
  const initial = useI18n.getState().locale;
  document.documentElement.lang = initial === "zh" ? "zh-CN" : "en";
}

/** Type-safe translation key. Autocompletes against the English dict. */
export type TKey = keyof Dict;

/**
 * React hook returning a stable `t(key, vars?)` function.
 * `vars` interpolates `{name}` placeholders.
 */
export function useT() {
  const locale = useI18n((s) => s.locale);
  return (key: TKey, vars?: Record<string, string | number>): string => {
    const dict = DICTS[locale] ?? en;
    let s = dict[key] ?? en[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      }
    }
    return s;
  };
}

/** Non-hook variant for use outside React render. */
export function t(key: TKey, vars?: Record<string, string | number>): string {
  const dict = DICTS[useI18n.getState().locale] ?? en;
  let s = dict[key] ?? en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return s;
}
