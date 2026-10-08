import { signal, useComputed, type ReadonlySignal } from "@preact/signals";
import { type HTMLAttributes, type RefObject } from "preact";
import { Fragment, memo } from "preact/compat";
import { useMemo } from "preact/hooks";
import { editChange } from "../edit-change";
import { dropOnEdge, useDragDrop } from "../hooks/use-drag-drop";
import { createTooltipTimers } from "../hooks/tooltip-timers";
import dragGhostStyles from "./drag-ghost.module.css";
import {
  BookmarkPill,
  BookmarkPreviewPill,
  BookmarkPushIcon,
  RemoteBookmarkPill,
  RemoteTagPill,
  TagPill,
  WorkspacePill,
} from "./pill";
import styles from "./change-node.module.css";
import {
  selectedNodes,
  changeDoubleClickAction,
  contextMenu,
  tooltip,
  isDragging,
  justFinishedDrag,
  dropTargetId,
  bookmarkDropPreviewTargetId,
  graphStyle,
  postMessage,
  showTooltips,
  showChangedFiles,
  expandedFileLists,
  changedFilesCache,
  setFileListsExpanded,
  selectedFiles,
  dragFiles,
  dragBookmarkName,
  dragStartChangeId,
  pillContextMenu,
  currentWorkspace,
  remoteRefContextMenu,
  fileContextMenu,
  closeAllMenus,
  isAnyMenuOpen,
  clearAllTooltipTimers,
  pushingBookmarks,
  pushingTags,
  deletingBookmarks,
  deletingTags,
  supportsTagTracking,
  hoveredChangeId,
  currentChanges,
  connectedHighlight,
  selectionAnchorId,
  hoveredEdge,
  edgeHighlight,
  visibleDropTargetId,
} from "../signals";
import { computeSelection } from "../selection";
import { computeFileSelection, draggedFilePaths } from "../file-selection";
import { fileNameOf, groupChangedFiles } from "../changed-file-groups";
import { edgeCursorFor, type EdgeCursor } from "../insert-edges";
import { clearHoveredEdge, insertSideAt, updateHoveredEdge } from "../edge-hover";
import { SWIMLANE_WIDTH, CHANGE_ID_RIGHT_PADDING, rootChangeId } from "../types";
import {
  getUniqueId,
  type ChangedFile,
  type LaneNode,
  type ChangeNode,
  type RegularChangeNode,
} from "../../../graph-protocol";
import { abbreviateName, cx, escapeInvisibleChars } from "../utils";

const transparentDragImage = new Image();
transparentDragImage.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

function shouldShowTooltip(change: ChangeNode): change is RegularChangeNode {
  return change.branchType !== "~" && change.id.changeId !== rootChangeId;
}

function isOverTooltipTarget(e: MouseEvent): boolean {
  const target = e.target as HTMLElement;
  return !!target.closest?.('[data-role="text-content"]') && !target.closest?.('[data-role="files-toggle"]');
}

interface Props {
  change: ChangeNode;
  index: number;
  nodeData: LaneNode | null;
  changeIdRef?: RefObject<HTMLDivElement>;
  compact: boolean;
}

const noEdge = signal(false);

function canHaveChangedFiles(change: RegularChangeNode): boolean {
  return !change.elided && (!change.isEmpty || change.conflict);
}

// A change with its changed files expanded has its bottom edge below them.
interface FileAreaEdge {
  edgeBottom: ReadonlySignal<boolean>;
  edgeCursor: ReadonlySignal<EdgeCursor | null>;
}

function fileAreaEdgeProps(change: RegularChangeNode, edge: FileAreaEdge) {
  const cursor = edge.edgeCursor.value;
  return {
    class: cx(
      edge.edgeBottom.value && styles.edgeBottom,
      cursor === "bottom" && styles.edgeCursorBottom,
      cursor === "shared" && styles.edgeCursorShared,
    ),
    "data-edge-bottom": edge.edgeBottom.value ? "" : undefined,
    "data-edge-cursor": cursor ?? undefined,
    onMouseEnter: (e: MouseEvent) => updateHoveredEdge(change, e, "bottom"),
    onMouseMove: (e: MouseEvent) => updateHoveredEdge(change, e, "bottom"),
    onMouseLeave: () => clearHoveredEdge(change),
    onDragOver: (e: DragEvent) => {
      updateHoveredEdge(change, e, "bottom");
      if (edgeHighlight.value) {
        e.preventDefault();
        e.dataTransfer!.dropEffect = "move";
      }
    },
    onDragLeave: (e: DragEvent) => {
      const relatedTarget = e.relatedTarget as HTMLElement | null;
      if (relatedTarget && (e.currentTarget as HTMLElement).contains(relatedTarget)) {
        return;
      }
      clearHoveredEdge(change);
    },
    onDrop: (e: DragEvent) => {
      if (dropOnEdge(change, e, "bottom")) {
        e.preventDefault();
      }
    },
    onDblClick: (e: MouseEvent) => {
      if ((e.ctrlKey || e.metaKey) && insertSideAt(change, e, "bottom")) {
        postMessage({ command: "insertNewChange", changeId: change.id.changeId, position: "before" });
      }
    },
  };
}

