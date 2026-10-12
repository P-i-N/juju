import { test, expect, runCommand } from "./base-test";
import { getParents } from "../test-repo";
import { openTwoGraphTabsSideBySide } from "./graph-tabs";
import type { Frame, Locator } from "@playwright/test";
import type { LogEntry } from "../../src/types";

// Playwright's emulated mouse drags never leave the iframe they start in, so the drags between the two graph tabs
// are dispatched as DragEvents, in the order a browser fires them: dragstart in the source tab, dragenter, dragover
// and dragleave or drop in the target tab, then dragend in the source tab.

interface DragPoint {
  side?: "top" | "bottom";
  ctrl?: boolean;
}

/** Starts a drag on the element and returns the text it put into the drag data. */
async function dragStart(source: Locator): Promise<string> {
  return source.evaluate((el) => {
    const dataTransfer = new DataTransfer();
    el.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer }));
    return dataTransfer.getData("text/plain");
  });
}

async function dragEnd(source: Locator) {
  await source.evaluate((el) => {
    el.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: new DataTransfer() }));
  });
}

async function dispatchDrag(
  target: Locator,
  type: "dragenter" | "dragover" | "dragleave" | "drop",
  point: DragPoint = {},
  data = "",
) {
  await target.evaluate(
    (el, { type, side, ctrl, data }) => {
      const rect = el.getBoundingClientRect();
      const dataTransfer = new DataTransfer();
      if (data) {
        dataTransfer.setData("text/plain", data);
      }
      el.dispatchEvent(
        new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          ctrlKey: ctrl,
          dataTransfer,
          clientX: side ? rect.left + rect.width / 2 : rect.left + 40,
          clientY: side === "top" ? rect.top + 1 : side === "bottom" ? rect.bottom - 1 : rect.top + rect.height / 2,
        }),
      );
    },
    { type, side: point.side ?? null, ctrl: point.ctrl ?? false, data },
  );
}

async function dragOver(target: Locator, point: DragPoint = {}, leaving?: Locator) {
  await dispatchDrag(target, "dragenter", point);
  await dispatchDrag(target, "dragover", point);
  if (leaving) {
    await dispatchDrag(leaving, "dragleave");
  }
}

async function outlineStyle(row: Locator): Promise<string> {
  return row.evaluate((el) => getComputedStyle(el).outlineStyle);
}

/**
 * Drags over the row until it shows the drag, which takes the drag relayed from the source tab: before it arrives,
 * the row ignores the drag.
 */
async function dragOverUntil(target: Locator, shows: (row: Locator) => Promise<void>, point: DragPoint = {}) {
  await expect(async () => {
    await dragOver(target, point);
    await shows(target);
  }).toPass();
}

async function highlighted(row: Locator) {
  expect(await outlineStyle(row)).toBe("solid");
}

function changeRow(graphFrame: Frame, changeId: string) {
  return graphFrame.locator(`#nodes > div[data-change-id^="${changeId}/"]`);
}

function fileRows(graphFrame: Frame, changeId: string, filePath?: string) {
  const pathFilter = filePath === undefined ? "" : `[data-path="${filePath}"]`;
  return graphFrame.locator(`#nodes > [data-role="changed-file"][data-file-of^="${changeId}/"]${pathFilter}`);
}

function parentIds(entries: LogEntry[], changeId: string): string[] {
  return entries.find((e) => e.change_id === changeId)!.parents.map((p) => p.change_id);
}

test.beforeEach(() => {
  // Every test opens two more graph tabs before it starts dragging.
  test.slow();
});

