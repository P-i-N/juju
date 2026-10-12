import {
  dragStartChangeId,
  isDragging,
  dropTargetId,
  justFinishedDrag,
  rebaseMenu,
  tooltip,
  dragBookmarkName,
  dragFiles,
  dragHunks,
  hunkDropMenu,
  postMessage,
  closeAllMenus,
  selectedNodes,
  hoveredEdge,
  dragSourceIds,
  edgeDropMenu,
  edgeHighlight,
  currentChanges,
} from "../signals";
import { clearHoveredEdge, edgeDropAt, updateHoveredEdge, type EdgeZones } from "../edge-hover";
import { clearRemoteDragNow } from "../drag-relay";
import { createTooltipTimers } from "./tooltip-timers";
import { rootChangeId } from "../types";
import type { ChangeNode, FullChangeId, RegularChangeNode } from "../../../graph-protocol";
import changeNodeStyles from "../components/change-node.module.css";
import dragGhostStyles from "../components/drag-ghost.module.css";

/**
 * Handles a Ctrl+drop of the dragged changes or changed files on the change's
 * edge under the pointer by opening the edge drop menu. Returns whether the
 * drop landed on an edge.
 */
export function dropOnEdge(change: ChangeNode, e: DragEvent, zones: EdgeZones = "both"): boolean {
  if (change.branchType === "~" || dragBookmarkName.value) {
    return false;
  }
  const position = edgeDropAt(change, e, zones);
  const highlight = edgeHighlight.value;
  if (!position || !highlight) {
    return false;
  }
  const files = dragFiles.value;
  const sourceIds = dragSourceIds.value;
  if (!files && sourceIds.length === 0) {
    return false;
  }
  isDragging.value = false;
  dragFiles.value = null;
  dropTargetId.value = null;
  justFinishedDrag.value = true;
  setTimeout(() => {
    justFinishedDrag.value = false;
  }, 100);
  closeAllMenus();
  const common = { targetId: change.id.changeId, position, highlight, clientX: e.clientX, clientY: e.clientY };
  edgeDropMenu.value = files
    ? { ...common, kind: "files", fromChangeId: files.changeId, paths: files.paths }
    : { ...common, kind: "changes", sourceIds };
  return true;
}

function isChangeInGraph(id: string): boolean {
  return currentChanges.value.some((c) => c.branchType !== "~" && c.id.changeId === id);
}

/** Highlights the row as the drop target unless the drag in progress started on it. */
function applyDropTarget(change: RegularChangeNode): void {
  if (!isDragging.value) {
    return;
  }
  if (!dragBookmarkName.value && !dragStartChangeId.value && !dragFiles.value && !dragHunks.value) {
    return;
  }
  if (dragStartChangeId.value && change.id.changeId === dragStartChangeId.value) {
    return;
  }
  if (dragFiles.value && change.id.changeId === dragFiles.value.changeId) {
    return;
  }
  if (dragHunks.value && change.id.changeId === dragHunks.value.changeId) {
    return;
  }
  dropTargetId.value = change.id.changeId;
}

