import { useEffect, useState } from "react";
import { detectLang, highlightLines, type Token } from "@/lib/highlighter";

/**
 * Asynchronously highlight an array of source lines and return per-line
 * tokens. Returns `null` while loading or on error (caller should render
 * plain text in that case).
 */
export function useHighlight(lines: string[], filename: string): Token[][] | null {
  const [tokens, setTokens] = useState<Token[][] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTokens(null);
    const lang = detectLang(filename);
    if (!lang) {
      setTokens(null);
      return;
    }
    void highlightLines(lines, lang).then((res) => {
      if (!cancelled) setTokens(res);
    });
    return () => {
      cancelled = true;
    };
    // We deliberately re-run when filename or the joined source changes. Joining
    // is cheap relative to highlight cost and avoids re-running on identity-only
    // array recreation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filename, lines.join("\n")]);

  return tokens;
}