export function ChangeNodeRow({ change, index, nodeData, changeIdRef, compact }: Props) {
  const { startHoverTimers, clearHoverTimers, clearHideTimer, scheduleHideTooltip } = createTooltipTimers();
  const isElided = change.branchType === "~";
  // Per-row computed signal to re-render only rows whose selection changed.
  const isSelected = useComputed(() => change.branchType !== "~" && selectedNodes.value.has(change.id.changeId));
  const filesExpanded = useComputed(
    () => showChangedFiles.value && change.branchType !== "~" && expandedFileLists.value.has(change.id.changeId),
  );
  const filesState =
    filesExpanded.value && change.branchType !== "~" ? changedFilesCache.value.get(change.commitId) : undefined;
  const hasFileArea = Array.isArray(filesState) || filesState === "error";
  const rowZones = hasFileArea ? "top" : "both";
  const dragProps = useDragDrop(change, rowZones);
  const edgeTop = useComputed(
    () => change.branchType !== "~" && (edgeHighlight.value?.top.has(change.id.changeId) ?? false),
  );
  const edgeBottom = useComputed(
    () => change.branchType !== "~" && (edgeHighlight.value?.bottom.has(change.id.changeId) ?? false),
  );
  const edgeCursor = useComputed(() =>
    change.branchType === "~" ? null : edgeCursorFor(edgeHighlight.value, hoveredEdge.value, change.id.changeId),
  );
  const topEdgeCursor = useComputed(() => (hoveredEdge.value?.side === "top" ? edgeCursor.value : null));
  const bottomEdgeCursor = useComputed(() => (hoveredEdge.value?.side === "bottom" ? edgeCursor.value : null));
  const fileAreaEdge = useMemo(() => ({ edgeBottom, edgeCursor: bottomEdgeCursor }), [edgeBottom, bottomEdgeCursor]);
  const graphW = SWIMLANE_WIDTH * (nodeData?.numLanesActiveVisually ?? 0);

  const handleClick = (e: MouseEvent) => {
    if (isDragging.value || justFinishedDrag.value) {
      return;
    }
    if ((e.ctrlKey || e.metaKey) && insertSideAt(change, e, rowZones) !== null) {
      return;
    }
    if (isElided && !e.shiftKey) {
      return;
    }
    selectedFiles.value = null;

    const outcome = computeSelection(currentChanges.value, index, selectionAnchorId.value, selectedNodes.value, {
      shiftKey: e.shiftKey,
      toggleKey: e.ctrlKey || e.metaKey,
    });
    if (outcome.kind === "warning") {
      postMessage({ command: "showWarning", message: outcome.message });
      return;
    }
    selectedNodes.value = outcome.selection;
    selectionAnchorId.value = outcome.anchor;
    postMessage({
      command: "selectChange",
      selectedNodes: Array.from(outcome.selection),
    });
  };

  const handleDoubleClick = (e: MouseEvent) => {
    if (change.branchType === "~") {
      return;
    }
    const side = (e.ctrlKey || e.metaKey) && insertSideAt(change, e, rowZones);
    if (side) {
      postMessage({
        command: "insertNewChange",
        changeId: change.id.changeId,
        position: side === "top" ? "after" : "before",
      });
      return;
    }
    editChange(change);
  };

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    if (isElided || change.id.changeId === rootChangeId) {
      return;
    }
    closeAllMenus();
    contextMenu.value = {
      change,
      clientX: e.clientX,
      clientY: e.clientY,
      changeDoubleClickAction: changeDoubleClickAction.value,
    };
  };

  const tryStartTooltip = (e: MouseEvent) => {
    clearHideTimer();
    if (isDragging.value || isAnyMenuOpen() || !showTooltips.value || edgeHighlight.value) {
      return;
    }
    if (shouldShowTooltip(change) && isOverTooltipTarget(e)) {
      startHoverTimers(change, e.pageX, e.pageY);
    }
  };

  const handleMouseEnter = (e: MouseEvent) => {
    if (!isDragging.value) {
      const childIds: string[] = [];
      for (const c of currentChanges.value) {
        if (change.branchType !== "~" && c.parentChangeIds?.includes(change.id.changeId)) {
          childIds.push(getUniqueId(c));
        }
      }
      const id = getUniqueId(change);
      connectedHighlight.value = {
        focalId: id,
        connectedIds: new Set([id, ...(change.parentChangeIds ?? []), ...childIds]),
      };
    }
    hoveredChangeId.value = getUniqueId(change);
    updateHoveredEdge(change, e, rowZones);
    tryStartTooltip(e);
  };

  const handleMouseMove = (e: MouseEvent) => {
    updateHoveredEdge(change, e, rowZones);
    clearHoverTimers();
    tryStartTooltip(e);
  };

  const handleMouseLeave = () => {
    hoveredEdge.value = null;
    connectedHighlight.value = null;
    hoveredChangeId.value = null;
    clearHoverTimers();
    clearHideTimer();
    scheduleHideTooltip();
  };

  const modeClasses = cx(compact && styles.compactMode);

  const changeUniqueId = getUniqueId(change);

  return (
    <>
      <ChangeNodeClass
        changeId={changeUniqueId}
        currentWorkingCopy={change.branchType !== "~" && change.currentWorkingCopy}
        isElided={isElided}
        selected={isSelected}
        edgeTop={edgeTop}
        edgeBottom={hasFileArea ? noEdge : edgeBottom}
        edgeCursor={hasFileArea ? topEdgeCursor : edgeCursor}
        modeClasses={modeClasses}
        data-change-id={changeUniqueId}
        onClick={handleClick}
        onDblClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        onMouseEnter={handleMouseEnter}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        {...dragProps}
      >
        <div class={styles.changeIdLeft} data-role="change-id" ref={changeIdRef}>
          {change.branchType !== "~" && (
            <>
              {change.conflict && (
                <span class={styles.conflictIndicator} data-role="conflict-indicator">
                  ✗
                </span>
              )}
              <span class={styles.changeIdPrefix}>{change.id.changeIdPrefix}</span>
              <span class={styles.changeIdSuffix}>{change.id.changeIdSuffix}</span>
              {change.id.changeOffset && <span class={styles.changeIdOffset}>/{change.id.changeOffset}</span>}
            </>
          )}
        </div>
        {change.branchType === "~" ? (
          <ElidedTextContent graphW={graphW} />
        ) : (
          <MemoizedChangeNodeTextContent
            change={change}
            graphW={graphW}
            filesExpanded={filesExpanded.value}
            loadingFiles={filesState === "loading"}
          />
        )}
      </ChangeNodeClass>
      {change.branchType !== "~" && Array.isArray(filesState) && filesState.length > 0 && (
        <MemoizedChangedFileRows change={change} files={filesState} graphW={graphW} bottomEdge={fileAreaEdge} />
      )}
      {change.branchType !== "~" && Array.isArray(filesState) && filesState.length === 0 && (
        <FileRowMessage change={change} graphW={graphW} bottomEdge={fileAreaEdge}>
          No changed files
        </FileRowMessage>
      )}
      {change.branchType !== "~" && filesState === "error" && (
        <FileRowMessage change={change} graphW={graphW} bottomEdge={fileAreaEdge}>
          Failed to load changed files
        </FileRowMessage>
      )}
    </>
  );
}

