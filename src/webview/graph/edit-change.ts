import type { RegularChangeNode } from "../../graph-protocol";
import { resolveDoubleClickAction } from "../../double-click-action";
import { changeDoubleClickAction, postMessage } from "./signals";

/**
 * A double click action on a change. The behavior depends on the double action config value.
 * Returns whether a message was sent to the extension host.
 */
export function editChange(change: RegularChangeNode): boolean {
  const target = { ...change, changeId: change.id.changeId };
  if (resolveDoubleClickAction(target, changeDoubleClickAction.value) === null) {
    return false;
  }
  postMessage({ command: "editChange", changeId: change.id.changeId });
  return true;
}
