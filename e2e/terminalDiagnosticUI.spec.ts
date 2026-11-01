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
  await expect(controls.getByRole("button", { name: "停止并导出" })).toBeDisabled();
});
