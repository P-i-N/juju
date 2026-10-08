import { test, expect, mod } from "./base-test";
import { getParents } from "../test-repo";
import type { Locator } from "@playwright/test";

async function edgePoint(row: Locator, side: "top" | "bottom") {
  const box = (await row.boundingBox())!;
  return { x: box.x + box.width / 2, y: side === "top" ? box.y + 1 : box.y + box.height - 1 };
}

test("edges are only highlighted while the modifier is held", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4);
  const commitB = nodes.nth(1);
  const commitA = nodes.nth(2);

  const point = await edgePoint(commitA, "top");
  await workbox.mouse.move(point.x, point.y);
  await expect(graphFrame.locator("[data-edge-top], [data-edge-bottom]")).toHaveCount(0);

  await workbox.keyboard.down(mod);
  await workbox.mouse.move(point.x + 1, point.y);

  await expect(commitA).toHaveAttribute("data-edge-top", "");
  await expect(commitB).toHaveAttribute("data-edge-bottom", "");

  await workbox.keyboard.up(mod);
  await workbox.mouse.move(point.x, point.y);

  await expect(graphFrame.locator("[data-edge-top], [data-edge-bottom]")).toHaveCount(0);
});

test("double-clicking a top edge inserts a new change after the change", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.commitFile("c.txt", "content c", "C");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);
  const commitA = nodes.nth(3);

  const point = await edgePoint(commitA, "top");
  await workbox.keyboard.down(mod);
  await workbox.mouse.move(point.x, point.y);
  await expect(commitA).toHaveAttribute("data-edge-top", "");
  await workbox.mouse.dblclick(point.x, point.y);
  await workbox.keyboard.up(mod);

  await expect(async () => {
    const logEntries = await testRepo.log();
    expect(getParents(logEntries, "@")).toEqual(["A"]);
    const working = logEntries.find((e) => e.current_working_copy)!;
    const b = logEntries.find((e) => e.description.trim() === "B")!;
    expect(b.parents.map((p) => p.change_id)).toEqual([working.change_id]);
  }).toPass();
});

test("double-clicking a bottom edge inserts a new change before the change", async ({
  graphFrame,
  testRepo,
  workbox,
}) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.commitFile("c.txt", "content c", "C");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);
  const commitC = nodes.nth(1);

  const point = await edgePoint(commitC, "bottom");
  await workbox.keyboard.down(mod);
  await workbox.mouse.move(point.x, point.y);
  await expect(commitC).toHaveAttribute("data-edge-bottom", "");
  await workbox.mouse.dblclick(point.x, point.y);
  await workbox.keyboard.up(mod);

  await expect(async () => {
    const logEntries = await testRepo.log();
    expect(getParents(logEntries, "@")).toEqual(["B"]);
    const working = logEntries.find((e) => e.current_working_copy)!;
    const c = logEntries.find((e) => e.description.trim() === "C")!;
    expect(c.parents.map((p) => p.change_id)).toEqual([working.change_id]);
  }).toPass();
});

test("ctrl+click on an edge does not change the selection", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "content a", "A");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(3);
  const commitA = nodes.nth(1);

  const point = await edgePoint(commitA, "top");
  await workbox.keyboard.down(mod);
  await workbox.mouse.click(point.x, point.y);
  await workbox.keyboard.up(mod);

  await expect(commitA).not.toHaveAttribute("data-selected");

  const box = (await commitA.boundingBox())!;
  await workbox.keyboard.down(mod);
  await workbox.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await workbox.keyboard.up(mod);

  await expect(commitA).toHaveAttribute("data-selected", "");
});