test("Ctrl+dropping a changed file on an edge in another graph tab moves it into a new change", async ({
  graphFrame,
  testRepo,
  workbox,
}) => {
  const idA = await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.writeFile("b.txt", "content b");
  await testRepo.writeFile("c.txt", "content c");
  const idB = await testRepo.commit("B");
  await expect(graphFrame.locator("#nodes > div[data-change-id]")).toHaveCount(4);
  const idWorkingCopy = (await testRepo.log("@"))[0].change_id;
  const [source, target] = await openTwoGraphTabsSideBySide(workbox, graphFrame);

  await changeRow(source, idB).locator('[data-role="files-toggle"]').click();
  const fileRow = fileRows(source, idB, "b.txt");
  await expect(fileRow).toBeVisible();

  const data = await dragStart(fileRow);
  const edge = { side: "top", ctrl: true } as const;
  const targetA = changeRow(target, idA);
  await dragOverUntil(
    targetA,
    async (row) => expect(await row.evaluate((el) => el.hasAttribute("data-edge-top"))).toBe(true),
    edge,
  );
  await expect(changeRow(target, idB)).toHaveAttribute("data-edge-bottom", "");

  await dispatchDrag(targetA, "drop", edge, data);
  await dragEnd(fileRow);
  const menu = target.locator("#edge-drop-menu");
  await expect(menu).toBeVisible();
  await expect(source.locator("#edge-drop-menu")).toHaveCount(0);
  await menu.locator('[data-action="moveToNewChange"]').click();
  await expect(menu).not.toBeVisible();

  await expect(async () => {
    const entries = await testRepo.log();
    const [idNew] = parentIds(entries, idB);
    expect(idNew).not.toEqual(idA);
    expect(parentIds(entries, idNew)).toEqual([idA]);
    expect(entries.find((e) => e.current_working_copy)!.change_id).toEqual(idWorkingCopy);
    const moved = (await testRepo.jjCommand(["diff", "-r", idNew, "--name-only"])).stdout.toString();
    expect(moved.trim().split(/\r?\n/)).toEqual(["b.txt"]);
    const left = (await testRepo.jjCommand(["diff", "-r", idB, "--name-only"])).stdout.toString();
    expect(left.trim().split(/\r?\n/)).toEqual(["c.txt"]);
  }).toPass();
});

test("dragging a change over another graph tab highlights the drop target and opens the rebase menu there", async ({
  graphFrame,
  testRepo,
  workbox,
}) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.commitFile("c.txt", "content c", "C");
  await expect(graphFrame.locator("#nodes > div")).toHaveCount(5);
  const [source, target] = await openTwoGraphTabsSideBySide(workbox, graphFrame);

  const sourceC = source.locator("#nodes > div").nth(1);
  const targetB = target.locator("#nodes > div").nth(2);
  const targetA = target.locator("#nodes > div").nth(3);

  const data = await dragStart(sourceC);
  await dragOverUntil(targetB, highlighted);
  await dragOver(targetA, {}, targetB);

  await expect(targetA).toHaveCSS("outline-style", "solid");
  await expect(targetB).toHaveCSS("outline-style", "none");

  await dispatchDrag(targetA, "drop", {}, data);
  await dragEnd(sourceC);

  const rebaseItem = target.locator('#rebase-menu [data-action="rebase"]');
  await expect(rebaseItem).toBeVisible();
  await expect(source.locator("#rebase-menu")).toHaveCount(0);
  await rebaseItem.hover();
  await target.locator('#rebase-menu [data-action="rebaseOnto"]').click();

  await expect(async () => {
    expect(getParents(await testRepo.log(), "C")).toEqual(["A"]);
  }).toPass();
});

test("dragging a multi-selection across graph tabs rebases every selected change", async ({
  graphFrame,
  testRepo,
  workbox,
}) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.commitFile("c.txt", "content c", "C");
  await testRepo.commitFile("d.txt", "content d", "D");
  await expect(graphFrame.locator("#nodes > div")).toHaveCount(6);
  const [source, target] = await openTwoGraphTabsSideBySide(workbox, graphFrame);

  // Graph order, top to bottom: @(0), D(1), C(2), B(3), A(4), root(5).
  const sourceA = source.locator("#nodes > div").nth(4);
  const sourceB = source.locator("#nodes > div").nth(3);
  const targetD = target.locator("#nodes > div").nth(1);

  await sourceA.click();
  await sourceB.click({ modifiers: ["Shift"] });
  await expect(target.locator("#nodes > div[data-selected]")).toHaveCount(2);

  const data = await dragStart(sourceB);
  await dragOverUntil(targetD, highlighted);
  await dispatchDrag(targetD, "drop", {}, data);
  await dragEnd(sourceB);

  const rebaseItem = target.locator('#rebase-menu [data-action="rebase"]');
  await expect(rebaseItem).toBeVisible();
  await rebaseItem.hover();
  await target.locator('#rebase-menu [data-action="rebaseOnto"]').click();

  await expect(async () => {
    const logEntries = await testRepo.log();
    expect(getParents(logEntries, "A")).toEqual(["D"]);
    expect(getParents(logEntries, "B")).toEqual(["A"]);
    expect(getParents(logEntries, "D")).toEqual(["C"]);
  }).toPass();
});

