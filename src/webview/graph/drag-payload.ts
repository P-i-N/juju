import type { FullChangeId, GraphDragPayload } from "../../graph-protocol";
import type { DraggedFiles, DraggedHunks } from "./signals";

export interface LocalDragState {
  startId: FullChangeId | null;
  sourceIds: FullChangeId[];
  bookmark: string | null;
  files: DraggedFiles | null;
  hunks: DraggedHunks | null;
}

export function dragPayloadOf(state: LocalDragState): GraphDragPayload | null {
  if (state.bookmark) {
    return { kind: "bookmark", name: state.bookmark };
  }
  if (state.hunks) {
    return { kind: "hunks", changeId: state.hunks.changeId, hunks: state.hunks.hunks };
  }
  if (state.files) {
    return { kind: "files", changeId: state.files.changeId, paths: state.files.paths };
  }
  if (state.startId) {
    return { kind: "changes", startId: state.startId, sourceIds: state.sourceIds };
  }
  return null;
}

export function dragStateOf(payload: GraphDragPayload): LocalDragState {
  const state: LocalDragState = { startId: null, sourceIds: [], bookmark: null, files: null, hunks: null };
  switch (payload.kind) {
    case "changes":
      return { ...state, startId: payload.startId, sourceIds: payload.sourceIds };
    case "bookmark":
      return { ...state, bookmark: payload.name };
    case "files":
      return { ...state, files: { changeId: payload.changeId, paths: payload.paths } };
    case "hunks":
      return { ...state, hunks: { changeId: payload.changeId, hunks: payload.hunks } };
  }
}
