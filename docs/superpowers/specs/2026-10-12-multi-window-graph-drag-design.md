# Multiple Graph Windows with Cross-Window Drag & Drop

## Intent

In large projects with complex graphs, the user wants several JJ Graph windows open at once (typically each dragged out
into its own floating VS Code window) and to move work between them by dragging, exactly as they already can inside one
graph. Example from the user: drag a changed file in one floating window and Ctrl+drop it on the edge between two
commits in another floating window to move it into a new change there.

Per-window filters (a different revset or branch per window) were discussed and explicitly deferred: every graph window
shows the same commits as today.

## Goals

1. "Jujutsu: Open Graph in Tab" opens a **new** graph tab every time (today it reveals the single existing tab). Any
   number of graph tabs can be open, each movable into its own floating window, alongside the sidebar graph.
2. Every graph surface (sidebar + all tabs) stays live: refreshes, repository switches and errors reach all of them.
3. **Every drag that works inside one graph also works across graph windows**, with the same feedback (drop-target
   highlight, edge/insert highlight, Ctrl+drop edge menu, hunk drop menu) and the same repository effect:
   - changes (rebase / duplicate / squash, including Ctrl+drop on an edge),
   - bookmarks (move bookmark),
   - changed files (move into a change, Ctrl+drop on an edge → "Move to New Change" / "Copy to New Change"),
   - hunks (the hunk drop menu).
4. An open graph menu (context menu, rebase menu, edge/hunk drop menu, pill/remote-ref/file menus) closes when the user
   interacts with any other graph window, not only when its own page loses focus.
5. All open graph tabs come back after a window reload.

## Non-goals

- Per-window revsets / filters / repositories (deferred; all windows show the same graph).
- A dedicated "Open Graph in New Window" command. VS Code's "Copy into New Window" on a webview tab moves the tab
  instead of copying it; that is VS Code behaviour the extension cannot change, and the user said the existing "Open
  Graph in Tab" plus "Move into New Window" is enough.
- Dragging from a graph into editors, the explorer or other views, or from them into a graph.

## Anti-goals (would count as failure even if it technically works)

- A graph window that is stuck in "dragging" state (it defers graph updates while dragging, so a stuck state freezes it)
  after a cross-window drag is cancelled, dropped elsewhere, or its source window is closed.
- A drop that performs an action twice (once per window) or acts on the wrong change.
- Regressing drags inside a single graph, or the sidebar/tab selection mirroring added in the graph-in-tab work.

## Current state (relevant facts)

- Base: this builds on the `feat/hunks` bookmark (on top of `main`), which already contains the graph-in-tab work
  (`JJGraphWebview` hosts a set of surfaces, broadcasts host→webview messages, mirrors selection via `setSelection`,
  replays state on `webviewReady`) plus hunk dragging and the Ctrl+drop edge menu. Hunk drags exist only there.
- `src/graph-webview.ts` keeps a single `tab` reference: `openInTab` reveals it if present, and the panel serializer's
  `restoreTab` disposes any restored panel when a tab already exists. Both must change for goals 1 and 5.
- Drag state lives per webview in signals (`src/webview/graph/signals.ts`): `isDragging`, `dragStartChangeId` (with
  derived `dragSourceIds`, the whole selection when the dragged change is part of it), `dragBookmarkName`,
  `dragFiles: { changeId, paths }`, `dragHunks: { changeId, hunks: { path, hunk: HunkRange }[] }`. Drop targets
  (`src/webview/graph/hooks/use-drag-drop.ts`, `change-node.tsx`, `edge-hover.ts`) read these signals; with no local
  drag state they ignore the drag, which is why another window shows no highlight today. Change drags also put the
  change id into `dataTransfer` as `text/plain`.
- While `isDragging` is true, a webview defers incoming `updateGraph` messages (`pendingGraphUpdate` in `app.tsx`).
- Menus close via `closeAllMenus()` on the page's `blur` event (`app.tsx`). A right-click menu does not focus the page,
  so clicking into another window never closes it.

