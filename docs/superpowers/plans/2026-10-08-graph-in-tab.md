# Graph in a Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user open the JJ Graph as an editor tab (poppable into a floating window) that stays live and in sync
with the Source Control sidebar graph.

**Architecture:** `JJGraphWebview` replaces its single `panel?: WebviewView` with a set of surfaces (the sidebar
`WebviewView` plus an optional tab `WebviewPanel`). One shared message handler, one snapshot and one selection serve all
surfaces; host-to-webview messages are broadcast, and a late-attaching surface gets the last graph message replayed.
Selection is mirrored through a new `setSelection` host-to-webview message.

**Tech Stack:** TypeScript (strict, ES2022), VS Code extension API (`WebviewView`, `WebviewPanel`,
`WebviewPanelSerializer`), Preact + `@preact/signals` webview, `node:test` unit tests, Playwright integration tests.

Spec: [docs/superpowers/specs/2026-10-08-graph-in-tab-design.md](../specs/2026-10-08-graph-in-tab-design.md)

## Global Constraints

- This is a jj repository: use `jj` commands, never `git`. Commit with `jj commit -m "<message>"` (the working copy is
  clean before each task; each task's commit step commits everything the task changed).
- Commit messages: Conventional Commits, `<type>: <description>`, sentence case, imperative, no trailing period. Every
  commit message ends with the trailer line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` after a blank
  line.
- No code comments unless they explain something non-obvious that already existed; existing comments stay unless they
  become incorrect.
- UI text: Title Case for command titles ("Open Graph in Tab").
- After every task run `pnpm run format` then `pnpm run check` (type check, lint, format check, unit tests). Both must
  pass before committing.
- Do not add custom timeouts to Playwright expectations (the config sets `expect.timeout`).
- Run a single Playwright file with:
  `pnpm exec playwright test --config=tests-integration/playwright.config.ts tests-integration/tests/<file>.test.ts`
- Tab view type is exactly `jjGraphTab`; sidebar view id stays `jjGraphWebview`; command id is exactly
  `jj.openGraphInTab`.
- At most one graph tab. Scroll position, expanded file lists, tooltips, menus and drags are NOT mirrored.

## File Structure

| File                                        | Change                                                                                                                     |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/webview/graph/selection.ts`            | Add pure helper `mirroredSelection`                                                                                        |
| `src/unit-test/selection.test.ts`           | Unit tests for `mirroredSelection`                                                                                         |
| `src/graph-protocol.ts`                     | Add `setSelection` to `ExtensionToWebviewMessage`                                                                          |
| `src/webview/graph/app.tsx`                 | Handle `setSelection`                                                                                                      |
| `src/graph-webview.ts`                      | Surfaces set, `attachSurface`, `handleMessage` method, broadcast, replay, selection mirroring, `openInTab`, tab serializer |
| `src/commands.ts`                           | Register `jj.openGraphInTab`                                                                                               |
| `package.json`                              | Command contribution, sidebar button, palette entry, `editor/title` toolbar entries for the tab, submenu `when` widening   |
| `tests-integration/tests/graph-tab.test.ts` | Playwright test                                                                                                            |

---

### Task 1: `setSelection` protocol message and webview handling

**Files:**

- Modify: `src/webview/graph/selection.ts` (append after `lastSelectedChangeId`, ~line 124)
- Test: `src/unit-test/selection.test.ts` (append a new `describe`)
- Modify: `src/graph-protocol.ts` (the `ExtensionToWebviewMessage` union, ~line 194)
- Modify: `src/webview/graph/app.tsx` (imports at top, `handleMessage` switch at ~line 128)

**Interfaces:**

- Produces:
  `mirroredSelection(changes: ChangeNode[], ids: readonly FullChangeId[]): { selection: Set<FullChangeId>; anchor: FullChangeId | null }`
  in `src/webview/graph/selection.ts`; protocol variant `{ command: "setSelection"; selectedNodes: FullChangeId[] }`
  (consumed by Tasks 2/3).

- [ ] **Step 1: Write the failing test**

Append to `src/unit-test/selection.test.ts` (add `mirroredSelection` to the existing import list from
`"../webview/graph/selection"`):

```ts
describe("mirroredSelection", () => {
  const elided = { fakeId: "~1", parentChangeIds: [], branchType: "~" } as unknown as ChangeNode;

  it("returns an empty selection and no anchor for no ids", () => {
    const changes: ChangeNode[] = [regular("a"), regular("b")];

    const result = mirroredSelection(changes, []);

    assert.deepEqual(Array.from(result.selection), []);
    assert.equal(result.anchor, null);
  });

  it("keeps ids present in the graph and anchors on the last one", () => {
    const changes: ChangeNode[] = [regular("a"), regular("b"), regular("c")];

    const result = mirroredSelection(changes, [full("a"), full("c")]);

    assert.deepEqual(Array.from(result.selection), [full("a"), full("c")]);
    assert.equal(result.anchor, full("c"));
  });

  it("drops ids that are not in the graph", () => {
    const changes: ChangeNode[] = [regular("a"), regular("b")];

    const result = mirroredSelection(changes, [full("a"), full("gone")]);

    assert.deepEqual(Array.from(result.selection), [full("a")]);
    assert.equal(result.anchor, full("a"));
  });

  it("never selects elided rows", () => {
    const changes: ChangeNode[] = [regular("a"), elided];

    const result = mirroredSelection(changes, [full("~1")]);

    assert.deepEqual(Array.from(result.selection), []);
    assert.equal(result.anchor, null);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm run unit-test` Expected: FAIL (TypeScript/tsx error: `mirroredSelection` is not exported from
`../webview/graph/selection`).

- [ ] **Step 3: Implement the helper**

In `src/webview/graph/selection.ts`, directly after `lastSelectedChangeId`:

```ts
/**
 * Applies a selection reported by another graph surface: keeps only ids that
 * are selectable rows of this graph and anchors range selection on the last
 * of them.
 */
export function mirroredSelection(
  changes: ChangeNode[],
  ids: readonly FullChangeId[],
): { selection: Set<FullChangeId>; anchor: FullChangeId | null } {
  const { positionById } = indexSelectableChanges(changes);
  const selection = new Set(ids.filter((id) => positionById.has(id)));
  return { selection, anchor: lastSelectedChangeId(changes, selection) };
}
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `pnpm run unit-test` Expected: PASS, including the four new `mirroredSelection` tests.

- [ ] **Step 5: Add the protocol message**

In `src/graph-protocol.ts`, in `ExtensionToWebviewMessage`, add this variant next to `showErrorState`:

```ts
  | { command: "setSelection"; selectedNodes: FullChangeId[] }
```

- [ ] **Step 6: Handle it in the webview**

In `src/webview/graph/app.tsx`: add `selectionAnchorId` to the import from `"./signals"` (next to `selectedNodes`),
import the helper, and add a case in `handleMessage`:

```ts
import { mirroredSelection } from "./selection";
```

```ts
        case "setSelection": {
          const { selection, anchor } = mirroredSelection(currentChanges.value, message.selectedNodes);
          selectedNodes.value = selection;
          selectionAnchorId.value = anchor;
          break;
        }
```

Place the case right after `case "showErrorState": ... break;`. It must not post `selectChange` (that would echo).

- [ ] **Step 7: Format, check, commit**

Run: `pnpm run format` then `pnpm run check` Expected: all pass.

```bash
jj commit -m "feat: Mirror a selection reported by another graph surface

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Multi-surface `JJGraphWebview` (no behavior change for the sidebar)

**Files:**

- Modify: `src/graph-webview.ts` (fields ~lines 52-98, `resolveWebviewView` lines 100-806,
  `postMessageToWebview`/`setSelectedRepository` ~lines 911-925, guards at ~1007/1018/1044, `render` ~1140-1157)

**Interfaces:**

- Consumes: `ExtensionToWebviewMessage` incl. `setSelection` (Task 1).
- Produces (all in `JJGraphWebview`):
  - `type GraphSurface = vscode.WebviewView | vscode.WebviewPanel` (module-level)
  - `private readonly surfaces: Set<GraphSurface>`
  - `private async attachSurface(surface: GraphSurface): Promise<void>`
  - `private async handleMessage(message: Message, source: GraphSurface): Promise<void>`
  - `private postMessageToWebview(message: ExtensionToWebviewMessage, except?: GraphSurface): Thenable<boolean>`
    (broadcast)
  - `private postMessageToSurface(surface: GraphSurface, message: ExtensionToWebviewMessage): Thenable<boolean>`
  - `private updateTitles(): void`

This task is a refactor: the sidebar must behave exactly as before. The existing Playwright tests are the regression
check.

- [ ] **Step 1: Replace the single panel with a surface set**

At module level (after `type Message = WebviewToExtensionMessage;`):

```ts
type GraphSurface = vscode.WebviewView | vscode.WebviewPanel;
type UpdateGraphMessage = Extract<ExtensionToWebviewMessage, { command: "updateGraph" }>;
```

In the class, replace `public panel?: vscode.WebviewView;` with:

```ts
  private readonly surfaces = new Set<GraphSurface>();
  private lastGraphMessage: UpdateGraphMessage | undefined;
```

- [ ] **Step 2: Split `resolveWebviewView` into `attachSurface` + `handleMessage`**

Replace the current lines from `public async resolveWebviewView(...) {` through the line
`webviewView.webview.onDidReceiveMessage(async (message: Message) => {` and its first guard (lines 100-137, ending with
`const repo = this.repository!;`) with the following. The `switch (message.command) { ... }` body that follows stays
untouched.

```ts
  public async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    await this.attachSurface(webviewView);
    await this.updateElidingContext();
    await this.refresh();
  }

  private async attachSurface(surface: GraphSurface): Promise<void> {
    this.surfaces.add(surface);
    surface.onDidDispose(() => this.surfaces.delete(surface));
    surface.title = this.surfaceTitle();

    surface.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    surface.webview.html = this.getWebviewContent(surface.webview);

    await new Promise<void>((resolve) => {
      const listeners: vscode.Disposable[] = [];
      const done = () => {
        listeners.forEach((listener) => listener.dispose());
        resolve();
      };
      listeners.push(
        surface.webview.onDidReceiveMessage((message: Message) => {
          if (message.command === "webviewReady") {
            done();
          }
        }),
      );
      listeners.push(surface.onDidDispose(done));
    });

    if (!this.surfaces.has(surface)) {
      return;
    }

    if (!this.repository) {
      const msg: ExtensionToWebviewMessage = this.jjBinaryNotFound
        ? { command: "showJJNotFoundState" }
        : { command: "showNoRepoFoundState" };
      this.postMessageToSurface(surface, msg);
    }

    surface.webview.onDidReceiveMessage((message: Message) => this.handleMessage(message, surface));

    this.replayTo(surface);
  }

  private replayTo(surface: GraphSurface): void {
    if (!this.lastGraphMessage) {
      return;
    }
    this.postMessageToSurface(surface, { ...this.lastGraphMessage, preserveScroll: false });
    this.postMessageToSurface(surface, { command: "setSelection", selectedNodes: Array.from(this.selectedNodes) });
  }

  private async handleMessage(message: Message, source: GraphSurface): Promise<void> {
    if (
      !this.repository &&
      message.command !== "selectChange" &&
      message.command !== "openDetailsView" &&
      message.command !== "reportError" &&
      message.command !== "showWarning"
    ) {
      return;
    }
    const repo = this.repository!;
```

Then change the end of the old closure. The current tail is:

```ts
        case "showWarning":
          vscode.window.showWarningMessage(message.message);
          break;
      }
    });

    await this.updateElidingContext();
    await this.refresh();
  }
```

Replace it with:

```ts
        case "showWarning":
          vscode.window.showWarningMessage(message.message);
          break;
      }
  }
```

(`pnpm run format` re-indents the moved body.) `source` is unused until Task 3; to keep lint green in this task,
reference it in the `selectChange` case now (next step).

- [ ] **Step 3: Mirror the selection to the other surfaces**

In the `case "selectChange": { ... }` block, after `this.selectedNodes = new Set(selectedIds);` add:

```ts
this.postMessageToWebview({ command: "setSelection", selectedNodes: selectedIds }, source);
```

- [ ] **Step 4: Broadcast helpers, titles, guards**

Replace `postMessageToWebview` with:

```ts
  private postMessageToWebview(message: ExtensionToWebviewMessage, except?: GraphSurface): Thenable<boolean> {
    return Promise.all(
      Array.from(this.surfaces)
        .filter((surface) => surface !== except)
        .map((surface) => this.postMessageToSurface(surface, message)),
    ).then((results) => results.some(Boolean));
  }

  private postMessageToSurface(surface: GraphSurface, message: ExtensionToWebviewMessage): Thenable<boolean> {
    return Promise.resolve(surface.webview.postMessage(message)).catch((error: unknown) => {
      logger.warn(`Failed to post to a graph surface: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    });
  }

  private surfaceTitle(): string {
    return this.repository ? `JJ Graph (${path.basename(this.repository.repositoryRoot)})` : "JJ Graph";
  }

  private updateTitles(): void {
    const title = this.surfaceTitle();
    for (const surface of this.surfaces) {
      surface.title = title;
    }
  }
