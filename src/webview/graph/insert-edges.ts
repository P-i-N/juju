import { rootChangeId } from "./types";
import type { ChangeNode, FullChangeId, RegularChangeNode } from "../../graph-protocol";

export type EdgeSide = "top" | "bottom";

export interface HoveredEdge {
  changeId: FullChangeId;
  side: EdgeSide;
}

export interface EdgeHighlight {
  top: ReadonlySet<FullChangeId>;
  bottom: ReadonlySet<FullChangeId>;
}

export type EdgeCursor = EdgeSide | "shared";

export type DropPosition = "onto" | "after" | "before";

export const EDGE_ZONE_FRACTION = 0.25;

export function edgeSideAt(offsetY: number, height: number): EdgeSide | null {
  const zone = height * EDGE_ZONE_FRACTION;
  if (offsetY < zone) {
    return "top";
  }
  if (offsetY >= height - zone) {
    return "bottom";
  }
  return null;
}

/** The root has no parents to insert a change between, so only its top edge works. */
export function canInsertAt(change: ChangeNode, side: EdgeSide): change is RegularChangeNode {
  if (change.branchType === "~") {
    return false;
  }
  return side === "top" || change.id.changeId !== rootChangeId;
}

function regularChanges(changes: ChangeNode[]): RegularChangeNode[] {
  return changes.filter((c): c is RegularChangeNode => c.branchType !== "~");
}

function childrenOf(changes: RegularChangeNode[], changeId: FullChangeId): RegularChangeNode[] {
  return changes.filter((c) => c.parentChangeIds?.includes(changeId));
}

/**
 * The edges to highlight for the hovered one, or null when it cannot be used.
 * Inserting after a change is the same as inserting before its child when
 * that child is its only child and it is that child's only parent, so the two
 * edges are highlighted together. Edges touching an excluded change (one being
 * dragged) cannot be used.
 */
export function computeEdgeHighlight(
  changes: ChangeNode[],
  hovered: HoveredEdge,
  excluded: readonly FullChangeId[] = [],
): EdgeHighlight | null {
  const regular = regularChanges(changes);
  const top = new Set<FullChangeId>();
  const bottom = new Set<FullChangeId>();
  const change = regular.find((c) => c.id.changeId === hovered.changeId);
  if (!change || !canInsertAt(change, hovered.side)) {
    return null;
  }

  if (hovered.side === "top") {
    top.add(change.id.changeId);
    const children = childrenOf(regular, change.id.changeId);
    const [child] = children;
    if (children.length === 1 && child.parentChangeIds?.length === 1) {
      bottom.add(child.id.changeId);
    }
  } else {
    bottom.add(change.id.changeId);
    const [parentId] = change.parentChangeIds ?? [];
    if (change.parentChangeIds?.length === 1 && childrenOf(regular, parentId).length === 1) {
      const parent = regular.find((c) => c.id.changeId === parentId);
      if (parent) {
        top.add(parent.id.changeId);
      }
    }
  }
  if (excluded.some((id) => top.has(id) || bottom.has(id))) {
    return null;
  }
  return { top, bottom };
}

/**
 * Where a drop on an edge puts the dropped changes: a bottom edge inserts
 * before its change, a top edge shared with an only child inserts in between,
 * and a top edge of its own adds a new child.
 */
export function edgeDropPosition(highlight: EdgeHighlight, hovered: HoveredEdge): DropPosition {
  if (hovered.side === "bottom") {
    return "before";
  }
  return highlight.bottom.size > 0 ? "after" : "onto";
}

/** The cursor for the row under the pointer: its hovered side, or "shared" when a neighbor's edge lights up too. */
export function edgeCursorFor(
  highlight: EdgeHighlight | null,
  hovered: HoveredEdge | null,
  changeId: FullChangeId,
): EdgeCursor | null {
  if (!highlight || hovered?.changeId !== changeId) {
    return null;
  }
  if (!highlight.top.has(changeId) && !highlight.bottom.has(changeId)) {
    return null;
  }
  return highlight.top.size > 0 && highlight.bottom.size > 0 ? "shared" : hovered.side;
}
