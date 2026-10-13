import { computed, signal } from "@preact/signals";
import type { VSCodeAPI } from "./types";
import { computeEdgeHighlight, type DropPosition, type EdgeHighlight, type HoveredEdge } from "./insert-edges";
import type { FileSelection } from "./file-selection";
import { DEFAULT_CHANGE_DOUBLE_CLICK_ACTION } from "../../double-click-action";
import type {
  ChangeNode,
  ChangeIdGraph,
  DiffStats,
  RegularChangeNode,
  WebviewToExtensionMessage,
  FullChangeId,
  ChangedFile,
  FileHunk,
} from "../../graph-protocol";

declare function acquireVsCodeApi(): VSCodeAPI;

export let vscode: VSCodeAPI;

export function initVsCodeApi() {
  vscode = acquireVsCodeApi();
}

export function postMessage(message: WebviewToExtensionMessage): void {
  vscode.postMessage(message);
}

export const currentChanges = signal<ChangeNode[]>([]);
export const currentGraph = signal<ChangeIdGraph | null>(null);
export const selectedNodes = signal<Set<FullChangeId>>(new Set());
export const selectionAnchorId = signal<FullChangeId | null>(null);
export const isDragging = signal(false);
export const dragStartChangeId = signal<string | null>(null);
export const dragBookmarkName = signal<string | null>(null);
export const dropTargetId = signal<string | null>(null);
export const bookmarkDropPreviewTargetId = computed(() => {
  const name = dragBookmarkName.value;
  const targetId = dropTargetId.value;
  if (!name || !targetId) {
    return null;
  }
  const target = currentChanges.value.find(
    (c): c is RegularChangeNode => c.branchType !== "~" && c.id.changeId === targetId,
  );
  if (!target || target.localBookmarks.some((b) => b.name === name)) {
    return null;
  }
  return targetId;
});
export const hoveredChangeId = signal<string | null>(null);
export const insertModifierHeld = signal(false);
export const hoveredEdge = signal<HoveredEdge | null>(null);
/** True while this graph shows a drag that started in another graph window. */
export const remoteDrag = signal(false);
/**
 * True once this window has received drag events for the relayed drag. VS Code blocks webviews from drags that pass
 * over workbench UI first unless Shift is held, so until then this window may not be able to accept the drop.
 */
export const remoteDragReceived = signal(false);
/** The changes of a drag that started in another graph window, as that window resolved them. */
export const remoteDragSourceIds = signal<FullChangeId[] | null>(null);
/** The changes being dragged: the whole selection when the dragged change is part of a multi-selection. */
export const dragSourceIds = computed<FullChangeId[]>(() => {
  const remote = remoteDragSourceIds.value;
  if (remote) {
    return remote;
  }
  const start = dragStartChangeId.value as FullChangeId | null;
  if (!start) {
    return [];
  }
  const selection = selectedNodes.value;
  return selection.size > 1 && selection.has(start) ? [start, ...[...selection].filter((id) => id !== start)] : [start];
});
export const edgeHighlight = computed(() => {
  // The edge a drop landed on stays highlighted while its menu is open.
  const menu = edgeDropMenu.value;
  if (menu) {
    return menu.highlight;
  }
  const edge = hoveredEdge.value;
  if (!edge || !insertModifierHeld.value || dragBookmarkName.value) {
    return null;
  }
  return computeEdgeHighlight(currentChanges.value, edge, dragSourceIds.value);
});
/** The drop target frame gives way to the edge highlight. */
export const visibleDropTargetId = computed(() => (edgeHighlight.value ? null : dropTargetId.value));
export const justFinishedDrag = signal(false);
export const maxPrefixLength = signal(4);
export const changeIdHorizontalOffset = signal(0);
export const isStale = signal(false);
export const isJJNotFound = signal(false);
export const isNoRepoFound = signal(false);
export const isError = signal(false);
export const graphStyle = signal("full");
export const changeDoubleClickAction = signal<string>(DEFAULT_CHANGE_DOUBLE_CLICK_ACTION);
export const showTooltips = signal(true);
export const showChangedFiles = signal(false);
export const expandedFileLists = signal<Set<FullChangeId>>(new Set());
export type ChangedFilesState = ChangedFile[] | "loading" | "error";
// Changed files keyed by commit id: a commit id pins the content, so a loaded file list never goes stale.
export const changedFilesCache = signal<Map<string, ChangedFilesState>>(new Map());
export const selectedFiles = signal<FileSelection | null>(null);
// The last loaded file list of each change, shown while the list of a rewritten commit loads
// so that expanded changes never collapse in between.
export const lastChangedFiles = signal<Map<FullChangeId, ChangedFile[]>>(new Map());
// Expanded hunk lists keyed by fileKey(changeId, path), so they stay open while a change is rewritten.
export const expandedFileHunks = signal<Set<string>>(new Set());
export type FileHunksState = FileHunk[] | "loading" | "error";
// Hunks keyed by fileKey(commitId, path): a commit id pins the content, so loaded hunks never go stale.
export const fileHunksCache = signal<Map<string, FileHunksState>>(new Map());
// The last loaded hunks keyed by fileKey(changeId, path), shown while the hunks of a rewritten
// commit load.
export const lastFileHunks = signal<Map<string, FileHunk[]>>(new Map());
// Selected hunks of a single change, keyed by hunkSelectionKey(path, hunk).
export const selectedHunks = signal<FileSelection | null>(null);
export type HunkRange = Pick<FileHunk, "oldStart" | "oldLines" | "newStart" | "newLines">;
export interface DraggedFiles {
  changeId: FullChangeId;
  // The paths to move, including the source paths of renamed files.
  paths: string[];
}
export const dragFiles = signal<DraggedFiles | null>(null);
export interface DraggedHunks {
  changeId: FullChangeId;
  hunks: { path: string; hunk: HunkRange }[];
}
export const dragHunks = signal<DraggedHunks | null>(null);
export const supportsTagTracking = signal(false);
export const currentWorkspace = signal<string | null>(null);
export const scrollY = signal(0);
export const offsetWidth = signal(0);
export const tooltipTimeout = signal<ReturnType<typeof setTimeout> | null>(null);
export const tooltipHideTimeout = signal<ReturnType<typeof setTimeout> | null>(null);
export const diffStatsPrefetchTimeout = signal<ReturnType<typeof setTimeout> | null>(null);

