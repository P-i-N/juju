import { test, expect, TestRepo, mod, runCommand } from "../tests/base-test";
import path from "path";
import fs from "fs/promises";
import os from "os";
import { spawn, execFileSync, type ChildProcess } from "child_process";
import type { ElectronApplication, Frame, Locator, Page } from "@playwright/test";

// Use the system jj identity so the author name is omitted from the graph like for your own changes.
TestRepo.userName = null;
TestRepo.userEmail = null;

const OUTPUT_DIR = path.resolve(__dirname, "..", "..", "images");
const ZOOM_LEVEL = 1;
const FPS = 25;
const GIF_FPS = 15;

type Rect = { x: number; y: number; width: number; height: number };

async function addSettings(userDataDir: string, settings: Record<string, unknown>) {
  const settingsPath = path.join(userDataDir, "User", "settings.json");
  const s = JSON.parse(await fs.readFile(settingsPath, "utf-8")) as Record<string, unknown>;
  await fs.writeFile(settingsPath, JSON.stringify({ ...s, ...settings }));
}

/** A fake mouse pointer drawn on top of the workbench, since synthesized mouse events move no real cursor. */
class Pointer {
  private x = 0;
  private y = 0;

  constructor(private readonly workbox: Page) {}

  async install(x: number, y: number) {
    this.x = x;
    this.y = y;
    await this.workbox.evaluate(
      ({ x, y }) => {
        const style = document.createElement("style");
        style.textContent = `
          #demo-pointer { position: fixed; z-index: 1000000; pointer-events: none; width: 22px; height: 22px;
            margin: -2px 0 0 -3px; filter: drop-shadow(0 1px 2px rgba(0,0,0,.6)); }
          #demo-pointer-ripple { position: fixed; z-index: 999999; pointer-events: none; width: 30px; height: 30px;
            margin: -15px 0 0 -15px; border-radius: 50%; background: rgba(255, 200, 0, .55); opacity: 0;
            transform: scale(.3); }
          #demo-pointer-ripple.active { animation: demo-ripple .45s ease-out; }
          @keyframes demo-ripple { from { opacity: 1; transform: scale(.3); } to { opacity: 0; transform: scale(1.4); } }
          #demo-keys { position: fixed; z-index: 1000000; pointer-events: none; display: none; padding: 4px 10px;
            border-radius: 6px; border: 1px solid #888; border-bottom-width: 3px; background: #f3f3f3; color: #222;
            font: 600 13px system-ui, sans-serif; box-shadow: 0 2px 6px rgba(0,0,0,.5); }
        `;
        document.head.appendChild(style);
        const ripple = document.createElement("div");
        ripple.id = "demo-pointer-ripple";
        document.body.appendChild(ripple);
        const pointer = document.createElement("div");
        pointer.id = "demo-pointer";
        const svgNs = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNs, "svg");
        svg.setAttribute("viewBox", "0 0 22 22");
        svg.setAttribute("width", "22");
        svg.setAttribute("height", "22");
        const arrow = document.createElementNS(svgNs, "path");
        arrow.setAttribute("d", "M3 2 L3 18 L7.2 14 L10 20.5 L12.8 19.3 L10.1 13 L16 13 Z");
        arrow.setAttribute("fill", "white");
        arrow.setAttribute("stroke", "black");
        arrow.setAttribute("stroke-width", "1.3");
        arrow.setAttribute("stroke-linejoin", "round");
        svg.appendChild(arrow);
        pointer.appendChild(svg);
        document.body.appendChild(pointer);
        const keys = document.createElement("div");
        keys.id = "demo-keys";
        document.body.appendChild(keys);
        pointer.style.left = `${x}px`;
        pointer.style.top = `${y}px`;
      },
      { x, y },
    );
    await this.workbox.mouse.move(x, y);
  }

  position() {
    return { x: this.x, y: this.y };
  }

  private async place(x: number, y: number) {
    this.x = x;
    this.y = y;
    await this.workbox.evaluate(
      ({ x, y }) => {
        const pointer = document.getElementById("demo-pointer")!;
        pointer.style.left = `${x}px`;
        pointer.style.top = `${y}px`;
        const keys = document.getElementById("demo-keys")!;
        keys.style.left = `${x + 18}px`;
        keys.style.top = `${y + 18}px`;
      },
      { x, y },
    );
    await this.workbox.mouse.move(x, y);
  }

  async moveTo(x: number, y: number, duration = 600) {
    const startX = this.x;
    const startY = this.y;
    const steps = Math.max(1, Math.round(duration / 25));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      await this.place(startX + (x - startX) * ease, startY + (y - startY) * ease);
      await this.workbox.waitForTimeout(10);
    }
  }

  async moveToLocator(locator: Locator, offset?: { x?: number; y?: number }, duration = 600) {
    const box = (await locator.boundingBox())!;
    await this.moveTo(box.x + (offset?.x ?? box.width / 2), box.y + (offset?.y ?? box.height / 2), duration);
  }

  /** Nudges the pointer in place, which lets drag-over handlers catch up with the last move. */
  async wiggle() {
    const { x, y } = this;
    for (const dx of [1, 2, 1, 0]) {
      await this.place(x + dx, y);
      await this.workbox.waitForTimeout(20);
    }
  }

  async ripple() {
    await this.workbox.evaluate(
      ({ x, y }) => {
        const ripple = document.getElementById("demo-pointer-ripple")!;
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;
        ripple.classList.remove("active");
        void ripple.offsetWidth;
        ripple.classList.add("active");
      },
      { x: this.x, y: this.y },
    );
  }

  async click() {
    await this.ripple();
    await this.workbox.mouse.click(this.x, this.y);
  }

  async dblclick() {
    await this.ripple();
    await this.workbox.mouse.dblclick(this.x, this.y);
  }

  async down() {
    await this.ripple();
    await this.workbox.mouse.down();
  }

  async up() {
    await this.workbox.mouse.up();
  }

  async showKeys(label: string | null) {
    await this.workbox.evaluate((label) => {
      const keys = document.getElementById("demo-keys")!;
      keys.textContent = label ?? "";
      keys.style.display = label ? "block" : "none";
    }, label);
  }

  async hide() {
    await this.workbox.evaluate(() => {
      document.getElementById("demo-pointer")!.style.display = "none";
    });
  }
}