test("the cursor shows the direction of the hovered edge", async ({ graphFrame, testRepo, workbox }) => {
  const idA = await testRepo.commitFile("a.txt", "content a", "A");
  const idB = await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.jjCommand(["new", idA]);
  const idC = await testRepo.commitFile("c.txt", "content c", "C");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);
  const row = (id: string) => graphFrame.locator(`#nodes > [data-change-id^="${id}"]`);

  await workbox.keyboard.down(mod);

  const topOfA = await edgePoint(row(idA), "top");
  await workbox.mouse.move(topOfA.x, topOfA.y);
  await expect(row(idA)).toHaveAttribute("data-edge-cursor", "top");
  expect(await row(idA).evaluate((el) => getComputedStyle(el).cursor)).toContain("url(");

  const bottomOfB = await edgePoint(row(idB), "bottom");
  await workbox.mouse.move(bottomOfB.x, bottomOfB.y);
  await expect(row(idB)).toHaveAttribute("data-edge-cursor", "bottom");
  expect(await row(idB).evaluate((el) => getComputedStyle(el).cursor)).toContain("url(");
  await expect(row(idA)).not.toHaveAttribute("data-edge-cursor");

  const topOfC = await edgePoint(row(idC), "top");
  await workbox.mouse.move(topOfC.x, topOfC.y);
  await expect(row(idC)).toHaveAttribute("data-edge-cursor", "shared");
  await expect(row(idC)).toHaveCSS("cursor", "ns-resize");

  await workbox.keyboard.up(mod);
  await workbox.mouse.move(topOfC.x + 1, topOfC.y);
  await expect(graphFrame.locator("[data-edge-cursor]")).toHaveCount(0);
});

test.describe("with tooltips enabled", () => {
  test.use({ customSettings: { "juju.showTooltips": true } });

  test("change tooltips are hidden while an edge is shown", async ({ graphFrame, testRepo, workbox }) => {
    await testRepo.commitFile("a.txt", "content a", "A");
    await testRepo.commitFile("b.txt", "content b", "B");

    const nodes = graphFrame.locator("#nodes > div");
    await expect(nodes).toHaveCount(4);
    const commitA = nodes.nth(2);
    const tooltip = graphFrame.locator("#tooltip");

    const box = (await commitA.boundingBox())!;
    await workbox.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(tooltip).toBeVisible();

    const point = await edgePoint(commitA, "top");
    await workbox.keyboard.down(mod);
    await workbox.mouse.move(point.x, point.y);
    await expect(commitA).toHaveAttribute("data-edge-top", "");
    await expect(tooltip).toBeHidden();

    await workbox.mouse.move(point.x + 5, point.y);
    // Longer than the tooltip delay, so a tooltip would have appeared by now.
    await workbox.waitForTimeout(1000);
    await expect(tooltip).toBeHidden();

    await workbox.keyboard.up(mod);
  });
});

test("an expanded change has its bottom edge below its changed files", async ({ graphFrame, testRepo, workbox }) => {
  const idA = await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.writeFile("b1.txt", "content b1");
  await testRepo.writeFile("b2.txt", "content b2");
  const idB = await testRepo.commit("B");

  const rowA = graphFrame.locator(`#nodes > div[data-change-id^="${idA}/"]`);
  const rowB = graphFrame.locator(`#nodes > div[data-change-id^="${idB}/"]`);
  await rowB.locator('[data-role="files-toggle"]').click();
  const filesOfB = graphFrame.locator(`#nodes > [data-role="changed-file"][data-file-of^="${idB}/"]`);
  await expect(filesOfB).toHaveCount(2);
  const lastFile = filesOfB.last();

  await workbox.keyboard.down(mod);

  const bottomOfRow = await edgePoint(rowB, "bottom");
  await workbox.mouse.move(bottomOfRow.x, bottomOfRow.y);
  await workbox.mouse.move(bottomOfRow.x + 1, bottomOfRow.y);
  await expect(graphFrame.locator("[data-edge-top], [data-edge-bottom]")).toHaveCount(0);

  const bottomOfFiles = await edgePoint(lastFile, "bottom");
  await workbox.mouse.move(bottomOfFiles.x, bottomOfFiles.y);
  await expect(lastFile).toHaveAttribute("data-edge-bottom", "");
  await expect(lastFile).toHaveAttribute("data-edge-cursor", "shared");
  await expect(rowA).toHaveAttribute("data-edge-top", "");
  await expect(rowB).not.toHaveAttribute("data-edge-bottom");
  await expect(filesOfB.first()).not.toHaveAttribute("data-edge-bottom");

  await workbox.mouse.dblclick(bottomOfFiles.x, bottomOfFiles.y);
  await workbox.keyboard.up(mod);

  await expect(async () => {
    const logEntries = await testRepo.log();
    expect(getParents(logEntries, "@")).toEqual(["A"]);
    const working = logEntries.find((e) => e.current_working_copy)!;
    const b = logEntries.find((e) => e.description.trim() === "B")!;
    expect(b.parents.map((p) => p.change_id)).toEqual([working.change_id]);
  }).toPass();
});
