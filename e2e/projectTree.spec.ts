import { expect, test } from "./fixtures";

test("keyboard navigation: arrows move, Right/Left expand and collapse, Enter opens", async ({ workbench: page }) => {
  const tree = page.getByRole("tree", { name: "Project" });
  await page.getByRole("treeitem", { name: /acme-api/ }).click();
  const selected = tree.locator('[role="treeitem"][aria-selected="true"]');
  await expect(selected).toContainText("acme-api");

  await page.keyboard.press("ArrowDown");
  await expect(selected).toHaveText("build");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(selected).toHaveText("src");

  const src = tree.getByRole("treeitem", { name: "src", exact: true });
  await expect(src).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ArrowRight");
  await expect(src).toHaveAttribute("aria-expanded", "true");
  await expect(tree.getByRole("treeitem", { name: "main", exact: true })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(src).toHaveAttribute("aria-expanded", "false");
  await expect(tree.getByRole("treeitem", { name: "main", exact: true })).toBeHidden();

  await page.keyboard.press("End");
  await expect(selected).toHaveText("settings.gradle.kts");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("tablist", { name: "Editor tabs" }).getByRole("tab", { name: "settings.gradle.kts" }),
  ).toBeVisible();
});

test("type-ahead jumps to a matching node", async ({ workbench: page }) => {
  const tree = page.getByRole("tree", { name: "Project" });
  await page.getByRole("treeitem", { name: /acme-api/ }).click();
  await page.keyboard.type("READ");
  await expect(tree.locator('[role="treeitem"][aria-selected="true"]')).toHaveText("README.md");
});

