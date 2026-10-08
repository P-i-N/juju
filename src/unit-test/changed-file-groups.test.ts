/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileNameOf, groupChangedFiles } from "../webview/graph/changed-file-groups";
import type { ChangedFile } from "../graph-protocol";

function file(path: string): ChangedFile {
  return { type: "M", path, conflict: false };
}

function layout(paths: string[]): [string, string[]][] {
  return groupChangedFiles(paths.map(file)).map((g) => [g.directory, g.files.map((f) => f.path)]);
}

describe("groupChangedFiles", () => {
  it("groups files by their directory, root files first", () => {
    assert.deepEqual(layout(["src/b.ts", "README.md", "src/a.ts", "docs/x.md"]), [
      ["", ["README.md"]],
      ["docs", ["docs/x.md"]],
      ["src", ["src/a.ts", "src/b.ts"]],
    ]);
  });

  it("keeps a nested directory right after its parent", () => {
    assert.deepEqual(layout(["src-old/a.ts", "src/webview/b.ts", "src/c.ts"]), [
      ["src", ["src/c.ts"]],
      ["src/webview", ["src/webview/b.ts"]],
      ["src-old", ["src-old/a.ts"]],
    ]);
  });

  it("sorts names case-insensitively and numbers naturally", () => {
    assert.deepEqual(layout(["d/file10.ts", "d/B.ts", "d/a.ts", "d/file2.ts"]), [
      ["d", ["d/a.ts", "d/B.ts", "d/file2.ts", "d/file10.ts"]],
    ]);
  });

  it("returns no groups for no files", () => {
    assert.deepEqual(layout([]), []);
  });
});

describe("fileNameOf", () => {
  it("returns the last path segment", () => {
    assert.equal(fileNameOf("src/webview/a.ts"), "a.ts");
    assert.equal(fileNameOf("a.ts"), "a.ts");
  });
});
