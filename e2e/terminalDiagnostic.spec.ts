import { test, expect } from "@playwright/test";
import type {} from "./terminalDiagnostic.fixture";
type Row = { event: string; source: string; fields: Record<string, unknown> };

test.beforeEach(async ({ page }) => {
  await page.goto("/e2e/terminalDiagnostic.fixture.html");
  await page.waitForFunction(() => window.diagnosticTest?.ready);
});

test("off by default, native Shift preserves selection and trusted provenance", async ({ page }) => {
  expect(await page.evaluate(() => JSON.parse(window.diagnosticTest.diagnostic.exportJson()).rows)).toEqual([]);
  await page.evaluate(() => window.diagnosticTest.diagnostic.start("builtin-chinese"));
  await page.keyboard.press("Shift");
  const result = await page.evaluate(() => ({
    y: window.diagnosticTest.terminal.buffer.active.viewportY,
    report: JSON.parse(window.diagnosticTest.diagnostic.exportJson()),
  }));
  expect(result.y).toBe(110);
  expect(
    result.report.rows.some((r: Row) => r.event === "keydown:capture" && r.fields.key === "Shift" && r.fields.trusted),
  ).toBe(true);
});

for (const enabled of [false, true])
  for (const state of ["idle229", "composing16", "sending16"]) {
    test(`original jump preserved: ${state}, recording=${enabled}`, async ({ page }) => {
      const result = await page.evaluate(
        ({ enabled, state }) => {
          const { terminal: t, diagnostic: d } = window.diagnosticTest;
          if (enabled) d.start("sogou-english");
          if (state !== "idle229")
            t.textarea!.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
          if (state === "sending16")
            t.textarea!.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
          t.textarea!.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Shift",
              code: "ShiftLeft",
              keyCode: state === "idle229" ? 229 : 16,
              shiftKey: true,
              bubbles: true,
            }),
          );
          return {
            y: t.buffer.active.viewportY,
            base: t.buffer.active.baseY,
            selection: t.getSelection(),
            report: JSON.parse(d.exportJson()),
          };
        },
        { enabled, state },
      );
      expect(result.y).toBe(result.base);
      expect(result.selection).toBe("ne abcde");
      if (enabled) {
        const rows = result.report.rows;
        const capture = rows.findIndex((r: Row) => r.event === "keydown:capture");
        const decision = rows.findIndex(
          (r: Row) => r.source === "composition-key" && r.event === "leave" && r.fields.continueKey === false,
        );
        const bottom = rows.findIndex((r: Row) => r.source === "bottom" && r.event === "enter");
        expect(capture).toBeGreaterThan(-1);
        expect(decision).toBeGreaterThan(capture);
        expect(bottom).toBeGreaterThan(decision);
        expect(rows[bottom].fields.caller).toBe("keydown");
        expect(rows[capture].fields.trusted).toBe(false);
      } else expect(result.report.rows).toEqual([]);
    });
  }

test("secret sentinel never retained in diagnostic memory or export; input unchanged", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { terminal: t, diagnostic: d, data } = window.diagnosticTest;
    const secret = "PRIVATE_SENTINEL_4c719b";
    d.start("sogou-chinese");
    await new Promise<void>((r) => t.write(secret, r));
    t.textarea!.dispatchEvent(new KeyboardEvent("keydown", { key: secret, code: secret, keyCode: 65, bubbles: true }));
    t.textarea!.value = secret;
    t.textarea!.dispatchEvent(
      new InputEvent("input", { data: secret, inputType: "insertText", bubbles: true, composed: false }),
    );
    t.textarea!.dispatchEvent(new CompositionEvent("compositionupdate", { data: secret, bubbles: true }));
    t.paste(secret);
    d.stop();
    return { report: d.exportJson(), memory: JSON.stringify((d as unknown as { rows: unknown }).rows), data, secret };
  });
  expect(result.report).not.toContain(result.secret);
  expect(result.memory).not.toContain(result.secret);
  expect(result.data).toEqual([result.secret, result.secret]);
});

test("actual commit source and cancellation", async ({ page }) => {
  await page.evaluate(() => {
    const { terminal: t, diagnostic: d } = window.diagnosticTest;
    d.start("sogou-chinese");
    t.textarea!.dispatchEvent(new CompositionEvent("compositionstart"));
    t.textarea!.value = "中";
    t.textarea!.dispatchEvent(new CompositionEvent("compositionend"));
  });
  await expect.poll(() => page.evaluate(() => window.diagnosticTest.data)).toEqual(["中"]);
  const rows = await page.evaluate(() => JSON.parse(window.diagnosticTest.diagnostic.exportJson()).rows);
  expect(rows.some((r: Row) => r.source === "bottom" && r.event === "enter" && r.fields.caller === "user-data")).toBe(
    true,
  );
});

test("bounded buffer automatically stops, restores handlers, clear and disposal erase memory", async ({ page }) => {
  await page.goto("/e2e/terminalDiagnostic.fixture.html?limit=20");
  await page.waitForFunction(() => window.diagnosticTest?.ready);
  const result = await page.evaluate(() => {
    const { terminal: t, diagnostic: d } = window.diagnosticTest;
    const core = (t as unknown as { _core: { _keyDown: unknown } })._core;
    const original = core._keyDown;
    d.start("abc");
    for (let i = 0; i < 10; i++)
      t.textarea!.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", keyCode: 16, bubbles: true }));
    const stopped = d.snapshot();
    const count = JSON.parse(d.exportJson()).rows.length;
    const restored = core._keyDown === original;
    d.clear();
    const cleared = JSON.parse(d.exportJson()).rows.length;
    d.start("abc");
    window.dispatchEvent(new Event("pagehide"));
    return {
      stopped,
      count,
      restored,
      cleared,
      disposed: d.snapshot(),
      remaining: JSON.parse(d.exportJson()).rows.length,
      restart: d.start("abc"),
    };
  });
  expect(result.stopped).toMatchObject({ active: false, reason: "buffer-limit" });
  expect(result.count).toBe(20);
  expect(result.restored).toBe(true);
  expect(result.cleared).toBe(0);
  expect(result.remaining).toBe(0);
  expect(result.restart).toBe(false);
});

test("stop restores original handler identity; ordinary key still works", async ({ page }) => {
  expect(
    await page.evaluate(() => {
      const { terminal: t, diagnostic: d } = window.diagnosticTest;
      const core = (t as unknown as { _core: { _keyDown: unknown } })._core;
      const original = core._keyDown;
      d.start("abc");
      d.stop();
      return core._keyDown === original;
    }),
  ).toBe(true);
  await page.keyboard.press("a");
  expect(await page.evaluate(() => window.diagnosticTest.data)).toEqual(["a"]);
});
