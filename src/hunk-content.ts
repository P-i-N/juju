import type { FileHunk } from "./graph-protocol";

export interface HunkLines extends FileHunk {
  removedLines: string[];
  addedLines: string[];
  oldMissingFinalNewline: boolean;
  newMissingFinalNewline: boolean;
}

export type HunkRange = Pick<FileHunk, "oldStart" | "oldLines" | "newStart" | "newLines">;

export function isSameHunk(a: HunkRange, b: HunkRange): boolean {
  return (
    a.oldStart === b.oldStart && a.oldLines === b.oldLines && a.newStart === b.newStart && a.newLines === b.newLines
  );
}

/**
 * Returns the content of a file as its old side with only the hunks at the indices in `keep`
 * applied, computed from the new side by reverting every other hunk. `hunks` are the
 * zero-context hunks of the file's diff, in order.
 */
export function contentWithHunks(newContent: string, hunks: readonly HunkLines[], keep: ReadonlySet<number>): string {
  let finalNewline = newContent.endsWith("\n");
  const lines = newContent === "" ? [] : newContent.split("\n");
  if (finalNewline) {
    lines.pop();
  }
  // Reverting bottom-up keeps the line numbers of the hunks above valid.
  for (let i = hunks.length - 1; i >= 0; i--) {
    if (keep.has(i)) {
      continue;
    }
    const hunk = hunks[i];
    // A hunk without new lines (a pure deletion) is anchored after line newStart.
    const start = hunk.newLines === 0 ? hunk.newStart : hunk.newStart - 1;
    lines.splice(start, hunk.newLines, ...hunk.removedLines);
    if (hunk.oldMissingFinalNewline || hunk.newMissingFinalNewline) {
      finalNewline = !hunk.oldMissingFinalNewline;
    }
  }
  return lines.join("\n") + (finalNewline && lines.length > 0 ? "\n" : "");
}
