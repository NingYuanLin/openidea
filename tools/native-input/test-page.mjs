import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.messages = [];
    window.webkit = { messageHandlers: { nativeDiagnostic: { postMessage: (b) => window.messages.push(b) } } };
  });
  const html = readFileSync(new URL("./shared/index.html", import.meta.url), "utf8");
  await page.goto("about:blank");
  await page.setContent(html);
  // setContent shares the installed bridge from about:blank.
  await page.evaluate(() => {
    window.nativeStatus({
      host: "appkit",
      commit: "test",
      active: false,
      count: 0,
      dropped: 0,
      pending: 0,
      capability: "disabled",
    });
  });
  assert.equal(await page.locator("#privateProbe").isChecked(), false);
  await page.locator("#sample").press("ShiftLeft");
  assert.equal(await page.evaluate(() => messages.filter((x) => x.op === "dom").length), 0);
  await page.locator("#start").click();
  assert.equal(await page.locator("#sample").evaluate((e) => document.activeElement === e), true);
  await page.evaluate(() =>
    nativeStatus({
      host: "appkit",
      commit: "test",
      active: true,
      count: 1,
      dropped: 0,
      pending: 0,
      capability: "disabled",
    }),
  );
  await page.keyboard.press("ShiftLeft");
  await page.keyboard.press("ShiftRight");
  await page.keyboard.type("SECRET_SENTINEL_abcdef123456");
  let records = await page.evaluate(() => messages);
  assert.equal(records.filter((x) => x.op === "dom").length, 4);
  const serialized = JSON.stringify(records);
  assert(!serialized.includes("SECRET_SENTINEL"));
  assert(!serialized.includes("KeyA"));
  assert(!serialized.includes('"keyCode":65'));
  assert(records.some((x) => x.op === "text-state" && x.targetLength > 0));
  await page.locator("#stop").click();
  await page.evaluate(() =>
    nativeStatus({
      host: "appkit",
      commit: "test",
      active: false,
      count: 5,
      dropped: 0,
      pending: 0,
      capability: "disabled",
    }),
  );
  page.once("dialog", (d) => d.dismiss());
  await page.locator("#start").click();
  assert.equal(await page.evaluate(() => messages.filter((x) => x.op === "start").length), 1);
  page.once("dialog", (d) => d.accept());
  await page.locator("#start").click();
  assert.equal(await page.evaluate(() => messages.filter((x) => x.op === "start").length), 2);
  await page.locator("#export").click();
  assert.equal(await page.evaluate(() => messages.at(-1).op), "export");
  console.log(
    "PASS page default-off, private opt-in, focus, both Shifts, printable redaction, length-only text, discard confirmation, export action",
  );
} finally {
  await browser.close();
}