```

In `setSelectedRepository`, replace the `if (this.panel) { this.panel.title = ... }` block with `this.updateTitles();`,
and inside `if (prevRoot !== repo.repositoryRoot) {` add `this.lastGraphMessage = undefined;` before
`this.lastSnapshot = undefined;`.

Replace the three guards:

- `graphQueryFor`: `if (!this.panel || this.repository?...` becomes
  `if (this.surfaces.size === 0 || this.repository?.repositoryRoot !== repositoryRoot) {`
- `refresh`: `if (!this.panel || !this.repository || !this.refreshHandler)` becomes
  `if (this.surfaces.size === 0 || !this.repository || !this.refreshHandler)`
- `render`: `if (!this.panel || !repository || !snapshot)` becomes
  `if (this.surfaces.size === 0 || !repository || !snapshot)`

- [ ] **Step 5: Cache the graph message for replay**

In `render()`, change `const msg: ExtensionToWebviewMessage = {` (the `updateGraph` literal) to
`const msg: UpdateGraphMessage = {`, and just before `this.postMessageToWebview(msg);` (after the
`if (this.lastSnapshot !== snapshot ...) return;` stale check) add:

```ts
this.lastGraphMessage = msg;
```

- [ ] **Step 6: Type check and regression run**

Run: `pnpm run format` then `pnpm run check` Expected: pass. Fix any residual `this.panel` reference the compiler
reports (there must be none left: `grep -n "this\.panel" src/graph-webview.ts` returns nothing).

Run the sidebar regression tests:
`pnpm exec playwright test --config=tests-integration/playwright.config.ts tests-integration/tests/graph-view.test.ts tests-integration/tests/graph-multi-select.test.ts tests-integration/tests/details-view.test.ts`
Expected: PASS (the sidebar behaves as before).

- [ ] **Step 7: Commit**

```bash
jj commit -m "refactor: Let the graph host several webview surfaces

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Graph tab (command, panel lifecycle, serializer)

**Files:**

- Modify: `src/graph-webview.ts` (constants near `rootChangeId` ~line 39; constructor ~lines 81-98; new `openInTab`,
  `restoreTab`, `attachTab` methods next to `attachSurface`)
- Modify: `src/commands.ts` (next to `jj.openDetailsWebview`, ~line 996)
- Modify: `package.json` (`contributes.commands`, `menus.view/title`, `menus.commandPalette`)

**Interfaces:**

- Consumes: `attachSurface`, `surfaceTitle` (Task 2).
- Produces: `JJGraphWebview.openInTab(): void`; command id `jj.openGraphInTab`; view type constant
  `GRAPH_TAB_VIEW_TYPE = "jjGraphTab"` (module-level, used by Task 4's `when` clauses as the literal `'jjGraphTab'`).

- [ ] **Step 1: Add the tab state, constant and serializer**

Module-level in `src/graph-webview.ts` (below `rootChangeId`):

```ts
const GRAPH_TAB_VIEW_TYPE = "jjGraphTab";
```

Class field next to `surfaces`:

```ts
  private tab: vscode.WebviewPanel | undefined;
```

In the constructor, extend the `context.subscriptions.push(...)` call with a second registration so it reads:

```ts
context.subscriptions.push(
  vscode.window.registerWebviewViewProvider("jjGraphWebview", this, {
    webviewOptions: {
      retainContextWhenHidden: true,
    },
  }),
  vscode.window.registerWebviewPanelSerializer(GRAPH_TAB_VIEW_TYPE, {
    deserializeWebviewPanel: (panel) => this.restoreTab(panel),
  }),
);
```

- [ ] **Step 2: Add `openInTab`, `restoreTab`, `attachTab`**

Add after `attachSurface`:

```ts
  public openInTab(): void {
    if (this.tab) {
      this.tab.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(GRAPH_TAB_VIEW_TYPE, this.surfaceTitle(), vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [this.extensionUri],
    });
    void this.attachTab(panel);
  }

  private async restoreTab(panel: vscode.WebviewPanel): Promise<void> {
    if (this.tab) {
      panel.dispose();
      return;
    }
    await this.attachTab(panel);
  }

  private async attachTab(panel: vscode.WebviewPanel): Promise<void> {
    this.tab = panel;
    panel.onDidDispose(() => {
      if (this.tab === panel) {
        this.tab = undefined;
      }
    });
    try {
      await this.attachSurface(panel);
    } catch (error: unknown) {
      showErrorMessage("Failed to open graph tab", error);
      panel.dispose();
    }
  }
```

`updateTitles()` (Task 2) already covers the tab because it is in `surfaces`.

- [ ] **Step 3: Register the command**

In `src/commands.ts`, directly after the `jj.openDetailsWebview` registration:

```ts
context.subscriptions.push(vscode.commands.registerCommand("jj.openGraphInTab", () => state.graphWebview!.openInTab()));
```

- [ ] **Step 4: Contribute the command and the sidebar button**

In `package.json` `contributes.commands`, next to the `jj.openDetailsWebview` entry:

```json
      {
        "command": "jj.openGraphInTab",
        "title": "Open Graph in Tab",
        "category": "Jujutsu",
        "icon": "$(link-external)"
      },
```

In `menus.view/title`, after the `jj.selectGraphWebviewRepo` entry (the one with `"group": "navigation@8"`), add:

```json
{
  "command": "jj.openGraphInTab",
  "when": "view == jjGraphWebview",
  "group": "navigation@9"
}
```

(add the comma after the preceding entry.) In `menus.commandPalette`, add:

```json
        {
          "command": "jj.openGraphInTab",
          "when": "jj.reposExist"
        },
```

- [ ] **Step 5: Format, check, manual smoke test**

Run: `pnpm run format` then `pnpm run check`. Expected: pass.

Manual: `pnpm run build-dev`, launch the extension host (F5 or `code --extensionDevelopmentPath=.`), open a jj repo, run
"Jujutsu: Open Graph in Tab" from the palette. Expected: a "JJ Graph (<repo>)" tab shows the graph; running the command
again reveals the same tab; selecting a change in either surface highlights it in both; dragging the tab out into its
own window keeps it working. Reload the window (Developer: Reload Window): if the tab is not restored, add in
`src/webview/graph/signals.ts` `initVsCodeApi()` the line `vscode.setState({ graph: true });` after
`vscode = acquireVsCodeApi();` and re-test (VS Code only persists panels that have webview state).

- [ ] **Step 6: Commit**

```bash
jj commit -m "feat: Open the graph in a tab

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Tab toolbar (`editor/title` entries)

**Files:**

- Modify: `package.json` (`menus.editor/title` ~line 349, `menus.jj.graphFetchSubmenu` ~lines 463-479)

**Interfaces:**

- Consumes: the tab's view type `jjGraphTab` (Task 3); existing commands and context keys (`jj.fetching`,
  `jj.fetchPushSyncing`, `jjGraphView.nodesSelected`, `jjGraphView.elidingActive`, `jj.hasMultipleRepos`).

- [ ] **Step 1: Add the tab toolbar entries**

Append these entries to the end of the `menus.editor/title` array (add the comma after the current last entry). Groups
mirror the sidebar's `navigation@N` values. Let `TAB` stand for `activeWebviewPanelId == 'jjGraphTab'` (write it out
literally in JSON):

```json
        {
          "command": "jj.openDetailsWebview",
          "when": "activeWebviewPanelId == 'jjGraphTab'",
          "group": "navigation@0"
        },
        {
          "command": "jj.gitFetch",
          "when": "activeWebviewPanelId == 'jjGraphTab' && !jj.fetching",
          "group": "navigation@1"
        },
        {
          "command": "jj.gitFetch.syncing",
          "when": "activeWebviewPanelId == 'jjGraphTab' && jj.fetching",
          "group": "navigation@1"
        },
        {
          "submenu": "jj.graphFetchSubmenu",
          "when": "activeWebviewPanelId == 'jjGraphTab' && !jj.fetchPushSyncing",
          "group": "navigation@2"
        },
        {
          "command": "jj.graphFetchSubmenu.syncing",
          "when": "activeWebviewPanelId == 'jjGraphTab' && jj.fetchPushSyncing",
          "group": "navigation@2"
        },
        {
          "command": "jj.undo",
          "when": "activeWebviewPanelId == 'jjGraphTab'",
          "group": "navigation@3"
        },
        {
          "command": "jj.redo",
          "when": "activeWebviewPanelId == 'jjGraphTab'",
          "group": "navigation@4"
        },
        {
          "command": "jj.refreshGraphWebview",
          "when": "activeWebviewPanelId == 'jjGraphTab'",
          "group": "navigation@5"
        },
        {
          "command": "jj.newGraphWebview",
          "when": "activeWebviewPanelId == 'jjGraphTab' && jjGraphView.nodesSelected",
          "group": "navigation@6"
        },
        {
          "command": "jj.toggleElideImmutableCommits.show",
          "when": "activeWebviewPanelId == 'jjGraphTab' && jjGraphView.elidingActive",
          "group": "navigation@7"
        },
        {
          "command": "jj.toggleElideImmutableCommits.elide",
          "when": "activeWebviewPanelId == 'jjGraphTab' && !jjGraphView.elidingActive",
          "group": "navigation@7"
        },
        {
          "command": "jj.selectGraphWebviewRepo",
          "when": "activeWebviewPanelId == 'jjGraphTab' && jj.hasMultipleRepos",
          "group": "navigation@8"
        }
```

- [ ] **Step 2: Widen the fetch submenu conditions**

In `menus.jj.graphFetchSubmenu`, change each of the three `"when": "view == jjGraphWebview"` to:

```json
"when": "view == jjGraphWebview || activeWebviewPanelId == 'jjGraphTab'"
```

- [ ] **Step 3: Format, check, manual smoke test**

Run: `pnpm run format` then `pnpm run check`. Expected: pass (prettier validates the JSON).

Manual: with the tab active, the editor title bar shows Details, Fetch, Fetch submenu, Undo, Redo, Refresh, Elide toggle
(and New when changes are selected, Select Repository with several repos). Activating another editor hides them. The
sidebar toolbar is unchanged.

- [ ] **Step 4: Commit**

```bash
jj commit -m "feat: Show the graph toolbar on the graph tab

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Playwright test for the graph tab

**Files:**

- Create: `tests-integration/tests/graph-tab.test.ts`

**Interfaces:**

- Consumes: fixtures `graphFrame`, `testRepo`, `workbox` and helpers `runCommand`, `mod` from
  `tests-integration/tests/base-test.ts`; command title "Jujutsu: Open Graph in Tab" (Task 3). Graph rows are
  `#nodes > div`; a selected row has the `data-selected` attribute.

- [ ] **Step 1: Write the test**

```ts
import type { Frame, Page } from "@playwright/test";
import { test, expect, mod, runCommand } from "./base-test";

async function findOtherGraphFrame(workbox: Page, sidebarFrame: Frame): Promise<Frame> {
  let found: Frame | undefined;
  await expect(async () => {
    for (const frame of workbox.frames()) {
      if (frame === sidebarFrame) {
        continue;
      }
      try {
        const content = await frame.content();
        if (content.includes('id="nodes"') && (await frame.locator("#nodes > div").count()) > 0) {
          found = frame;
          return;
        }
      } catch {
        // The frame can be mid-navigation while the webview (re)loads; the
        // content read throws while it is settling, so just try the next.
      }
    }
    throw new Error("Graph tab frame not ready");
  }).toPass();
  return found!;
}

test("graph tab mirrors the sidebar graph", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");

  const sidebarNodes = graphFrame.locator("#nodes > div");
  await expect(sidebarNodes).toHaveCount(4); // @, B, A, root

  await runCommand(workbox, "Jujutsu: Open Graph in Tab");
  const tabFrame = await findOtherGraphFrame(workbox, graphFrame);
  const tabNodes = tabFrame.locator("#nodes > div");
  await expect(tabNodes).toHaveCount(4);

  await test.step("selecting in the sidebar selects in the tab", async () => {
    await sidebarNodes.nth(1).click();
    await expect(sidebarNodes.nth(1)).toHaveAttribute("data-selected");
    await expect(tabNodes.nth(1)).toHaveAttribute("data-selected");
  });

  await test.step("selecting in the tab selects in the sidebar", async () => {
    await tabNodes.nth(2).click();
    await expect(tabNodes.nth(2)).toHaveAttribute("data-selected");
    await expect(sidebarNodes.nth(2)).toHaveAttribute("data-selected");
    await expect(sidebarNodes.nth(1)).not.toHaveAttribute("data-selected");
  });

  await test.step("a repository change updates both graphs", async () => {
    await testRepo.commitFile("c.txt", "content c", "C");
    await expect(sidebarNodes).toHaveCount(5);
    await expect(tabNodes).toHaveCount(5);
  });

  await test.step("closing the tab leaves the sidebar graph working", async () => {
    await workbox.keyboard.press(`${mod}+w`);
    await expect(tabNodes).toHaveCount(0);
    await sidebarNodes.nth(1).click();
    await expect(sidebarNodes.nth(1)).toHaveAttribute("data-selected");
  });
});
```

- [ ] **Step 2: Run the test**

Run:
`pnpm exec playwright test --config=tests-integration/playwright.config.ts tests-integration/tests/graph-tab.test.ts`
Expected: PASS. If `tabNodes` still resolves after closing the tab (a detached frame may report count 0 or throw),
replace the `toHaveCount(0)` assertion with
`await expect(workbox.locator(".tab", { hasText: "JJ Graph" })).toHaveCount(0);`.

- [ ] **Step 3: Format, check, commit**

Run: `pnpm run format` then `pnpm run check`. Expected: pass.

```bash
jj commit -m "test: Test the graph tab mirrors the sidebar graph

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage**

- Section 1 (surfaces, shared handler, broadcast, guards, titles, request/response broadcast): Task 2.
- Section 2 (late attach / replay): Task 2 step 2 (`replayTo`) and step 5 (cached message). Deviation from the spec:
  instead of refactoring `render()` into `buildGraphMessage()`, the already-built `updateGraph` message is cached in
  `lastGraphMessage` and replayed with `preserveScroll: false`; the effect is the same with a smaller diff. The cache is
  cleared when the repository switches.
- Section 3 (selection mirroring, no echo, `nodesSelected` unchanged): Task 1 (message, helper, webview handling without
  echo) and Task 2 step 3 (host sends to other surfaces).
- Section 4 (command, single tab, reveal, serializer, close handling): Task 3.
- Section 5 (tab toolbar, submenu `when`): Task 4.
- Section 6 (webview changes): Task 1.
- Error handling (per-surface post failures swallowed, "Failed to open graph tab"): Task 2 step 4
  (`postMessageToSurface` catch) and Task 3 step 2 (`attachTab`).
- Testing (integration + helper unit test): Tasks 1 and 5.

**Placeholder scan:** none; every code step shows the code.

**Type consistency:** `GraphSurface`, `UpdateGraphMessage`, `surfaces`, `lastGraphMessage`, `attachSurface`, `replayTo`,
`handleMessage(message, source)`, `postMessageToWebview(message, except?)`, `postMessageToSurface`, `surfaceTitle`,
`updateTitles`, `openInTab`, `restoreTab`, `attachTab`, `mirroredSelection`, `GRAPH_TAB_VIEW_TYPE` / `'jjGraphTab'`,
`jj.openGraphInTab` are used identically across tasks.

**Known limitation:** while a surface is opened in a stale / error / no-repo state, replay sends the last good graph and
the next poll corrects it.
