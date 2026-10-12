# Multiple Graph Windows with Cross-Window Drag & Drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any number of JJ Graph tabs (each movable into its own floating window), and every graph drag (changes,
bookmarks, files, hunks) working across graph windows with the same feedback and effect as inside one graph.

**Architecture:** The host (`JJGraphWebview`) already hosts a set of surfaces and broadcasts to them. The single `tab`
becomes a set, so "Open Graph in Tab" always opens a new tab and every tab is restored. A drag that starts in one
webview is announced to the host as a `GraphDragPayload`. The host relays it to the other surfaces, which load it into
their existing drag signals as a _remote drag_, so all existing drop targets, highlights and menus work unchanged. The
drag ends everywhere through a relayed end plus local fallbacks, and pointer-downs are relayed so menus close across
windows.

**Tech Stack:** TypeScript (strict), VS Code webview API, Preact + `@preact/signals`, `node:test` unit tests, Playwright
integration tests.

**Spec:**
[docs/superpowers/specs/2026-10-12-multi-window-graph-drag-design.md](../specs/2026-10-12-multi-window-graph-drag-design.md)

## Global Constraints

- Base: the `feat/hunks` bookmark. Use `jj` only, never `git`. Commit with `jj commit -m "<msg>"` (the working copy is
  clean before each task). Conventional Commits, sentence case, imperative, no trailing period. Trailer after a blank
  line: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No code comments unless they explain something non-obvious. Keep existing comments unless they become incorrect.
- UI text: Title Case for titles/menu items. No new commands or menu entries are added by this plan.
- "Open Graph in Tab" (`jj.openGraphInTab`) stays the only way to open graph tabs, and opens a **new** tab every time.
  Tab view type stays `jjGraphTab`. Tab title stays `JJ Graph (<repo basename>)`.
- Every graph surface shows the same commits (no per-window revsets). Selection stays mirrored across all surfaces.
- Exactly one window performs a drop's action: the window where the drop happens.
- A window must never stay in drag state after a drag ends anywhere (it defers `updateGraph` while dragging).
- After each task: `pnpm run format` and `pnpm run check`. `pnpm` may be missing from PATH in agent environments. If so,
  run `node_modules/.bin/prettier --write <changed files>`, the three `tsc --noEmit` projects (root,
  `src/webview/tsconfig.json`, `tests-integration/tsconfig.json`),
  `node_modules/.bin/eslint esbuild.js src tests-integration/*.ts tests-integration/tests`, and
  `node --import tsx --test --test-reporter ./src/unit-test/reporter.mjs src/unit-test/*.test.ts`. Known pre-existing
  failures: 4 Windows-path cases in `src/unit-test/utils.test.ts`.
- Playwright: rebuild first (`node esbuild.js`), then
  `node_modules/.bin/playwright test --config=tests-integration/playwright.config.ts <file>`. Never add custom timeouts
  to expectations.

## Review Focus

1. **Escape-cancelled drag:** the user cancels a drag with Escape in the source window. Every other window drops its
   remote drag state, and graph updates that were deferred during the drag get applied. Test in Task 3.
2. **Source tab closed mid-drag:** a source graph tab is closed while a drag it started is active, so its `dragend`
   never arrives. The other windows clear their state. Test in Task 3 (host disposes the source → relayed end).
3. **Drop onto the drag's own change:** in another window, dropping onto the dragged change, or onto the change owning
   the dragged files or hunks, does nothing, exactly as in one window. Test in Task 3.
4. **Multi-selection change drag:** across windows, the rebase menu acts on every selected change, as in one window.
   Test in Task 3.
5. **Drop outside every graph:** a drag ends on an editor or other non-graph UI. All windows clear their state. Covered
   by the same relayed end as item 1. Test in Task 3 (drop on the editor area).

---

### Task 1: Drag payload protocol and pure helpers

**Files:**

- Modify: `src/graph-protocol.ts` (new type, new messages in both unions)
- Create: `src/webview/graph/drag-payload.ts`
- Test: `src/unit-test/drag-payload.test.ts`

**Interfaces:**