test("dragging a bookmark into another graph tab moves the bookmark", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "content a", "commit 1");
  await testRepo.jjCommand(["bookmark", "create", "test-bookmark", "-r", "@-"]);
  await testRepo.commitFile("b.txt", "content b", "commit 2");
  await expect(graphFrame.locator("#nodes > div")).toHaveCount(4);
  const [source, target] = await openTwoGraphTabsSideBySide(workbox, graphFrame);

  const targetCommit2 = target.locator("#nodes > div").nth(1);
  const bookmarkPill = source.locator('[data-bookmark="test-bookmark"]');
  await expect(bookmarkPill).toBeVisible();

  const data = await dragStart(bookmarkPill);
  await dragOverUntil(targetCommit2, highlighted);
  await expect(targetCommit2.locator('[data-bookmark-preview="test-bookmark"]')).toBeVisible();
  await dispatchDrag(targetCommit2, "drop", {}, data);
  await dragEnd(bookmarkPill);

  await expect(targetCommit2.locator('[data-bookmark="test-bookmark"]')).toBeVisible();
  await expect(async () => {
    expect((await testRepo.getBookmark("test-bookmark"))?.description).toBe("commit 2");
  }).toPass();
});

test("dragging hunks into another graph tab opens the hunk drop menu there", async ({
  graphFrame,
  testRepo,
  workbox,
}) => {
  const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
  const targetChange = await testRepo.commitFile("a.txt", lines.join("\n") + "\n", "target");
  const changed = [...lines];
  changed[1] = "changed 2";
  changed.splice(14, 0, "inserted after 14");
  const sourceChange = await testRepo.commitFile("a.txt", changed.join("\n") + "\n", "source");
  await expect(graphFrame.locator("#nodes > div[data-change-id]")).toHaveCount(4);
  const [source, target] = await openTwoGraphTabsSideBySide(workbox, graphFrame);

  await changeRow(source, sourceChange).locator('[data-role="files-toggle"]').click();
  await fileRows(source, sourceChange, "a.txt").locator('[data-role="hunks-toggle"]').click();
  const sourceHunks = source.locator(`#nodes > [data-role="file-hunk"][data-hunk-of^="${sourceChange}/"]`);
  await expect(sourceHunks).toHaveCount(2);

  const targetRow = changeRow(target, targetChange);
  const data = await dragStart(sourceHunks.nth(0));
  await dragOverUntil(targetRow, highlighted);
  await dispatchDrag(targetRow, "drop", {}, data);
  await dragEnd(sourceHunks.nth(0));

  const menu = target.locator("#hunk-drop-menu");
  await expect(menu.locator("[data-action]")).toHaveText(["Move", "Duplicate"]);
  await expect(source.locator("#hunk-drop-menu")).toHaveCount(0);
  await menu.locator('[data-action="moveHunks"]').click();

  const targetLines = [...lines];
  targetLines[1] = "changed 2";
  await expect
    .poll(async () => (await testRepo.jjCommand(["file", "show", "-r", targetChange, "a.txt"])).stdout.toString())
    .toBe(targetLines.join("\n") + "\n");
});

test("dropping onto the dragged change in another graph tab does nothing", async ({
  graphFrame,
  testRepo,
  workbox,
}) => {
  const idA = await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.writeFile("b.txt", "content b");
  await testRepo.writeFile("c.txt", "content c");
  const idB = await testRepo.commit("B");
  const idC = await testRepo.commitFile("d.txt", "content d", "C");
  await expect(graphFrame.locator("#nodes > div[data-change-id]")).toHaveCount(5);
  const logBefore = await testRepo.log();
  const [source, target] = await openTwoGraphTabsSideBySide(workbox, graphFrame);
  const targetA = changeRow(target, idA);

  await test.step("a change dropped onto itself", async () => {
    const sourceC = changeRow(source, idC);
    const targetC = changeRow(target, idC);
    const data = await dragStart(sourceC);
    await dragOverUntil(targetA, highlighted);
    await dragOver(targetC, {}, targetA);
    await expect(targetA).toHaveCSS("outline-style", "none");
    expect(await outlineStyle(targetC)).toBe("none");
    await dispatchDrag(targetC, "drop", {}, data);
    await dragEnd(sourceC);
  });

  await test.step("a changed file dropped onto its own change", async () => {
    await changeRow(source, idB).locator('[data-role="files-toggle"]').click();
    const fileRow = fileRows(source, idB, "b.txt");
    await expect(fileRow).toBeVisible();
    const targetB = changeRow(target, idB);
    const data = await dragStart(fileRow);
    await dragOverUntil(targetA, highlighted);
    await dragOver(targetB, {}, targetA);
    await expect(targetA).toHaveCSS("outline-style", "none");
    expect(await outlineStyle(targetB)).toBe("none");
    await dispatchDrag(targetB, "drop", {}, data);
    await dragEnd(fileRow);
  });

  for (const frame of [source, target, graphFrame]) {
    await expect(frame.locator("#rebase-menu, #edge-drop-menu, #hunk-drop-menu")).toHaveCount(0);
  }
  expect(await testRepo.log()).toEqual(logBefore);
});

