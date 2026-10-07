import * as vscode from "vscode";
import { logger } from "./logger";
import { createThrottledAsyncFn } from "./utils";
import { OperationLogManager, OperationLogTreeDataProvider } from "./operation-log-tree-view";
import { JJGraphWebview } from "./graph-webview";
import { DetailsWebview } from "./details-webview";
import type { ExtensionState } from "./extension-state";
import type { ForceRefresh } from "./source-control";
import { StaleWorkingCopyError } from "./errors";

function syncSelectedRepoToActiveEditor(state: ExtensionState) {
  if (!vscode.workspace.getConfiguration("juju").get<boolean>("autoSwitchRepository")) {
    return;
  }
  const uri = vscode.window.activeTextEditor?.document.uri;
  if (!uri || !["file", "jj"].includes(uri.scheme)) {
    return;
  }
  const repository = state.workspaceSCM.getRepositoryFromUri(uri);
  if (repository && repository.repositoryRoot !== state.getSelectedRepo()?.repositoryRoot) {
    state.setSelectedRepo(repository);
  }
}

export function initInfrastructure(state: ExtensionState) {
  const context = state.context;
  const initialSelectedRepo = state.getSelectedRepo();

  const graphWebview = new JJGraphWebview(
    context.extensionUri,
    initialSelectedRepo,
    context,
    state.workspaceSCM.jjBinaryNotFound,
  );
  context.subscriptions.push(graphWebview);

  const detailsWebview = new DetailsWebview(context.extensionUri, graphWebview);
  context.subscriptions.push(detailsWebview);

  graphWebview.setRefreshHandler(async (repo) => {
    const repoSCM = state.workspaceSCM.getByRoot(repo.repositoryRoot);
    if (!repoSCM) {
      return;
    }
    try {
      await repoSCM.checkForUpdates(undefined, "force");
    } catch (error: unknown) {
      if (error instanceof StaleWorkingCopyError) {
        return;
      }
      logger.error(`Failed to refresh graph: ${error instanceof Error ? error.message : String(error)}`);
      graphWebview.showErrorState();
    }
  });
  state.workspaceSCM.graphQueryProvider = (repositoryRoot) => graphWebview.graphQueryFor(repositoryRoot);

  state.onDidSetSelectedRepository(
    async () => {
      const repo = state.getSelectedRepo();
      if (repo) {
        await graphWebview.setSelectedRepository(repo);
      }
    },
    undefined,
    context.subscriptions,
  );

  context.subscriptions.push(
    graphWebview.onDidChangeSelection(async (selectedNodes) => {
      const repoRoot = graphWebview.repository?.repositoryRoot;
      if (!repoRoot) {
        return;
      }
      const repoSCM = state.workspaceSCM.getByRoot(repoRoot);
      if (repoSCM) {
        if (selectedNodes.length === 2) {
          await repoSCM.setSelectedCommit(undefined);
          await repoSCM.setDiffSelection(selectedNodes[0].id, selectedNodes[1].id, {
            fromIsWorkingCopy: selectedNodes[0].currentWorkingCopy,
            toIsWorkingCopy: selectedNodes[1].currentWorkingCopy,
          });
        } else {
          const changeId = selectedNodes.length === 1 ? selectedNodes[0].id.changeId : undefined;
          await repoSCM.setDiffSelection();
          await repoSCM.setSelectedCommit(changeId);
        }
      }
    }),
  );

  context.subscriptions.push(
    graphWebview.onDidSwitchChange(async () => {
      await graphWebview.refresh();
    }),
  );

  const operationLogTreeDataProvider = new OperationLogTreeDataProvider(initialSelectedRepo);
  const operationLogManager = new OperationLogManager(operationLogTreeDataProvider);
  context.subscriptions.push(operationLogManager);

  state.onDidSetSelectedRepository(
    async () => {
      const repo = state.getSelectedRepo();
      if (repo) {
        await operationLogManager.setSelectedRepo(repo);
      }
    },
    undefined,
    context.subscriptions,
  );

  state.workspaceSCM.snapshotConsumer = async (repositoryRoot, snapshot) => {
    operationLogManager.applyOperations(repositoryRoot, snapshot.operations);
    if (graphWebview.repository?.repositoryRoot !== repositoryRoot || !snapshot.graphLoaded) {
      return;
    }
    const appliedAt = Date.now();
    await graphWebview.applySnapshot(snapshot);
    await detailsWebview.refresh(appliedAt);
  };

  context.subscriptions.push(
    state.workspaceSCM.onDidRepoUpdate(({ repoSCM, stale }) => {
      if (stale && graphWebview.repository?.repositoryRoot === repoSCM.repositoryRoot) {
        graphWebview.showStaleState();
      }
    }),
  );

  state.initialize(graphWebview, detailsWebview, operationLogManager);

  syncSelectedRepoToActiveEditor(state);
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => syncSelectedRepoToActiveEditor(state)));

  vscode.commands.executeCommand("setContext", "jj.reposExist", true);
}