- Produces, in `src/graph-protocol.ts`:
  - The payload type:
    ```ts
    export type GraphDragPayload =
      | { kind: "changes"; startId: FullChangeId; sourceIds: FullChangeId[] }
      | { kind: "bookmark"; name: string }
      | { kind: "files"; changeId: FullChangeId; paths: string[] }
      | {
          kind: "hunks";
          changeId: FullChangeId;
          hunks: {
            path: string;
            hunk: { oldStart: number; oldLines: number; newStart: number; newLines: number };
          }[];
        };
    ```
  - Webview→host messages: `{ command: "dragStarted"; payload: GraphDragPayload }`, `{ command: "dragEnded" }`,
    `{ command: "graphPointerDown" }`.
  - Host→webview messages: `{ command: "remoteDragStarted"; payload: GraphDragPayload }`,
    `{ command: "remoteDragEnded" }`, `{ command: "closeMenus" }`.
- Produces, in `src/webview/graph/drag-payload.ts` (no signal imports, so it is unit-testable):
  - `interface LocalDragState { startId: FullChangeId | null; sourceIds: FullChangeId[]; bookmark: string | null; files: DraggedFiles | null; hunks: DraggedHunks | null }`.
    Import `DraggedFiles` and `DraggedHunks` as types from `./signals`, or move the two interfaces into this file and
    re-export them from `signals.ts`. Pick whichever avoids a runtime import of `signals.ts`.
  - `dragPayloadOf(state: LocalDragState): GraphDragPayload | null`. Precedence is bookmark, then hunks, then files,
    then changes, matching how `onDrop` checks them. Returns `null` when nothing is dragged.
  - `dragStateOf(payload: GraphDragPayload): LocalDragState`, the inverse.

- [ ] **Step 1: Write the failing tests** in `src/unit-test/drag-payload.test.ts` (`describe("dragPayloadOf")`,
      `describe("dragStateOf")`). They assert:
  - A change drag `{ startId: "a", sourceIds: ["a","b"], bookmark: null, files: null, hunks: null }` gives
    `{ kind: "changes", startId: "a", sourceIds: ["a","b"] }`.
  - A bookmark drag gives `{ kind: "bookmark", name }`, even if `startId` is also set.
  - A files drag gives `{ kind: "files", changeId, paths }`. A hunks drag gives `{ kind: "hunks", changeId, hunks }`.
  - An all-empty state gives `null`.
  - For each of the four kinds, `dragPayloadOf(dragStateOf(p))` deep-equals `p`.
  - `dragStateOf({ kind: "files", ... })` has `startId: null`, `sourceIds: []`, `bookmark: null`, `hunks: null`.
- [ ] **Step 2: Run the tests and see them fail.**
      `node --import tsx --test --test-reporter ./src/unit-test/reporter.mjs src/unit-test/drag-payload.test.ts` fails
      because the module is missing.
- [ ] **Step 3: Implement** the protocol additions and both functions. Leave the new messages unhandled for now: the
      host's `handleMessage` switch and the webview's `handleMessage` simply ignore unknown commands. Check that
      type-checking still passes, since exhaustive switches may need a `case` that does nothing yet. If so, add it in
      the task that implements the message.
- [ ] **Step 4: Run the tests and see them pass.** Then run the full check (Global Constraints).
- [ ] **Step 5: Commit** with message `feat: Describe graph drags as a relayable payload`.

---

### Task 2: Any number of graph tabs

**Files:**

- Modify: `src/graph-webview.ts`: `tab` field, `openInTab`, `restoreTab`, `attachTab`
- Test: `tests-integration/tests/graph-tab.test.ts` (add a test)

**Interfaces:**

- Produces: `private readonly tabs = new Set<vscode.WebviewPanel>()`, which replaces `tab`.
  - `openInTab()` always creates and attaches a new panel.
  - `restoreTab(panel)` always attaches. It never disposes, and it stays synchronous: it must not await the handshake
    (see the existing `void this.attachTab(panel)`).
  - `attachTab` adds the panel to `tabs` and removes it on dispose.
  - No other behaviour changes: titles, `retainContextWhenHidden`, `updateElidingContext`, and `refresh` after attach
    all stay.