export function useDragDrop(change: ChangeNode, zones: EdgeZones = "both") {
  // Elided ("~") rows return early here. This is only safe because this hook
  // calls no real hooks itself below — createTooltipTimers() is a plain
  // closure factory over module-level signals, not a hook. Do not add real
  // hook calls after this early return.
  if (change.branchType === "~") {
    return {};
  }
  const isRoot = change.id.changeId === rootChangeId;
  const { clearAllTimers } = createTooltipTimers();

  return {
    draggable: !isRoot,
    onDragStart: isRoot
      ? undefined
      : (e: DragEvent) => {
          if (e.shiftKey) {
            e.preventDefault();
            return;
          }
          dragBookmarkName.value = null;
          dragFiles.value = null;
          dragHunks.value = null;
          dragStartChangeId.value = change.id.changeId;
          isDragging.value = true;
          clearAllTimers();
          tooltip.value = null;
          e.dataTransfer!.setData("text/plain", change.id.changeId);
          // Holding Ctrl asks for a copy on some platforms; allowing it keeps
          // Ctrl+drops onto insert edges possible.
          e.dataTransfer!.effectAllowed = "copyMove";

          const ghost = document.createElement("div");
          ghost.className = dragGhostStyles.dragGhost;
          if (change.conflict) {
            const conflict = document.createElement("span");
            conflict.className = changeNodeStyles.conflictIndicator;
            conflict.textContent = "✗";
            ghost.appendChild(conflict);
          }
          const prefix = document.createElement("span");
          prefix.className = changeNodeStyles.changeIdPrefix;
          prefix.textContent = change.id.changeIdPrefix;
          ghost.appendChild(prefix);
          const suffix = document.createElement("span");
          suffix.className = changeNodeStyles.changeIdSuffix;
          suffix.textContent = change.id.changeIdSuffix;
          ghost.appendChild(suffix);
          if (change.id.changeOffset) {
            const offset = document.createElement("span");
            offset.className = changeNodeStyles.changeIdOffset;
            offset.textContent = `/${change.id.changeOffset}`;
            ghost.appendChild(offset);
          }
          if (change.label) {
            ghost.appendChild(document.createTextNode(" "));
            const desc = document.createElement("span");
            desc.className = dragGhostStyles.dragGhostDescription;
            desc.textContent = change.label;
            ghost.appendChild(desc);
          }
          const selection = selectedNodes.value;
          if (selection.size > 1 && selection.has(change.id.changeId)) {
            const count = document.createElement("span");
            count.className = dragGhostStyles.dragGhostCount;
            count.textContent = `+ ${selection.size - 1} more`;
            ghost.appendChild(count);
          }
          document.body.appendChild(ghost);
          e.dataTransfer!.setDragImage(ghost, -15, 0);
          setTimeout(() => ghost.remove(), 0);
        },
    onDragEnd: isRoot
      ? undefined
      : () => {
          isDragging.value = false;
          dragStartChangeId.value = null;
          dragBookmarkName.value = null;
          dropTargetId.value = null;
          hoveredEdge.value = null;
        },
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
      updateHoveredEdge(change, e, zones);
      // A drag relayed from another graph window can arrive after the pointer entered the row.
      applyDropTarget(change);
    },
    onDragEnter: (e: DragEvent) => {
      e.preventDefault();
      applyDropTarget(change);
    },
    onDragLeave: (e: DragEvent) => {
      const relatedTarget = e.relatedTarget as HTMLElement | null;
      const currentTarget = e.currentTarget as HTMLElement;
      if (relatedTarget && currentTarget.contains(relatedTarget)) {
        return;
      }
      // Browsers fire dragenter on the new row before dragleave on the old
      // one, so only clear the highlights if they still belong to this row.
      clearHoveredEdge(change);
      if (dropTargetId.value === change.id.changeId) {
        dropTargetId.value = null;
      }
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();

      if (dragBookmarkName.value) {
        clearAllTimers();
        tooltip.value = null;
        const bookmarkName = dragBookmarkName.value;
        isDragging.value = false;
        dragBookmarkName.value = null;
        dropTargetId.value = null;
        justFinishedDrag.value = true;
        setTimeout(() => {
          justFinishedDrag.value = false;
        }, 100);
        postMessage({
          command: "moveBookmark",
          bookmark: bookmarkName,
          targetChangeId: change.id.changeId,
        });
        return;
      }

      if (dropOnEdge(change, e, zones)) {
        return;
      }

      if (dragHunks.value) {
        const dragged = dragHunks.value;
        clearAllTimers();
        tooltip.value = null;
        isDragging.value = false;
        dragHunks.value = null;
        dropTargetId.value = null;
        justFinishedDrag.value = true;
        setTimeout(() => {
          justFinishedDrag.value = false;
        }, 100);
        if (dragged.changeId !== change.id.changeId) {
          closeAllMenus();
          hunkDropMenu.value = {
            fromChangeId: dragged.changeId,
            toChangeId: change.id.changeId,
            hunks: dragged.hunks,
            clientX: e.clientX,
            clientY: e.clientY,
          };
        }
        return;
      }

      if (dragFiles.value) {
        const files = dragFiles.value;
        clearAllTimers();
        tooltip.value = null;
        isDragging.value = false;
        dragFiles.value = null;
        dropTargetId.value = null;
        justFinishedDrag.value = true;
        setTimeout(() => {
          justFinishedDrag.value = false;
        }, 100);
        if (files.changeId !== change.id.changeId) {
          postMessage({
            command: "moveFileChanges",
            fromChangeId: files.changeId,
            toChangeId: change.id.changeId,
            paths: files.paths,
          });
        }
        return;
      }

      // Without drag state the drop is only attributable when its text names a change in this graph; a file or hunk
      // drag whose relay has not arrived yet carries a path there.
      const droppedId = e.dataTransfer!.getData("text/plain");
      const sourceId = (dragStartChangeId.value ??
        (isChangeInGraph(droppedId) ? droppedId : null)) as FullChangeId | null;
      // When the dragged change is part of a multi-selection, operate on every
      // selected change; otherwise fall back to just the dragged one.
      const sourceIds = dragSourceIds.value.length > 0 ? dragSourceIds.value : sourceId ? [sourceId] : [];
      // A drag from another graph window gets no dragend here.
      clearRemoteDragNow();
      const targetId = change.id.changeId;
      if (!sourceId || !targetId || sourceId === targetId) {
        return;
      }

      clearAllTimers();
      tooltip.value = null;

      justFinishedDrag.value = true;
      closeAllMenus();
      rebaseMenu.value = {
        sourceId,
        sourceIds,
        targetId,
        targetChange: change,
        clientX: e.clientX,
        clientY: e.clientY,
      };

      setTimeout(() => {
        justFinishedDrag.value = false;
      }, 100);
    },
  };
}