function ChangeNodeClass({
  changeId,
  currentWorkingCopy,
  isElided,
  selected,
  edgeTop,
  edgeBottom,
  edgeCursor,
  modeClasses,
  children,
  ...rest
}: {
  changeId: string;
  currentWorkingCopy: boolean;
  isElided: boolean;
  selected: ReadonlySignal<boolean>;
  edgeTop: ReadonlySignal<boolean>;
  edgeBottom: ReadonlySignal<boolean>;
  edgeCursor: ReadonlySignal<EdgeCursor | null>;
  modeClasses: string;
  children?: preact.ComponentChildren;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      class={cx(
        styles.changeNode,
        currentWorkingCopy && styles.workingCopy,
        isElided && styles.elidedNode,
        selected.value && styles.selected,
        visibleDropTargetId.value === changeId && styles.dropTarget,
        edgeTop.value && styles.edgeTop,
        edgeBottom.value && styles.edgeBottom,
        edgeCursor.value === "top" && styles.edgeCursorTop,
        edgeCursor.value === "bottom" && styles.edgeCursorBottom,
        edgeCursor.value === "shared" && styles.edgeCursorShared,
        modeClasses,
      )}
      data-selected={selected.value ? "" : undefined}
      data-edge-top={edgeTop.value ? "" : undefined}
      data-edge-bottom={edgeBottom.value ? "" : undefined}
      data-edge-cursor={edgeCursor.value ?? undefined}
      {...rest}
    >
      {children}
    </div>
  );
}

