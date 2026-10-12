import { useEffect } from "preact/hooks";
import { effect } from "@preact/signals";
import {
  currentChanges,
  currentGraph,
  graphStyle,
  changeDoubleClickAction,
  maxPrefixLength,
  offsetWidth,
  scrollY,
  isStale,
  isJJNotFound,
  isNoRepoFound,
  isError,
  isDragging,
  selectedNodes,
  selectionAnchorId,
  pendingGraphUpdate,
  pushingBookmarks,
  pushingTags,
  deletingBookmarks,
  deletingTags,
  supportsTagTracking,
  postMessage,
  currentWorkspace,
  diffStatsCache,
  tooltip,
  showTooltips,
  showChangedFiles,
  expandedFileLists,
  changedFilesCache,
  expandedFileHunks,
  fileHunksCache,
  fileKey,
  lastChangedFiles,
  lastFileHunks,
  pillContextMenu,
  remoteRefContextMenu,
  closeAllMenus,
} from "./signals";
import { Graph } from "./components/graph";
import { ContextMenu } from "./components/context-menu";
import { RebaseMenu } from "./components/rebase-menu";
import { EdgeDropMenu } from "./components/edge-drop-menu";
import { HunkDropMenu } from "./components/hunk-drop-menu";
import { PillContextMenu } from "./components/pill-context-menu";
import { RemoteRefContextMenu } from "./components/remote-ref-context-menu";
import { FileContextMenu } from "./components/file-context-menu";
import { Tooltip } from "./components/tooltip";
import { StaleState } from "./components/stale-state";
import { JJNotFoundState } from "./components/jj-not-found-state";
import { NoRepoFoundState } from "./components/no-repo-found-state";
import { ErrorState } from "./components/error-state";
import { ErrorBoundary } from "./components/error-boundary";
import type { PendingGraphUpdate } from "./signals";
import { mirroredSelection } from "./selection";
import { applyRemoteDragEnd, applyRemoteDragStart, installDragRelay } from "./drag-relay";
import { RegularChangeNode, type ExtensionToWebviewMessage, type FullChangeId } from "../../graph-protocol";