- [ ] **Step 1: Write the failing Playwright test** `"each Open Graph in Tab opens another live graph tab"` in
      `graph-tab.test.ts`:
  - Commit A and B, then run "Jujutsu: Open Graph in Tab" twice.
  - `workbox.locator(".tab", { hasText: "JJ Graph" })` has count 2.
  - After `testRepo.commitFile("c.txt", …)`, every graph frame on the page (sidebar plus both tabs, three frames found
    by a helper like the existing `findOtherGraphFrame` that collects all frames containing `id="nodes"` with rows)
    shows 5 rows.
  - Selecting a row in one tab sets `data-selected` on that row in the other two frames.

  Since only the active tab of an editor group renders, move the second tab with "View: Move Editor into Right Group"
  before collecting frames. Put that in a helper
  `openTwoGraphTabsSideBySide(workbox, sidebarFrame): Promise<[Frame, Frame]>`, exported from a new
  `tests-integration/tests/graph-tabs.ts` so Task 3 reuses it.

- [ ] **Step 2: Run it and see it fail.** There is only one tab, because the second "Open Graph in Tab" reveals the
      first.
- [ ] **Step 3: Implement** the `tabs` set as in the Interfaces block.
- [ ] **Step 4: Run** `graph-tab.test.ts` and confirm both tests pass. Also run `graph-view.test.ts`.
- [ ] **Step 5: Commit** with message `feat: Open a new graph tab every time`.

---

### Task 3: Cross-window drag relay

**Files:**

- Create: `src/webview/graph/drag-relay.ts`
- Modify:
  - `src/webview/graph/signals.ts`: `remoteDrag` signal, and `dragSourceIds` honours relayed ids
  - `src/webview/graph/hooks/use-drag-drop.ts`: `onDrop` change branch
  - `src/webview/graph/app.tsx`: install the relay, handle the two remote messages
  - `src/graph-webview.ts`: relay in `handleMessage`, plus dispose handling
- Test:
  - `src/unit-test/drag-payload.test.ts` (extend only if new pure logic appears)
  - `tests-integration/tests/graph-cross-window-drag.test.ts`

**Interfaces:**

- Consumes:
  - `GraphDragPayload`, the drag messages, `dragPayloadOf` and `dragStateOf` (Task 1).
  - `openTwoGraphTabsSideBySide` (Task 2).
- Produces, in `signals.ts`:
  - `export const remoteDrag = signal(false)`, true while this window shows a drag that started elsewhere.
  - `export const remoteDragSourceIds = signal<FullChangeId[] | null>(null)`. While non-null, `dragSourceIds` returns it
    instead of deriving from local selection.
- Produces, in `drag-relay.ts`:
  - `installDragRelay(): () => void`. It installs an `effect` and returns its disposer.
    - **Start.** When `isDragging` turns true while `!remoteDrag.value`, it posts `dragStarted` with
      `dragPayloadOf(...)` of the current signals and remembers in a closure flag that a local drag is active. Every
      drag start site already sets its payload signal before `isDragging`, so no drag start site changes.
    - **End.** When `isDragging` turns false, it posts `dragEnded` only if that flag is set, then clears the flag. If
      `remoteDrag` is still true, it also resets `remoteDrag` and `remoteDragSourceIds`. That covers a drop in a target
      window, whose existing handlers only reset the payload signals and `isDragging`.
    - **Invariant:** a remote drag never posts `dragStarted` or `dragEnded`.
  - `applyRemoteDragStart(payload: GraphDragPayload): void`. It closes menus, writes `dragStateOf(payload)` into
    `dragStartChangeId`, `dragBookmarkName`, `dragFiles`, `dragHunks` and `remoteDragSourceIds`, then sets
    `remoteDrag = true` and `isDragging = true`.
  - `applyRemoteDragEnd(): void`. It clears the remote state after `REMOTE_DRAG_END_GRACE_MS = 500`, so a drop in this
    window that is ordered after the relayed end still sees its payload. It also clears `dropTargetId`, `hoveredEdge`,
    `remoteDragSourceIds` and `remoteDrag`. If a local drop already cleared the state, it is a no-op.
  - `clearRemoteDragNow(): void`, used by the fallback and by a drop in this window.
  - Fallback: while `remoteDrag` is true, a window `mousemove` with `buttons === 0` calls `clearRemoteDragNow()`. Mouse
    events do not fire during an HTML5 drag, so any such move means the drag is over.

