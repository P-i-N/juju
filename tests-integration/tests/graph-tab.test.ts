import type { Frame, Page } from "@playwright/test";
import { test, expect, runCommand } from "./base-test";

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
    const graphTab = workbox.locator(".tab", { hasText: "JJ Graph" });
    await expect(graphTab).toHaveCount(1);
    await runCommand(workbox, "View: Close Editor");
    await expect(graphTab).toHaveCount(0);
    await sidebarNodes.nth(1).click();
    await expect(sidebarNodes.nth(1)).toHaveAttribute("data-selected");
  });
});