test("Git ignore submenu offers shared and local destinations for files and folders", async ({ workbench: page }) => {
  for (const name of ["README.md", "src"]) {
    await page.getByRole("treeitem", { name, exact: true }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Git", exact: true }).hover();
    await page.getByRole("menuitem", { name: "Add to .gitignore", exact: true }).hover();
    await expect(page.getByRole("menuitem", { name: ".gitignore", exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: ".git/info/exclude", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  }
});

// Layout regressions need a browser: jsdom cannot distinguish a clipped label
// from a row that actually contributes to the horizontal scroll range.
test("expanded Project names scroll horizontally without clipping or shortening selection", async ({
  workbench: page,
}) => {
  const tree = page.getByRole("tree", { name: "Project" });
  await page.getByRole("button", { name: "Expand All", exact: true }).click();
  const row = tree.getByRole("treeitem", { name: "OrderService.kt", exact: true });
  const label = row.getByText("OrderService.kt", { exact: true });
  await expect(row).toBeVisible();
  await expect.poll(() => tree.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeGreaterThan(0);
  await expect.poll(() => label.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);

  await row.click();
  await expect(row).toHaveAttribute("aria-selected", "true");
  await expect
    .poll(() => row.evaluate((el) => el.getBoundingClientRect().width))
    .toBeGreaterThan(await tree.evaluate((el) => el.clientWidth));
  await tree.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await expect.poll(() => tree.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  const bounds = await label.evaluate((el) => {
    const label = el.getBoundingClientRect();
    const tree = el.closest('[role="tree"]')!.getBoundingClientRect();
    return { labelRight: label.right, treeRight: tree.right };
  });
  expect(bounds.labelRight).toBeLessThanOrEqual(bounds.treeRight);
});

test("Project width includes offscreen names and survives virtual row unmounts", async ({ workbench: page }) => {
  const longName = `z_${"wide_filename_".repeat(16)}end.txt`;
  await page.evaluate(async (longName) => {
    const fsModule = "/src/features/project-tree/fs.ts";
    const storeModule = "/src/features/project-tree/store.ts";
    const { projectFs } = await import(fsModule);
    const { reloadAll } = await import(storeModule);
    const fs = projectFs("/dev/acme-api");
    for (let i = 0; i < 160; i++) await fs.createFile(`/dev/acme-api/row_${String(i).padStart(3, "0")}.txt`);
    await fs.createFile(`/dev/acme-api/${longName}`);
    await reloadAll();
  }, longName);
  const tree = page.getByRole("tree", { name: "Project" });
  const longest = tree.getByRole("treeitem", { name: longName, exact: true });
  // The last row is not mounted yet; its label must still contribute a useful
  // horizontal range rather than waiting until it happens to enter the viewport.
  await expect(longest).toHaveCount(0);
  await expect.poll(() => tree.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeGreaterThan(600);
  await tree.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(longest).toBeVisible();
  await expect
    .poll(() => longest.getByText(longName, { exact: true }).evaluate((el) => el.scrollWidth - el.clientWidth))
    .toBeLessThanOrEqual(1);
  await tree.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  const widest = await tree.evaluate((el) => ({ width: el.scrollWidth, left: el.scrollLeft }));
  await tree.evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect(longest).toHaveCount(0);
  await expect.poll(() => tree.evaluate((el) => el.scrollWidth)).toBe(widest.width);
  await expect.poll(() => tree.evaluate((el) => el.scrollLeft)).toBe(widest.left);
  expect(await tree.getByRole("treeitem").count()).toBeLessThan(80);
});

test("inline rename reveals a deep short name horizontally without moving the vertical viewport", async ({
  workbench: page,
}) => {
  await page.evaluate(async () => {
    const fsModule = "/src/features/project-tree/fs.ts";
    const storeModule = "/src/features/project-tree/store.ts";
    const { projectFs } = await import(fsModule);
    const { reloadAll, setViewOption } = await import(storeModule);
    await projectFs("/dev/acme-api").createFile("/dev/acme-api/a/b/c/d/e/x");
    setViewOption("compact", false);
    await reloadAll();
  });
  const tree = page.getByRole("tree", { name: "Project" });
  await page.getByRole("button", { name: "Expand All", exact: true }).click();
  const row = tree.getByRole("treeitem", { name: "x", exact: true });
  await row.click();
  await tree.evaluate((el) => {
    el.scrollLeft = 0;
  });
  const top = await tree.evaluate((el) => el.scrollTop);
  // Inline rename is a hidden action (Shift+F6 opens the separate refactoring
  // dialog), so exercise its production operation after selecting through UI.
  await page.evaluate(async () => {
    const operationsModule = "/src/features/project-tree/operations.ts";
    const { beginRename } = await import(operationsModule);
    beginRename();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const input = tree.getByRole("textbox", { name: "New name", exact: true });
  await expect(input).toBeFocused();
  await expect
    .poll(() =>
      input.evaluate((el) => {
        const input = el.getBoundingClientRect();
        const tree = el.closest('[role="tree"]')!.getBoundingClientRect();
        return input.left >= tree.left && input.right <= tree.right;
      }),
    )
    .toBe(true);
  expect(await tree.evaluate((el) => el.scrollTop)).toBe(top);
  expect(await tree.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await input.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(row).toHaveText("x");
});

test("clicking trailing Project row space preserves single-click expansion", async ({ workbench: page }) => {
  await page.evaluate(async () => {
    const storeModule = "/src/features/project-tree/store.ts";
    const { setViewOption } = await import(storeModule);
    setViewOption("singleClickExpand", true);
  });
  const tree = page.getByRole("tree", { name: "Project" });
  const row = tree.getByRole("treeitem", { name: "src", exact: true });
  await expect(row).toHaveAttribute("aria-expanded", "false");
  const bounds = await row.boundingBox();
  if (!bounds) throw new Error("Project row has no layout box");
  await row.click({ position: { x: Math.min(bounds.width - 12, 200), y: bounds.height / 2 } });
  await expect(row).toHaveAttribute("aria-expanded", "true");
  await expect(row).toHaveAttribute("aria-selected", "true");
  await expect(tree.getByRole("treeitem", { name: "main", exact: true })).toBeVisible();
});

test("Project width follows font changes, panel resizing and collapse", async ({ workbench: page }) => {
  const tree = page.getByRole("tree", { name: "Project" });
  await page.getByRole("button", { name: "Expand All", exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  const range = () => tree.evaluate((el) => el.scrollWidth - el.clientWidth);
  await expect.poll(range).toBeGreaterThan(0);
  const initialRange = await range();
  const oldSize = await page.evaluate(() => {
    const old = document.documentElement.style.getPropertyValue("--fs-ui");
    document.documentElement.style.setProperty("--fs-ui", "20px");
    return old;
  });
  await expect.poll(range).toBeGreaterThan(initialRange + 30);
  const largeRange = await range();
  const label = tree.getByRole("treeitem", { name: "OrderService.kt", exact: true }).getByText("OrderService.kt");
  await expect.poll(() => label.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await page.evaluate((oldSize) => {
    if (oldSize) document.documentElement.style.setProperty("--fs-ui", oldSize);
    else document.documentElement.style.removeProperty("--fs-ui");
  }, oldSize);
  await expect.poll(range).toBeLessThan(largeRange);

  const separator = page.getByRole("separator", { name: "Resize left tool window", exact: true });
  const box = await separator.boundingBox();
  if (!box) throw new Error("Project resize separator has no layout box");
  const initialWidth = await tree.evaluate((el) => el.clientWidth);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 200, y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => tree.evaluate((el) => el.clientWidth)).toBeGreaterThan(initialWidth + 150);
  await expect.poll(range).toBeLessThanOrEqual(1);

  await page.mouse.move(x + 200, y);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(range).toBeGreaterThan(0);
  await tree.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await expect.poll(() => tree.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Collapse All", exact: true }).click();
  await expect.poll(range).toBeLessThanOrEqual(1);
  await expect.poll(() => tree.evaluate((el) => el.scrollLeft)).toBe(0);
});
