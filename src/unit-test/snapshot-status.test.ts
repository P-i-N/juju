/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { currentWorkspaceFromEntries, hasMissingParents, statusFromSnapshot } from "../snapshot-status";
import type { DiffFileEntry, FileStatus, LogEntry, RealPath } from "../types";

const repoRoot = (process.platform === "win32" ? "C:\\repo" : "/repo") as RealPath;

function entry(partial: Partial<LogEntry> & Pick<LogEntry, "change_id">): LogEntry {
  return {
    change_id_shortest: partial.change_id.slice(0, 4),
    commit_id: `${partial.change_id}-commit`,
    commit_id_short: partial.change_id.slice(0, 7),
    immutable: false,
    mine: true,
    empty: false,
    current_working_copy: false,
    root: false,
    conflict: false,
    divergent: false,
    hidden: false,
    change_offset: "",
    description: "",
    author: { name: "A", email: "a@example.com", timestamp: "2026-10-07 10:00:00" },
    committer: { name: "A", email: "a@example.com", timestamp: "2026-10-07 10:00:00" },
    parents: [],
    local_bookmarks: [],
    remote_bookmarks: [],
    local_tags: [],
    remote_tags: [],
    working_copies: [],
    diff_files: null,
    conflicted_files: null,
    tracked_files: null,
    ...partial,
  };
}

function modified(file: string): DiffFileEntry {
  return { status_char: "M", source_path: file, target_path: file, is_conflict: false };
}

function parentRef(changeId: string) {
  return { change_id: changeId, divergent: false, change_offset: "" };
}

describe("statusFromSnapshot Test Suite", () => {
  it("builds the working copy, its parent, and their file statuses", () => {
    const entries = [
      entry({
        change_id: "wwwwwwww",
        current_working_copy: true,
        description: "wip",
        parents: [parentRef("pppppppp")],
        diff_files: [modified("a.txt")],
        conflicted_files: [],
        tracked_files: ["a.txt", path.join("src", "b.ts")],
      }),
      entry({
        change_id: "pppppppp",
        description: "parent",
        local_bookmarks: [{ name: "main", synced: true, conflict: false }],
        diff_files: [modified("c.txt")],
        conflicted_files: [],
      }),
      entry({ change_id: "zzzzzzzz" }),
    ];
    const untracked: FileStatus[] = [{ type: "?", file: "big.bin", path: path.join(repoRoot, "big.bin") as RealPath }];

    const { status, parentFiles, trackedFiles } = statusFromSnapshot(entries, repoRoot, untracked);

    assert.strictEqual(status.workingCopy.changeId.changeId, "wwwwwwww");
    assert.strictEqual(status.workingCopy.description, "wip");
    assert.deepStrictEqual(
      status.fileStatuses.map((f) => f.file),
      ["a.txt"],
    );
    assert.strictEqual(status.untrackedFiles, untracked);
    assert.strictEqual(status.parentChanges.length, 1);
    assert.strictEqual(status.parentChanges[0].changeId.changeId, "pppppppp");
    assert.deepStrictEqual(status.parentChanges[0].bookmarks, ["main"]);
    assert.deepStrictEqual(
      parentFiles.get("pppppppp")?.fileStatuses.map((f) => f.file),
      ["c.txt"],
    );
    assert.deepStrictEqual(trackedFiles, ["a.txt", path.join("src", "b.ts")]);
  });

  it("keeps jj's parent order for merges", () => {
    const entries = [
      entry({
        change_id: "wwwwwwww",
        current_working_copy: true,
        parents: [parentRef("bbbbbbbb"), parentRef("aaaaaaaa")],
        diff_files: [],
        conflicted_files: [],
        tracked_files: [],
      }),
      entry({ change_id: "aaaaaaaa", diff_files: [], conflicted_files: [] }),
      entry({ change_id: "bbbbbbbb", diff_files: [], conflicted_files: [] }),
    ];
    const { status } = statusFromSnapshot(entries, repoRoot, []);
    assert.deepStrictEqual(
      status.parentChanges.map((p) => p.changeId.changeId),
      ["bbbbbbbb", "aaaaaaaa"],
    );
  });

  it("reports conflicted files of the working copy", () => {
    const entries = [
      entry({
        change_id: "wwwwwwww",
        current_working_copy: true,
        conflict: true,
        diff_files: [],
        conflicted_files: ["x.txt"],
        tracked_files: ["x.txt"],
      }),
    ];
    const { status } = statusFromSnapshot(entries, repoRoot, []);
    assert.strictEqual(status.workingCopy.isConflict, true);
    assert.strictEqual(status.conflictedFiles.size, 1);
    assert.deepStrictEqual(
      status.fileStatuses.map((f) => [f.type, f.file]),
      [["X", "x.txt"]],
    );
  });

  it("matches divergent parents by change offset", () => {
    const entries = [
      entry({
        change_id: "wwwwwwww",
        current_working_copy: true,
        parents: [{ change_id: "dddddddd", divergent: true, change_offset: "1" }],
        diff_files: [],
        conflicted_files: [],
        tracked_files: [],
      }),
      entry({ change_id: "dddddddd", divergent: true, change_offset: "0", description: "other" }),
      entry({ change_id: "dddddddd", divergent: true, change_offset: "1", description: "mine", diff_files: [] }),
    ];
    const { status } = statusFromSnapshot(entries, repoRoot, []);
    assert.strictEqual(status.parentChanges[0].description, "mine");
    assert.strictEqual(status.parentChanges[0].changeId.changeId, "dddddddd/1");
  });

  it("throws when the working copy is missing", () => {
    assert.throws(() => statusFromSnapshot([entry({ change_id: "zzzzzzzz" })], repoRoot, []), /working copy/);
  });

  it("throws when a parent of the working copy is missing", () => {
    const entries = [entry({ change_id: "wwwwwwww", current_working_copy: true, parents: [parentRef("pppppppp")] })];
    assert.throws(() => statusFromSnapshot(entries, repoRoot, []), /parent/);
  });
});

