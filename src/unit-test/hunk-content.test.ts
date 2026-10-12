/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { contentWithHunks } from "../hunk-content";
import { parseGitDiffHunkLines } from "../parse-git-diff";

function diff(...hunkLines: string[]): string {
  return ["diff --git a/f.txt b/f.txt", "--- a/f.txt", "+++ b/f.txt", ...hunkLines].join("\n");
}

const oldContent = ["a", "b", "c", "d", "e", "f"].join("\n") + "\n";
// b changed, x inserted after d, f removed.
const newContent = ["a", "B", "c", "d", "x", "e"].join("\n") + "\n";
const output = diff("@@ -2 +2 @@", "-b", "+B", "@@ -4,0 +5 @@", "+x", "@@ -6 +6,0 @@", "-f");

describe("contentWithHunks", () => {
  const hunks = parseGitDiffHunkLines(output).get("f.txt")!;

  it("parses the removed and added lines of every hunk", () => {
    assert.deepEqual(
      hunks.map((h) => [h.removedLines, h.addedLines]),
      [
        [["b"], ["B"]],
        [[], ["x"]],
        [["f"], []],
      ],
    );
  });

  it("applies only the kept modification", () => {
    assert.equal(contentWithHunks(newContent, hunks, new Set([0])), ["a", "B", "c", "d", "e", "f"].join("\n") + "\n");
  });

  it("applies only the kept insertion", () => {
    assert.equal(
      contentWithHunks(newContent, hunks, new Set([1])),
      ["a", "b", "c", "d", "x", "e", "f"].join("\n") + "\n",
    );
  });

  it("applies only the kept deletion", () => {
    assert.equal(contentWithHunks(newContent, hunks, new Set([2])), ["a", "b", "c", "d", "e"].join("\n") + "\n");
  });

  it("applies several kept hunks", () => {
    assert.equal(contentWithHunks(newContent, hunks, new Set([0, 2])), ["a", "B", "c", "d", "e"].join("\n") + "\n");
  });

  it("reverts every hunk when none is kept", () => {
    assert.equal(contentWithHunks(newContent, hunks, new Set()), oldContent);
  });

  it("restores a missing final newline of the old side", () => {
    const eofHunks = parseGitDiffHunkLines(diff("@@ -2 +2 @@", "-b", "\\ No newline at end of file", "+B")).get(
      "f.txt",
    )!;
    assert.equal(eofHunks[0].oldMissingFinalNewline, true);
    assert.equal(contentWithHunks("a\nB\n", eofHunks, new Set()), "a\nb");
  });

  it("keeps CRLF line endings intact", () => {
    const crlfHunks = parseGitDiffHunkLines(diff("@@ -1 +1 @@", "-a\r", "+A\r", "@@ -3 +3 @@", "-c\r", "+C\r")).get(
      "f.txt",
    )!;
    assert.equal(contentWithHunks("A\r\nb\r\nC\r\n", crlfHunks, new Set([1])), "a\r\nb\r\nC\r\n");
  });
});
