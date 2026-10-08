import type { FullChangeId } from "../../graph-protocol";

/** Selected changed files, which always belong to a single change. */
export interface FileSelection {
  changeId: FullChangeId;
  paths: ReadonlySet<string>;
  anchor: string;
}

/**
 * The file selection after clicking a changed file, with the usual list
 * semantics: a plain click selects only the file, Ctrl/Cmd toggles it, Shift
 * selects the range from the anchor (added to the selection with Ctrl/Cmd).
 * Files of another change start a new selection instead of joining it.
 */
export function computeFileSelection(
  current: FileSelection | null,
  changeId: FullChangeId,
  orderedPaths: readonly string[],
  clickedPath: string,
  keys: { shiftKey: boolean; toggleKey: boolean },
): FileSelection | null {
  const single: FileSelection = { changeId, paths: new Set([clickedPath]), anchor: clickedPath };
  if (!current || current.changeId !== changeId || (!keys.shiftKey && !keys.toggleKey)) {
    return single;
  }

  if (keys.shiftKey) {
    const from = orderedPaths.indexOf(current.anchor);
    const to = orderedPaths.indexOf(clickedPath);
    if (from === -1 || to === -1) {
      return single;
    }
    const range = orderedPaths.slice(Math.min(from, to), Math.max(from, to) + 1);
    const paths = keys.toggleKey ? new Set([...current.paths, ...range]) : new Set(range);
    return { changeId, paths, anchor: current.anchor };
  }

  const paths = new Set(current.paths);
  if (paths.has(clickedPath)) {
    paths.delete(clickedPath);
  } else {
    paths.add(clickedPath);
  }
  return paths.size === 0 ? null : { changeId, paths, anchor: clickedPath };
}

/** The files a drag carries: the selection when the dragged file is part of it, otherwise just that file. */
export function draggedFilePaths(
  current: FileSelection | null,
  changeId: FullChangeId,
  orderedPaths: readonly string[],
  draggedPath: string,
): string[] {
  if (current?.changeId !== changeId || !current.paths.has(draggedPath)) {
    return [draggedPath];
  }
  return orderedPaths.filter((path) => current.paths.has(path));
}

/**
 * The file selection after clicking a directory header: a plain click selects
 * just the directory's files, Ctrl/Cmd adds them to the selection of the same
 * change, or removes them when they are all selected already.
 */
export function selectFileGroup(
  current: FileSelection | null,
  changeId: FullChangeId,
  groupPaths: readonly string[],
  toggleKey: boolean,
): FileSelection | null {
  const [first] = groupPaths;
  if (first === undefined) {
    return current;
  }
  if (!toggleKey || current?.changeId !== changeId) {
    return { changeId, paths: new Set(groupPaths), anchor: first };
  }
  const paths = new Set(current.paths);
  if (groupPaths.every((path) => paths.has(path))) {
    groupPaths.forEach((path) => paths.delete(path));
    return paths.size === 0 ? null : { changeId, paths, anchor: current.anchor };
  }
  groupPaths.forEach((path) => paths.add(path));
  return { changeId, paths, anchor: first };
}
