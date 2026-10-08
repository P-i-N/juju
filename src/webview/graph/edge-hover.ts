import { canInsertAt, edgeDropPosition, edgeSideAt, type DropPosition, type EdgeSide } from "./insert-edges";
import { edgeHighlight, hoveredEdge, insertModifierHeld } from "./signals";
import type { ChangeNode } from "../../graph-protocol";

/**
 * Which edges of a change an element offers: a change row offers both, but
 * with its changed files expanded only the top one, while the last row of
 * the files offers the bottom one.
 */
export type EdgeZones = "both" | EdgeSide;

export function insertSideAt(change: ChangeNode, e: MouseEvent, zones: EdgeZones = "both"): EdgeSide | null {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const side = edgeSideAt(e.clientY - rect.top, rect.height);
  if (side === null || (zones !== "both" && side !== zones)) {
    return null;
  }
  return canInsertAt(change, side) ? side : null;
}

/** Records the edge under the pointer of a mouse or drag event on one of the change's elements. */
export function updateHoveredEdge(change: ChangeNode, e: MouseEvent, zones: EdgeZones = "both") {
  insertModifierHeld.value = e.ctrlKey || e.metaKey;
  const side = insertSideAt(change, e, zones);
  const current = hoveredEdge.value;
  if (side === null || change.branchType === "~") {
    if (current !== null) {
      hoveredEdge.value = null;
    }
    return;
  }
  if (current?.changeId !== change.id.changeId || current.side !== side) {
    hoveredEdge.value = { changeId: change.id.changeId, side };
  }
}

/** Forgets the hovered edge if it belongs to the change, leaving a neighbor's edge alone. */
export function clearHoveredEdge(change: ChangeNode) {
  if (change.branchType !== "~" && hoveredEdge.value?.changeId === change.id.changeId) {
    hoveredEdge.value = null;
  }
}

/** Where a drop at the event lands on the change's edge, or null when it is not on a usable edge. */
export function edgeDropAt(change: ChangeNode, e: MouseEvent, zones: EdgeZones = "both"): DropPosition | null {
  updateHoveredEdge(change, e, zones);
  const highlight = edgeHighlight.value;
  const hovered = hoveredEdge.value;
  return highlight && hovered ? edgeDropPosition(highlight, hovered) : null;
}
