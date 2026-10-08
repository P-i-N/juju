/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeFileSelection, draggedFilePaths, type FileSelection } from "../webview/graph/file-selection";
import type { FullChangeId } from "../graph-protocol";

function full(id: string): FullChangeId {
  return id as FullChangeId;
}

const files = ["a.txt", "b.txt", "c.txt", "d.txt"];
const plain = { shiftKey: false, toggleKey: false };
const shift = { shiftKey: true, toggleKey: false };
const toggle = { shiftKey: false, toggleKey: true };
const toggleShift = { shiftKey: true, toggleKey: true };

function selection(changeId: string, paths: string[], anchor: string): FileSelection {
  return { changeId: full(changeId), paths: new Set(paths), anchor };
}

function paths(result: FileSelection | null): string[] {
  return [...(result?.paths ?? [])].sort();
}

describe("computeFileSelection", () => {
  it("selects only the clicked file on plain click", () => {
    const result = computeFileSelection(selection("x", ["a.txt", "b.txt"], "a.txt"), full("x"), files, "c.txt", plain);
    assert.deepEqual(paths(result), ["c.txt"]);
    assert.equal(result?.anchor, "c.txt");
    assert.equal(result?.changeId, full("x"));
  });

  it("toggles a file into the selection of the same change", () => {
    const result = computeFileSelection(selection("x", ["a.txt"], "a.txt"), full("x"), files, "c.txt", toggle);
    assert.deepEqual(paths(result), ["a.txt", "c.txt"]);
    assert.equal(result?.anchor, "c.txt");
  });

  it("toggles a file out of the selection of the same change", () => {
    const result = computeFileSelection(selection("x", ["a.txt", "c.txt"], "a.txt"), full("x"), files, "c.txt", toggle);
    assert.deepEqual(paths(result), ["a.txt"]);
  });

  it("clears the selection when toggling out its last file", () => {
    assert.equal(computeFileSelection(selection("x", ["a.txt"], "a.txt"), full("x"), files, "a.txt", toggle), null);
  });

  it("selects a range from the anchor on shift+click", () => {
    const result = computeFileSelection(selection("x", ["b.txt"], "b.txt"), full("x"), files, "d.txt", shift);
    assert.deepEqual(paths(result), ["b.txt", "c.txt", "d.txt"]);
    assert.equal(result?.anchor, "b.txt");
  });

  it("selects a range upwards from the anchor", () => {
    const result = computeFileSelection(selection("x", ["c.txt"], "c.txt"), full("x"), files, "a.txt", shift);
    assert.deepEqual(paths(result), ["a.txt", "b.txt", "c.txt"]);
  });

  it("replaces the selection with the range on shift+click", () => {
    const result = computeFileSelection(selection("x", ["a.txt", "d.txt"], "b.txt"), full("x"), files, "c.txt", shift);
    assert.deepEqual(paths(result), ["b.txt", "c.txt"]);
  });

  it("adds the range to the selection on ctrl+shift+click", () => {
    const result = computeFileSelection(
      selection("x", ["a.txt", "d.txt"], "b.txt"),
      full("x"),
      files,
      "c.txt",
      toggleShift,
    );
    assert.deepEqual(paths(result), ["a.txt", "b.txt", "c.txt", "d.txt"]);
  });

  it("starts a new selection when toggling a file of another change", () => {
    const result = computeFileSelection(selection("x", ["a.txt"], "a.txt"), full("y"), files, "b.txt", toggle);
    assert.deepEqual(paths(result), ["b.txt"]);
    assert.equal(result?.changeId, full("y"));
  });

  it("starts a new selection when shift+clicking a file of another change", () => {
    const result = computeFileSelection(selection("x", ["a.txt"], "a.txt"), full("y"), files, "c.txt", shift);
    assert.deepEqual(paths(result), ["c.txt"]);
    assert.equal(result?.anchor, "c.txt");
  });

  it("selects only the clicked file on shift+click without a selection", () => {
    const result = computeFileSelection(null, full("x"), files, "c.txt", shift);
    assert.deepEqual(paths(result), ["c.txt"]);
  });

  it("selects only the clicked file on shift+click when the anchor is gone", () => {
    const result = computeFileSelection(selection("x", ["z.txt"], "z.txt"), full("x"), files, "b.txt", shift);
    assert.deepEqual(paths(result), ["b.txt"]);
  });
});

describe("draggedFilePaths", () => {
  it("drags the whole selection in file order when the dragged file is selected", () => {
    const current = selection("x", ["d.txt", "b.txt"], "d.txt");
    assert.deepEqual(draggedFilePaths(current, full("x"), files, "d.txt"), ["b.txt", "d.txt"]);
  });

  it("drags only the dragged file when it is not selected", () => {
    const current = selection("x", ["a.txt", "b.txt"], "a.txt");
    assert.deepEqual(draggedFilePaths(current, full("x"), files, "c.txt"), ["c.txt"]);
  });

  it("drags only the dragged file when the selection belongs to another change", () => {
    const current = selection("y", ["a.txt", "b.txt"], "a.txt");
    assert.deepEqual(draggedFilePaths(current, full("x"), files, "a.txt"), ["a.txt"]);
  });

  it("drags only the dragged file without a selection", () => {
    assert.deepEqual(draggedFilePaths(null, full("x"), files, "a.txt"), ["a.txt"]);
  });
});
