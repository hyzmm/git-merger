/**
 * Parse a conflicted file's working-tree content into "chunks".
 *
 * Each chunk is either:
 *   - clean text (no conflict)
 *   - a 3-way conflict block with `ours`, `theirs`, and optional `base`
 *     (when conflict.style is "diff3").
 *
 * A conflict block looks like:
 *
 *   <<<<<<< HEAD
 *   ours line 1
 *   ours line 2
 *   ||||||| common ancestor                <- only present in diff3 style
 *   base line
 *   =======
 *   theirs line
 *   >>>>>>> feat-branch
 *
 * Resolution choices ("left" / "right" / "both") just pick which side(s)
 * survive; the user can also edit `result` manually.
 */

export type ChunkKind = "clean" | "conflict";

export type Resolution = "pending" | "left" | "right" | "both" | "manual";

export interface CleanChunk {
  kind: "clean";
  /** content including its trailing newline (if any) */
  text: string;
}

export interface ConflictChunk {
  kind: "conflict";
  /** zero-based index, useful for navigation */
  index: number;
  oursLabel: string;
  theirsLabel: string;
  ours: string;
  theirs: string;
  base?: string;
  /** initial pending state; mutated outside this module */
  resolution: Resolution;
  /** the user-edited result text when resolution === "manual"; otherwise the
   *  derived text from `ours` / `theirs` / both. */
  result: string;
}

export type Chunk = CleanChunk | ConflictChunk;

export function parseConflicts(text: string): Chunk[] {
  const lines = text.split(/(?<=\n)/); // keep trailing newlines on each line
  const chunks: Chunk[] = [];
  let buf = "";
  let i = 0;
  let conflictIdx = 0;

  function flushClean() {
    if (buf.length > 0) {
      chunks.push({ kind: "clean", text: buf });
      buf = "";
    }
  }

  while (i < lines.length) {
    const line = lines[i];
    const startMatch = /^<{7} ?(.*)\r?\n?$/.exec(line);
    if (startMatch) {
      flushClean();
      const oursLabel = startMatch[1].trim() || "ours";
      let ours = "";
      let theirs = "";
      let base: string | undefined;
      let theirsLabel = "theirs";
      let phase: "ours" | "base" | "theirs" = "ours";
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (/^\|{7}/.test(l)) {
          phase = "base";
          base = "";
          i++;
          continue;
        }
        if (/^={7}\r?\n?$/.test(l)) {
          phase = "theirs";
          i++;
          continue;
        }
        const endMatch = /^>{7} ?(.*)\r?\n?$/.exec(l);
        if (endMatch) {
          theirsLabel = endMatch[1].trim() || "theirs";
          i++;
          break;
        }
        if (phase === "ours") ours += l;
        else if (phase === "base") base = (base ?? "") + l;
        else theirs += l;
        i++;
      }
      chunks.push({
        kind: "conflict",
        index: conflictIdx++,
        oursLabel,
        theirsLabel,
        ours,
        theirs,
        base,
        resolution: "pending",
        result: ours, // default preview = ours
      });
    } else {
      buf += line;
      i++;
    }
  }
  flushClean();
  return chunks;
}

/** Recombine chunks into a final file text, applying current resolutions. */
export function joinChunks(chunks: Chunk[]): string {
  let out = "";
  for (const c of chunks) {
    if (c.kind === "clean") {
      out += c.text;
    } else {
      out += c.result;
    }
  }
  return out;
}

export function resolveText(chunk: ConflictChunk, choice: Resolution): string {
  switch (choice) {
    case "left":
      return chunk.ours;
    case "right":
      return chunk.theirs;
    case "both":
      // ensure newline between the two halves
      return chunk.ours.endsWith("\n") || chunk.ours.length === 0
        ? chunk.ours + chunk.theirs
        : chunk.ours + "\n" + chunk.theirs;
    case "manual":
    case "pending":
      return chunk.result;
  }
}

export function chunkSummary(chunks: Chunk[]): {
  total: number;
  resolved: number;
  pending: number;
} {
  let total = 0;
  let resolved = 0;
  for (const c of chunks) {
    if (c.kind === "conflict") {
      total++;
      if (c.resolution !== "pending") resolved++;
    }
  }
  return { total, resolved, pending: total - resolved };
}
