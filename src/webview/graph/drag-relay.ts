import { batch, effect } from "@preact/signals";
import type { FullChangeId, GraphDragPayload } from "../../graph-protocol";
import { dragPayloadOf, dragStateOf } from "./drag-payload";
import {
  closeAllMenus,
  dragBookmarkName,
  dragFiles,
  dragHunks,
  dragSourceIds,
  dragStartChangeId,
  dropTargetId,
  hoveredEdge,
  isDragging,
  postMessage,
  remoteDrag,
  remoteDragReceived,
  remoteDragSourceIds,
} from "./signals";

/**
 * How long a relayed drag end waits before clearing the drag: the source window ends its drag as soon as the drop
 * completes, so the relayed end can arrive before this window has handled a drop that landed here.
 */
export const REMOTE_DRAG_END_GRACE_MS = 500;

let pendingEnd: ReturnType<typeof setTimeout> | undefined;

function cancelPendingEnd() {
  clearTimeout(pendingEnd);
  pendingEnd = undefined;
}

export function clearRemoteDragNow(): void {
  cancelPendingEnd();
  if (!remoteDrag.peek()) {
    return;
  }
  batch(() => {
    remoteDrag.value = false;
    remoteDragReceived.value = false;
    remoteDragSourceIds.value = null;
    isDragging.value = false;
    dragStartChangeId.value = null;
    dragBookmarkName.value = null;
    dragFiles.value = null;
    dragHunks.value = null;
    dropTargetId.value = null;
    hoveredEdge.value = null;
  });
}

export function applyRemoteDragStart(payload: GraphDragPayload): void {
  cancelPendingEnd();
  closeAllMenus();
  const state = dragStateOf(payload);
  batch(() => {
    dragStartChangeId.value = state.startId;
    dragBookmarkName.value = state.bookmark;
    dragFiles.value = state.files;
    dragHunks.value = state.hunks;
    remoteDragSourceIds.value = state.sourceIds;
    remoteDragReceived.value = false;
    remoteDrag.value = true;
    isDragging.value = true;
  });
}

export function applyRemoteDragEnd(): void {
  cancelPendingEnd();
  if (!remoteDrag.peek()) {
    return;
  }
  pendingEnd = setTimeout(clearRemoteDragNow, REMOTE_DRAG_END_GRACE_MS);
}

/**
 * Tells the other graph windows about every drag that starts and ends in this one, and clears a drag relayed from
 * another window once it is over here.
 */
export function installDragRelay(): () => void {
  let localDrag = false;

  const disposeEffect = effect(() => {
    if (isDragging.value) {
      if (localDrag || remoteDrag.peek()) {
        return;
      }
      const payload = dragPayloadOf({
        startId: dragStartChangeId.peek() as FullChangeId | null,
        sourceIds: dragSourceIds.peek(),
        bookmark: dragBookmarkName.peek(),
        files: dragFiles.peek(),
        hunks: dragHunks.peek(),
      });
      if (payload) {
        localDrag = true;
        postMessage({ command: "dragStarted", payload });
      }
      return;
    }
    if (localDrag) {
      localDrag = false;
      postMessage({ command: "dragEnded" });
    }
    // A drop in this window ends a relayed drag by resetting isDragging.
    clearRemoteDragNow();
  });

  // Mouse events do not fire during a drag, so a move without a pressed button means the drag is over.
  const handleMouseMove = (e: MouseEvent) => {
    if (e.buttons === 0 && remoteDrag.peek()) {
      clearRemoteDragNow();
    }
  };
  // A drag starting here supersedes a relayed one that has not been cleared yet.
  const handleDragStart = () => {
    if (remoteDrag.peek()) {
      clearRemoteDragNow();
    }
  };
  const handleDragOver = () => {
    if (remoteDrag.peek() && !remoteDragReceived.peek()) {
      remoteDragReceived.value = true;
    }
  };
  window.addEventListener("mousemove", handleMouseMove);
  window.addEventListener("dragstart", handleDragStart, true);
  window.addEventListener("dragenter", handleDragOver, true);
  window.addEventListener("dragover", handleDragOver, true);

  return () => {
    disposeEffect();
    cancelPendingEnd();
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("dragstart", handleDragStart, true);
    window.removeEventListener("dragenter", handleDragOver, true);
    window.removeEventListener("dragover", handleDragOver, true);
  };
}
