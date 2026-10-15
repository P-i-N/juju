/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert";
import { abandonEntries, rebaseEntries } from "../optimistic-graph";
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
