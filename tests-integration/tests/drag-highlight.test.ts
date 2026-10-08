import { test, expect, type TestRepo } from "./base-test";
import type { Locator, Page } from "@playwright/test";

async function center(locator: Locator) {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function graphAreaPoint(row: Locator) {
  const box = (await row.boundingBox())!;
  return { x: box.x + 40, y: box.y + box.height / 2 };
}

async function dragAcrossAdjacentRows(workbox: Page, source: Locator, first: Locator, second: Locator) {
  const start = await center(source);
  await workbox.mouse.move(start.x, start.y);
  await workbox.mouse.down();
  const firstPoint = await graphAreaPoint(first);
  await workbox.mouse.move(firstPoint.x, firstPoint.y, { steps: 10 });
  const secondPoint = await graphAreaPoint(second);
  await workbox.mouse.move(secondPoint.x, secondPoint.y, { steps: 10 });
}

async function setupCommits(testRepo: TestRepo) {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.commitFile("c.txt", "content c", "C");
}

test("drop target highlight follows a dragged change across adjacent rows", async ({
  graphFrame,
  testRepo,
  workbox,
}) => {
  await setupCommits(testRepo);

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);

  const commitC = nodes.nth(1);
  const commitB = nodes.nth(2);
  const commitA = nodes.nth(3);

  await dragAcrossAdjacentRows(workbox, commitC, commitB, commitA);

  await expect(commitA).toHaveCSS("outline-style", "solid");
  await expect(commitB).toHaveCSS("outline-style", "none");

  await workbox.mouse.up();
});

test("drop target highlight follows a dragged bookmark across adjacent rows", async ({
  graphFrame,
  testRepo,
  workbox,
}) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.jjCommand(["bookmark", "create", "test-bookmark", "-r", "@-"]);
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.commitFile("c.txt", "content c", "C");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);

  const commitC = nodes.nth(1);
  const commitB = nodes.nth(2);
  const commitA = nodes.nth(3);
  const bookmarkPill = graphFrame.locator('[data-bookmark="test-bookmark"]');
  await expect(commitA.locator('[data-bookmark="test-bookmark"]')).toBeVisible();

  await dragAcrossAdjacentRows(workbox, bookmarkPill, commitB, commitC);

  await expect(commitC).toHaveCSS("outline-style", "solid");
  await expect(commitB).toHaveCSS("outline-style", "none");

  await workbox.mouse.up();

  await expect(commitC.locator('[data-bookmark="test-bookmark"]')).toBeVisible();
});