/** Records the X display the workbench runs on. */
class Recorder {
  private ffmpeg: ChildProcess | undefined;
  private exited: Promise<void> | undefined;
  readonly videoPath: string;

  constructor(
    private readonly display: string,
    name: string,
  ) {
    this.videoPath = path.join(os.tmpdir(), `juju-${name}.mkv`);
  }

  async start() {
    await fs.rm(this.videoPath, { force: true });
    const ffmpeg = spawn(
      "ffmpeg",
      [
        "-loglevel",
        "error",
        "-f",
        "x11grab",
        "-draw_mouse",
        "0",
        "-framerate",
        `${FPS}`,
        "-video_size",
        "1920x1080",
        "-i",
        this.display,
        "-c:v",
        "libx264rgb",
        "-crf",
        "0",
        "-preset",
        "ultrafast",
        "-y",
        this.videoPath,
      ],
      { stdio: ["pipe", "inherit", "inherit"] },
    );
    this.ffmpeg = ffmpeg;
    this.exited = new Promise((resolve) => ffmpeg.on("exit", () => resolve()));
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  async stop() {
    this.ffmpeg!.stdin!.write("q");
    this.ffmpeg!.stdin!.end();
    await this.exited;
  }
}

/** Turns the recording into an optimized, looping GIF of the region `clip` (in device pixels). */
function toGif(videoPath: string, filename: string, clip: Rect, startSeconds: number, width?: number) {
  const crop = `crop=${Math.round(clip.width)}:${Math.round(clip.height)}:${Math.round(clip.x)}:${Math.round(clip.y)}`;
  const scale = width ? `,scale=${width}:-1:flags=lanczos` : "";
  const filters = `${crop},fps=${GIF_FPS}${scale}`;
  execFileSync("ffmpeg", [
    "-loglevel",
    "error",
    "-ss",
    `${startSeconds}`,
    "-i",
    videoPath,
    "-filter_complex",
    `[0]${filters},split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`,
    "-loop",
    "0",
    "-y",
    path.join(OUTPUT_DIR, filename),
  ]);
}

async function deviceRect(workbox: Page, rect: Rect): Promise<Rect> {
  const ratio = await workbox.evaluate(() => window.devicePixelRatio);
  return { x: rect.x * ratio, y: rect.y * ratio, width: rect.width * ratio, height: rect.height * ratio };
}

async function prepareWorkbench(
  electronApp: ElectronApplication,
  userDataDir: string,
  workbox: Page,
  size = { width: 1600, height: 1000 },
) {
  type Electron = { BrowserWindow: { getAllWindows(): { setBounds(bounds: Rect): void }[] } };
  await electronApp.evaluate(({ BrowserWindow }: Electron, size) => {
    BrowserWindow.getAllWindows()[0].setBounds({ x: 0, y: 0, ...size });
  }, size);
  await runCommand(workbox, "Notifications: Clear All Notifications");
  await addSettings(userDataDir, {
    "window.zoomLevel": ZOOM_LEVEL,
    "workbench.colorTheme": "Dark+",
    "juju.graphStyle": "compact",
  });
  await workbox.waitForTimeout(1000);
}

async function widenSideBar(workbox: Page, by: number) {
  const sash = workbox.locator(".monaco-sash.vertical").nth(1);
  const sashBox = (await sash.boundingBox())!;
  const x = sashBox.x + sashBox.width / 2;
  const y = sashBox.y + sashBox.height / 2;
  await workbox.mouse.move(x, y);
  await workbox.mouse.down();
  await workbox.mouse.move(x + by, y, { steps: 5 });
  await workbox.mouse.up();
}

/** The graph area of the side bar, from the JJ Graph header down by `height` CSS pixels. */
async function graphClip(workbox: Page, height: number): Promise<Rect> {
  const header = (await workbox
    .getByRole("button", { name: /JJ Graph.*Section/i })
    .first()
    .boundingBox())!;
  const sideBar = (await workbox.locator(".part.sidebar").boundingBox())!;
  return deviceRect(workbox, {
    x: header.x,
    y: header.y,
    width: sideBar.x + sideBar.width - header.x,
    height,
  });
}

/** A small web app history used by all demos. Returns the change IDs by description. */
async function initializeDemoRepo(testRepo: TestRepo) {
  await testRepo.writeFile("package.json", '{ "name": "webshop" }\n');
  await testRepo.writeFile("src/app.ts", "export function start() {}\n");
  await testRepo.writeFile("README.md", "# Webshop\n");
  const setup = await testRepo.commit("chore: Set up the project");

  await testRepo.writeFile("src/auth/login.ts", "export function login() {}\n");
  await testRepo.writeFile("src/auth/session.ts", "export function openSession() {}\n");
  await testRepo.writeFile("src/ui/login-form.css", ".login {}\n");
  const login = await testRepo.commit("feat: Add the login form");

  await testRepo.writeFile("src/cart/cart.ts", "export class Cart {}\n");
  await testRepo.writeFile("src/cart/pricing.ts", "export function total() {}\n");
  await testRepo.writeFile("tests/cart.test.ts", "test('cart', () => {});\n");
  const cart = await testRepo.commit("feat: Add a shopping cart");

  await testRepo.writeFile("src/auth/session.ts", "export function openSession() {}\nexport function refresh() {}\n");
  await testRepo.writeFile("tests/session.test.ts", "test('session', () => {});\n");
  const session = await testRepo.commit("feat: Refresh expired sessions");

  await testRepo.writeFile("docs/auth.md", "# Authentication\n");
  await testRepo.writeFile("README.md", "# Webshop\n\nSee docs/auth.md\n");
  const docs = await testRepo.commit("docs: Describe authentication");

  return { setup, login, cart, session, docs };
}

function changeRow(graphFrame: Frame, changeId: string) {
  return graphFrame.locator(`#nodes > div[data-change-id^="${changeId}/"]`);
}

function fileRow(graphFrame: Frame, changeId: string, filePath: string) {
  return graphFrame.locator(
    `#nodes > [data-role="changed-file"][data-file-of^="${changeId}/"][data-path="${filePath}"]`,
  );
}

async function findTabGraphFrame(workbox: Page, sidebarFrame: Frame): Promise<Frame> {
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
        // The frame can be mid-navigation while the webview (re)loads; just try the next.
      }
    }
    throw new Error("Graph tab frame not ready");
  }).toPass();
  return found!;
}

