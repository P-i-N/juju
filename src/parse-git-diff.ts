import path from "path";
import type { FileHunk } from "./graph-protocol";
import type { HunkLines } from "./hunk-content";
import { toForwardSlashes } from "./utils";

export interface GitDiffLineCounts {
  added: number;
  removed: number;
  binary: boolean;
}

const DIFF_HEADER_PREFIX = "diff --git ";
const RENAME_TO_PREFIX = "rename to ";
const COPY_TO_PREFIX = "copy to ";
const BINARY_FILES_PREFIX = "Binary files ";
const GIT_BINARY_PATCH_PREFIX = "GIT binary patch";

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const MAX_HUNK_PREVIEW_LENGTH = 200;

interface FileSection {
  renamedTo: string | undefined;
  plusPath: string | undefined;
  minusPath: string | undefined;
  headerPath: string | undefined;
  added: number;
  removed: number;
  binary: boolean;
  hunks: HunkInProgress[];
}

interface HunkInProgress extends HunkLines {
  firstRemoved: string | undefined;
  lastKind: "+" | "-" | undefined;
}

interface ParsedFileSection {
  path: string;
  added: number;
  removed: number;
  binary: boolean;
  hunks: HunkLines[];
}

/**
 * Parses `jj diff --git` output into per-file added/removed line counts, keyed by the
 * repository-relative path (forward slashes) of the file's right side. Binary files carry
 * no counts and are flagged instead. A file whose path cannot be recovered from the header
 * lines (e.g. quoted paths with control characters) is omitted; callers then show no
 * per-file delta for it.
 */
export function parseGitDiffLineCounts(output: string): Map<string, GitDiffLineCounts> {
  const result = new Map<string, GitDiffLineCounts>();
  for (const section of parseGitDiffSections(output)) {
    result.set(section.path, { added: section.added, removed: section.removed, binary: section.binary });
  }
  return result;
}

/**
 * Parses `jj diff --git` output into per-file hunks, keyed like {@link parseGitDiffLineCounts}.
 * Run the diff with `--context 0` to get exactly the groups of changed lines.
 */
export function parseGitDiffHunks(output: string): Map<string, FileHunk[]> {
  const result = new Map<string, FileHunk[]>();
  for (const section of parseGitDiffSections(output)) {
    result.set(
      section.path,
      section.hunks.map(({ oldStart, oldLines, newStart, newLines, added, removed, preview }) => ({
        oldStart,
        oldLines,
        newStart,
        newLines,
        added,
        removed,
        preview,
      })),
    );
  }
  return result;
}

/**
 * Like {@link parseGitDiffHunks}, but also returns the removed and added lines of every hunk,
 * as needed to rebuild a file with only some of its hunks applied.
 */
export function parseGitDiffHunkLines(output: string): Map<string, HunkLines[]> {
  const result = new Map<string, HunkLines[]>();
  for (const section of parseGitDiffSections(output)) {
    result.set(section.path, section.hunks);
  }
  return result;
}

