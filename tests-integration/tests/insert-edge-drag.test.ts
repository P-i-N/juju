import { test, expect, mod } from "./base-test";
import { getParents } from "../test-repo";
import type { Frame, Locator, Page } from "@playwright/test";
import type { LogEntry } from "../../src/types";

async function edgePoint(row: Locator, side: "top" | "bottom") {
  const box = (await row.boundingBox())!;
  return { x: box.x + box.width / 2, y: side === "top" ? box.y + 1 : box.y + box.height - 1 };
}

async function ctrlDragToEdge(workbox: Page, source: Locator, target: Locator, side: "top" | "bottom") {
  const sourceBox = (await source.boundingBox())!;
  await workbox.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await workbox.mouse.down();
  await workbox.keyboard.down(mod);
  const point = await edgePoint(target, side);
  await workbox.mouse.move(point.x, point.y, { steps: 10 });
  // Playwright's drag emulation drops the dragover events of the last few
  // moves, so nudge the pointer within the edge zone until they arrive.
  for (const dx of [1, 2, 3, 0]) {
    await workbox.mouse.move(point.x + dx, point.y);
  }
}

async function dropAndChoose(workbox: Page, graphFrame: Frame, action: string) {
  await workbox.mouse.up();
  await workbox.keyboard.up(mod);
  const menu = graphFrame.locator("#edge-drop-menu");
  await expect(menu).toBeVisible();
  await menu.locator(`[data-action="${action}"]`).click();
  await expect(menu).not.toBeVisible();
}

function changeRow(graphFrame: Frame, changeId: string) {
  return graphFrame.locator(`#nodes > div[data-change-id^="${changeId}/"]`);
}

function parentIds(entries: LogEntry[], changeId: string): string[] {
  return entries.find((e) => e.change_id === changeId)!.parents.map((p) => p.change_id);
}

test("Ctrl+dropping a change on a shared edge inserts it in between", async ({ graphFrame, testRepo, workbox }) => {
  const idA = await testRepo.commitFile("a.txt", "content a", "A");
  const idB = await testRepo.commitFile("b.txt", "content b", "B");
  const idC = await testRepo.commitFile("c.txt", "content c", "C");
  await expect(graphFrame.locator("#nodes > div[data-change-id]")).toHaveCount(5);

  await ctrlDragToEdge(workbox, changeRow(graphFrame, idC), changeRow(graphFrame, idA), "top");

  await expect(changeRow(graphFrame, idA)).toHaveAttribute("data-edge-top", "");
  await expect(changeRow(graphFrame, idB)).toHaveAttribute("data-edge-bottom", "");
  await expect(changeRow(graphFrame, idA)).toHaveCSS("outline-style", "none");

  await dropAndChoose(workbox, graphFrame, "rebase");

  await expect(async () => {
    const entries = await testRepo.log();
    expect(parentIds(entries, idC)).toEqual([idA]);
    expect(parentIds(entries, idB)).toEqual([idC]);
  }).toPass();
});

test("Ctrl+dropping a change on a top edge of its own rebases it onto the change", async ({
  graphFrame,
  testRepo,
  workbox,
}) => {
  const idA = await testRepo.commitFile("a.txt", "content a", "A");
  const idB = await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.jjCommand(["new", idA]);
  const idC = await testRepo.commitFile("c.txt", "content c", "C");
  await expect(graphFrame.locator("#nodes > div[data-change-id]")).toHaveCount(5);

  await ctrlDragToEdge(workbox, changeRow(graphFrame, idC), changeRow(graphFrame, idB), "top");

  await expect(changeRow(graphFrame, idB)).toHaveAttribute("data-edge-top", "");
  await expect(graphFrame.locator("[data-edge-bottom]")).toHaveCount(0);

  await dropAndChoose(workbox, graphFrame, "rebase");

  await expect(async () => {
    const entries = await testRepo.log();
    expect(parentIds(entries, idC)).toEqual([idB]);
    expect(parentIds(entries, idB)).toEqual([idA]);
  }).toPass();
});

test("Ctrl+dropping a change on a bottom edge rebases it before the change", async ({
  graphFrame,
  testRepo,
  workbox,
}) => {
  const idA = await testRepo.commitFile("a.txt", "content a", "A");
  const idB = await testRepo.commitFile("b.txt", "content b", "B");
  const idC = await testRepo.commitFile("c.txt", "content c", "C");
  await expect(graphFrame.locator("#nodes > div[data-change-id]")).toHaveCount(5);

  await ctrlDragToEdge(workbox, changeRow(graphFrame, idC), changeRow(graphFrame, idB), "bottom");

  await expect(changeRow(graphFrame, idB)).toHaveAttribute("data-edge-bottom", "");

  await dropAndChoose(workbox, graphFrame, "rebase");

  await expect(async () => {
    const entries = await testRepo.log();
    expect(parentIds(entries, idC)).toEqual([idA]);
    expect(parentIds(entries, idB)).toEqual([idC]);
  }).toPass();
});