test("record expandable commits", async ({ electronApp, userDataDir, graphFrame, testRepo, workbox, xvfbDisplay }) => {
  await prepareWorkbench(electronApp, userDataDir, workbox);
  const ids = await initializeDemoRepo(testRepo);
  await widenSideBar(workbox, 120);
  await expect(graphFrame.locator("#nodes > div[data-change-id]")).toHaveCount(7);

  const pointer = new Pointer(workbox);
  const sideBar = (await workbox.locator(".part.sidebar").boundingBox())!;
  await pointer.install(sideBar.x + sideBar.width - 40, sideBar.y + 420);
  const clip = await graphClip(workbox, 360);

  const recorder = new Recorder(xvfbDisplay, "expand");
  await recorder.start();
  await workbox.waitForTimeout(800);

  const cartToggle = changeRow(graphFrame, ids.cart).locator('[data-role="files-toggle"]');
  await pointer.moveToLocator(cartToggle);
  await workbox.waitForTimeout(300);
  await pointer.click();
  await expect(fileRow(graphFrame, ids.cart, "tests/cart.test.ts")).toBeVisible();
  await workbox.waitForTimeout(1200);

  const loginToggle = changeRow(graphFrame, ids.login).locator('[data-role="files-toggle"]');
  await pointer.moveToLocator(loginToggle);
  await workbox.waitForTimeout(300);
  await pointer.click();
  await expect(fileRow(graphFrame, ids.login, "src/auth/login.ts")).toBeVisible();
  await workbox.waitForTimeout(1200);

  await pointer.moveToLocator(fileRow(graphFrame, ids.login, "src/auth/session.ts"));
  await pointer.click();
  await workbox.waitForTimeout(400);
  await pointer.moveToLocator(fileRow(graphFrame, ids.login, "src/ui/login-form.css"), undefined, 400);
  await workbox.keyboard.down(mod);
  await pointer.showKeys("Ctrl");
  await pointer.click();
  await workbox.keyboard.up(mod);
  await pointer.showKeys(null);
  await workbox.waitForTimeout(1200);

  await pointer.moveToLocator(cartToggle);
  await pointer.click();
  await expect(fileRow(graphFrame, ids.cart, "tests/cart.test.ts")).toHaveCount(0);
  await workbox.waitForTimeout(400);
  await pointer.moveToLocator(loginToggle, undefined, 400);
  await pointer.click();
  await expect(fileRow(graphFrame, ids.login, "src/auth/login.ts")).toHaveCount(0);
  await workbox.waitForTimeout(1000);

  await recorder.stop();
  toGif(recorder.videoPath, "expandable-commits.gif", clip, 0.5);
});

