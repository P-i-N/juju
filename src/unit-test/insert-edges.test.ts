/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canInsertAt, computeEdgeHighlight, edgeCursorFor, edgeSideAt } from "../webview/graph/insert-edges";
import { rootChangeId } from "../webview/graph/types";
import type { ChangeNode, FullChangeId, RegularChangeNode } from "../graph-protocol";

function full(id: string): FullChangeId {
  return id as FullChangeId;
}

function regular(id: string, parents: string[] = []): RegularChangeNode {
  return {
    id: {
      changeId: full(id),
      changeIdPrefix: id.slice(0, 4),
      changeIdSuffix: "",
      changeOffset: null,
    },
    commitId: id,
    label: id,
    description: id,
    tooltip: id,
    currentWorkingCopy: false,
    localBookmarks: [],
    remoteBookmarks: [],
    localTags: [],
    remoteTags: [],
    workingCopies: [],
    branchType: "○",
    authorName: "Test",
    authorEmail: "test@test.com",
    authorTimestamp: "2024-01-01",
    fullDescription: id,
    mine: true,
    conflict: false,
    isEmpty: false,
    parentChangeIds: parents.map(full),
  };
}

function sorted(ids: ReadonlySet<FullChangeId>): string[] {
  return [...ids].sort();
}

describe("edgeSideAt", () => {
  it("returns the top edge in the top quarter of the row", () => {
    assert.equal(edgeSideAt(0, 20), "top");
    assert.equal(edgeSideAt(4.9, 20), "top");
  });

  it("returns the bottom edge in the bottom quarter of the row", () => {
    assert.equal(edgeSideAt(15, 20), "bottom");
    assert.equal(edgeSideAt(19.9, 20), "bottom");
  });

  it("returns no edge in the middle of the row", () => {
    assert.equal(edgeSideAt(5, 20), null);
    assert.equal(edgeSideAt(10, 20), null);
    assert.equal(edgeSideAt(14.9, 20), null);
  });
});

describe("canInsertAt", () => {
  it("allows both edges of a regular change", () => {
    assert.equal(canInsertAt(regular("a"), "top"), true);
    assert.equal(canInsertAt(regular("a"), "bottom"), true);
  });

  it("allows only the top edge of the root", () => {
    assert.equal(canInsertAt(regular(rootChangeId), "top"), true);
    assert.equal(canInsertAt(regular(rootChangeId), "bottom"), false);
  });

  it("allows no edge of an elided row", () => {
    const elided: ChangeNode = { fakeId: "~1", branchType: "~" };
    assert.equal(canInsertAt(elided, "top"), false);
    assert.equal(canInsertAt(elided, "bottom"), false);
  });
});

describe("computeEdgeHighlight", () => {
  it("shares the top edge with the bottom edge of an only child", () => {
    const changes = [regular("b", ["a"]), regular("a")];
    const highlight = computeEdgeHighlight(changes, { changeId: full("a"), side: "top" });
    assert.deepEqual(sorted(highlight.top), ["a"]);
    assert.deepEqual(sorted(highlight.bottom), ["b"]);
  });

  it("shares the bottom edge with the top edge of an only parent", () => {
    const changes = [regular("b", ["a"]), regular("a")];
    const highlight = computeEdgeHighlight(changes, { changeId: full("b"), side: "bottom" });
    assert.deepEqual(sorted(highlight.top), ["a"]);
    assert.deepEqual(sorted(highlight.bottom), ["b"]);
  });

  it("keeps the top edge to itself when there are several children", () => {
    const changes = [regular("c", ["a"]), regular("b", ["a"]), regular("a")];
    const highlight = computeEdgeHighlight(changes, { changeId: full("a"), side: "top" });
    assert.deepEqual(sorted(highlight.top), ["a"]);
    assert.deepEqual(sorted(highlight.bottom), []);
  });

  it("keeps the bottom edge to itself when the parent has several children", () => {
    const changes = [regular("c", ["a"]), regular("b", ["a"]), regular("a")];
    const highlight = computeEdgeHighlight(changes, { changeId: full("b"), side: "bottom" });
    assert.deepEqual(sorted(highlight.top), []);
    assert.deepEqual(sorted(highlight.bottom), ["b"]);
  });

  it("keeps the top edge to itself when the only child is a merge", () => {
    const changes = [regular("m", ["a", "b"]), regular("b"), regular("a")];
    const highlight = computeEdgeHighlight(changes, { changeId: full("a"), side: "top" });
    assert.deepEqual(sorted(highlight.top), ["a"]);
    assert.deepEqual(sorted(highlight.bottom), []);
  });

  it("keeps the bottom edge of a merge to itself", () => {
    const changes = [regular("m", ["a", "b"]), regular("b"), regular("a")];
    const highlight = computeEdgeHighlight(changes, { changeId: full("m"), side: "bottom" });
    assert.deepEqual(sorted(highlight.top), []);
    assert.deepEqual(sorted(highlight.bottom), ["m"]);
  });

  it("highlights nothing for the bottom edge of the root", () => {
    const changes = [regular("a", [rootChangeId]), regular(rootChangeId)];
    const highlight = computeEdgeHighlight(changes, { changeId: rootChangeId, side: "bottom" });
    assert.deepEqual(sorted(highlight.top), []);
    assert.deepEqual(sorted(highlight.bottom), []);
  });

  it("highlights nothing for an unknown change", () => {
    const highlight = computeEdgeHighlight([regular("a")], { changeId: full("x"), side: "top" });
    assert.deepEqual(sorted(highlight.top), []);
    assert.deepEqual(sorted(highlight.bottom), []);
  });
});

describe("edgeCursorFor", () => {
  const changes = [regular("c", ["a"]), regular("b", ["a"]), regular("a")];

  it("points up on a top edge of its own", () => {
    const hovered = { changeId: full("a"), side: "top" } as const;
    assert.equal(edgeCursorFor(computeEdgeHighlight(changes, hovered), hovered, full("a")), "top");
  });

  it("points down on a bottom edge of its own", () => {
    const hovered = { changeId: full("b"), side: "bottom" } as const;
    assert.equal(edgeCursorFor(computeEdgeHighlight(changes, hovered), hovered, full("b")), "bottom");
  });

  it("is shared when the edge is shared with a neighbor", () => {
    const linear = [regular("b", ["a"]), regular("a")];
    const hovered = { changeId: full("a"), side: "top" } as const;
    assert.equal(edgeCursorFor(computeEdgeHighlight(linear, hovered), hovered, full("a")), "shared");
  });

  it("is unset for rows other than the hovered one", () => {
    const linear = [regular("b", ["a"]), regular("a")];
    const hovered = { changeId: full("a"), side: "top" } as const;
    assert.equal(edgeCursorFor(computeEdgeHighlight(linear, hovered), hovered, full("b")), null);
  });

  it("is unset without a highlight", () => {
    const hovered = { changeId: full("a"), side: "top" } as const;
    assert.equal(edgeCursorFor(null, hovered, full("a")), null);
  });

  it("is unset when the hovered edge highlights nothing", () => {
    const hovered = { changeId: full("x"), side: "top" } as const;
    assert.equal(edgeCursorFor(computeEdgeHighlight(changes, hovered), hovered, full("x")), null);
  });
});