export function App() {
  useEffect(() => {
    const applyGraphUpdate = (message: PendingGraphUpdate) => {
      isStale.value = false;
      isJJNotFound.value = false;
      isNoRepoFound.value = false;
      isError.value = false;
      const newChangeIds = new Set(message.changes.filter((c) => c.branchType !== "~").map((c) => c.id.changeId));
      const preserved = new Set(Array.from(selectedNodes.value).filter((id) => newChangeIds.has(id)));
      selectedNodes.value = preserved;
      expandedFileLists.value = new Set(Array.from(expandedFileLists.value).filter((id) => newChangeIds.has(id)));
      const newCommitIds = new Set(
        message.changes.filter((c): c is RegularChangeNode => c.branchType !== "~").map((c) => c.commitId),
      );
      changedFilesCache.value = new Map(
        Array.from(changedFilesCache.value).filter(([commitId]) => newCommitIds.has(commitId)),
      );
      const idOfFileKey = (key: string) => key.slice(0, key.indexOf("\n"));
      expandedFileHunks.value = new Set(
        Array.from(expandedFileHunks.value).filter((key) => newChangeIds.has(idOfFileKey(key) as FullChangeId)),
      );
      fileHunksCache.value = new Map(
        Array.from(fileHunksCache.value).filter(([key]) => newCommitIds.has(idOfFileKey(key))),
      );
      lastChangedFiles.value = new Map(
        Array.from(lastChangedFiles.value).filter(([changeId]) => newChangeIds.has(changeId)),
      );
      lastFileHunks.value = new Map(
        Array.from(lastFileHunks.value).filter(([key]) => newChangeIds.has(idOfFileKey(key) as FullChangeId)),
      );
      diffStatsCache.value = new Map();
      const activeTooltip = tooltip.value;
      if (activeTooltip) {
        const updatedChange = message.changes.find(
          (c): c is RegularChangeNode => c.branchType !== "~" && c.id.changeId === activeTooltip.change.id.changeId,
        );
        if (updatedChange) {
          tooltip.value = { ...activeTooltip, change: updatedChange };
          postMessage({ command: "fetchDiffStats", changeId: updatedChange.id.changeId });
        } else {
          tooltip.value = null;
        }
      }
      currentChanges.value = message.changes;
      currentGraph.value = message.laneInfo;
      changeDoubleClickAction.value = message.changeDoubleClickAction;
      graphStyle.value = message.graphStyle;
      showTooltips.value = message.showTooltips;
      showChangedFiles.value = message.showChangedFiles;
      supportsTagTracking.value = message.supportsTagTracking;
      currentWorkspace.value = message.currentWorkspace ?? null;
      maxPrefixLength.value = message.maxPrefixLength;
      offsetWidth.value = message.offsetWidth;
      scrollY.value = message.preserveScroll ? window.scrollY : 0;
    };

    const disposeDragRelay = installDragRelay();

    const dispose = effect(() => {
      if (!isDragging.value && pendingGraphUpdate.value) {
        const update = pendingGraphUpdate.value;
        pendingGraphUpdate.value = null;
        applyGraphUpdate(update);
      }
    });

    // Changed files are loaded lazily: request them for every expanded change
    // whose commit has not been loaded yet (or failed to load).
    const disposeChangedFilesFetch = effect(() => {
      const expanded = expandedFileLists.value;
      if (!showChangedFiles.value || expanded.size === 0) {
        return;
      }
      const cache = changedFilesCache.peek();
      const missing = currentChanges.value.filter(
        (c): c is RegularChangeNode =>
          c.branchType !== "~" &&
          expanded.has(c.id.changeId) &&
          (!cache.has(c.commitId) || cache.get(c.commitId) === "error"),
      );
      if (missing.length === 0) {
        return;
      }
      const next = new Map(cache);
      for (const change of missing) {
        next.set(change.commitId, "loading");
        postMessage({ command: "fetchChangedFiles", commitId: change.commitId });
      }
      changedFilesCache.value = next;
    });

    // Hunks are loaded lazily as well: request them for every expanded file of an expanded
    // change whose file list is loaded.
    const disposeFileHunksFetch = effect(() => {
      const expandedHunks = expandedFileHunks.value;
      if (!showChangedFiles.value || expandedHunks.size === 0) {
        return;
      }
      const expandedLists = expandedFileLists.value;
      const fileLists = changedFilesCache.value;
      const cache = fileHunksCache.peek();
      const next = new Map(cache);
      for (const change of currentChanges.value) {
        if (change.branchType === "~" || !expandedLists.has(change.id.changeId)) {
          continue;
        }
        const files = fileLists.get(change.commitId);
        if (!Array.isArray(files)) {
          continue;
        }
        for (const file of files) {
          if (!expandedHunks.has(fileKey(change.id.changeId, file.path))) {
            continue;
          }
          const key = fileKey(change.commitId, file.path);
          const state = cache.get(key);
          if (state !== undefined && state !== "error") {
            continue;
          }
          next.set(key, "loading");
          postMessage({
            command: "fetchFileHunks",
            commitId: change.commitId,
            path: file.path,
            ...(file.renamedFrom ? { renamedFrom: file.renamedFrom } : {}),
          });
        }
      }
      if (next.size !== cache.size || Array.from(next).some(([key, state]) => cache.get(key) !== state)) {
        fileHunksCache.value = next;
      }
    });

    const changesWithCommit = (commitId: string) =>
      currentChanges.value.filter((c): c is RegularChangeNode => c.branchType !== "~" && c.commitId === commitId);

    const handleMessage = (event: MessageEvent) => {
      const message = event.data as ExtensionToWebviewMessage;
      switch (message.command) {
        case "updateGraph":
          if (isDragging.value) {
            pendingGraphUpdate.value = message;
            break;
          }
          applyGraphUpdate(message);
          break;
        case "remoteDragStarted":
          applyRemoteDragStart(message.payload);
          break;
        case "remoteDragEnded":
          applyRemoteDragEnd();
          break;
        case "closeMenus":
          closeAllMenus();
          break;
        case "showStaleState":
          isStale.value = true;
          break;
        case "showJJNotFoundState":
          isJJNotFound.value = true;
          break;
        case "showNoRepoFoundState":
          isNoRepoFound.value = true;
          break;
        case "showErrorState":
          isError.value = true;
          break;
        case "setSelection": {
          const { selection, anchor } = mirroredSelection(currentChanges.value, message.selectedNodes);
          selectedNodes.value = selection;
          selectionAnchorId.value = anchor;
          break;
        }
        case "diffStatsResponse": {
          const newCache = new Map(diffStatsCache.value);
          newCache.set(message.changeId, message.stats);
          diffStatsCache.value = newCache;
          const state = tooltip.value;
          if (state && state.change.id.changeId === message.changeId) {
            tooltip.value = { ...state };
          }
          break;
        }
        case "fileHunksResponse": {
          const key = fileKey(message.commitId, message.path);
          if (fileHunksCache.value.get(key) !== "loading") {
            break;
          }
          const next = new Map(fileHunksCache.value);
          next.set(key, message.hunks ?? "error");
          fileHunksCache.value = next;
          if (message.hunks) {
            const last = new Map(lastFileHunks.value);
            for (const change of changesWithCommit(message.commitId)) {
              last.set(fileKey(change.id.changeId, message.path), message.hunks);
            }
            lastFileHunks.value = last;
          }
          break;
        }
        case "changedFilesResponse": {
          if (changedFilesCache.value.get(message.commitId) !== "loading") {
            break;
          }
          const next = new Map(changedFilesCache.value);
          next.set(message.commitId, message.files ?? "error");
          changedFilesCache.value = next;
          if (message.files) {
            const last = new Map(lastChangedFiles.value);
            for (const change of changesWithCommit(message.commitId)) {
              last.set(change.id.changeId, message.files);
            }
            lastChangedFiles.value = last;
          }
          break;
        }
        case "bookmarkTrackingRemotesResponse": {
          const state = pillContextMenu.value;
          if (state && state.type === "bookmark" && state.name === message.bookmark && state.pendingRemotes) {
            pillContextMenu.value = {
              ...state,
              remotes: message.remotes.length > 0 ? message.remotes : undefined,
              unsyncedRemotes:
                message.unsyncedRemotes && message.unsyncedRemotes.length > 0 ? message.unsyncedRemotes : undefined,
              untrackedRemotes:
                message.untrackedRemotes && message.untrackedRemotes.length > 0 ? message.untrackedRemotes : undefined,
              pendingRemotes: undefined,
            };
          }
          break;
        }
        case "tagPushRemotesResponse": {
          const state = pillContextMenu.value;
          if (state && state.type === "tag" && state.name === message.tag && state.pendingRemotes) {
            pillContextMenu.value = {
              ...state,
              remotes: message.pushRemotes.length > 0 ? message.pushRemotes : undefined,
              pendingRemotes: undefined,
            };
          }
          break;
        }
        case "tagTrackingRemotesResponse": {
          const state = pillContextMenu.value;
          if (state && state.type === "tag" && state.name === message.tag && state.pendingRemotes) {
            pillContextMenu.value = {
              ...state,
              remotes: message.remotes.length > 0 ? message.remotes : undefined,
              pendingRemotes: undefined,
            };
          }
          break;
        }
        case "pushBookmarkDone": {
          const newSet = new Set(pushingBookmarks.value);
          newSet.delete(message.bookmark);
          pushingBookmarks.value = newSet;
          break;
        }
        case "pushTagDone": {
          const newSet = new Set(pushingTags.value);
          newSet.delete(message.tag);
          pushingTags.value = newSet;
          break;
        }
        case "deleteRemoteRefDone": {
          const set = message.refType === "bookmark" ? deletingBookmarks : deletingTags;
          const newSet = new Set(set.value);
          newSet.delete(message.name);
          set.value = newSet;
          break;
        }
        case "remoteRefStatusResponse": {
          const state = remoteRefContextMenu.value;
          if (
            !state ||
            !state.pendingStatus ||
            state.type !== message.refType ||
            state.name !== message.name ||
            state.remote !== message.remote
          ) {
            break;
          }
          // A tracked, unsynced remote ref can be pushed (or deleted when the
          // local ref is gone). In every other case (untracked, already synced,
          // or lookup failure) offer to track the ref from this remote instead.
          const actionable = message.found && message.tracked && !message.synced;
          remoteRefContextMenu.value = {
            ...state,
            pendingStatus: undefined,
            action: actionable ? (message.present ? "push" : "delete") : "track",
          };
          break;
        }
      }
    };

    window.addEventListener("message", handleMessage);
    window.addEventListener("blur", closeAllMenus);

    const handlePointerDown = () => postMessage({ command: "graphPointerDown" });
    window.addEventListener("pointerdown", handlePointerDown, true);

    let resizeTimeout: ReturnType<typeof setTimeout> | undefined;
    const handleResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        requestAnimationFrame(() => {
          if (currentGraph.value) {
            currentGraph.value = { ...currentGraph.value };
          }
        });
      }, 100);
    };
    window.addEventListener("resize", handleResize);

    postMessage({ command: "webviewReady" });

    return () => {
      disposeDragRelay();
      dispose();
      disposeChangedFilesFetch();
      disposeFileHunksFetch();
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("blur", closeAllMenus);
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("resize", handleResize);
      clearTimeout(resizeTimeout);
    };
  }, []);

  return (
    <ErrorBoundary>
      {isStale.value ? (
        <StaleState />
      ) : isJJNotFound.value ? (
        <JJNotFoundState />
      ) : isNoRepoFound.value ? (
        <NoRepoFoundState />
      ) : isError.value ? (
        <ErrorState />
      ) : (
        <Graph />
      )}
      <ContextMenu />
      <RebaseMenu />
      <EdgeDropMenu />
      <HunkDropMenu />
      <PillContextMenu />
      <RemoteRefContextMenu />
      <FileContextMenu />
      <Tooltip />
    </ErrorBoundary>
  );
}