async function drag(pointer: Pointer, workbox: Page, source: Locator, target: Locator, offset?: { y?: number }) {
  await pointer.moveToLocator(source);
  await workbox.waitForTimeout(200);
  await pointer.down();
  await pointer.moveTo(pointer.position().x + 6, pointer.position().y - 6, 100);
  await pointer.moveToLocator(target, { x: 140, ...offset }, 900);
  await pointer.wiggle();
  await workbox.waitForTimeout(500);
}

test("record dragging changed files", async ({
  electronApp,
  userDataDir,
  graphFrame,
  testRepo,
  workbox,
  xvfbDisplay,
}) => {
  await prepareWorkbench(electronApp, userDataDir, workbox);
  const ids = await initializeDemoRepo(testRepo);
  await widenSideBar(workbox, 120);
  await expect(graphFrame.locator("#nodes > div[data-change-id]")).toHaveCount(7);
  await changeRow(graphFrame, ids.session).locator('[data-role="files-toggle"]').click();
  await changeRow(graphFrame, ids.login).locator('[data-role="files-toggle"]').click();
  const sessionFile = fileRow(graphFrame, ids.login, "src/auth/session.ts");
  await expect(sessionFile).toBeVisible();

  const pointer = new Pointer(workbox);
  const sideBar = (await workbox.locator(".part.sidebar").boundingBox())!;
  await pointer.install(sideBar.x + sideBar.width - 40, sideBar.y + 440);
  const clip = await graphClip(workbox, 420);

  const recorder = new Recorder(xvfbDisplay, "drag-files");
  await recorder.start();
  await workbox.waitForTimeout(1000);

  await drag(pointer, workbox, sessionFile, changeRow(graphFrame, ids.session));
  await pointer.up();
  await expect(fileRow(graphFrame, ids.session, "src/auth/session.ts")).toBeVisible();
  await expect(sessionFile).toHaveCount(0);
  await workbox.waitForTimeout(1500);

  // Ctrl+drag the session test onto the edge above its change to move it into a new change of its own.
  const testFile = fileRow(graphFrame, ids.session, "tests/session.test.ts");
  const sessionRow = changeRow(graphFrame, ids.session);
  await pointer.moveToLocator(testFile);
  await workbox.waitForTimeout(200);
  await pointer.down();
  await workbox.keyboard.down(mod);
  await pointer.showKeys("Ctrl");
  await pointer.moveToLocator(sessionRow, { x: 140, y: 1 }, 900);
  await pointer.wiggle();
  await expect(sessionRow).toHaveAttribute("data-edge-top", "");
  await workbox.waitForTimeout(700);
  await pointer.up();
  await workbox.keyboard.up(mod);
  await pointer.showKeys(null);
  let newChange = "";
  await expect(async () => {
    const entries = await testRepo.log();
    newChange = entries.find((e) => e.change_id === ids.docs)!.parents[0].change_id;
    expect(newChange).not.toEqual(ids.session);
  }).toPass();
  await expect(testFile).toHaveCount(0);
  await workbox.waitForTimeout(600);
  await pointer.moveToLocator(changeRow(graphFrame, newChange).locator('[data-role="files-toggle"]'), undefined, 500);
  await pointer.click();
  await expect(fileRow(graphFrame, newChange, "tests/session.test.ts")).toBeVisible();
  await pointer.moveTo(sideBar.x + sideBar.width - 40, sideBar.y + 470, 500);
  await workbox.waitForTimeout(1800);

  await recorder.stop();
  toGif(recorder.videoPath, "dragging-changed-files.gif", clip, 0.8);
});

