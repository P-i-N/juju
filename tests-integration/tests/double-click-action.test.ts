import { test, expect } from "./base-test";
import { getParents } from "../test-repo";

test("double-clicking a described change creates a new change on top of it by default", async ({
  graphFrame,
  testRepo,
}) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4); // @, B, A, root

  await nodes.nth(2).dblclick(); // A

  await expect(async () => {
    expect(getParents(await testRepo.log(), "@")).toEqual(["A"]);
  }).toPass();
});

test("double-clicking an undescribed change edits it by default", async ({ graphFrame, testRepo }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.writeFile("u.txt", "content u");
  await testRepo.jjCommand(["new"]);
  const undescribed = (await testRepo.log("@-"))[0].change_id;

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4); // @, undescribed, A, root
  await expect(nodes.nth(1)).toContainText("(no description set)");

  await nodes.nth(1).dblclick();

  await expect(async () => {
    const workingCopy = (await testRepo.log()).find((e) => e.current_working_copy);
    expect(workingCopy?.change_id).toEqual(undescribed);
  }).toPass();
  await expect(nodes).toHaveCount(3); // the previous empty working copy is abandoned
});

test("double-clicking an undescribed working copy does nothing by default", async ({
  graphFrame,
  testRepo,
  workbox,
}) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.writeFile("u.txt", "content u");
  const workingCopy = (await testRepo.log("@"))[0].change_id;

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(3); // @, A, root

  await nodes.nth(0).dblclick();
  // Longer than creating a change takes, so the "new" action would have run by now.
  await workbox.waitForTimeout(1000);

  const entries = await testRepo.log();
  expect(entries.find((e) => e.current_working_copy)?.change_id).toEqual(workingCopy);
  expect(getParents(entries, "@")).toEqual(["A"]);
  await expect(nodes).toHaveCount(3);
});