- Produces, in the host (`graph-webview.ts`):
  - `private activeDrag: { source: GraphSurface } | undefined`.
  - On `dragStarted`: set `activeDrag` and relay `remoteDragStarted` to every other surface.
  - On `dragEnded` from the active source: clear `activeDrag` and relay `remoteDragEnded` to the others.
  - When the active source surface is disposed: relay `remoteDragEnded` to the remaining surfaces.
  - These three commands must be handled before the `!this.repository` guard returns.
- Change in `use-drag-drop.ts` `onDrop`:
  - The changes branch takes `sourceId` from `dragStartChangeId.value`, falling back to
    `e.dataTransfer.getData("text/plain")`.
  - It takes `sourceIds` from `dragSourceIds.value`, falling back to `[sourceId]`, instead of re-deriving from
    `selectedNodes`.
  - The result for a local drag must stay identical: same ordering, dragged change first.

- [ ] **Step 1: Write the failing Playwright tests** in `graph-cross-window-drag.test.ts`.
  - **Setup.** Each test opens two side-by-side tabs via `openTwoGraphTabsSideBySide`, with the left tab as the source
    and the right tab as the target.
  - **How to drag.** Drag with `workbox.mouse` across the two frames' page coordinates. Model it on `ctrlDragToEdge` /
    `dropAndChoose` / `changeRow` in `insert-edge-drag.test.ts` and on the mouse moves in `drag-highlight.test.ts`,
    copying the small helpers locally. If a real mouse drag between the two iframes cannot be made to work in
    Playwright, dispatch synthetic `DragEvent`s instead: `dragstart` on the source element in the source frame, then
    `dragenter`, `dragover` and `drop` (with `ctrlKey` and `clientX`/`clientY` where needed) on the target element in
    the target frame, then `dragend` on the source. Do this through `frame.evaluate`, and record the choice in the
    report.
  - **Tests and assertions:**
    1. `"Ctrl+dropping a changed file on an edge in another graph tab moves it into a new change"`. It is the same
       scenario and repo assertions as the single-graph test "Ctrl+dropping a changed file on an edge moves it into a
       new change there", but the menu appears in the **target** frame.
    2. `"dragging a change over another graph tab highlights the drop target and opens the rebase menu there"`:
       - During the drag, the hovered row in the target frame has the same drop-target highlight attribute or class the
         single-graph drag-highlight test asserts.
       - After the drop, `#rebase-menu` (or whatever the single-graph tests use) is visible in the target frame and
         absent in the source.
    3. `"dragging a multi-selection across graph tabs rebases every selected change"` (Review Focus 4). It asserts the
       repo parents of both selected changes after choosing Rebase.
    4. `"dragging a bookmark into another graph tab moves the bookmark"`. Assert with `testRepo` that the bookmark
       target changed.
    5. `"dragging hunks into another graph tab opens the hunk drop menu there"`. Expand hunks the same way the existing
       hunk tests in `show-changed-files.test.ts` do, then assert the hunk drop menu is visible in the target frame.
    6. `"dropping onto the dragged change in another graph tab does nothing"` (Review Focus 3). Assert no menu opens and
       `testRepo.log()` is unchanged.
    7. `"a cancelled cross-tab drag leaves no graph tab stuck"` (Review Focus 1 and 5):
       - Start a drag, move over the target, then press Escape (or drop on the editor area) and finish the drag.
       - Then `testRepo.commitFile(...)`. Both tab frames and the sidebar must show the new row, which proves no surface
         defers updates forever.
    8. `"closing the source tab mid-drag clears the drag in other tabs"` (Review Focus 2):
       - Use synthetic events: `dragstart` in the source, then close the source tab with "View: Close Editor" without a
         `dragend`.
       - Then commit a file and expect the remaining tab to show the new row.
- [ ] **Step 2: Run them and see them fail.** There is no highlight or menu in the target and no repo change. Note which
      ones already pass (the Ctrl+edge change drop may), and say so in the report.