describe("hasMissingParents Test Suite", () => {
  it("is false when all parents of the working copy are present", () => {
    const entries = [
      entry({ change_id: "wwwwwwww", current_working_copy: true, parents: [parentRef("pppppppp")] }),
      entry({ change_id: "pppppppp" }),
    ];
    assert.strictEqual(hasMissingParents(entries), false);
  });

  it("is true when a parent of the working copy is absent", () => {
    const entries = [entry({ change_id: "wwwwwwww", current_working_copy: true, parents: [parentRef("pppppppp")] })];
    assert.strictEqual(hasMissingParents(entries), true);
  });

  it("is false without a working copy entry", () => {
    assert.strictEqual(hasMissingParents([entry({ change_id: "zzzzzzzz" })]), false);
  });
});

describe("currentWorkspaceFromEntries Test Suite", () => {
  it("needs no lookup when no change has workspace names (single workspace)", () => {
    const entries = [entry({ change_id: "wwwwwwww", current_working_copy: true })];
    assert.deepStrictEqual(currentWorkspaceFromEntries(entries), { name: undefined, lookupNeeded: false });
  });

  it("uses the working copy's only workspace name", () => {
    const entries = [
      entry({ change_id: "wwwwwwww", current_working_copy: true, working_copies: ["default"] }),
      entry({ change_id: "oooooooo", working_copies: ["other"] }),
    ];
    assert.deepStrictEqual(currentWorkspaceFromEntries(entries), { name: "default", lookupNeeded: false });
  });

  it("needs a lookup when several workspaces share the working copy", () => {
    const entries = [entry({ change_id: "wwwwwwww", current_working_copy: true, working_copies: ["a", "b"] })];
    assert.deepStrictEqual(currentWorkspaceFromEntries(entries), { name: undefined, lookupNeeded: true });
  });
});