interface ContextMenuState {
  change: RegularChangeNode;
  clientX: number;
  clientY: number;
  changeDoubleClickAction: string;
}

interface RebaseMenuState {
  sourceId: FullChangeId;
  sourceIds: FullChangeId[];
  targetId: FullChangeId;
  targetChange: RegularChangeNode;
  clientX: number;
  clientY: number;
}

interface TooltipState {
  change: RegularChangeNode;
  pageX: number;
  pageY: number;
}

export const contextMenu = signal<ContextMenuState | null>(null);
export const rebaseMenu = signal<RebaseMenuState | null>(null);
export const tooltip = signal<TooltipState | null>(null);
export const diffStatsCache = signal<Map<string, DiffStats>>(new Map());

export interface HighlightState {
  focalId: string;
  connectedIds: Set<string>;
}
export const connectedHighlight = signal<HighlightState | null>(null);

export interface PendingGraphUpdate {
  changes: ChangeNode[];
  laneInfo: import("../../graph-protocol").ChangeIdGraph;
  changeDoubleClickAction: string;
  graphStyle: string;
  maxPrefixLength: number;
  offsetWidth: number;
  preserveScroll: boolean;
  showTooltips: boolean;
  showChangedFiles: boolean;
  supportsTagTracking: boolean;
  currentWorkspace: string | undefined;
}

interface PillContextMenuState {
  type: "bookmark" | "tag" | "workspace";
  name: string;
  clientX: number;
  clientY: number;
  synced?: boolean;
  remotes?: string[];
  unsyncedRemotes?: string[];
  untrackedRemotes?: string[];
  pendingRemotes?: boolean;
  /** When set, the ref is being pushed: show only a "Cancel Push" action. */
  cancelPush?: boolean;
}

export const pillContextMenu = signal<PillContextMenuState | null>(null);

interface RemoteRefContextMenuState {
  type: "bookmark" | "tag";
  name: string;
  remote: string;
  change: RegularChangeNode;
  clientX: number;
  clientY: number;
  changeDoubleClickAction: string;
  pendingStatus?: boolean;
  action?: "delete" | "push" | "track";
  /** When set, the ref is being deleted from the remote: show only a "Cancel Deletion" action. */
  cancelDelete?: boolean;
}

export const remoteRefContextMenu = signal<RemoteRefContextMenuState | null>(null);

