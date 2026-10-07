import path from "path";
import { parseFileStatuses } from "./parse-file-statuses";
import { changeIdFromLogEntry, fullChangeId, maxChangeIdPrefixLength } from "./utils";
import type { Change, FileStatus, LogEntry, NormalizedPath, RealPath, RepositoryStatus } from "./types";

export type ChangeFiles = { fileStatuses: FileStatus[]; conflictedFiles: Set<NormalizedPath> };

export type SnapshotStatus = {
  status: RepositoryStatus;
  parentFiles: Map<string, ChangeFiles>;
  trackedFiles: string[];
};

function entryKey(entry: { change_id: string; change_offset: string }): string {
  return fullChangeId(entry.change_id, entry.change_offset);
}

function findWorkingCopy(entries: LogEntry[]): LogEntry | undefined {
  return entries.find((e) => e.current_working_copy);
}

export function needsWorkingCopyFallback(entries: LogEntry[]): boolean {
  const workingCopy = findWorkingCopy(entries);
  if (!workingCopy) {
    return true;
  }
  const keys = new Set(entries.map(entryKey));
  return workingCopy.parents.some((p) => !keys.has(entryKey(p)));
}

export function statusFromSnapshot(
  entries: LogEntry[],
  repositoryRoot: RealPath,
  untrackedFiles: FileStatus[],
): SnapshotStatus {
  const workingCopyEntry = findWorkingCopy(entries);
  if (!workingCopyEntry) {
    throw new Error("The repository snapshot does not contain the working copy.");
  }
  const entriesByKey = new Map<string, LogEntry>();
  for (const e of entries) {
    const key = entryKey(e);
    if (!entriesByKey.has(key)) {
      entriesByKey.set(key, e);
    }
  }
  const parentEntries = workingCopyEntry.parents.map((p) => {
    const parentEntry = entriesByKey.get(entryKey(p));
    if (!parentEntry) {
      throw new Error(`The repository snapshot does not contain the parent ${entryKey(p)} of the working copy.`);
    }
    return parentEntry;
  });

  const maxPrefixLength = maxChangeIdPrefixLength([
    workingCopyEntry.change_id_shortest,
    ...parentEntries.map((p) => p.change_id_shortest),
  ]);
  const toChange = (e: LogEntry): Change => ({
    changeId: changeIdFromLogEntry(e, maxPrefixLength),
    commitId: e.commit_id,
    description: e.description,
    isEmpty: e.empty,
    isConflict: e.conflict,
    bookmarks: e.local_bookmarks.map((b) => b.name),
    divergent: e.divergent,
  });
  const filesOf = (e: LogEntry): ChangeFiles => {
    const { fileStatuses, conflictedFiles } = parseFileStatuses(
      e.diff_files ?? [],
      e.conflicted_files ?? [],
      repositoryRoot,
    );
    return { fileStatuses, conflictedFiles };
  };

  const workingCopyFiles = filesOf(workingCopyEntry);
  const parentChanges = parentEntries.map(toChange);
  const parentFiles = new Map<string, ChangeFiles>();
  parentEntries.forEach((parentEntry, i) => parentFiles.set(parentChanges[i].changeId.changeId, filesOf(parentEntry)));

  return {
    status: {
      workingCopy: toChange(workingCopyEntry),
      parentChanges,
      fileStatuses: workingCopyFiles.fileStatuses,
      conflictedFiles: workingCopyFiles.conflictedFiles,
      untrackedFiles,
    },
    parentFiles,
    trackedFiles: (workingCopyEntry.tracked_files ?? []).map((p) => path.normalize(p)),
  };
}

export function currentWorkspaceFromEntries(entries: LogEntry[]): { name: string | undefined; lookupNeeded: boolean } {
  if (!entries.some((e) => e.working_copies.length > 0)) {
    return { name: undefined, lookupNeeded: false };
  }
  const workingCopies = findWorkingCopy(entries)?.working_copies ?? [];
  if (workingCopies.length === 1) {
    return { name: workingCopies[0], lookupNeeded: false };
  }
  return { name: undefined, lookupNeeded: true };
}
