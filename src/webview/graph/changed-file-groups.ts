import type { ChangedFile } from "../../graph-protocol";

export interface ChangedFileGroup {
  /** The directory of the files, "" for files at the repository root. */
  directory: string;
  files: ChangedFile[];
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function directoryOf(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? "" : path.slice(0, separator);
}

function compareText(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

// Compared segment by segment so a directory is directly followed by its subdirectories.
function compareDirectories(a: string, b: string): number {
  const aSegments = a === "" ? [] : a.split("/");
  const bSegments = b === "" ? [] : b.split("/");
  for (let i = 0; i < Math.min(aSegments.length, bSegments.length); i++) {
    const order = compareText(aSegments[i], bSegments[i]);
    if (order !== 0) {
      return order;
    }
  }
  return aSegments.length - bSegments.length;
}

/** Changed files sorted by directory and then name, grouped by directory. */
export function groupChangedFiles(files: readonly ChangedFile[]): ChangedFileGroup[] {
  const sorted = [...files].sort(
    (a, b) =>
      compareDirectories(directoryOf(a.path), directoryOf(b.path)) ||
      compareText(fileNameOf(a.path), fileNameOf(b.path)),
  );
  const groups: ChangedFileGroup[] = [];
  for (const file of sorted) {
    const directory = directoryOf(file.path);
    const last = groups.at(-1);
    if (last?.directory === directory) {
      last.files.push(file);
    } else {
      groups.push({ directory, files: [file] });
    }
  }
  return groups;
}