## Evidence from the spike (throwaway, abandoned)

A spike logging every drag event in two graph tabs, each in its own floating window, showed:

- `dragenter` / `dragover` / `drop` **do** fire in a graph webview in a different floating window, so HTML5 drag & drop
  crosses windows; no VS Code overlay swallows them.
- The target window shows no drop highlight (it has no local drag state), but a Ctrl+drop worked across windows.

## Decided by the user

- Keep "Open Graph in Tab" as the only way to open graph tabs; it opens a new tab each time.
- All drag kinds work across windows (changes, bookmarks, files, hunks).
- No per-window filters for now.

## Design (decided in conversation, details left to the builder where noted)

### Drag relay through the extension host

Graph webviews cannot see each other, so the source window tells the host what is being dragged and the host relays it
to every other graph surface:

- On drag start, the source webview posts a host message describing the drag payload: the kind and its data, i.e. the
  dragged change ids (as `dragSourceIds` resolves them in the source, so a multi-selection drag carries the whole
  selection), or the bookmark name, or `DraggedFiles`, or `DraggedHunks`.
- The host forwards it to every surface except the source. A receiving webview stores it as **remote drag state** and
  its drop targets treat it exactly like a local drag: highlights, edge hover, Ctrl+drop menu, hunk drop menu, and the
  same host commands on drop. All windows show the same graph, so ids are valid in every window.
- On drag end in the source, and on a drop in any window, the drag is ended everywhere (host relays an "ended" message).
  Exactly one window performs the drop action: the window where the drop happens.
- Builder's choice: whether remote state reuses the existing drag signals directly or sits beside them; the drag-image
  ghost stays a source-window concern.

### Never stuck in a drag

Remote drag state must always clear. At minimum: when the source ends the drag (relayed), when this window handles a
drop, when the source surface is disposed while a drag is active, and by a local fallback (e.g. a `mousemove` with no
buttons pressed, or a timeout after the last drag event) in case a relay message is lost. Deferred graph updates must
apply once the state clears.

Ordering (builder's call, noted by the review): the source's relayed "ended" can reach the target before the target's
own `drop` handler runs, since the source fires `dragend` as the drop completes. The target must still be able to act on
its drop, e.g. by keeping remote drag state briefly after a relayed "ended" and letting its local drop clear it.

### Multiple tabs

- `openInTab` always creates a new panel; the single `tab` field becomes a set (or is dropped in favour of `surfaces`).
- The serializer restores every graph tab after a reload (no "dispose duplicates").
- Tab titles stay `JJ Graph (<repo>)` (builder may add a distinguishing suffix if trivial; not required).
- Selection stays mirrored across all surfaces (my call, not contradicted by the user): selecting a change in one window
  selects it everywhere, as with the sidebar and one tab today.

### Closing menus across windows

When a graph webview gets a pointer-down (or opens a menu), it tells the host, which tells every other surface to run
`closeAllMenus()`. The existing `blur` handling stays.

## Testing

- Unit tests for any pure logic added (e.g. remote drag state transitions / payload validation).
- Playwright: real OS-level drags across separate windows cannot be automated, but the relay is the same when two graph
  tabs sit side by side in one window (split editor). Cover: a cross-tab file Ctrl+drop on an edge, a change drag onto a
  change (drop-target highlight visible in the target tab), a bookmark drag, a hunk drag, a cancelled drag leaving no
  stuck state (target tab still applies graph updates), menus closing when clicking another graph tab, and two tabs
  restored after reload if feasible.
- Manual check by the user: the same drags between two floating windows.
- `pnpm run format` and `pnpm run check` (pnpm may not be on PATH in the agent environment; run the equivalents).

## Left to the builder

- Message names and exact payload shapes for the relay; how remote state is represented in the webview.
- The stuck-state fallback mechanism, as long as the anti-goal holds.
- How menu-closing is triggered (pointer-down vs menu-open), as long as goal 4 holds.