test("edges touching the dragged change are not offered", async ({ graphFrame, testRepo, workbox }) => {
  const idA = await testRepo.commitFile("a.txt", "content a", "A");
  const idB = await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.commitFile("c.txt", "content c", "C");
  await expect(graphFrame.locator("#nodes > div[data-change-id]")).toHaveCount(5);

  await ctrlDragToEdge(workbox, changeRow(graphFrame, idB), changeRow(graphFrame, idA), "top");

  await expect(changeRow(graphFrame, idA)).toHaveCSS("outline-style", "solid");
  await expect(graphFrame.locator("[data-edge-top], [data-edge-bottom]")).toHaveCount(0);

  await workbox.mouse.up();
  await workbox.keyboard.up(mod);

  await expect(graphFrame.locator('#rebase-menu [data-action="rebase"]')).toBeVisible();
  await expect(graphFrame.locator("#edge-drop-menu")).toHaveCount(0);
  await workbox.keyboard.press("Escape");
});

test("Ctrl+dropping a changed file on an edge moves it into a new change there", async ({
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

  await changeRow(graphFrame, idB).locator('[data-role="files-toggle"]').click();
  const fileRow = graphFrame.locator(`#nodes > [data-role="changed-file"][data-file-of^="${idB}/"][data-path="b.txt"]`);
  await expect(fileRow).toBeVisible();

  await ctrlDragToEdge(workbox, fileRow, changeRow(graphFrame, idA), "top");

  await expect(changeRow(graphFrame, idA)).toHaveAttribute("data-edge-top", "");
  const lastFileOfB = graphFrame.locator(`#nodes > [data-role="changed-file"][data-file-of^="${idB}/"]`).last();
  await expect(lastFileOfB).toHaveAttribute("data-edge-bottom", "");

  await dropAndChoose(workbox, graphFrame, "moveToNewChange");

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

test("Ctrl+dropping a change below the changed files of an expanded change rebases it before that change", async ({
  graphFrame,
  testRepo,
  workbox,
}) => {
  const idA = await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.writeFile("b1.txt", "content b1");
  await testRepo.writeFile("b2.txt", "content b2");
  const idB = await testRepo.commit("B");
  const idC = await testRepo.commitFile("c.txt", "content c", "C");
  await expect(graphFrame.locator("#nodes > div[data-change-id]")).toHaveCount(5);

  await changeRow(graphFrame, idB).locator('[data-role="files-toggle"]').click();
  const filesOfB = graphFrame.locator(`#nodes > [data-role="changed-file"][data-file-of^="${idB}/"]`);
  await expect(filesOfB).toHaveCount(2);

  await ctrlDragToEdge(workbox, changeRow(graphFrame, idC), filesOfB.last(), "bottom");

  await expect(filesOfB.last()).toHaveAttribute("data-edge-bottom", "");
  await expect(changeRow(graphFrame, idB)).not.toHaveAttribute("data-edge-bottom");

  await dropAndChoose(workbox, graphFrame, "rebase");

  await expect(async () => {
    const entries = await testRepo.log();
    expect(parentIds(entries, idC)).toEqual([idA]);
    expect(parentIds(entries, idB)).toEqual([idC]);
  }).toPass();
});

test("Ctrl+dropping a changed file on a bottom edge moves it into a new parent without switching to it", async ({
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

  await changeRow(graphFrame, idB).locator('[data-role="files-toggle"]').click();
  const fileRow = graphFrame.locator(`#nodes > [data-role="changed-file"][data-file-of^="${idB}/"][data-path="b.txt"]`);
  await expect(fileRow).toBeVisible();

  await ctrlDragToEdge(workbox, fileRow, changeRow(graphFrame, idA), "bottom");
  await expect(changeRow(graphFrame, idA)).toHaveAttribute("data-edge-bottom", "");

  await dropAndChoose(workbox, graphFrame, "moveToNewChange");

  await expect(async () => {
    const entries = await testRepo.log();
    const [idNew] = parentIds(entries, idA);
    expect(entries.find((e) => e.change_id === idNew)?.description.trim()).toEqual("");
    expect(parentIds(entries, idB)).toEqual([idA]);
    expect(entries.find((e) => e.current_working_copy)!.change_id).toEqual(idWorkingCopy);
    const moved = (await testRepo.jjCommand(["diff", "-r", idNew, "--name-only"])).stdout.toString();
    expect(moved.trim().split(/\r?\n/)).toEqual(["b.txt"]);
  }).toPass();
});

test("the edge drop menu offers rebase and duplicate for changes", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  const idC = await testRepo.commitFile("c.txt", "content c", "C");
  await expect(graphFrame.locator("#nodes > div[data-change-id]")).toHaveCount(5);
  const rowA = graphFrame.locator("#nodes > div[data-change-id]").nth(3);

  await ctrlDragToEdge(workbox, changeRow(graphFrame, idC), rowA, "top");
  await workbox.mouse.up();
  await workbox.keyboard.up(mod);

  const menu = graphFrame.locator("#edge-drop-menu");
  await expect(menu.locator("[data-action]")).toHaveText(["Rebase", "Rebase With Descendants", "Duplicate"]);
  // The edge the drop landed on stays highlighted while the menu is open.
  await expect(rowA).toHaveAttribute("data-edge-top", "");

  await workbox.keyboard.press("Escape");
  await expect(menu).not.toBeVisible();
  await expect(rowA).not.toHaveAttribute("data-edge-top", "");
  const entries = await testRepo.log();
  expect(getParents(entries, "C")).toEqual(["B"]);
});

test("Duplicate from the edge drop menu inserts a copy of the change at the edge", async ({
  graphFrame,
  testRepo,
  workbox,
}) => {
  const idA = await testRepo.commitFile("a.txt", "content a", "A");
  const idB = await testRepo.commitFile("b.txt", "content b", "B");
  const idC = await testRepo.commitFile("c.txt", "content c", "C");
  await expect(graphFrame.locator("#nodes > div[data-change-id]")).toHaveCount(5);

  await ctrlDragToEdge(workbox, changeRow(graphFrame, idC), changeRow(graphFrame, idA), "top");
  await dropAndChoose(workbox, graphFrame, "duplicate");

  await expect(async () => {
    const entries = await testRepo.log();
    const [idCopy] = parentIds(entries, idB);
    expect(idCopy).not.toEqual(idA);
    expect(entries.find((e) => e.change_id === idCopy)?.description.trim()).toEqual("C");
    expect(parentIds(entries, idCopy)).toEqual([idA]);
    expect(parentIds(entries, idC)).toEqual([idB]);
  }).toPass();
});

test("Rebase With Descendants from the edge drop menu moves the change with its descendants", async ({
  graphFrame,
  testRepo,
  workbox,
}) => {
  const idA = await testRepo.commitFile("a.txt", "content a", "A");
  const idB = await testRepo.commitFile("b.txt", "content b", "B");
  const idC = await testRepo.commitFile("c.txt", "content c", "C");
  await testRepo.jjCommand(["new", idA]);
  const idD = await testRepo.commitFile("d.txt", "content d", "D");
  await expect(graphFrame.locator("#nodes > div[data-change-id]")).toHaveCount(6); // @, D, C, B, A, root

  // D's only child is the working copy, so its top edge is shared: B goes in between.
  await ctrlDragToEdge(workbox, changeRow(graphFrame, idB), changeRow(graphFrame, idD), "top");
  await dropAndChoose(workbox, graphFrame, "rebaseWithDescendants");

  await expect(async () => {
    const entries = await testRepo.log();
    expect(parentIds(entries, idB)).toEqual([idD]);
    expect(parentIds(entries, idC)).toEqual([idB]);
  }).toPass();
});

test("Copy to New Change from the edge drop menu copies a file's changes into a new change", async ({
  graphFrame,
  testRepo,
  workbox,
}) => {
  const idA = await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.writeFile("b.txt", "content b");
  await testRepo.writeFile("c.txt", "content c");
  const idB = await testRepo.commit("B");
  await testRepo.jjCommand(["new", idA]);
  await testRepo.commitFile("x.txt", "content x", "X");
  const idWorkingCopy = (await testRepo.log("@"))[0].change_id;

  await changeRow(graphFrame, idB).locator('[data-role="files-toggle"]').click();
  const fileRow = graphFrame.locator(`#nodes > [data-role="changed-file"][data-file-of^="${idB}/"][data-path="b.txt"]`);
  await expect(fileRow).toBeVisible();

  // A has two children, so its top edge is its own: the copy becomes a new child of A.
  await ctrlDragToEdge(workbox, fileRow, changeRow(graphFrame, idA), "top");
  await expect(graphFrame.locator(`#nodes > div[data-change-id^="${idA}/"]`)).toHaveAttribute("data-edge-top", "");
  const menu = graphFrame.locator("#edge-drop-menu");
  await workbox.mouse.up();
  await workbox.keyboard.up(mod);
  await expect(menu.locator("[data-action]")).toHaveText(["Move to New Change", "Copy to New Change"]);
  await menu.locator('[data-action="copyToNewChange"]').click();

  await expect(async () => {
    const entries = await testRepo.log();
    const children = entries.filter((e) => e.parents.some((p) => p.change_id === idA)).map((e) => e.change_id);
    const copies = children.filter((id) => entries.find((e) => e.change_id === id)?.description.trim() === "");
    expect(copies).toHaveLength(1);
    const copied = (await testRepo.jjCommand(["diff", "-r", copies[0], "--name-only"])).stdout.toString();
    expect(copied.trim().split(/\r?\n/)).toEqual(["b.txt"]);
    const kept = (await testRepo.jjCommand(["diff", "-r", idB, "--name-only"])).stdout.toString();
    expect(kept.trim().split(/\r?\n/)).toEqual(["b.txt", "c.txt"]);
    expect(entries.find((e) => e.current_working_copy)!.change_id).toEqual(idWorkingCopy);
  }).toPass();
});