- [ ] **Step 3: Implement** the signals, `drag-relay.ts`, the `app.tsx` wiring, the `onDrop` change and the host relay,
      as in the Interfaces block. The `app.tsx` wiring calls `installDragRelay()` in the existing mount effect, disposes
      it on unmount, and handles `remoteDragStarted` and `remoteDragEnded`.
- [ ] **Step 4: Run** `graph-cross-window-drag.test.ts`, then the existing drag suites for regressions:
      `insert-edge-drag.test.ts`, `drag-highlight.test.ts`, `bookmarks.test.ts`, `duplicate.test.ts`, `rebase.test.ts`,
      `show-changed-files.test.ts`, `graph-tab.test.ts`. Then run the full check.
- [ ] **Step 5: Commit** with message `feat: Drag changes, bookmarks, files and hunks between graph windows`.

---

### Task 4: Close graph menus when another graph window is used

**Files:**

- Modify:
  - `src/webview/graph/app.tsx`: post `graphPointerDown`, handle `closeMenus`
  - `src/graph-webview.ts`: relay
- Test: `tests-integration/tests/graph-cross-window-drag.test.ts` (or `graph-tab.test.ts`)

**Interfaces:**

- Consumes: `graphPointerDown` and `closeMenus` (Task 1), and `openTwoGraphTabsSideBySide` (Task 2).
- Produces:
  - **Webview:** a capture-phase `pointerdown` listener on `window`, registered in the existing mount effect and removed
    on unmount, posts `{ command: "graphPointerDown" }`. On `closeMenus` the webview calls `closeAllMenus()`. The
    existing `blur` → `closeAllMenus` stays.
  - **Host:** on `graphPointerDown` from surface X, post `closeMenus` to every surface except X. Handle it before the
    `!this.repository` guard.

- [ ] **Step 1: Write the failing Playwright test** `"a graph context menu closes when another graph tab is clicked"`:
  - Right-click a change row in the left tab, and expect its context menu (the locator the existing context-menu tests
    use) to be visible.
  - Click a row in the right tab. Expect the left tab's menu to be hidden, and the right tab's selection to be updated.
- [ ] **Step 2: Run it and see it fail.** The menu stays open.
- [ ] **Step 3: Implement** as in the Interfaces block.
- [ ] **Step 4: Run** the new test, `graph-tab.test.ts`, and one existing context-menu suite (e.g. `abandon.test.ts`)
      for regressions. Then run the full check.
- [ ] **Step 5: Commit** with message `feat: Close graph menus when another graph window is used`.

---

## Self-Review

- **Spec coverage:**
  - Goal 1 (new tab each time): Task 2.
  - Goal 2 (all surfaces live): already holds; tested in Task 2.
  - Goal 3 (all drags): Task 3, tests 1–6.
  - Goal 4 (menus): Task 4.
  - Goal 5 (restore every tab): Task 2, by `restoreTab` no longer disposing. No automated reload test, because the
    reload path cannot be driven reliably. It stays a manual check, as in the spec ("if feasible").
- **Anti-goals:**
  - Stuck drag: Task 3, tests 7–8, plus the mousemove fallback.
  - Double action: the host relays only state, never commands, and exactly one `onDrop` runs.
  - Single-graph regressions: Task 3 step 4 and Task 4 step 4.
  - Ordering race: `REMOTE_DRAG_END_GRACE_MS`.
- **Out of scope** per spec: per-window revsets, a "New Window" command, and drags to or from non-graph views.
- **Names across tasks:**
  - `GraphDragPayload`, `dragPayloadOf`, `dragStateOf` and `LocalDragState` (Task 1).
  - `tabs` and `openTwoGraphTabsSideBySide` (Task 2).
  - `remoteDrag`, `remoteDragSourceIds`, `installDragRelay`, `applyRemoteDragStart`, `applyRemoteDragEnd`,
    `clearRemoteDragNow` and `REMOTE_DRAG_END_GRACE_MS` (Task 3).
  - The messages `dragStarted`, `dragEnded`, `graphPointerDown`, `remoteDragStarted`, `remoteDragEnded` and `closeMenus`
    are used consistently.