test("a cancelled cross-tab drag leaves no graph tab stuck", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.commitFile("c.txt", "content c", "C");
  await expect(graphFrame.locator("#nodes > div")).toHaveCount(5);
  const [source, target] = await openTwoGraphTabsSideBySide(workbox, graphFrame);
  const frames = [source, target, graphFrame];
  const sourceC = source.locator("#nodes > div").nth(1);
  const targetB = target.locator("#nodes > div").nth(2);

  await test.step("a drag dropped where no graph accepts it", async () => {
    // A real mouse drag in the source tab, dropped on its empty area below the rows: the browser ends it with a
    // dragend and no drop, as for a drop on an editor or any other UI outside the graphs.
    const startBox = (await sourceC.boundingBox())!;
    await workbox.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2);
    await workbox.mouse.down();
    await workbox.mouse.move(startBox.x + 40, startBox.y + startBox.height * 2, { steps: 5 });
    await dragOverUntil(targetB, highlighted);
    await dispatchDrag(targetB, "dragleave");
    const sourceBox = (await (await source.frameElement()).boundingBox())!;
    await workbox.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height - 10, { steps: 5 });
    await workbox.mouse.up();

    await testRepo.commitFile("d.txt", "content d", "D");
    for (const frame of frames) {
      await expect(frame.locator("#nodes > div")).toHaveCount(6);
      await expect(frame.locator("#rebase-menu")).toHaveCount(0);
    }
  });

  await test.step("a drag cancelled with Escape", async () => {
    // Escape ends the drag with a dragend in the source tab and no drop anywhere. Playwright cannot cancel its
    // emulated drags, so the drag is dispatched.
    const dragged = source.locator("#nodes > div").nth(1);
    const hovered = target.locator("#nodes > div").nth(2);
    await dragStart(dragged);
    await dragOverUntil(hovered, highlighted);
    await dragEnd(dragged);

    await expect(hovered).toHaveCSS("outline-style", "none");
    await testRepo.commitFile("e.txt", "content e", "E");
    for (const frame of frames) {
      await expect(frame.locator("#nodes > div")).toHaveCount(7);
    }
  });
});

test("closing the source tab mid-drag clears the drag in other tabs", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await expect(graphFrame.locator("#nodes > div")).toHaveCount(4);
  const [source, target] = await openTwoGraphTabsSideBySide(workbox, graphFrame);

  // The source tab never sends a dragend, as when it is closed in the middle of a drag.
  const targetRow = target.locator("#nodes > div").nth(2);
  await dragStart(source.locator("#nodes > div").nth(1));
  await dragOverUntil(targetRow, highlighted);

  // Activate the source tab, then give the workbench keyboard focus by clicking the tab's bottom-right corner,
  // away from the target tab and the sidebar.
  const graphTabs = workbox.locator(".tab", { hasText: "JJ Graph" });
  await graphTabs.first().click();
  const box = (await (await source.frameElement()).boundingBox())!;
  await workbox.mouse.click(box.x + box.width - 10, box.y + box.height - 10);
  await runCommand(workbox, "View: Close Editor");
  await expect(graphTabs).toHaveCount(1);
  await expect.poll(() => source.isDetached()).toBe(true);
  expect(target.isDetached()).toBe(false);

  await expect(targetRow).toHaveCSS("outline-style", "none");
  await testRepo.commitFile("c.txt", "content c", "C");
  await expect(target.locator("#nodes > div")).toHaveCount(5);
  await expect(graphFrame.locator("#nodes > div")).toHaveCount(5);
});
