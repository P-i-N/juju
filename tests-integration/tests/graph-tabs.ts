import type { Frame, Page } from "@playwright/test";
import { expect, runCommand } from "./base-test";

async function hasGraphRows(frame: Frame): Promise<boolean> {
  try {
    const content = await frame.content();
    return content.includes('id="nodes"') && (await frame.locator("#nodes > div").count()) > 0;
  } catch {
    // The frame can be mid-navigation while the webview (re)loads; the
    // content read throws while it is settling, so treat it as not ready.
    return false;
  }
}

export async function findOtherGraphFrames(workbox: Page, knownFrames: Frame[]): Promise<Frame[]> {
  const found: Frame[] = [];
  for (const frame of workbox.frames()) {
    if (knownFrames.includes(frame)) {
      continue;
    }
    if (await hasGraphRows(frame)) {
      found.push(frame);
    }
  }
  return found;
}

async function openGraphTabAndFocus(workbox: Page, knownFrames: Frame[]): Promise<Frame> {
  await runCommand(workbox, "Jujutsu: Open Graph in Tab");
  let tabFrame: Frame | undefined;
  await expect(async () => {
    const frames = await findOtherGraphFrames(workbox, knownFrames);
    expect(frames).toHaveLength(1);
    tabFrame = frames[0];
  }).toPass();
  // Keyboard shortcuts only reach the workbench once the webview has been clicked.
  await tabFrame!.locator("body").click();
  return tabFrame!;
}

export async function openTwoGraphTabsSideBySide(workbox: Page, sidebarFrame: Frame): Promise<[Frame, Frame]> {
  const firstTab = await openGraphTabAndFocus(workbox, [sidebarFrame]);
  const secondTab = await openGraphTabAndFocus(workbox, [sidebarFrame, firstTab]);
  await expect(workbox.locator(".tab", { hasText: "JJ Graph" })).toHaveCount(2);

  await runCommand(workbox, "View: Move Editor into Right Group");
  await expect(async () => {
    expect(await hasGraphRows(firstTab)).toBe(true);
    expect(await hasGraphRows(secondTab)).toBe(true);
  }).toPass();

  return [firstTab, secondTab];
}