function parseGitDiffSections(output: string): ParsedFileSection[] {
  const result: ParsedFileSection[] = [];
  let section: FileSection | undefined;
  let hunk: HunkInProgress | undefined;

  const commitSection = () => {
    if (!section) {
      return;
    }
    // The right-side path is exact in the rename/copy header; otherwise it comes from the
    // +++ line, and only a deletion falls back to the --- line. Sections without any of
    // those (binary files, mode-only changes) fall back to the b-side path of the
    // `diff --git` header.
    const target = section.renamedTo ?? section.plusPath ?? section.minusPath ?? section.headerPath;
    if (target !== undefined) {
      result.push({
        path: toForwardSlashes(path.normalize(target)),
        added: section.added,
        removed: section.removed,
        binary: section.binary,
        hunks: section.hunks.map(({ firstRemoved, lastKind: _lastKind, ...h }) => ({
          ...h,
          preview: h.preview || firstRemoved || "",
        })),
      });
    }
    section = undefined;
    hunk = undefined;
  };

  for (const line of output.split("\n")) {
    if (line.startsWith(DIFF_HEADER_PREFIX)) {
      commitSection();
      section = {
        renamedTo: undefined,
        plusPath: undefined,
        minusPath: undefined,
        headerPath: headerTargetPath(line),
        added: 0,
        removed: 0,
        binary: false,
        hunks: [],
      };
      continue;
    }
    if (!section) {
      continue;
    }
    const hunkHeader = HUNK_HEADER.exec(line);
    if (hunkHeader) {
      hunk = {
        oldStart: Number(hunkHeader[1]),
        oldLines: hunkHeader[2] === undefined ? 1 : Number(hunkHeader[2]),
        newStart: Number(hunkHeader[3]),
        newLines: hunkHeader[4] === undefined ? 1 : Number(hunkHeader[4]),
        added: 0,
        removed: 0,
        preview: "",
        removedLines: [],
        addedLines: [],
        oldMissingFinalNewline: false,
        newMissingFinalNewline: false,
        firstRemoved: undefined,
        lastKind: undefined,
      };
      section.hunks.push(hunk);
      continue;
    }
    if (hunk) {
      // Inside a hunk every line is content: a removed line may itself start with "--- ".
      if (line.startsWith("+")) {
        section.added++;
        hunk.added++;
        hunk.addedLines.push(line.slice(1));
        hunk.lastKind = "+";
        if (!hunk.preview) {
          hunk.preview = previewOf(line);
        }
      } else if (line.startsWith("-")) {
        section.removed++;
        hunk.removed++;
        hunk.removedLines.push(line.slice(1));
        hunk.lastKind = "-";
        hunk.firstRemoved ??= previewOf(line);
      } else if (line.startsWith("\\")) {
        // "\ No newline at end of file" refers to the line right before it.
        if (hunk.lastKind === "-") {
          hunk.oldMissingFinalNewline = true;
        } else if (hunk.lastKind === "+") {
          hunk.newMissingFinalNewline = true;
        }
      }
      continue;
    }
    if (line.startsWith(RENAME_TO_PREFIX)) {
      section.renamedTo = line.slice(RENAME_TO_PREFIX.length);
      continue;
    }
    if (line.startsWith(COPY_TO_PREFIX)) {
      section.renamedTo = line.slice(COPY_TO_PREFIX.length);
      continue;
    }
    if (line.startsWith("+++ ")) {
      section.plusPath = stripBPath(line);
      continue;
    }
    if (line.startsWith("--- ")) {
      section.minusPath = stripXPath(line);
      continue;
    }
    if (line.startsWith(BINARY_FILES_PREFIX) || line.startsWith(GIT_BINARY_PATCH_PREFIX)) {
      section.binary = true;
      continue;
    }
  }
  commitSection();

  return result;
}

function previewOf(line: string): string {
  return line.slice(1).trim().slice(0, MAX_HUNK_PREVIEW_LENGTH);
}

function stripBPath(line: string): string | undefined {
  return line.startsWith("+++ b/") ? line.slice("+++ b/".length) : undefined;
}

function stripXPath(line: string): string | undefined {
  return line.startsWith("--- a/") ? line.slice("--- a/".length) : undefined;
}

/**
 * Extracts the b-side path from a `diff --git a/<A> b/<B>` header, used only for sections
 * without ---/+++/rename lines (binary files, mode-only changes). Splitting at the last
 * " b/" recovers <B> for regular paths; quoted or otherwise ambiguous paths yield a wrong
 * key, which simply matches no file. Quoted headers return undefined.
 */
function headerTargetPath(line: string): string | undefined {
  const rest = line.slice(DIFF_HEADER_PREFIX.length);
  if (rest.startsWith('"')) {
    return undefined;
  }
  const separator = rest.lastIndexOf(" b/");
  if (separator === -1) {
    return undefined;
  }
  const bPath = rest.slice(separator + " b/".length);
  return bPath.length > 0 ? bPath : undefined;
}