test("record inserting changes", async ({ electronApp, userDataDir, graphFrame, testRepo, workbox, xvfbDisplay }) => {
  await prepareWorkbench(electronApp, userDataDir, workbox);
  const ids = await initializeDemoRepo(testRepo);
  await widenSideBar(workbox, 120);
  await expect(graphFrame.locator("#nodes > div[data-change-id]")).toHaveCount(7);

  const pointer = new Pointer(workbox);
  const sideBar = (await workbox.locator(".part.sidebar").boundingBox())!;
  await pointer.install(sideBar.x + sideBar.width - 40, sideBar.y + 330);
  const clip = await graphClip(workbox, 230);

  const recorder = new Recorder(xvfbDisplay, "insert");
  await recorder.start();
  await workbox.waitForTimeout(1000);

  // Ctrl+drag "Refresh expired sessions" onto the edge between the login form and the shopping cart.
  const sessionRow = changeRow(graphFrame, ids.session);
  const loginRow = changeRow(graphFrame, ids.login);
  await pointer.moveToLocator(sessionRow, { x: 140 });
  await workbox.waitForTimeout(200);
  await pointer.down();
  await workbox.keyboard.down(mod);
  await pointer.showKeys("Ctrl");
  await pointer.moveToLocator(loginRow, { x: 140, y: 1 }, 1000);
  await pointer.wiggle();
  await expect(loginRow).toHaveAttribute("data-edge-top", "");
  await workbox.waitForTimeout(700);
  await pointer.up();
  await workbox.keyboard.up(mod);
  await pointer.showKeys(null);
  await expect(async () => {
    const entries = await testRepo.log();
    expect(entries.find((e) => e.change_id === ids.session)!.parents.map((p) => p.change_id)).toEqual([ids.login]);
  }).toPass();
  await pointer.moveTo(sideBar.x + sideBar.width - 40, pointer.position().y + 20, 400);
  await workbox.waitForTimeout(1500);

  // Ctrl+double-click the edge between the shopping cart and the session refresh to insert a new change there.
  const cartRow = changeRow(graphFrame, ids.cart);
  await pointer.moveToLocator(cartRow, { x: 140, y: 6 }, 700);
  await workbox.keyboard.down(mod);
  await pointer.showKeys("Ctrl");
  await pointer.moveToLocator(cartRow, { x: 141, y: (await cartRow.boundingBox())!.height - 1 }, 300);
  await pointer.wiggle();
  await expect(cartRow).toHaveAttribute("data-edge-bottom", "");
  await workbox.waitForTimeout(700);
  await pointer.dblclick();
  await workbox.keyboard.up(mod);
  await pointer.showKeys(null);
  await expect(async () => {
    const entries = await testRepo.log();
    const workingCopy = entries.find((e) => e.current_working_copy)!;
    expect(workingCopy.parents.map((p) => p.change_id)).toEqual([ids.session]);
  }).toPass();
  await expect(cartRow).not.toHaveAttribute("data-edge-bottom");
  await pointer.moveTo(sideBar.x + sideBar.width - 40, pointer.position().y + 30, 400);
  await workbox.waitForTimeout(2000);

  await recorder.stop();
  toGif(recorder.videoPath, "inserting-changes.gif", clip, 0.8);
});