interface FileContextMenuState {
  change: RegularChangeNode;
  file: ChangedFile;
  /** The files the menu acts on: the selection when the clicked file is part of it, otherwise just that file. */
  files: ChangedFile[];
  clientX: number;
  clientY: number;
}

export const fileContextMenu = signal<FileContextMenuState | null>(null);

/** Identifies a hunk by its file and line ranges, which stay valid while the hunks reload. */
export function hunkSelectionKey(path: string, hunk: HunkRange): string {
  return `${path}\n${hunk.oldStart},${hunk.oldLines},${hunk.newStart},${hunk.newLines}`;
}

export function parseHunkSelectionKey(key: string): { path: string; hunk: HunkRange } {
  const separator = key.lastIndexOf("\n");
  const [oldStart, oldLines, newStart, newLines] = key
    .slice(separator + 1)
    .split(",")
    .map(Number);
  return { path: key.slice(0, separator), hunk: { oldStart, oldLines, newStart, newLines } };
}

/**
 * Whether a changed file can be expanded into hunks: only files modified in place with line
 * changes. Added, deleted, renamed and copied files always form a single hunk.
 */
export function canExpandHunks(file: ChangedFile): boolean {
  return file.type === "M" && !(file.linesAdded === 0 && file.linesRemoved === 0);
}

export function fileKey(id: string, path: string): string {
  return `${id}\n${path}`;
}

export function setFileHunksExpanded(changeId: FullChangeId, paths: Iterable<string>, expanded: boolean) {
  const next = new Set(expandedFileHunks.value);
  for (const path of paths) {
    if (expanded) {
      next.add(fileKey(changeId, path));
    } else {
      next.delete(fileKey(changeId, path));
    }
  }
  expandedFileHunks.value = next;
}

export function setFileListsExpanded(changeIds: Iterable<FullChangeId>, expanded: boolean) {
  const next = new Set(expandedFileLists.value);
  for (const changeId of changeIds) {
    if (expanded) {
      next.add(changeId);
    } else {
      next.delete(changeId);
    }
  }
  expandedFileLists.value = next;
}

export const pendingGraphUpdate = signal<PendingGraphUpdate | null>(null);

export const pushingBookmarks = signal<Set<string>>(new Set());
export const pushingTags = signal<Set<string>>(new Set());
export const deletingBookmarks = signal<Set<string>>(new Set());
export const deletingTags = signal<Set<string>>(new Set());

export function clearAllTooltipTimers() {
  if (diffStatsPrefetchTimeout.value) {
    clearTimeout(diffStatsPrefetchTimeout.value);
    diffStatsPrefetchTimeout.value = null;
  }
  if (tooltipTimeout.value) {
    clearTimeout(tooltipTimeout.value);
    tooltipTimeout.value = null;
  }
  if (tooltipHideTimeout.value) {
    clearTimeout(tooltipHideTimeout.value);
    tooltipHideTimeout.value = null;
  }
}

export type EdgeDropMenuState = {
  targetId: FullChangeId;
  position: DropPosition;
  highlight: EdgeHighlight;
  clientX: number;
  clientY: number;
} & ({ kind: "changes"; sourceIds: FullChangeId[] } | { kind: "files"; fromChangeId: FullChangeId; paths: string[] });

export const edgeDropMenu = signal<EdgeDropMenuState | null>(null);

interface HunkDropMenuState {
  fromChangeId: FullChangeId;
  toChangeId: FullChangeId;
  hunks: { path: string; hunk: HunkRange }[];
  clientX: number;
  clientY: number;
}

export const hunkDropMenu = signal<HunkDropMenuState | null>(null);

export function isAnyMenuOpen(): boolean {
  return (
    contextMenu.value !== null ||
    rebaseMenu.value !== null ||
    edgeDropMenu.value !== null ||
    hunkDropMenu.value !== null ||
    pillContextMenu.value !== null ||
    remoteRefContextMenu.value !== null ||
    fileContextMenu.value !== null
  );
}

export function closeAllMenus() {
  contextMenu.value = null;
  rebaseMenu.value = null;
  edgeDropMenu.value = null;
  hunkDropMenu.value = null;
  pillContextMenu.value = null;
  remoteRefContextMenu.value = null;
  fileContextMenu.value = null;
  // The commit detail popup must never be visible alongside an open menu, and
  // pending tooltip timers must not fire while a menu is open, so hide the
  // popup and cancel its timers whenever menus are closed or swapped out.
  tooltip.value = null;
  clearAllTooltipTimers();
}
