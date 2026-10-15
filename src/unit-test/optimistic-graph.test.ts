/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert";
import { abandonEntries, moveChangedFiles, rebaseEntries, type ChangeFiles } from "../optimistic-graph";
import type { ChangedFile } from "../graph-protocol";
import type { LogEntry } from "../types";

function createEntry(changeId: string, parentIds: string[] = [], extra: Partial<LogEntry> = {}): LogEntry {
  return {
    change_id: changeId,
    change_id_shortest: changeId.slice(0, 4),
    commit_id: changeId,
    commit_id_short: changeId.slice(0, 8),
    immutable: false,
    mine: false,
    empty: false,
    current_working_copy: false,
    root: false,
    conflict: false,
    divergent: false,
    hidden: false,
    change_offset: "",
    description: `Commit ${changeId}`,
    author: { name: "Test", email: "test@test.com", timestamp: "2024-01-01" },
    committer: { name: "Test", email: "test@test.com", timestamp: "2024-01-01" },
    parents: parentIds.map((id) => ({ change_id: id, divergent: false, change_offset: "" })),
    local_bookmarks: [],
    remote_bookmarks: [],
    local_tags: [],
    remote_tags: [],
    working_copies: [],
    ...extra,
  };
}

function describeGraph(entries: LogEntry[] | undefined): string[] | undefined {
  return entries?.map((e) => `${e.change_id}:${e.parents.map((p) => p.change_id).join(",")}`);
}

// z <- a <- b <- c
//        \
//         d
function sampleGraph(): LogEntry[] {
  return [
    createEntry("c", ["b"]),
    createEntry("b", ["a"]),
    createEntry("d", ["a"]),
    createEntry("a", ["z"]),
    createEntry("z", [], { immutable: true, root: true }),
  ];
}

describe("abandonEntries", () => {
  it("reparents children onto the abandoned change's parents", () => {
    assert.deepStrictEqual(describeGraph(abandonEntries(sampleGraph(), ["b"])), ["c:a", "d:a", "a:z", "z:"]);
  });

  it("bypasses chains of abandoned changes and dedupes merge parents", () => {
    const entries = [
      createEntry("m", ["b", "d"]),
      createEntry("b", ["a"]),
      createEntry("d", ["a"]),
      createEntry("a", ["z"]),
      createEntry("z"),
    ];
    assert.deepStrictEqual(describeGraph(abandonEntries(entries, ["b", "d"])), ["m:a", "a:z", "z:"]);
  });

  it("keeps unaffected entries identical", () => {
    const entries = sampleGraph();
    const result = abandonEntries(entries, ["c"])!;
    assert.strictEqual(result[0], entries[1]);
  });

  it("refuses unknown, immutable and working-copy changes", () => {
    assert.strictEqual(abandonEntries(sampleGraph(), ["x"]), undefined);
    assert.strictEqual(abandonEntries(sampleGraph(), ["z"]), undefined);
    const entries = sampleGraph();
    entries[0] = createEntry("c", ["b"], { current_working_copy: true, working_copies: ["default"] });
    assert.strictEqual(abandonEntries(entries, ["c"]), undefined);
  });
});

