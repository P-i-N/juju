# Graph in a Tab (Pop-Out Graph)

## Goal

Let the user open the JJ Graph as an editor tab that can be dragged out into a floating VS Code window (for example onto
a second monitor), while the existing "JJ Graph" view in the Source Control sidebar keeps working. Both show the same
live graph and stay in sync.

## Background

The graph is a `WebviewView` (`jjGraphWebview`) contributed to the `scm` view container. VS Code can only float editor
groups, not views, so the graph has to also be available as a `WebviewPanel` (editor tab).

`JJGraphWebview` ([src/graph-webview.ts](../../../src/graph-webview.ts)) already keeps all graph state in the extension
host: `lastSnapshot`, `selectedNodes`, `repository`, `currentChanges`. The webview renders and reports user actions. The
single obstacle is `panel?: vscode.WebviewView`: one surface only, used by `postMessageToWebview`, `refresh`, `render`,
`graphQueryFor` and the repository title update. The Details and Split views already use `createWebviewPanel`, so panels
are an established pattern here.

## Decisions

- Sidebar view and tab are both live and mirrored (user's choice). Closing either leaves the other working.
- At most one graph tab; opening again reveals it.
- Tab toolbar duplicates the sidebar `view/title` actions under `editor/title`.
- The tab is restored after a window reload via a `WebviewPanelSerializer`.
- Not mirrored: scroll position, expanded changed-file lists, tooltips, open context menus, in-progress drags. These are
  per-surface UI state.

## Design

### 1. Surfaces in `JJGraphWebview`

Replace `panel?: WebviewView` with a set of surfaces:

```ts
type GraphSurface = vscode.WebviewView | vscode.WebviewPanel;
private readonly surfaces = new Set<GraphSurface>();
```

- `attachSurface(surface, kind)` is the common path for `resolveWebviewView` (sidebar) and the tab:
  1. add `surface` to `surfaces`; remove it on dispose (`onDidDispose` for both kinds);
  2. set `webview.options` (`enableScripts`, `localResourceRoots`) and `webview.html`;
  3. wait for that surface's own `webviewReady`;
  4. register the shared message handler (the existing `switch` in `resolveWebviewView`, moved into a method
     `handleMessage(message, source)`);
  5. replay current state to this surface only (see "Late attach").
- `postMessageToWebview(message)` broadcasts to every surface and resolves to `true` if any delivery succeeded.
- A surface-targeted variant `postMessageToSurface(surface, message)` is used for replay and `setSelection`.
- Guards `if (!this.panel)` in `refresh`, `render`, `graphQueryFor` become `this.surfaces.size === 0`.
- Titles: a single `updateTitles()` sets `JJ Graph (<repo basename>)` on every surface, called from `resolveWebviewView`
  and `setSelectedRepository`.
- Request/response messages (`fetchDiffStats`, `fetchChangedFiles`, remote-ref lookups, `*Done`) are broadcast. The
  webview handlers already ignore responses that do not match their pending state (`changedFilesResponse` checks for
  `"loading"`, menu responses compare name/remote), and cache writes are idempotent, so this is harmless and avoids
  threading a source surface through every handler.

### 2. Late attach (replay)

When a surface finishes its `webviewReady` handshake:

- no repository: send `showJJNotFoundState` / `showNoRepoFoundState` (existing behaviour);
- otherwise, if `lastSnapshot` exists, render it to this surface only. `render()` is refactored so the message
  construction is separate from delivery: `buildGraphMessage()` returns the `updateGraph` message, `render()` broadcasts
  it, replay posts it to the single surface. `preserveScroll` is `false` for replay;
- send `setSelection` with the current `selectedNodes`.

If there is no snapshot yet, the next regular refresh renders to all surfaces, as it does today.

### 3. Selection mirroring

Selection lives in the webview (`selectedNodes`, `selectionAnchorId` signals) and is reported via `selectChange`. Add
host to webview message:

```ts
| { command: "setSelection"; selectedNodes: FullChangeId[] }
```

- On `selectChange` from surface X, the host updates `selectedNodes` as today and posts `setSelection` to every surface
  except X.
- The webview handler sets `selectedNodes.value` to the given ids (filtered to ids present in `currentChanges`) and sets
  `selectionAnchorId` to the last id (or `null` when empty). It does not post `selectChange` back, so there is no echo
  loop.
- The existing `fireSelection` de-duplication (`lastFiredSelection`) is unchanged, so Details and diff selection fire
  once per real change.
- `jjGraphView.nodesSelected` stays a single global context key driven by the host selection, so toolbar actions
  (`jj.newGraphWebview`) behave the same from either surface.

### 4. Tab lifecycle and command

New command `jj.openGraphInTab`, title "Open Graph in Tab", category "Jujutsu", icon `$(link-external)`.

- Contributed to `view/title` for `jjGraphWebview` at `navigation@9` (after the repo switcher) and available in the
  Command Palette (`when: jj.reposExist`).
- Handler: if the tab exists, `reveal()`; else
  `createWebviewPanel("jjGraphTab", title, ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [extensionUri] })`
  and `attachSurface`.
- `registerWebviewPanelSerializer("jjGraphTab", { deserializeWebviewPanel })` attaches a restored panel the same way
  (the HTML is re-set; state is replayed from the host).
- When the extension is deactivated or the panel is closed, the surface is removed and the sidebar is unaffected.

### 5. Tab toolbar

The sidebar's `view/title` entries (package.json, `view == jjGraphWebview ...`) do not render for an editor tab. Add
matching `editor/title` entries with `when: activeWebviewPanelId == 'jjGraphTab' && <same condition>` for: Details,
Fetch (idle/syncing), Fetch submenu (idle/syncing), Undo, Redo, Refresh, New, Elide toggle (show/elide), Select
Repository. The fetch submenu (`jj.graphFetchSubmenu`) items get a `when` that also accepts the tab, i.e.
`view == jjGraphWebview || activeWebviewPanelId == 'jjGraphTab'`. The same commands and context keys are reused; no new
command logic.

Group/order values mirror the sidebar (`navigation@N`) so the two toolbars look alike.

### 6. Webview side

`src/webview/graph` needs no layout change: it already adapts to its container width. Only additions are the
`setSelection` case in `handleMessage` in [app.tsx](../../../src/webview/graph/app.tsx) and the corresponding
`ExtensionToWebviewMessage` variant in [graph-protocol.ts](../../../src/graph-protocol.ts).

## Error handling

- `postMessage` to a disposed surface is guarded: surfaces are removed on dispose and `postMessage` rejections are
  swallowed per surface so one dead surface cannot block delivery to the other.
- If `createWebviewPanel` or the handshake fails, the error goes through
  `showErrorMessage("Failed to open graph tab", error)`; the sidebar is unaffected.

## Testing

- Integration (Playwright, `tests-integration/tests`): open the tab with `jj.openGraphInTab`; select a change in the tab
  and assert it is highlighted in the sidebar view, and the reverse; refresh after a repo change updates both; closing
  the tab leaves the sidebar graph working.
- Unit: none needed for wiring. If `setSelection` filtering is extracted into a pure helper (ids present in
  `currentChanges`), it gets a small unit test in `src/unit-test`.
- `pnpm run format` and `pnpm run check` after the change.

## Out of scope

- Mirroring scroll position or other per-surface UI state.
- Multiple graph tabs, or a tab per repository.
- A separate OS-level VS Code window sharing state (not practical across extension hosts).
