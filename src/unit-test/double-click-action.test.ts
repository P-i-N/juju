/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveDoubleClickAction, type DoubleClickTarget } from "../double-click-action";

const root = "z".repeat(32);

function change(overrides: Partial<DoubleClickTarget> = {}): DoubleClickTarget {
  return { changeId: "abc", fullDescription: "Described\n", currentWorkingCopy: false, isEmpty: false, ...overrides };
}

describe("resolveDoubleClickAction", () => {
  describe("new, edit undescribed", () => {
    const setting = "newEditUndescribed";

    it("creates a new change on top of a described change", () => {
      assert.equal(resolveDoubleClickAction(change(), setting), "new");
    });

    it("edits an undescribed change", () => {
      assert.equal(resolveDoubleClickAction(change({ fullDescription: "" }), setting), "edit");
    });

    it("treats a whitespace-only description as undescribed", () => {
      assert.equal(resolveDoubleClickAction(change({ fullDescription: " \n" }), setting), "edit");
    });

    it("creates a new change on top of the root instead of editing it", () => {
      assert.equal(resolveDoubleClickAction(change({ changeId: root, fullDescription: "" }), setting), "new");
    });

    it("creates a new change on top of a described working copy with content", () => {
      assert.equal(resolveDoubleClickAction(change({ currentWorkingCopy: true }), setting), "new");
    });

    it("does nothing for a described empty working copy", () => {
      assert.equal(resolveDoubleClickAction(change({ currentWorkingCopy: true, isEmpty: true }), setting), null);
    });

    it("does nothing for an undescribed working copy", () => {
      assert.equal(resolveDoubleClickAction(change({ currentWorkingCopy: true, fullDescription: "" }), setting), null);
    });
  });

  describe("new", () => {
    it("creates a new change on top of an undescribed change", () => {
      assert.equal(resolveDoubleClickAction(change({ fullDescription: "" }), "new"), "new");
    });

    it("creates a new change on top of a working copy with content", () => {
      assert.equal(resolveDoubleClickAction(change({ currentWorkingCopy: true, fullDescription: "" }), "new"), "new");
    });

    it("does nothing for an empty working copy", () => {
      assert.equal(resolveDoubleClickAction(change({ currentWorkingCopy: true, isEmpty: true }), "new"), null);
    });
  });

  describe("edit", () => {
    it("edits a described change", () => {
      assert.equal(resolveDoubleClickAction(change(), "edit"), "edit");
    });

    it("does nothing for the working copy", () => {
      assert.equal(resolveDoubleClickAction(change({ currentWorkingCopy: true }), "edit"), null);
    });

    it("does nothing for the root", () => {
      assert.equal(resolveDoubleClickAction(change({ changeId: root }), "edit"), null);
    });
  });

  it("falls back to new, edit undescribed for an unknown setting", () => {
    assert.equal(resolveDoubleClickAction(change({ fullDescription: "" }), "bogus"), "edit");
    assert.equal(resolveDoubleClickAction(change(), "bogus"), "new");
  });
});