export function createPolling(
  state: ExtensionState,
  checkRepos: (specificFolders?: string[]) => Promise<void>,
): {
  throttledPoll: (forceRefresh: ForceRefresh) => Promise<void>;
  scheduleNextPoll: () => void;
} {
  const context = state.context;

  async function poll(forceRefresh: ForceRefresh) {
    const didUpdate = await state.workspaceSCM.refresh();
    if (didUpdate) {
      const repo = state.getSelectedRepo();
      if (repo) {
        state.setSelectedRepo(repo);
      }
    }

    await Promise.all(state.workspaceSCM.repoSCMs.map((repoSCM) => repoSCM.checkForUpdates(undefined, forceRefresh)));
  }

  const throttledPoll = createThrottledAsyncFn(poll);

  let isPollingCanceled = false;
  let pollTimeoutId: NodeJS.Timeout | undefined;
  const scheduleNextPoll = () => {
    if (isPollingCanceled) {
      return;
    }
    void throttledPoll("if-changed").catch((err) => {
      logger.error(`Error during background poll: ${String(err)}`);
    });
    // Re-arm immediately instead of after the poll settles: a poll stuck on a stalled jj
    // subprocess must not stop future ticks. Overlapping ticks are coalesced by the throttle.
    if (state.workspaceSCM.repoSCMs.length === 0) {
      pollTimeoutId = setTimeout(scheduleNextPoll, 5000);
    } else {
      const pollIntervalSeconds = vscode.workspace.getConfiguration("juju").get<number>("pollIntervalSeconds");
      if (pollIntervalSeconds !== undefined && pollIntervalSeconds > 0) {
        pollTimeoutId = setTimeout(scheduleNextPoll, pollIntervalSeconds * 1000);
      }
    }
  };

  context.subscriptions.push(
    new vscode.Disposable(() => {
      isPollingCanceled = true;
      clearTimeout(pollTimeoutId);
    }),
  );

  vscode.workspace.onDidChangeWorkspaceFolders(
    async () => {
      logger.info("Workspace folders changed");
      const didUpdate = await state.workspaceSCM.refresh();
      if (didUpdate) {
        const repo = state.getSelectedRepo();
        if (repo) {
          state.setSelectedRepo(repo);
        }
      }
      await checkRepos();
    },
    undefined,
    context.subscriptions,
  );

  vscode.workspace.onDidChangeConfiguration(
    async (e) => {
      if (e.affectsConfiguration("git")) {
        logger.info("Git configuration changed");
        const workspaceFolders = vscode.workspace.workspaceFolders || [];

        const affectedFolders = workspaceFolders
          .filter((folder) => e.affectsConfiguration("git", folder.uri))
          .map((folder) => folder.uri.fsPath);

        if (affectedFolders.length > 0) {
          await checkRepos(affectedFolders);
        }
      }
      if (e.affectsConfiguration("juju.commitAction")) {
        for (const repoSCM of state.workspaceSCM.repoSCMs) {
          repoSCM.updatePlaceholderText();
        }
      }
      if (e.affectsConfiguration("juju.autoSwitchRepository")) {
        syncSelectedRepoToActiveEditor(state);
      }
      if (e.affectsConfiguration("juju.fileClickAction")) {
        for (const repoSCM of state.workspaceSCM.repoSCMs) {
          repoSCM.render();
        }
      }
      if (
        e.affectsConfiguration("juju.graphStyle") ||
        e.affectsConfiguration("juju.logLimit") ||
        e.affectsConfiguration("juju.elideImmutableCommits") ||
        e.affectsConfiguration("juju.elidedVisibleImmutableParents") ||
        e.affectsConfiguration("juju.showTooltips") ||
        e.affectsConfiguration("juju.showChangedFiles")
      ) {
        if (state.graphWebview) {
          if (e.affectsConfiguration("juju.elideImmutableCommits")) {
            await state.graphWebview.resetElideOverride();
          }
          if (e.affectsConfiguration("juju.logLimit")) {
            await state.graphWebview.refresh();
          } else {
            await state.graphWebview.rerender();
          }
        }
      }
    },
    undefined,
    context.subscriptions,
  );

  return { throttledPoll, scheduleNextPoll };
}
