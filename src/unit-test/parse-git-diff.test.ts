/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseGitDiffHunks, parseGitDiffLineCounts } from "../parse-git-diff";

describe("parseGitDiffLineCounts Test Suite", () => {
  it("counts added and removed lines per file", () => {
    const output = [
      "diff --git a/a.txt b/a.txt",
      "index 1..2 100644",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1,3 +1,4 @@",
      " context",
      "-removed",
      "+added",
      "+added 2",
      "diff --git a/b.txt b/b.txt",
      "--- a/b.txt",
      "+++ b/b.txt",
      "@@ -2,1 +2,1 @@",
      "-old",
      "+new",
    ].join("\n");
    const counts = parseGitDiffLineCounts(output);
    assert.deepEqual(counts.get("a.txt"), { added: 2, removed: 1, binary: false });
    assert.deepEqual(counts.get("b.txt"), { added: 1, removed: 1, binary: false });
    assert.equal(counts.size, 2);
  });

  it("keys added files by their +++ path", () => {
    const output = [
      "diff --git a/dir/new.txt b/dir/new.txt",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/dir/new.txt",
      "@@ -0,0 +1,2 @@",
      "+one",
      "+two",
    ].join("\n");
    const counts = parseGitDiffLineCounts(output);
    assert.deepEqual(counts.get("dir/new.txt"), { added: 2, removed: 0, binary: false });
  });

  it("keys deleted files by their --- path", () => {
    const output = [
      "diff --git a/gone.txt b/gone.txt",
      "deleted file mode 100644",
      "--- a/gone.txt",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-one",
      "-two",
    ].join("\n");
    const counts = parseGitDiffLineCounts(output);
    assert.deepEqual(counts.get("gone.txt"), { added: 0, removed: 2, binary: false });
  });

  it("keys renamed files by the rename-to path and counts their content changes", () => {
    const output = [
      "diff --git a/old.txt b/dir/new.txt",
      "similarity index 90%",
      "rename from old.txt",
      "rename to dir/new.txt",
      "--- a/old.txt",
      "+++ b/dir/new.txt",
      "@@ -1,2 +1,3 @@",
      " keep",
      "+added",
      " context",
    ].join("\n");
    const counts = parseGitDiffLineCounts(output);
    assert.deepEqual(counts.get("dir/new.txt"), { added: 1, removed: 0, binary: false });
    assert.equal(counts.has("old.txt"), false);
  });

  it("counts pure renames as zero-line changes", () => {
    const output = [
      "diff --git a/old.txt b/dir/new.txt",
      "similarity index 100%",
      "rename from old.txt",
      "rename to dir/new.txt",
    ].join("\n");
    const counts = parseGitDiffLineCounts(output);
    assert.deepEqual(counts.get("dir/new.txt"), { added: 0, removed: 0, binary: false });
  });

  it("flags binary files instead of counting lines", () => {
    const output = [
      "diff --git a/data.bin b/data.bin",
      "index 1..2 100644",
      "Binary files a/data.bin and b/data.bin differ",
    ].join("\n");
    const counts = parseGitDiffLineCounts(output);
    assert.deepEqual(counts.get("data.bin"), { added: 0, removed: 0, binary: true });
  });

  it("flags binary additions with a /dev/null left side", () => {
    const output = [
      "diff --git a/data.bin b/data.bin",
      "new file mode 100644",
      "Binary files /dev/null and b/data.bin differ",
    ].join("\n");
    const counts = parseGitDiffLineCounts(output);
    assert.deepEqual(counts.get("data.bin"), { added: 0, removed: 0, binary: true });
  });

  it("handles mode-only changes with no ---/+++ lines", () => {
    const output = ["diff --git a/script.sh b/script.sh", "old mode 100644", "new mode 100755"].join("\n");
    const counts = parseGitDiffLineCounts(output);
    // The path falls back to the header's b-side; a mode change carries no line counts.
    assert.deepEqual(counts.get("script.sh"), { added: 0, removed: 0, binary: false });
  });

  it("ignores the no-newline marker", () => {
    const output = [
      "diff --git a/a.txt b/a.txt",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1,1 +1,1 @@",
      "-old",
      "\\ No newline at end of file",
      "+new",
    ].join("\n");
    const counts = parseGitDiffLineCounts(output);
    assert.deepEqual(counts.get("a.txt"), { added: 1, removed: 1, binary: false });
  });

  it("returns an empty map for empty output", () => {
    assert.equal(parseGitDiffLineCounts("").size, 0);
  });
});

describe("parseGitDiffHunks Test Suite", () => {
  it("parses zero-context hunks with ranges, counts and previews", () => {
    const output = [
      "diff --git a/a.txt b/a.txt",
      "index 1..2 100644",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -3,2 +3,3 @@",
      "-old one",
      "-old two",
      "+  new one  ",
      "+new two",
      "+new three",
      "@@ -10 +10,0 @@",
      "-gone",
      "@@ -20,0 +20 @@",
      "+inserted",
    ].join("\n");
    assert.deepEqual(parseGitDiffHunks(output).get("a.txt"), [
      { oldStart: 3, oldLines: 2, newStart: 3, newLines: 3, added: 3, removed: 2, preview: "new one" },
      { oldStart: 10, oldLines: 1, newStart: 10, newLines: 0, added: 0, removed: 1, preview: "gone" },
      { oldStart: 20, oldLines: 0, newStart: 20, newLines: 1, added: 1, removed: 0, preview: "inserted" },
    ]);
  });

  it("treats lines inside a hunk as content even when they look like headers", () => {
    const output = [
      "diff --git a/a.txt b/a.txt",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1,2 +1,2 @@",
      "--- a/looks-like-a-header",
      "+++ b/looks-like-a-header",
      "-plain",
      "+plain changed",
    ].join("\n");
    const hunks = parseGitDiffHunks(output).get("a.txt");
    assert.equal(hunks?.length, 1);
    assert.equal(hunks?.[0].added, 2);
    assert.equal(hunks?.[0].removed, 2);
    assert.deepEqual(parseGitDiffLineCounts(output).get("a.txt"), { added: 2, removed: 2, binary: false });
  });

  it("keys renamed files by their new path and gives binary files no hunks", () => {
    const output = [
      "diff --git a/old.txt b/new.txt",
      "rename from old.txt",
      "rename to new.txt",
      "--- a/old.txt",
      "+++ b/new.txt",
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "diff --git a/img.png b/img.png",
      "Binary files a/img.png and b/img.png differ",
    ].join("\n");
    const hunks = parseGitDiffHunks(output);
    assert.equal(hunks.get("new.txt")?.length, 1);
    assert.deepEqual(hunks.get("img.png"), []);
  });
});
