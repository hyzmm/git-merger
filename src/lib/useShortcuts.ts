import { useEffect } from "react";

export interface ShortcutMap {
  /** Key as in KeyboardEvent.key, lowercase comparison. Use Alt+/Ctrl+/Shift+ prefixes. */
  [combo: string]: () => void;
}

/**
 * Global keyboard shortcut hook. Combos are strings like "f7", "shift+f7",
 * "alt+1", "ctrl+r". Comparisons are case-insensitive.
 *
 * Inputs (input/textarea/contenteditable) are excluded — typing in a textarea
 * won't accidentally fire Alt+1.
 */
export function useShortcuts(map: ShortcutMap, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || (t as HTMLElement).isContentEditable)
      ) {
        // Allow ctrl-shortcuts inside inputs only for explicit modifiers (e.g. Ctrl+Enter).
        if (!e.ctrlKey && !e.metaKey) return;
      }
      const parts: string[] = [];
      if (e.ctrlKey || e.metaKey) parts.push("ctrl");
      if (e.altKey) parts.push("alt");
      if (e.shiftKey) parts.push("shift");
      parts.push(e.key.toLowerCase());
      const combo = parts.join("+");
      const handler = map[combo];
      if (handler) {
        e.preventDefault();
        handler();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [map, enabled]);
}