describe("rebaseEntries", () => {
  it("rebases a single revision onto a target and leaves its children behind", () => {
    assert.deepStrictEqual(describeGraph(rebaseEntries(sampleGraph(), ["b"], "d", "onto", false)), [
      "c:a",
      "b:d",
      "d:a",
      "a:z",
      "z:",
    ]);
  });

  it("rebases a change with its descendants", () => {
    assert.deepStrictEqual(describeGraph(rebaseEntries(sampleGraph(), ["b"], "d", "onto", true)), [
      "c:b",
      "b:d",
      "d:a",
      "a:z",
      "z:",
    ]);
  });

  it("inserts a revision after a target", () => {
    assert.deepStrictEqual(describeGraph(rebaseEntries(sampleGraph(), ["d"], "a", "after", false)), [
      "c:b",
      "b:d",
      "d:a",
      "a:z",
      "z:",
    ]);
  });

  it("inserts a revision before a target", () => {
    assert.deepStrictEqual(describeGraph(rebaseEntries(sampleGraph(), ["d"], "b", "before", false)), [
      "c:b",
      "b:d",
      "d:a",
      "a:z",
      "z:",
    ]);
  });

  it("preserves the structure between multiple rebased revisions", () => {
    assert.deepStrictEqual(describeGraph(rebaseEntries(sampleGraph(), ["c", "b"], "d", "onto", false)), [
      "c:b",
      "b:d",
      "d:a",
      "a:z",
      "z:",
    ]);
  });

  it("moves a revision below its own descendant", () => {
    assert.deepStrictEqual(describeGraph(rebaseEntries(sampleGraph(), ["b"], "c", "before", false)), [
      "c:b",
      "b:a",
      "d:a",
      "a:z",
      "z:",
    ]);
    assert.deepStrictEqual(describeGraph(rebaseEntries(sampleGraph(), ["a"], "c", "onto", false)), [
      "a:c",
      "c:b",
      "b:z",
      "d:z",
      "z:",
    ]);
  });

  it("refuses rebases it cannot predict", () => {
    assert.strictEqual(rebaseEntries(sampleGraph(), ["x"], "d", "onto", false), undefined);
    assert.strictEqual(rebaseEntries(sampleGraph(), ["b"], "x", "onto", false), undefined);
    assert.strictEqual(rebaseEntries(sampleGraph(), ["b"], "c", "onto", true), undefined);
    assert.strictEqual(rebaseEntries(sampleGraph(), ["a"], "z", "before", false), undefined);
  });
});

function file(path: string, type: ChangedFile["type"], extra: Partial<ChangedFile> = {}): ChangedFile {
  return { path, type, conflict: false, ...extra };
}

function changeFiles(files: ChangedFile[], counts: Record<string, [number, number]> = {}): ChangeFiles {
  return {
    files,
    lineCounts: new Map(Object.entries(counts).map(([p, [added, removed]]) => [p, { added, removed }])),
  };
}

function describeFiles(files: ChangeFiles): string[] {
  return files.files.map((f) => {
    const counts = files.lineCounts.get(f.path);
    return `${f.type} ${f.path}${counts ? ` +${counts.added}-${counts.removed}` : ""}`;
  });
}

describe("moveChangedFiles", () => {
  it("moves a file into a change that does not touch it", () => {
    const result = moveChangedFiles(
      changeFiles([file("a.txt", "M"), file("b.txt", "A")], { "a.txt": [1, 2], "b.txt": [3, 0] }),
      changeFiles([file("c.txt", "M")], { "c.txt": [4, 4] }),
      ["b.txt"],
    )!;
    assert.deepStrictEqual(describeFiles(result.source), ["M a.txt +1-2"]);
    assert.deepStrictEqual(describeFiles(result.destination), ["A b.txt +3-0", "M c.txt +4-4"]);
  });

  it("moves every file under a directory path", () => {
    const result = moveChangedFiles(
      changeFiles([file("src/a.ts", "M"), file("src/b.ts", "M"), file("srcx.ts", "M")]),
      changeFiles([]),
      ["src"],
    )!;
    assert.deepStrictEqual(describeFiles(result.source), ["M srcx.ts"]);
    assert.deepStrictEqual(describeFiles(result.destination), ["M src/a.ts", "M src/b.ts"]);
  });

  it("combines statuses of files both changes touch and drops their unknown line counts", () => {
    const result = moveChangedFiles(
      changeFiles([file("added.txt", "M"), file("deleted.txt", "D"), file("readded.txt", "A"), file("keep.txt", "M")], {
        "added.txt": [1, 1],
      }),
      changeFiles([file("added.txt", "A"), file("deleted.txt", "A"), file("readded.txt", "D")], {
        "added.txt": [5, 0],
      }),
      ["added.txt", "deleted.txt", "readded.txt"],
    )!;
    assert.deepStrictEqual(describeFiles(result.destination), ["A added.txt", "M readded.txt"]);
  });

  it("refuses moves it cannot predict", () => {
    const source = changeFiles([file("a.txt", "M"), file("b.txt", "M")]);
    assert.strictEqual(moveChangedFiles(source, changeFiles([]), ["missing.txt"]), undefined);
    assert.strictEqual(moveChangedFiles(source, changeFiles([]), ["a.txt", "b.txt"]), undefined);
    const renamed = changeFiles([file("new.txt", "R", { renamedFrom: "old.txt" }), file("b.txt", "M")]);
    assert.strictEqual(moveChangedFiles(renamed, changeFiles([]), ["new.txt"]), undefined);
  });
});
