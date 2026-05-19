/**
 * Shiki-based syntax highlighter — lazy-loaded singleton with bundled languages.
 *
 * Instead of letting Shiki pull in all 300+ grammars (which produces hundreds
 * of small JS chunks at build time and bloats the desktop bundle), we
 * curate a list of languages we actually want to support and lazy-import
 * grammar modules from `shiki/langs/<id>.mjs` only when first needed.
 */

import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";

const THEME_ID = "github-dark-default";

/** Languages we explicitly support. Adding more is a single line each. */
type SupportedLang =
  | "typescript"
  | "tsx"
  | "javascript"
  | "jsx"
  | "json"
  | "jsonc"
  | "json5"
  | "markdown"
  | "css"
  | "scss"
  | "html"
  | "xml"
  | "yaml"
  | "toml"
  | "rust"
  | "python"
  | "go"
  | "java"
  | "kotlin"
  | "swift"
  | "c"
  | "cpp"
  | "csharp"
  | "ruby"
  | "php"
  | "bash"
  | "powershell"
  | "sql"
  | "dockerfile"
  | "vue"
  | "svelte"
  | "lua"
  | "dart"
  | "diff";

let _h: Promise<HighlighterCore> | null = null;
async function getHighlighter(): Promise<HighlighterCore> {
  if (!_h) {
    _h = (async () => {
      const themeMod = await import("shiki/themes/github-dark-default.mjs");
      return createHighlighterCore({
        themes: [themeMod.default],
        langs: [], // loaded on demand below
        engine: createOnigurumaEngine(import("shiki/wasm")),
      });
    })();
  }
  return _h;
}

/** Map of supported langs -> lazy module loaders. Each call returns the
 *  language definition module which is then registered into the highlighter. */
const LANG_LOADERS: Record<SupportedLang, () => Promise<unknown>> = {
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsonc: () => import("shiki/langs/jsonc.mjs"),
  json5: () => import("shiki/langs/json5.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  bash: () => import("shiki/langs/bash.mjs"),
  powershell: () => import("shiki/langs/powershell.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  dockerfile: () => import("shiki/langs/dockerfile.mjs"),
  vue: () => import("shiki/langs/vue.mjs"),
  svelte: () => import("shiki/langs/svelte.mjs"),
  lua: () => import("shiki/langs/lua.mjs"),
  dart: () => import("shiki/langs/dart.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
};

/** Map a file path (or extension) to one of our SupportedLang ids, or null. */
export function detectLang(filename: string): SupportedLang | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith("dockerfile") || lower.includes("/dockerfile")) return "dockerfile";
  const ext = lower.includes(".") ? lower.split(".").pop()! : lower;
  const TABLE: Record<string, SupportedLang> = {
    ts: "typescript",
    tsx: "tsx",
    cts: "typescript",
    mts: "typescript",
    js: "javascript",
    jsx: "jsx",
    cjs: "javascript",
    mjs: "javascript",
    json: "json",
    jsonc: "jsonc",
    json5: "json5",
    md: "markdown",
    css: "css",
    scss: "scss",
    sass: "scss",
    less: "css",
    html: "html",
    htm: "html",
    svg: "xml",
    xml: "xml",
    yml: "yaml",
    yaml: "yaml",
    toml: "toml",
    rs: "rust",
    py: "python",
    go: "go",
    java: "java",
    kt: "kotlin",
    kts: "kotlin",
    swift: "swift",
    c: "c",
    h: "c",
    cc: "cpp",
    cpp: "cpp",
    cxx: "cpp",
    hpp: "cpp",
    hh: "cpp",
    cs: "csharp",
    rb: "ruby",
    php: "php",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    ps1: "powershell",
    psm1: "powershell",
    sql: "sql",
    vue: "vue",
    svelte: "svelte",
    lua: "lua",
    dart: "dart",
    diff: "diff",
    patch: "diff",
  };
  return TABLE[ext] ?? null;
}

export interface Token {
  text: string;
  color?: string;
  italic?: boolean;
  bold?: boolean;
}

const _loaded = new Set<string>();

/**
 * Highlight an array of source lines and return per-line token arrays.
 * If `lang` is null or unsupported, returns a plain-text fallback.
 */
export async function highlightLines(
  lines: string[],
  lang: SupportedLang | null,
): Promise<Token[][]> {
  if (!lang) return plainFallback(lines);
  try {
    const h = await getHighlighter();
    if (!_loaded.has(lang)) {
      const mod = (await LANG_LOADERS[lang]()) as { default: unknown };
      // shiki accepts the default-exported lang module directly
      await h.loadLanguage(mod.default as never);
      _loaded.add(lang);
    }
    const code = lines.join("\n");
    const result = h.codeToTokens(code, { theme: THEME_ID, lang });
    const out: Token[][] = result.tokens.map((row) =>
      row.map((t) => ({
        text: t.content,
        color: t.color,
        italic: !!(t.fontStyle && t.fontStyle & 1),
        bold: !!(t.fontStyle && t.fontStyle & 2),
      })),
    );
    while (out.length < lines.length) out.push([{ text: "" }]);
    return out;
  } catch (err) {
    console.warn("[shiki] highlight failed, falling back to plain:", err);
    return plainFallback(lines);
  }
}

function plainFallback(lines: string[]): Token[][] {
  return lines.map((l) => [{ text: l }]);
}
