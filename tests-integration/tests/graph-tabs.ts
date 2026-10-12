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
  // Ctrl+Shift+P does not reach the workbench until the new webview has been clicked. Click its bottom-right
  // corner, far below the few graph rows, so that no row is selected.
  const box = await (await tabFrame!.frameElement()).boundingBox();
  expect(box).not.toBeNull();
  await workbox.mouse.click(box!.x + box!.width - 10, box!.y + box!.height - 10);
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

  for (const frame of [sidebarFrame, firstTab, secondTab]) {
    await expect(frame.locator("#nodes > div[data-selected]")).toHaveCount(0);
  }

  return [firstTab, secondTab];
}
