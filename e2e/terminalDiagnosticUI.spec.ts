import { expect, test } from "./fixtures";

test("diagnostic controls work in the real terminal pane without covering its content", async ({ workbench: page }) => {
  await page
    .getByRole("toolbar", { name: "Tool windows", exact: true })
    .getByRole("button", { name: "Terminal", exact: true })
    .click();
  const controls = page.getByLabel("终端输入法诊断");
  await expect(controls).toBeVisible();
  await controls.getByRole("button", { name: "开始新采样" }).click();
  await expect(controls.getByText("● 正在采集（仅内存）")).toBeVisible();
  const bar = await controls.boundingBox();
  const terminal = await page.locator(".openidea-terminal-host .xterm-screen").first().boundingBox();
  expect(bar).not.toBeNull();
  expect(terminal).not.toBeNull();
  expect(terminal!.y).toBeGreaterThanOrEqual(bar!.y + bar!.height - 1);
  await controls.getByRole("button", { name: "停止", exact: true }).click();
  await expect(controls.getByText(/已停止/)).toBeVisible();
  await controls.getByRole("button", { name: "清除", exact: true }).click();
  await controls.getByRole("button", { name: "确认丢弃并清除" }).click();
  await expect(controls.getByRole("button", { name: "停止并导出" })).toBeDisabled();
});

test("four targets focus in one document, keyboard navigation and discard protection", async ({ workbench: page }) => {
  await page
    .getByRole("toolbar", { name: "Tool windows", exact: true })
    .getByRole("button", { name: "Terminal", exact: true })
    .click();
  const controls = page.getByLabel("终端输入法诊断");
  await controls.getByRole("button", { name: "开始新采样" }).click();
  for (const [n, selector] of [
    [1, '[aria-label="普通输入框对照"]'],
    [2, '[aria-label="普通多行框对照"]'],
    [3, '[aria-label="终端样式框对照"]'],
    [4, ".openidea-terminal-host .xterm-helper-textarea"],
  ] as const) {
    const button = controls.getByRole("button", { name: new RegExp(`聚焦 ${n}`) });
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(selector).first()).toBeFocused();
    await page.keyboard.press("ShiftLeft");
    // Separate single modifiers from the application's existing 300ms double-Shift shortcut.
    await page.waitForTimeout(500);
    await page.keyboard.press("ShiftRight");
    await expect(page.locator(selector).first()).toBeFocused();
  }
  // macOS WebKit can skip buttons unless Keyboard Navigation is enabled.
  // Enter activation of every focus button is checked above; Tab must still
  // navigate the ordinary text fields without assuming a runner OS preference.
  await controls.getByLabel("普通输入框对照").focus();
  await page.keyboard.press("Tab");
  await expect(controls.getByLabel("普通多行框对照")).toBeFocused();
  await controls.getByRole("button", { name: "停止", exact: true }).click();
  await controls.getByRole("button", { name: "开始新采样" }).click();
  await expect(controls.getByRole("alert")).toBeVisible();
  await controls.getByRole("button", { name: "取消丢弃" }).click();
  await expect(controls.getByText(/已停止/)).toBeVisible();
  await controls.getByRole("button", { name: "开始新采样" }).click();
  await controls.getByRole("button", { name: "确认丢弃并开始" }).click();
  await expect(controls.getByText("● 正在采集（仅内存）")).toBeVisible();
  // Hiding and reopening the view must not leave a stale active capture.
  const toggle = page
    .getByRole("toolbar", { name: "Tool windows", exact: true })
    .getByRole("button", { name: "Terminal", exact: true });
  await toggle.click();
  await toggle.click();
  await expect(page.getByLabel("终端输入法诊断").getByText(/已停止/)).toBeVisible();
});