test("record graph in tab", async ({
  electronApp,
  userDataDir,
  scmView,
  graphFrame,
  testRepo,
  workbox,
  xvfbDisplay,
}) => {
  await prepareWorkbench(electronApp, userDataDir, workbox, { width: 1100, height: 640 });
  const ids = await initializeDemoRepo(testRepo);
  await expect(graphFrame.locator("#nodes > div[data-change-id]")).toHaveCount(7);

  const pointer = new Pointer(workbox);
  const editor = (await workbox.locator(".part.editor").boundingBox())!;
  await pointer.install(editor.x + editor.width / 2, editor.y + editor.height / 2);
  const window = await workbox.locator(".monaco-workbench").boundingBox();
  const clip = await deviceRect(workbox, window!);

  const recorder = new Recorder(xvfbDisplay, "graph-tab");
  await recorder.start();
  await workbox.waitForTimeout(1000);

  const graphHeader = scmView.locator(".pane-header", { hasText: "JJ Graph" }).first();
  await pointer.moveToLocator(graphHeader, { x: 60 }, 700);
  const openInTab = graphHeader.getByRole("button", { name: "Open Graph in Tab" });
  await pointer.moveToLocator(openInTab, undefined, 600);
  await workbox.waitForTimeout(300);
  await pointer.click();
  const tabFrame = await findTabGraphFrame(workbox, graphFrame);
  await expect(tabFrame.locator("#nodes > div[data-change-id]")).toHaveCount(7);
  await workbox.waitForTimeout(1200);

  await pointer.moveToLocator(changeRow(tabFrame, ids.cart).locator('[data-role="files-toggle"]'), undefined, 700);
  await pointer.click();
  await expect(fileRow(tabFrame, ids.cart, "src/cart/cart.ts")).toBeVisible();
  await workbox.waitForTimeout(800);

  await pointer.moveToLocator(changeRow(tabFrame, ids.login), { x: 300 }, 600);
  await pointer.click();
  await expect(changeRow(graphFrame, ids.login)).toHaveAttribute("data-selected");
  await workbox.waitForTimeout(1000);

  await pointer.moveToLocator(changeRow(graphFrame, ids.docs), { x: 200 }, 900);
  await pointer.click();
  await expect(changeRow(tabFrame, ids.docs)).toHaveAttribute("data-selected");
  await workbox.waitForTimeout(1000);

  await pointer.moveToLocator(changeRow(tabFrame, ids.session), { x: 300 }, 900);
  await pointer.click();
  await expect(changeRow(graphFrame, ids.session)).toHaveAttribute("data-selected");
  await workbox.waitForTimeout(1500);

  await recorder.stop();
  toGif(recorder.videoPath, "graph-in-tab.gif", clip, 0.8, 1000);
});
