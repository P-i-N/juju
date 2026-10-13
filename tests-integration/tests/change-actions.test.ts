import { test, expect } from "./base-test";

test("hide and show descendants via the eye button", async ({ graphFrame, testRepo }) => {
  await testRepo.commitFile("a.txt", "content a", "commit A");
  await testRepo.commitFile("b.txt", "content b", "commit B");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4);
  const commitB = graphFrame.getByText("commit B");
  await expect(commitB).toBeVisible();

  const commitA = nodes.nth(2);
  await commitA.hover();
  await commitA.locator('[data-role="toggle-descendants"]').click();

  await expect(commitB).toBeHidden();
  await expect(graphFrame.getByText("1 commit hidden")).toBeVisible();
  await expect(graphFrame.locator('[data-change-id] [data-role="text-content"]').first()).toContainText(
    "(empty) (no description set)",
  );

  await graphFrame.locator('[data-role="toggle-descendants"][aria-pressed="true"]').click();

  await expect(commitB).toBeVisible();
  await expect(nodes).toHaveCount(4);
});

test("edit the first line of a change description via the pencil button", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "content a", "Original title\n\nBody text");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(3);

  const commit = nodes.nth(1);
  await commit.hover();
  await commit.locator('[data-role="edit-description"]').click();

  const input = workbox.locator(".quick-input-widget input").first();
  await expect(input).toHaveValue("Original title");
  await input.fill("Updated title");
  await workbox.keyboard.press("Enter");

  await expect(graphFrame.getByText("Updated title")).toBeVisible();
  await expect(async () => {
    const logEntries = await testRepo.log();
    const entry = logEntries.find((e) => e.description.startsWith("Updated title"));
    expect(entry?.description).toBe("Updated title\n\nBody text\n");
  }).toPass();
});
