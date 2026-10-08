import { test, expect, clickFileMenuItem, runCommand, canonicalPath, mod } from "./base-test";
import type { Frame } from "@playwright/test";
import path from "path";

function fileRows(graphFrame: Frame, changeId: string, filePath?: string) {
  const pathFilter = filePath === undefined ? "" : `[data-path="${filePath}"]`;
  return graphFrame.locator(`#nodes > [data-role="changed-file"][data-file-of^="${changeId}/"]${pathFilter}`);
}

test.describe("with showChangedFiles disabled", () => {
  test.use({ customSettings: { "juju.showChangedFiles": false } });

  test("changed-files UI is hidden", async ({ graphFrame, testRepo }) => {
    await testRepo.commitFile("a.txt", "content a", "commit A");
    await testRepo.commitFile("b.txt", "content b", "commit B");

    await expect(graphFrame.locator("#nodes > div").first()).toBeVisible();
    await expect(graphFrame.locator('[data-role="changed-file"]')).toHaveCount(0);
    await expect(graphFrame.locator('[data-role="files-toggle"]')).toHaveCount(0);
  });
});

test.describe("with showChangedFiles enabled by default", () => {
  test("files are collapsed until the toggle is clicked", async ({ graphFrame, testRepo }) => {
    const changeA = await testRepo.commitFile("a.txt", "content a", "commit A");
    const changeB = await testRepo.commitFile("b.txt", "content b", "commit B");

    const rowA = graphFrame.locator(`#nodes > div[data-change-id^="${changeA}/"]`);
    const toggleA = rowA.locator('[data-role="files-toggle"]');
    await expect(toggleA).toBeVisible();
    await expect(toggleA).toHaveAttribute("aria-expanded", "false");
    await expect(graphFrame.locator('[data-role="changed-file"]')).toHaveCount(0);

    await toggleA.click();
    await expect(toggleA).toHaveAttribute("aria-expanded", "true");
    await expect(fileRows(graphFrame, changeA, "a.txt")).toBeVisible();
    await expect(fileRows(graphFrame, changeB)).toHaveCount(0);
    // Clicking the toggle must not select the change.
    await expect(rowA).not.toHaveAttribute("data-selected", "");

    await toggleA.click();
    await expect(toggleA).toHaveAttribute("aria-expanded", "false");
    await expect(graphFrame.locator('[data-role="changed-file"]')).toHaveCount(0);
  });

  test("ArrowRight and ArrowLeft expand and collapse the selected change", async ({ graphFrame, testRepo }) => {
    const changeA = await testRepo.commitFile("a.txt", "content a", "commit A");

    const rowA = graphFrame.locator(`#nodes > div[data-change-id^="${changeA}/"]`);
    await rowA.click();
    await expect(rowA).toHaveAttribute("data-selected", "");

    await rowA.press("ArrowRight");
    await expect(fileRows(graphFrame, changeA, "a.txt")).toBeVisible();

    await rowA.press("ArrowLeft");
    await expect(fileRows(graphFrame, changeA)).toHaveCount(0);
  });

  test("each changed file is its own selectable row", async ({ graphFrame, testRepo }) => {
    await testRepo.writeFile("a.txt", "content a");
    await testRepo.writeFile("b.txt", "content b");
    const changeAB = await testRepo.commit("commit AB");

    const row = graphFrame.locator(`#nodes > div[data-change-id^="${changeAB}/"]`);
    await row.locator('[data-role="files-toggle"]').click();

    const aFile = fileRows(graphFrame, changeAB, "a.txt");
    const bFile = fileRows(graphFrame, changeAB, "b.txt");
    await expect(aFile).toBeVisible();
    await expect(bFile).toBeVisible();
    await expect(aFile).toHaveAttribute("draggable", "true");
    // Like the SCM view: the file name and the change type on the right.
    await expect(aFile.locator('[data-role="file-name"]')).toHaveText("a.txt");
    await expect(aFile.locator('[data-role="file-status"]')).toHaveText("A");

    await aFile.click();
    await expect(aFile).toHaveAttribute("data-selected", "");
    await expect(bFile).not.toHaveAttribute("data-selected", "");

    await bFile.click();
    await expect(bFile).toHaveAttribute("data-selected", "");
    await expect(aFile).not.toHaveAttribute("data-selected", "");

    // Selecting a commit clears the file selection.
    await row.click();
    await expect(bFile).not.toHaveAttribute("data-selected", "");
  });

  test("changed files of one change can be multi-selected", async ({ graphFrame, testRepo }) => {
    await testRepo.writeFile("x.txt", "content x");
    const other = await testRepo.commit("other");
    for (const name of ["a.txt", "b.txt", "c.txt", "d.txt"]) {
      await testRepo.writeFile(name, `content ${name}`);
    }
    const change = await testRepo.commit("four files");

    await graphFrame.locator(`#nodes > div[data-change-id^="${change}/"] [data-role="files-toggle"]`).click();
    await graphFrame.locator(`#nodes > div[data-change-id^="${other}/"] [data-role="files-toggle"]`).click();
    const file = (name: string) => fileRows(graphFrame, change, name);
    const selected = graphFrame.locator('#nodes > [data-role="changed-file"][data-selected]');
    await expect(file("d.txt")).toBeVisible();

    await file("a.txt").click();
    await file("c.txt").click({ modifiers: ["Shift"] });
    await expect(selected).toHaveCount(3);
    await expect(file("d.txt")).not.toHaveAttribute("data-selected", "");

    await file("b.txt").click({ modifiers: [mod] });
    await expect(file("b.txt")).not.toHaveAttribute("data-selected", "");
    await expect(selected).toHaveCount(2);

    await file("d.txt").click({ modifiers: [mod] });
    await expect(selected).toHaveCount(3);

    // A file of another change starts a new selection instead of joining it.
    await fileRows(graphFrame, other, "x.txt").click({ modifiers: [mod] });
    await expect(selected).toHaveCount(1);
    await expect(fileRows(graphFrame, other, "x.txt")).toHaveAttribute("data-selected", "");
  });

  test("changed files are grouped under their directory", async ({ graphFrame, testRepo }) => {
    for (const name of ["z.txt", "src/b.ts", "src/a.ts", "docs/x.md"]) {
      await testRepo.writeFile(name, `content ${name}`);
    }
    const change = await testRepo.commit("grouped");

    await graphFrame.locator(`#nodes > div[data-change-id^="${change}/"] [data-role="files-toggle"]`).click();
    await expect(fileRows(graphFrame, change)).toHaveCount(4);

    const layout = await graphFrame
      .locator(`#nodes > [data-group-of^="${change}/"], #nodes > [data-file-of^="${change}/"]`)
      .evaluateAll((rows) =>
        rows.map((row) =>
          row.getAttribute("data-role") === "changed-file-group"
            ? `[${row.getAttribute("data-directory")}]`
            : row.querySelector('[data-role="file-name"]')!.textContent,
        ),
      );
    expect(layout).toEqual(["z.txt", "[docs]", "x.md", "[src]", "a.ts", "b.ts"]);
    await expect(graphFrame.locator('[data-role="file-directory"]')).toHaveCount(0);

    // Clicking a directory header selects the files under it.
    const srcHeader = graphFrame.locator(`#nodes > [data-group-of^="${change}/"][data-directory="src"]`);
    await expect(srcHeader).toHaveText("src");
    await srcHeader.click();
    await expect(graphFrame.locator('#nodes > [data-role="changed-file"][data-selected]')).toHaveCount(2);
    await expect(fileRows(graphFrame, change, "src/a.ts")).toHaveAttribute("data-selected", "");
    await expect(fileRows(graphFrame, change, "src/b.ts")).toHaveAttribute("data-selected", "");

    // Ctrl+clicking another header adds its files.
    await graphFrame
      .locator(`#nodes > [data-group-of^="${change}/"][data-directory="docs"]`)
      .click({ modifiers: [mod] });
    await expect(graphFrame.locator('#nodes > [data-role="changed-file"][data-selected]')).toHaveCount(3);

    // Clicking a header while any file under it is selected clears the selection.
    await srcHeader.click();
    await expect(graphFrame.locator('#nodes > [data-role="changed-file"][data-selected]')).toHaveCount(0);

    // A range follows the displayed order across directories.
    await fileRows(graphFrame, change, "z.txt").click();
    await fileRows(graphFrame, change, "src/a.ts").click({ modifiers: ["Shift"] });
    await expect(graphFrame.locator('#nodes > [data-role="changed-file"][data-selected]')).toHaveCount(3);
    await expect(fileRows(graphFrame, change, "src/b.ts")).not.toHaveAttribute("data-selected", "");
  });

  test("Discard Changes removes the selected files' changes from the change", async ({
    graphFrame,
    testRepo,
    workbox,
  }) => {
    await testRepo.commitFile("base.txt", "base", "base");
    for (const name of ["a.txt", "b.txt", "c.txt"]) {
      await testRepo.writeFile(name, `content ${name}`);
    }
    const change = await testRepo.commit("three files");

    await graphFrame.locator(`#nodes > div[data-change-id^="${change}/"] [data-role="files-toggle"]`).click();
    await expect(fileRows(graphFrame, change)).toHaveCount(3);

    // Right-clicking a file outside the selection selects just that file.
    await fileRows(graphFrame, change, "a.txt").click();
    await fileRows(graphFrame, change, "b.txt").click({ button: "right" });
    await expect(graphFrame.locator("#file-context-menu")).toBeVisible();
    await expect(fileRows(graphFrame, change, "b.txt")).toHaveAttribute("data-selected", "");
    await expect(fileRows(graphFrame, change, "a.txt")).not.toHaveAttribute("data-selected", "");
    await workbox.keyboard.press("Escape");

    await fileRows(graphFrame, change, "a.txt").click();
    await fileRows(graphFrame, change, "c.txt").click({ modifiers: [mod] });
    await clickFileMenuItem(graphFrame, fileRows(graphFrame, change, "c.txt"), "Discard Changes");

    const dialog = workbox.locator(".monaco-dialog-box");
    await expect(dialog).toContainText("Are you sure you want to discard changes in 2 files?");
    await dialog.getByRole("button", { name: "Discard" }).click();

    await expect
      .poll(async () => (await testRepo.jjCommand(["diff", "-r", change, "--name-only"])).stdout.toString().trim())
      .toBe("b.txt");
    await expect(fileRows(graphFrame, change)).toHaveCount(1);
  });

  test("dragging one of several selected files moves all of them", async ({ graphFrame, testRepo }) => {
    const target = await testRepo.commitFile("base.txt", "base", "target");
    for (const name of ["a.txt", "b.txt", "c.txt"]) {
      await testRepo.writeFile(name, `content ${name}`);
    }
    const source = await testRepo.commit("source");

    await graphFrame.locator(`#nodes > div[data-change-id^="${source}/"] [data-role="files-toggle"]`).click();
    await expect(fileRows(graphFrame, source, "c.txt")).toBeVisible();

    await fileRows(graphFrame, source, "a.txt").click();
    await fileRows(graphFrame, source, "c.txt").click({ modifiers: [mod] });

    await fileRows(graphFrame, source, "c.txt").dragTo(
      graphFrame.locator(`#nodes > div[data-change-id^="${target}/"]`),
    );

    await expect
      .poll(async () => (await testRepo.jjCommand(["diff", "-r", target, "--name-only"])).stdout.toString())
      .toMatch(/a\.txt[\s\S]*c\.txt/);
    await expect(fileRows(graphFrame, source, "b.txt")).toBeVisible();
    await expect(fileRows(graphFrame, source)).toHaveCount(1);
  });

  test("dragging a file onto another change moves its changes there", async ({ graphFrame, testRepo }) => {
    const target = await testRepo.commitFile("base.txt", "base", "target");
    await testRepo.writeFile("a.txt", "content a");
    await testRepo.writeFile("b.txt", "content b");
    const source = await testRepo.commit("source");

    await graphFrame.locator(`#nodes > div[data-change-id^="${source}/"] [data-role="files-toggle"]`).click();
    await graphFrame.locator(`#nodes > div[data-change-id^="${target}/"] [data-role="files-toggle"]`).click();
    await expect(fileRows(graphFrame, source, "a.txt")).toBeVisible();

    await fileRows(graphFrame, source, "a.txt").dragTo(
      graphFrame.locator(`#nodes > div[data-change-id^="${target}/"]`),
    );

    await expect(fileRows(graphFrame, target, "a.txt")).toBeVisible();
    await expect(fileRows(graphFrame, source, "a.txt")).toHaveCount(0);
    await expect(fileRows(graphFrame, source, "b.txt")).toBeVisible();
    await expect
      .poll(async () => (await testRepo.jjCommand(["file", "list", "-r", target])).stdout.toString())
      .toContain("a.txt");
  });

  test("showChangedFiles renders files and double-click opens diff", async ({ graphFrame, testRepo, workbox }) => {
    const changeA = await testRepo.commitFile("a.txt", "content a", "commit A");
    const changeB = await testRepo.commitFile("b.txt", "content b", "commit B");

    await graphFrame.locator(`#nodes > div[data-change-id^="${changeA}/"] [data-role="files-toggle"]`).click();
    await graphFrame.locator(`#nodes > div[data-change-id^="${changeB}/"] [data-role="files-toggle"]`).click();

    await expect(fileRows(graphFrame, changeA, "a.txt")).toBeVisible();
    await expect(fileRows(graphFrame, changeB, "b.txt")).toBeVisible();

    const aFile = fileRows(graphFrame, changeA, "a.txt");
    const diffEditor = workbox.locator(".editor-instance");
    await aFile.click();
    await expect(aFile).toHaveAttribute("data-selected", "");
    // Longer than opening a diff takes, so a single click would have opened one by now.
    await workbox.waitForTimeout(1000);
    await expect(diffEditor).toHaveCount(0);

    await aFile.dblclick();
    await expect(diffEditor).toBeVisible();
    // a.txt is Added in commit A: original is empty, modified contains the content.
    const original = workbox.locator(".editor.original .view-lines");
    const modified = workbox.locator(".editor.modified .view-lines");
    await expect(original).toHaveText(/^\s*$/);
    await expect(modified.getByText("content a", { exact: true }).first()).toBeVisible();
  });

  test("conflicted file with a regular diff entry keeps the conflict indicator", async ({ graphFrame, testRepo }) => {
    // Two sibling branches each add conflict.txt with different content, so
    // merging them produces a conflict.
    const baseChange = await testRepo.commitFile("base.txt", "base", "Base commit");

    await testRepo.writeFile("conflict.txt", "B");
    const changeB = await testRepo.commit("Change B");

    await testRepo.jjCommand(["new", baseChange]);
    await testRepo.writeFile("conflict.txt", "C");
    const changeC = await testRepo.commit("Change C");

    // Merge both branches, then copy the conflicted file into a new change on
    // top of the base commit. That change adds conflict.txt with a conflict
    // relative to its parent, so the file shows up in the diff with a plain
    // status letter (A) while also being conflicted.
    await testRepo.jjCommand(["new", changeB, changeC]);
    await testRepo.jjCommand(["describe", "-m", "merge"]);
    const mergeChangeId = (await testRepo.log("@"))[0].change_id;

    await testRepo.jjCommand(["new", baseChange]);
    await testRepo.jjCommand(["restore", "--from", mergeChangeId, "conflict.txt"]);
    await testRepo.writeFile("plain.txt", "plain");
    await testRepo.jjCommand(["describe", "-m", "adds conflicted file"]);
    const conflictedChangeId = (await testRepo.log("@"))[0].change_id;

    const changeRow = graphFrame.locator(`#nodes > div[data-change-id^="${conflictedChangeId}/"]`);
    await expect(changeRow).toBeVisible();
    await changeRow.locator('[data-role="files-toggle"]').click();

    const conflictFile = fileRows(graphFrame, conflictedChangeId, "conflict.txt");
    await expect(conflictFile).toBeVisible();
    // The status letter keeps its plain meaning but is marked as conflicted
    // (A! with conflict color), not rendered as a regular addition.
    await expect(conflictFile).toHaveAttribute("data-conflict", "");
    await expect(conflictFile.locator(`[data-role="file-status"]`)).toHaveText("A!");

    const plainFile = fileRows(graphFrame, conflictedChangeId, "plain.txt");
    await expect(plainFile).toBeVisible();
    await expect(plainFile).not.toHaveAttribute("data-conflict", "");
    await expect(plainFile.locator(`[data-role="file-status"]`)).toHaveText("A");
  });

  test("changed-file context menu matches the SCM view context menu", async ({
    graphFrame,
    testRepo,
    workbox,
    electronApp,
  }) => {
    await testRepo.commitFile("a.txt", "content a", "commit A");
    await testRepo.writeFile("a.txt", "modified a");

    const workingCopyChangeId = (await testRepo.log("@"))[0].change_id;
    const commitAChangeId = (await testRepo.log("@-"))[0].change_id;

    const workingCopyFile = fileRows(graphFrame, workingCopyChangeId, "a.txt");
    const commitAFile = fileRows(graphFrame, commitAChangeId, "a.txt");
    await graphFrame
      .locator(`#nodes > div[data-change-id^="${workingCopyChangeId}/"] [data-role="files-toggle"]`)
      .click();
    await graphFrame.locator(`#nodes > div[data-change-id^="${commitAChangeId}/"] [data-role="files-toggle"]`).click();
    await expect(workingCopyFile).toBeVisible();
    await expect(commitAFile).toBeVisible();

    const menu = graphFrame.locator("#file-context-menu");

    // Working-copy changes have no "Open File in Working Copy" entry (the file
    // already is the working copy), matching the @ SCM resource group.
    await test.step("working-copy file menu entries", async () => {
      await workingCopyFile.click({ button: "right" });
      await expect(menu).toBeVisible();
      await expect(menu.locator("[data-action]")).toHaveText([
        "View as Diff",
        "Open File",
        "Copy Path",
        "Copy Relative Path",
        "Discard Changes",
      ]);
      await graphFrame.locator("#nodes > div").first().click();
      await expect(menu).not.toBeVisible();
    });

    // Non-working-copy changes additionally offer "Open File in Working Copy".
    await test.step("non-working-copy file menu entries", async () => {
      await commitAFile.click({ button: "right" });
      await expect(menu).toBeVisible();
      await expect(menu.locator("[data-action]")).toHaveText([
        "View as Diff",
        "Open File",
        "Open File in Working Copy",
        "Copy Path",
        "Copy Relative Path",
        "Discard Changes",
      ]);
      await graphFrame.locator("#nodes > div").first().click();
      await expect(menu).not.toBeVisible();
    });

    await test.step("View as Diff on a non-working-copy change opens the change's diff", async () => {
      await clickFileMenuItem(graphFrame, commitAFile, "View as Diff");
      const diffEditor = workbox.locator(".editor-instance");
      await expect(diffEditor).toBeVisible();
      await expect(diffEditor.locator(".editor.original .view-lines")).toHaveText(/^\s*$/);
      await expect(diffEditor.locator(".editor.modified .view-lines").getByText("content a").first()).toBeVisible();
      await runCommand(workbox, "Close All Editors");
    });

    await test.step("Open File on a non-working-copy change opens the file at that revision", async () => {
      await clickFileMenuItem(graphFrame, commitAFile, "Open File");
      const atRevEditor = workbox.locator('.monaco-editor[role="code"][data-uri*="a.txt"]');
      await expect(atRevEditor.getByText("content a").first()).toBeVisible();
      await expect(workbox.locator(".tab.active")).toContainText("a.txt");
      await runCommand(workbox, "Close All Editors");
    });

    await test.step("Open File in Working Copy opens the live working-copy file", async () => {
      await clickFileMenuItem(graphFrame, commitAFile, "Open File in Working Copy");
      const openEditor = workbox.locator('.monaco-editor[role="code"][data-uri*="a.txt"]');
      await expect(workbox.locator(".tab.active")).toContainText("a.txt");
      await expect(openEditor.getByText("modified a").first()).toBeVisible();
      await runCommand(workbox, "Close All Editors");
    });

    await test.step("Open File on a working-copy change opens the live working-copy file", async () => {
      await clickFileMenuItem(graphFrame, workingCopyFile, "Open File");
      const openEditor = workbox.locator('.monaco-editor[role="code"][data-uri*="a.txt"]');
      await expect(openEditor.getByText("modified a").first()).toBeVisible();
      await runCommand(workbox, "Close All Editors");
    });

    await test.step("Copy Path copies the absolute path", async () => {
      await clickFileMenuItem(graphFrame, commitAFile, "Copy Path");
      await expect
        .poll(async () =>
          canonicalPath(
            await electronApp.evaluate(({ clipboard }: { clipboard: { readText: () => string } }) =>
              clipboard.readText(),
            ),
          ),
        )
        .toBe(canonicalPath(path.join(testRepo.repoPath, "a.txt")));
    });

    await test.step("Copy Relative Path copies the repository-relative path", async () => {
      await clickFileMenuItem(graphFrame, commitAFile, "Copy Relative Path");
      await expect
        .poll(() =>
          electronApp.evaluate(({ clipboard }: { clipboard: { readText: () => string } }) => clipboard.readText()),
        )
        .toBe("a.txt");
    });
  });
});
