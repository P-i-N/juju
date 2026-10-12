/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dragPayloadOf, dragStateOf, type LocalDragState } from "../webview/graph/drag-payload";
import type { FullChangeId, GraphDragPayload } from "../graph-protocol";

function full(id: string): FullChangeId {
  return id as FullChangeId;
}

const emptyState: LocalDragState = { startId: null, sourceIds: [], bookmark: null, files: null, hunks: null };

describe("dragPayloadOf", () => {
  it("describes a change drag", () => {
    const state: LocalDragState = { ...emptyState, startId: full("a"), sourceIds: [full("a"), full("b")] };
    assert.deepEqual(dragPayloadOf(state), { kind: "changes", startId: "a", sourceIds: ["a", "b"] });
  });

  it("prefers a bookmark over the change it was dragged from", () => {
    const state: LocalDragState = {
      ...emptyState,
      startId: full("a"),
      sourceIds: [full("a")],
      bookmark: "main",
    };
    assert.deepEqual(dragPayloadOf(state), { kind: "bookmark", name: "main" });
  });

  it("describes a files drag", () => {
    const state: LocalDragState = { ...emptyState, files: { changeId: full("c"), paths: ["x.ts", "y.ts"] } };
    assert.deepEqual(dragPayloadOf(state), { kind: "files", changeId: "c", paths: ["x.ts", "y.ts"] });
  });

  it("describes a hunks drag", () => {
    const hunks = [{ path: "x.ts", hunk: { oldStart: 1, oldLines: 2, newStart: 3, newLines: 4 } }];
    const state: LocalDragState = { ...emptyState, hunks: { changeId: full("c"), hunks } };
    assert.deepEqual(dragPayloadOf(state), { kind: "hunks", changeId: "c", hunks });
  });

  it("prefers hunks over files and changes", () => {
    const hunks = [{ path: "x.ts", hunk: { oldStart: 1, oldLines: 2, newStart: 3, newLines: 4 } }];
    const state: LocalDragState = {
      startId: full("a"),
      sourceIds: [full("a")],
      bookmark: null,
      files: { changeId: full("c"), paths: ["x.ts"] },
      hunks: { changeId: full("c"), hunks },
    };
    assert.equal(dragPayloadOf(state)?.kind, "hunks");
  });

  it("prefers files over changes", () => {
    const state: LocalDragState = {
      ...emptyState,
      startId: full("a"),
      sourceIds: [full("a")],
      files: { changeId: full("c"), paths: ["x.ts"] },
    };
    assert.equal(dragPayloadOf(state)?.kind, "files");
  });

  it("returns null when nothing is dragged", () => {
    assert.equal(dragPayloadOf(emptyState), null);
  });
});

describe("dragStateOf", () => {
  const payloads: GraphDragPayload[] = [
    { kind: "changes", startId: full("a"), sourceIds: [full("a"), full("b")] },
    { kind: "bookmark", name: "main" },
    { kind: "files", changeId: full("c"), paths: ["x.ts", "y.ts"] },
    {
      kind: "hunks",
      changeId: full("c"),
      hunks: [{ path: "x.ts", hunk: { oldStart: 1, oldLines: 2, newStart: 3, newLines: 4 } }],
    },
  ];

  for (const payload of payloads) {
    it(`round-trips a ${payload.kind} payload`, () => {
      assert.deepEqual(dragPayloadOf(dragStateOf(payload)), payload);
    });
  }

  it("leaves everything but the files unset for a files payload", () => {
    const state = dragStateOf({ kind: "files", changeId: full("c"), paths: ["x.ts"] });
    assert.deepEqual(state, {
      startId: null,
      sourceIds: [],
      bookmark: null,
      files: { changeId: "c", paths: ["x.ts"] },
      hunks: null,
    });
  });
});
