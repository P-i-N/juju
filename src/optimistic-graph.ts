import { getParentUniqueId, getUniqueEntryId } from "./elided-edges";
import type { ChangedFile } from "./graph-protocol";
import type { LogEntry, ParentRef } from "./types";

export type LineCounts = Map<string, { added: number; removed: number }>;

export interface ChangeFiles {
  files: ChangedFile[];
  lineCounts: LineCounts;
}

function isUnder(filePath: string, paths: string[]): boolean {
  return paths.some((p) => filePath === p || filePath.startsWith(`${p}/`));
}

/**
 * Predicts the changed files of both changes after `jj squash --from <source> --into <destination> <paths>`.
 * Returns undefined when the outcome cannot be predicted: nothing or a rename/copy would move, or the source
 * would become empty (jj then abandons it and may ask how to combine the descriptions).
 */
export function moveChangedFiles(
  source: ChangeFiles,
  destination: ChangeFiles,
  paths: string[],
): { source: ChangeFiles; destination: ChangeFiles } | undefined {
  const moved = source.files.filter((f) => isUnder(f.path, paths));
  const remaining = source.files.filter((f) => !isUnder(f.path, paths));
  if (moved.length === 0 || remaining.length === 0 || moved.some((f) => f.type === "R" || f.type === "C")) {
    return undefined;
  }
  if (destination.files.some((f) => (f.type === "R" || f.type === "C") && moved.some((m) => m.path === f.path))) {
    return undefined;
  }

  const sourceCounts = new Map([...source.lineCounts].filter(([p]) => !isUnder(p, paths)));
  const destinationFiles = new Map(destination.files.map((f) => [f.path, f]));
  const destinationCounts = new Map(destination.lineCounts);
  for (const file of moved) {
    const existing = destinationFiles.get(file.path);
    if (!existing) {
      destinationFiles.set(file.path, file);
      const counts = source.lineCounts.get(file.path);
      if (counts) {
        destinationCounts.set(file.path, counts);
      }
      continue;
    }
    // Both changes touch the file: the combined line counts are unknown until jj reports them.
    destinationCounts.delete(file.path);
    const conflict = existing.conflict || file.conflict;
    if (file.type === "D") {
      if (existing.type === "A") {
        destinationFiles.delete(file.path);
      } else {
        destinationFiles.set(file.path, { ...existing, type: "D", conflict });
      }
    } else {
      destinationFiles.set(file.path, { ...existing, type: existing.type === "D" ? "M" : existing.type, conflict });
    }
  }

  return {
    source: { files: remaining, lineCounts: sourceCounts },
    destination: {
      files: [...destinationFiles.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
      lineCounts: destinationCounts,
    },
  };
}

export type OptimisticTransform = (entries: LogEntry[]) => LogEntry[] | undefined;

export type RebaseMode = "onto" | "after" | "before";

function parentRefOf(entry: LogEntry): ParentRef {
  return { change_id: entry.change_id, divergent: entry.divergent, change_offset: entry.change_offset };
}

function dedupeParents(parents: ParentRef[]): ParentRef[] {
  const seen = new Set<string>();
  return parents.filter((p) => {
    const id = getParentUniqueId(p);
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

function sameParents(a: ParentRef[], b: ParentRef[]): boolean {
  return a.length === b.length && a.every((p, i) => getParentUniqueId(p) === getParentUniqueId(b[i]));
}

/**
 * Replaces parents that are in `removed` with their own parents, transitively, the way jj
 * reparents the children of commits that are abandoned or moved away with `rebase -r`.
 */
function bypassParents(parents: ParentRef[], removed: Set<string>, byId: Map<string, LogEntry>): ParentRef[] {
  return dedupeParents(
    parents.flatMap((p) => {
      const id = getParentUniqueId(p);
      const entry = byId.get(id);
      return removed.has(id) && entry ? bypassParents(entry.parents, removed, byId) : [p];
    }),
  );
}

/**
 * Orders entries children-before-parents like `jj log`, preferring the given sort keys
 * (lower first) whenever several entries are ready.
 */
function topologicalSort(entries: LogEntry[], keys: Map<string, number>): LogEntry[] | undefined {
  const ids = new Set(entries.map(getUniqueEntryId));
  const pendingChildren = new Map<string, number>(entries.map((e) => [getUniqueEntryId(e), 0]));
  for (const entry of entries) {
    for (const parentId of new Set(entry.parents.map(getParentUniqueId))) {
      if (ids.has(parentId)) {
        pendingChildren.set(parentId, (pendingChildren.get(parentId) ?? 0) + 1);
      }
    }
  }
  const ready = entries.filter((e) => pendingChildren.get(getUniqueEntryId(e)) === 0);
  const result: LogEntry[] = [];
  while (ready.length > 0) {
    let best = 0;
    for (let i = 1; i < ready.length; i++) {
      if (keys.get(getUniqueEntryId(ready[i]))! < keys.get(getUniqueEntryId(ready[best]))!) {
        best = i;
      }
    }
    const [entry] = ready.splice(best, 1);
    result.push(entry);
    for (const parentId of new Set(entry.parents.map(getParentUniqueId))) {
      const remaining = pendingChildren.get(parentId);
      if (remaining === undefined) {
        continue;
      }
      pendingChildren.set(parentId, remaining - 1);
      if (remaining === 1) {
        ready.push(entries.find((e) => getUniqueEntryId(e) === parentId)!);
      }
    }
  }
  return result.length === entries.length ? result : undefined;
}

function hasImmutableRewrite(before: LogEntry[], after: LogEntry[]): boolean {
  const beforeById = new Map(before.map((e) => [getUniqueEntryId(e), e]));
  return after.some((e) => {
    const old = beforeById.get(getUniqueEntryId(e));
    return e.immutable && old !== undefined && !sameParents(old.parents, e.parents);
  });
}

/**
 * Predicts the graph after `jj abandon`. Returns undefined when the outcome cannot be predicted
 * (unknown or immutable changes, or abandoning a working-copy commit, which makes jj create a new one).
 */
export function abandonEntries(entries: LogEntry[], ids: string[]): LogEntry[] | undefined {
  const byId = new Map(entries.map((e) => [getUniqueEntryId(e), e]));
  const abandoned = new Set(ids);
  for (const id of abandoned) {
    const entry = byId.get(id);
    if (!entry || entry.immutable || entry.working_copies.length > 0 || entry.current_working_copy) {
      return undefined;
    }
  }
  const result = entries
    .filter((e) => !abandoned.has(getUniqueEntryId(e)))
    .map((e) => {
      const parents = bypassParents(e.parents, abandoned, byId);
      return sameParents(parents, e.parents) ? e : { ...e, parents };
    });
  return hasImmutableRewrite(entries, result) ? undefined : result;
}

/**
 * Predicts the graph after `jj rebase -r/-s <sources> -o/-A/-B <target>`. Returns undefined
 * when the outcome cannot be predicted (unknown or immutable changes, or a rebase jj would reject).
 */
export function rebaseEntries(
  entries: LogEntry[],
  sources: string[],
  target: string,
  mode: RebaseMode,
  withDescendants: boolean,
): LogEntry[] | undefined {
  const byId = new Map(entries.map((e) => [getUniqueEntryId(e), e]));
  const targetEntry = byId.get(target);
  if (!targetEntry || sources.length === 0 || sources.some((id) => !byId.has(id))) {
    return undefined;
  }

  const moved = new Set(sources);
  if (withDescendants) {
    // Entries are ordered children before parents, so one reverse pass finds all descendants.
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry.parents.some((p) => moved.has(getParentUniqueId(p)))) {
        moved.add(getUniqueEntryId(entry));
      }
    }
  }
  if (moved.has(target)) {
    return undefined;
  }

  const newParents = new Map<string, ParentRef[]>(entries.map((e) => [getUniqueEntryId(e), e.parents]));

  // `-r` leaves the children of moved commits behind, attached to the moved commits' parents.
  for (const entry of entries) {
    const id = getUniqueEntryId(entry);
    if (!moved.has(id)) {
      newParents.set(id, bypassParents(entry.parents, moved, byId));
    }
  }

  const destinationParents = mode === "before" ? newParents.get(target)! : [parentRefOf(targetEntry)];
  const nearestMovedAncestors = (parents: ParentRef[], seen: Set<string>): ParentRef[] =>
    parents.flatMap((p) => {
      const id = getParentUniqueId(p);
      if (moved.has(id)) {
        return [p];
      }
      const entry = byId.get(id);
      if (!entry || seen.has(id)) {
        return [];
      }
      seen.add(id);
      return nearestMovedAncestors(entry.parents, seen);
    });
  for (const id of moved) {
    const entry = byId.get(id)!;
    if (withDescendants) {
      if (!entry.parents.some((p) => moved.has(getParentUniqueId(p)))) {
        newParents.set(id, destinationParents);
      }
    } else {
      const kept = dedupeParents(nearestMovedAncestors(entry.parents, new Set()));
      newParents.set(id, kept.length > 0 ? kept : destinationParents);
    }
  }

  if (mode !== "onto") {
    const hasMovedChild = new Set(
      [...moved].flatMap((id) => newParents.get(id)!.map(getParentUniqueId)).filter((id) => moved.has(id)),
    );
    const heads = [...moved].filter((id) => !hasMovedChild.has(id)).map((id) => parentRefOf(byId.get(id)!));
    if (mode === "after") {
      for (const [id, parents] of newParents) {
        if (!moved.has(id) && parents.some((p) => getParentUniqueId(p) === target)) {
          newParents.set(id, dedupeParents(parents.flatMap((p) => (getParentUniqueId(p) === target ? heads : [p]))));
        }
      }
    } else {
      newParents.set(target, heads);
    }
  }

  const rewritten = entries.map((e) => {
    const parents = newParents.get(getUniqueEntryId(e))!;
    return sameParents(parents, e.parents) ? e : { ...e, parents };
  });
  if (hasImmutableRewrite(entries, rewritten)) {
    return undefined;
  }

  const targetIndex = entries.findIndex((e) => getUniqueEntryId(e) === target);
  const movedOffset = mode === "before" ? 0.5 : -0.5;
  const keys = new Map(
    entries.map((e, i) => {
      const id = getUniqueEntryId(e);
      return [id, moved.has(id) ? targetIndex + movedOffset + i / (entries.length * 4) : i];
    }),
  );
  return topologicalSort(rewritten, keys);
}
