import { useComputed, type ReadonlySignal } from "@preact/signals";
import { type HTMLAttributes, type RefObject } from "preact";
import { memo } from "preact/compat";
import { editChange } from "../edit-change";
import { useDragDrop } from "../hooks/use-drag-drop";
import { createTooltipTimers } from "../hooks/tooltip-timers";
import dragGhostStyles from "./drag-ghost.module.css";
import { BookmarkPill, BookmarkPushIcon, RemoteBookmarkPill, RemoteTagPill, TagPill, WorkspacePill } from "./pill";
import styles from "./change-node.module.css";
import {
  selectedNodes,
  changeDoubleClickAction,
  contextMenu,
  tooltip,
  isDragging,
  justFinishedDrag,
  dropTargetId,
  graphStyle,
  postMessage,
  showTooltips,
  showChangedFiles,
  expandedFileLists,
  changedFilesCache,
  setFileListsExpanded,
  selectedFile,
  dragFile,
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
} from "../signals";
import { computeSelection } from "../selection";
import { SWIMLANE_WIDTH, CHANGE_ID_RIGHT_PADDING, rootChangeId } from "../types";
import {
  getUniqueId,
  type ChangedFile,
  type LaneNode,
  type ChangeNode,
  type RegularChangeNode,
} from "../../../graph-protocol";
import { abbreviateName, cx, escapeInvisibleChars } from "../utils";

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

function canHaveChangedFiles(change: RegularChangeNode): boolean {
  return !change.elided && (!change.isEmpty || change.conflict);
}

export function ChangeNodeRow({ change, index, nodeData, changeIdRef, compact }: Props) {
  const dragProps = useDragDrop(change);
  const { startHoverTimers, clearHoverTimers, clearHideTimer, scheduleHideTooltip } = createTooltipTimers();
  const isElided = change.branchType === "~";
  // Per-row computed signal to re-render only rows whose selection changed.
  const isSelected = useComputed(() => change.branchType !== "~" && selectedNodes.value.has(change.id.changeId));
  const filesExpanded = useComputed(
    () => showChangedFiles.value && change.branchType !== "~" && expandedFileLists.value.has(change.id.changeId),
  );
  const filesState =
    filesExpanded.value && change.branchType !== "~" ? changedFilesCache.value.get(change.commitId) : undefined;
  const graphW = SWIMLANE_WIDTH * (nodeData?.numLanesActiveVisually ?? 0);

  const handleClick = (e: MouseEvent) => {
    if (isDragging.value || justFinishedDrag.value) {
      return;
    }
    if (isElided && !e.shiftKey) {
      return;
    }
    selectedFile.value = null;

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

  const handleDoubleClick = () => {
    if (isElided) {
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
    if (isDragging.value || isAnyMenuOpen() || !showTooltips.value) {
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
    tryStartTooltip(e);
  };

  const handleMouseMove = (e: MouseEvent) => {
    clearHoverTimers();
    tryStartTooltip(e);
  };

  const handleMouseLeave = () => {
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
        <MemoizedChangedFileRows change={change} files={filesState} graphW={graphW} />
      )}
      {change.branchType !== "~" && Array.isArray(filesState) && filesState.length === 0 && (
        <FileRowMessage graphW={graphW}>No changed files</FileRowMessage>
      )}
      {filesState === "error" && <FileRowMessage graphW={graphW}>Failed to load changed files</FileRowMessage>}
    </>
  );
}

function ChangeNodeClass({
  changeId,
  currentWorkingCopy,
  isElided,
  selected,
  modeClasses,
  children,
  ...rest
}: {
  changeId: string;
  currentWorkingCopy: boolean;
  isElided: boolean;
  selected: ReadonlySignal<boolean>;
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
        dropTargetId.value === changeId && styles.dropTarget,
        modeClasses,
      )}
      data-selected={selected.value ? "" : undefined}
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

              const ghost = document.createElement("div");
              ghost.className = cx(dragGhostStyles.dragGhost, dragGhostStyles.bookmarkDragGhost);
              ghost.textContent = escapeInvisibleChars(b.name);
              document.body.appendChild(ghost);
              e.dataTransfer!.setDragImage(ghost, -15, 0);
              setTimeout(() => ghost.remove(), 0);
            }}
            onDragEnd={(e) => {
              e.stopPropagation();
              isDragging.value = false;
              dragBookmarkName.value = null;
              dropTargetId.value = null;
            }}
          >
            {!b.synced &&
              !b.conflict &&
              b.showPushButton !== false &&
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
            {(pushingTags.value.has(t.name) ||
              (supportsTagTracking.value && !t.synced && !t.conflict && t.showPushButton !== false)) &&
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

function FileRowMessage({ graphW, children }: { graphW: number; children: preact.ComponentChildren }) {
  return (
    <div
      class={cx(styles.fileRow, styles.fileRowMessage)}
      data-role="changed-file-message"
      style={fileRowStyle(graphW)}
    >
      {children}
    </div>
  );
}

const MemoizedChangedFileRows = memo(function ChangedFileRows({
  change,
  files,
  graphW,
}: {
  change: RegularChangeNode;
  files: ChangedFile[];
  graphW: number;
}) {
  return (
    <>
      {files.map((f) => (
        <FileRow key={f.path} change={change} file={f} graphW={graphW} />
      ))}
    </>
  );
});

function FileRow({ change, file, graphW }: { change: RegularChangeNode; file: ChangedFile; graphW: number }) {
  const selected = selectedFile.value?.changeId === change.id.changeId && selectedFile.value.path === file.path;
  const separator = file.path.lastIndexOf("/");
  const fileName = file.path.slice(separator + 1);
  const directory = separator === -1 ? "" : file.path.slice(0, separator);
  return (
    <div
      class={cx(styles.fileRow, selected && styles.selected)}
      style={fileRowStyle(graphW)}
      title="Open diff"
      data-role="changed-file"
      data-file-of={change.id.changeId}
      data-path={file.path}
      data-status={file.type.toLowerCase()}
      data-conflict={file.conflict ? "" : undefined}
      data-selected={selected ? "" : undefined}
      draggable={change.id.changeId !== rootChangeId}
      onClick={() => {
        if (isDragging.value || justFinishedDrag.value) {
          return;
        }
        selectedFile.value = { changeId: change.id.changeId, path: file.path };
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
        dragStartChangeId.value = null;
        dragBookmarkName.value = null;
        dragFile.value = {
          changeId: change.id.changeId,
          path: file.path,
          ...(file.renamedFrom ? { renamedFrom: file.renamedFrom } : {}),
        };
        isDragging.value = true;
        clearAllTooltipTimers();
        tooltip.value = null;
        e.dataTransfer!.setData("text/plain", file.path);
        e.dataTransfer!.effectAllowed = "move";

        const ghost = document.createElement("div");
        ghost.className = dragGhostStyles.dragGhost;
        ghost.textContent = file.path;
        document.body.appendChild(ghost);
        e.dataTransfer!.setDragImage(ghost, -15, 0);
        setTimeout(() => ghost.remove(), 0);
      }}
      onDragEnd={() => {
        isDragging.value = false;
        dragFile.value = null;
        dropTargetId.value = null;
      }}
    >
      <span class={styles.fileName} data-role="file-name">
        {fileName}
      </span>
      <span class={styles.fileDirectory} data-role="file-directory">
        {directory}
      </span>
      <span class={styles.fileStatus} data-role="file-status">
        {file.type}
        {file.conflict ? "!" : ""}
      </span>
    </div>
  );
}