const ElidedTextContent = memo(function ElidedTextContent({ graphW }: { graphW: number }) {
  const style = graphStyle.value;
  return (
    <div
      class={styles.textContent}
      data-role="text-content"
      style={{
        "--graph-width": `${graphW}px`,
        "--change-id-right-padding": `${CHANGE_ID_RIGHT_PADDING}px`,
      }}
    >
      <div></div>
      {style !== "compact" && <div class={styles.description}></div>}
    </div>
  );
});

function BookmarkDropPreview({ changeId }: { changeId: string }) {
  const name = dragBookmarkName.value;
  if (!name || bookmarkDropPreviewTargetId.value !== changeId) {
    return null;
  }
  return <BookmarkPreviewPill data-bookmark-preview={name}>{abbreviateName(name)}</BookmarkPreviewPill>;
}

const MemoizedChangeNodeTextContent = memo(function ChangeNodeTextContent({
  change,
  graphW,
  filesExpanded,
  loadingFiles,
}: {
  change: RegularChangeNode;
  graphW: number;
  filesExpanded: boolean;
  loadingFiles: boolean;
}) {
  const localBookmarkNames = new Set(change.localBookmarks.map((b) => b.name));
  const localTagNames = new Set(change.localTags.map((t) => t.name));
  const style = graphStyle.value;

  return (
    <div
      class={styles.textContent}
      data-role="text-content"
      style={{
        "--graph-width": `${graphW}px`,
        "--change-id-right-padding": `${CHANGE_ID_RIGHT_PADDING}px`,
      }}
    >
      <div>
        {showChangedFiles.value && <FilesToggle change={change} expanded={filesExpanded} loading={loadingFiles} />}
        {change.workingCopies?.map((wc) => (
          <WorkspacePill
            key={wc}
            data-workspace={wc}
            title={wc === currentWorkspace.value ? undefined : "Right-click for workspace actions"}
            onContextMenu={
              wc === currentWorkspace.value
                ? undefined
                : (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    closeAllMenus();
                    pillContextMenu.value = {
                      type: "workspace",
                      name: wc,
                      clientX: e.clientX,
                      clientY: e.clientY,
                    };
                  }
            }
          >
            {escapeInvisibleChars(wc)}
          </WorkspacePill>
        ))}
        {change.localBookmarks.map((b) => (
          <BookmarkPill
            key={b.name}
            conflict={b.conflict}
            synced={b.synced}
            data-bookmark={b.name}
            data-unsynced={!b.synced && !b.conflict ? "" : undefined}
            data-conflicted={b.conflict ? "" : undefined}
            draggable={!pushingBookmarks.value.has(b.name)}
            dragSource={dragBookmarkName.value === b.name}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              closeAllMenus();
              if (pushingBookmarks.value.has(b.name)) {
                pillContextMenu.value = {
                  type: "bookmark",
                  name: b.name,
                  clientX: e.clientX,
                  clientY: e.clientY,
                  cancelPush: true,
                };
                return;
              }
              pillContextMenu.value = {
                type: "bookmark",
                name: b.name,
                clientX: e.clientX,
                clientY: e.clientY,
                synced: b.synced,
                pendingRemotes: true,
              };
              postMessage({ command: "getBookmarkTrackingRemotes", bookmark: b.name });
            }}
            onDragStart={(e) => {
              e.stopPropagation();
              dragBookmarkName.value = b.name;
              isDragging.value = true;
              clearAllTooltipTimers();
              tooltip.value = null;
              e.dataTransfer!.setData("text/plain", "");
              e.dataTransfer!.effectAllowed = "move";
              e.dataTransfer!.setDragImage(transparentDragImage, 0, 0);
            }}
            onDragEnd={(e) => {
              e.stopPropagation();
              isDragging.value = false;
              dragBookmarkName.value = null;
              dropTargetId.value = null;
              hoveredEdge.value = null;
            }}
          >
            {!b.synced &&
              !b.conflict &&
              (pushingBookmarks.value.has(b.name) ? (
                <BookmarkPushIcon pushing={true} title="Pushing..." />
              ) : (
                <BookmarkPushIcon
                  title="Push to all tracking remotes"
                  onClick={(e) => {
                    e.stopPropagation();
                    const newSet = new Set(pushingBookmarks.value);
                    newSet.add(b.name);
                    pushingBookmarks.value = newSet;
                    postMessage({ command: "pushBookmark", bookmark: b.name });
                  }}
                />
              ))}
            {abbreviateName(b.name)}
          </BookmarkPill>
        ))}
        <BookmarkDropPreview changeId={change.id.changeId} />
        {change.remoteBookmarks
          .filter((b) => !localBookmarkNames.has(b.name))
          .map((b) => (
            <RemoteBookmarkPill
              key={b.name + "@" + b.remote}
              data-remote-bookmark={b.name}
              data-remote={b.remote}
              title={b.remote === "git" ? undefined : "Right-click for remote actions"}
              onContextMenu={
                b.remote === "git"
                  ? undefined
                  : (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      closeAllMenus();
                      if (deletingBookmarks.value.has(b.name)) {
                        remoteRefContextMenu.value = {
                          type: "bookmark",
                          name: b.name,
                          remote: b.remote,
                          change,
                          clientX: e.clientX,
                          clientY: e.clientY,
                          changeDoubleClickAction: changeDoubleClickAction.value,
                          cancelDelete: true,
                        };
                        return;
                      }
                      remoteRefContextMenu.value = {
                        type: "bookmark",
                        name: b.name,
                        remote: b.remote,
                        change,
                        clientX: e.clientX,
                        clientY: e.clientY,
                        changeDoubleClickAction: changeDoubleClickAction.value,
                        pendingStatus: true,
                      };
                      postMessage({
                        command: "getRemoteRefStatus",
                        refType: "bookmark",
                        name: b.name,
                        remote: b.remote,
                      });
                    }
              }
            >
              {deletingBookmarks.value.has(b.name) && <BookmarkPushIcon pushing={true} title="Deleting..." />}
              {abbreviateName(b.name)}@{b.remote}
            </RemoteBookmarkPill>
          ))}
        {change.localTags.map((t) => (
          <TagPill
            key={t.name}
            conflict={t.conflict}
            synced={t.synced}
            data-tag={t.name}
            data-unsynced={!t.synced && !t.conflict ? "" : undefined}
            data-conflicted={t.conflict ? "" : undefined}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              closeAllMenus();
              if (pushingTags.value.has(t.name)) {
                pillContextMenu.value = {
                  type: "tag",
                  name: t.name,
                  clientX: e.clientX,
                  clientY: e.clientY,
                  cancelPush: true,
                };
                return;
              }
              pillContextMenu.value = {
                type: "tag",
                name: t.name,
                clientX: e.clientX,
                clientY: e.clientY,
                pendingRemotes: true,
              };
              postMessage({
                command: supportsTagTracking.value ? "getTagTrackingRemotes" : "getTagPushRemotes",
                tag: t.name,
              });
            }}
          >
            {(pushingTags.value.has(t.name) || (supportsTagTracking.value && !t.synced && !t.conflict)) &&
              (pushingTags.value.has(t.name) ? (
                <BookmarkPushIcon pushing={true} title="Pushing..." />
              ) : (
                <BookmarkPushIcon
                  title="Push to all tracking remotes"
                  onClick={(e) => {
                    e.stopPropagation();
                    const newSet = new Set(pushingTags.value);
                    newSet.add(t.name);
                    pushingTags.value = newSet;
                    postMessage({ command: "pushTag", tag: t.name });
                  }}
                />
              ))}
            {abbreviateName(t.name)}
          </TagPill>
        ))}
        {change.remoteTags
          .filter((t) => !localTagNames.has(t.name))
          .map((t) => (
            <RemoteTagPill
              key={t.name + "@" + t.remote}
              data-remote-tag={t.name}
              data-remote={t.remote}
              title={t.remote === "git" ? undefined : "Right-click for remote actions"}
              onContextMenu={
                t.remote === "git"
                  ? undefined
                  : (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      closeAllMenus();
                      if (deletingTags.value.has(t.name)) {
                        remoteRefContextMenu.value = {
                          type: "tag",
                          name: t.name,
                          remote: t.remote,
                          change,
                          clientX: e.clientX,
                          clientY: e.clientY,
                          changeDoubleClickAction: changeDoubleClickAction.value,
                          cancelDelete: true,
                        };
                        return;
                      }
                      remoteRefContextMenu.value = {
                        type: "tag",
                        name: t.name,
                        remote: t.remote,
                        change,
                        clientX: e.clientX,
                        clientY: e.clientY,
                        changeDoubleClickAction: changeDoubleClickAction.value,
                        pendingStatus: true,
                      };
                      postMessage({
                        command: "getRemoteRefStatus",
                        refType: "tag",
                        name: t.name,
                        remote: t.remote,
                      });
                    }
              }
            >
              {deletingTags.value.has(t.name) && <BookmarkPushIcon pushing={true} title="Deleting..." />}
              {abbreviateName(t.name)}@{t.remote}
            </RemoteTagPill>
          ))}
        <span>{change.label}</span>
        {style === "compact" && !change.mine && change.authorName && (
          <span class={styles.authorSubdued}>{change.authorName}</span>
        )}
      </div>
      {style !== "compact" && <div class={styles.description}>{change.description}</div>}
    </div>
  );
});

