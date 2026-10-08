const rootChangeId = "z".repeat(32);

/** The values of the `juju.changeDoubleClickAction` setting. */
export type ChangeDoubleClickAction = "edit" | "new" | "newEditUndescribed";

export const DEFAULT_CHANGE_DOUBLE_CLICK_ACTION: ChangeDoubleClickAction = "newEditUndescribed";

export interface DoubleClickTarget {
  changeId: string;
  fullDescription: string;
  currentWorkingCopy: boolean;
  isEmpty: boolean;
}

function parseSetting(setting: string): ChangeDoubleClickAction {
  return setting === "edit" || setting === "new" ? setting : DEFAULT_CHANGE_DOUBLE_CLICK_ACTION;
}

/**
 * What double-clicking a change does: create a new change on top of it (jj
 * new), edit it (jj edit), or nothing. "newEditUndescribed" edits changes
 * without a description and creates a new change on top of described ones.
 * The working copy is never edited (it already is), and a new change is only
 * created on top of it when it has content.
 */
export function resolveDoubleClickAction(change: DoubleClickTarget, setting: string): "new" | "edit" | null {
  const isRoot = change.changeId === rootChangeId;
  const action = parseSetting(setting);
  const undescribed = change.fullDescription.trim() === "";
  const resolved = action === "newEditUndescribed" ? (undescribed && !isRoot ? "edit" : "new") : action;

  if (change.currentWorkingCopy) {
    return resolved === "new" && !change.isEmpty ? "new" : null;
  }
  if (resolved === "edit" && isRoot) {
    return null;
  }
  return resolved;
}