function FilesToggle({
  change,
  expanded,
  loading,
}: {
  change: RegularChangeNode;
  expanded: boolean;
  loading: boolean;
}) {
  if (!canHaveChangedFiles(change)) {
    return <span class={styles.filesToggle} />;
  }
  return (
    <span
      class={cx(
        styles.filesToggle,
        "codicon",
        loading ? "codicon-loading codicon-modifier-spin" : expanded ? "codicon-chevron-down" : "codicon-chevron-right",
      )}
      data-role="files-toggle"
      role="button"
      aria-expanded={expanded}
      title={expanded ? "Hide Changed Files" : "Show Changed Files"}
      onClick={(e) => {
        e.stopPropagation();
        setFileListsExpanded([change.id.changeId], !expanded);
      }}
      onDblClick={(e) => e.stopPropagation()}
    />
  );
}

function fileRowStyle(graphW: number) {
  return {
    "--graph-width": `${graphW}px`,
    "--change-id-right-padding": `${CHANGE_ID_RIGHT_PADDING}px`,
  };
}

function FileRowMessage({
  change,
  graphW,
  bottomEdge,
  children,
}: {
  change: RegularChangeNode;
  graphW: number;
  bottomEdge: FileAreaEdge;
  children: preact.ComponentChildren;
}) {
  const { class: edgeClass, ...edgeProps } = fileAreaEdgeProps(change, bottomEdge);
  return (
    <div
      class={cx(styles.fileRow, styles.fileRowMessage, edgeClass)}
      data-role="changed-file-message"
      style={fileRowStyle(graphW)}
      {...edgeProps}
    >
      {children}
    </div>
  );
}

const MemoizedChangedFileRows = memo(function ChangedFileRows({
  change,
  files,
  graphW,
  bottomEdge,
}: {
  change: RegularChangeNode;
  files: ChangedFile[];
  graphW: number;
  bottomEdge: FileAreaEdge;
}) {
  const groups = groupChangedFiles(files);
  const ordered = groups.flatMap((g) => g.files);
  const last = ordered.at(-1);
  return (
    <>
      {groups.map((group) => (
        <Fragment key={group.directory}>
          {group.directory !== "" && (
            <div
              class={cx(styles.fileRow, styles.fileGroupHeader)}
              style={fileRowStyle(graphW)}
              title={group.directory}
              data-role="changed-file-group"
              data-group-of={change.id.changeId}
              data-directory={group.directory}
            >
              <span class={styles.fileGroupDirectory}>{group.directory}</span>
            </div>
          )}
          {group.files.map((f) => (
            <FileRow
              key={f.path}
              change={change}
              file={f}
              files={ordered}
              grouped={group.directory !== ""}
              graphW={graphW}
              bottomEdge={f === last ? bottomEdge : undefined}
            />
          ))}
        </Fragment>
      ))}
    </>
  );
});

function FileRow({
  change,
  file,
  files,
  grouped,
  graphW,
  bottomEdge,
}: {
  change: RegularChangeNode;
  file: ChangedFile;
  files: ChangedFile[];
  grouped: boolean;
  graphW: number;
  bottomEdge?: FileAreaEdge;
}) {
  const edge = bottomEdge ? fileAreaEdgeProps(change, bottomEdge) : null;
  const { class: edgeClass, ...edgeProps } = edge ?? { class: "" };
  const selection = selectedFiles.value;
  const selected = selection?.changeId === change.id.changeId && selection.paths.has(file.path);
  const isInsertEdgeEvent = (e: MouseEvent) =>
    !!bottomEdge && (e.ctrlKey || e.metaKey) && insertSideAt(change, e, "bottom") !== null;
  return (
    <div
      class={cx(styles.fileRow, grouped && styles.groupedFileRow, selected && styles.selected, edgeClass)}
      style={fileRowStyle(graphW)}
      title={`${file.path}
Double-click to open diff`}
      data-role="changed-file"
      data-file-of={change.id.changeId}
      data-path={file.path}
      data-status={file.type.toLowerCase()}
      data-conflict={file.conflict ? "" : undefined}
      data-selected={selected ? "" : undefined}
      draggable={change.id.changeId !== rootChangeId}
      {...edgeProps}
      onClick={(e) => {
        if (isDragging.value || justFinishedDrag.value || isInsertEdgeEvent(e)) {
          return;
        }
        selectedFiles.value = computeFileSelection(
          selectedFiles.value,
          change.id.changeId,
          files.map((f) => f.path),
          file.path,
          { shiftKey: e.shiftKey, toggleKey: e.ctrlKey || e.metaKey },
        );
      }}
      onDblClick={(e) => {
        if (isInsertEdgeEvent(e)) {
          edge?.onDblClick(e);
          return;
        }
        selectedFiles.value = { changeId: change.id.changeId, paths: new Set([file.path]), anchor: file.path };
        postMessage({
          command: "openFileDiff",
          changeId: change.id.changeId,
          path: file.path,
          status: file.type,
          ...(file.renamedFrom ? { renamedFrom: file.renamedFrom } : {}),
        });
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        closeAllMenus();
        fileContextMenu.value = {
          change,
          file,
          clientX: e.clientX,
          clientY: e.clientY,
        };
      }}
      onDragStart={(e) => {
        const draggedPaths = draggedFilePaths(
          selectedFiles.value,
          change.id.changeId,
          files.map((f) => f.path),
          file.path,
        );
        const dragged = files.filter((f) => draggedPaths.includes(f.path));
        dragStartChangeId.value = null;
        dragBookmarkName.value = null;
        dragFiles.value = {
          changeId: change.id.changeId,
          paths: dragged.flatMap((f) => (f.renamedFrom ? [f.path, f.renamedFrom] : [f.path])),
        };
        isDragging.value = true;
        clearAllTooltipTimers();
        tooltip.value = null;
        e.dataTransfer!.setData("text/plain", file.path);
        e.dataTransfer!.effectAllowed = "copyMove";

        const ghost = document.createElement("div");
        ghost.className = dragGhostStyles.dragGhost;
        ghost.textContent = file.path;
        if (dragged.length > 1) {
          const count = document.createElement("span");
          count.className = dragGhostStyles.dragGhostCount;
          count.textContent = `+ ${dragged.length - 1} more`;
          ghost.appendChild(count);
        }
        document.body.appendChild(ghost);
        e.dataTransfer!.setDragImage(ghost, -15, 0);
        setTimeout(() => ghost.remove(), 0);
      }}
      onDragEnd={() => {
        isDragging.value = false;
        dragFiles.value = null;
        dropTargetId.value = null;
        hoveredEdge.value = null;
      }}
    >
      <span class={styles.fileName} data-role="file-name">
        {fileNameOf(file.path)}
      </span>
      <span class={styles.fileStatus} data-role="file-status">
        {file.type}
        {file.conflict ? "!" : ""}
      </span>
    </div>
  );
}
