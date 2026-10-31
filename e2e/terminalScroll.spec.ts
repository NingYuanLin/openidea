import { expect, test } from "@playwright/test";
import type {} from "./terminalScroll.fixture";

for (const bundle of ["esm", "umd"]) {
  test.describe(`terminal input scrolling (${bundle})`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/e2e/terminalScroll.html?bundle=${bundle}`);
      await page.evaluate(() => window.terminalScroll.ready);
    });

    test("IME-handled modifiers and unidentified 229 preserve scrollback and selection", async ({ page }) => {
      const result = await page.evaluate(() => {
        const { term, data } = window.terminalScroll;
        const selection = term.getSelection();
        for (const [key, code] of [
          ["Shift", "ShiftLeft"],
          ["Process", "ShiftRight"],
          ["Unidentified", ""],
        ]) {
          term.textarea!.dispatchEvent(
            new KeyboardEvent("keydown", { key, code, keyCode: 229, shiftKey: true, bubbles: true }),
          );
        }
        return { y: term.buffer.active.viewportY, data, selection: term.getSelection(), original: selection };
      });
      expect(result.y).toBe(110);
      expect(result.data).toEqual([]);
      expect(result.selection).toBe(result.original);
    });

    for (const trigger of ["1", "2", "3", " ", "Enter", "candidate"]) {
      test(`scrolls on committed text, not candidate key ${JSON.stringify(trigger)}`, async ({ page }) => {
        const before = await page.evaluate(async (key) => {
          const { term, data } = window.terminalScroll;
          const ta = term.textarea!;
          ta.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
          ta.value = "zhongwen";
          ta.dispatchEvent(new CompositionEvent("compositionupdate", { data: "zhongwen", bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 20));
          term.scrollToLine(110);
          if (key !== "candidate")
            ta.dispatchEvent(new KeyboardEvent("keydown", { key, keyCode: 229, isComposing: true, bubbles: true }));
          return { y: term.buffer.active.viewportY, data };
        }, trigger);
        expect(before).toEqual({ y: 110, data: [] });
        await page.evaluate(() => {
          const ta = window.terminalScroll.term.textarea!;
          ta.value = "中文";
          ta.dispatchEvent(new CompositionEvent("compositionend", { data: "中文", bubbles: true }));
        });
        await expect.poll(() => page.evaluate(() => window.terminalScroll.data)).toEqual(["中文"]);
        expect(
          await page.evaluate(() => {
            const b = window.terminalScroll.term.buffer.active;
            return b.viewportY === b.baseY;
          }),
        ).toBe(true);
      });
    }

    test("composition DOM activates without forcing scroll; cancel emits nothing", async ({ page }) => {
      const state = await page.evaluate(() => {
        const { term } = window.terminalScroll;
        const ta = term.textarea!;
        ta.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Process", keyCode: 229, bubbles: true }));
        ta.dispatchEvent(new CompositionEvent("compositionupdate", { data: "", bubbles: true }));
        return {
          y: term.buffer.active.viewportY,
          active: term.element!.querySelector(".composition-view")!.classList.contains("active"),
        };
      });
      expect(state).toEqual({ y: 110, active: true });
      // This checks the DOM lifecycle, not native macOS candidate-window placement.
      await page.evaluate(() =>
        window.terminalScroll.term.textarea!.dispatchEvent(
          new CompositionEvent("compositionend", { data: "", bubbles: true }),
        ),
      );
      await page.waitForTimeout(30);
      expect(
        await page.evaluate(() => ({
          y: window.terminalScroll.term.buffer.active.viewportY,
          data: window.terminalScroll.data,
        })),
      ).toEqual({ y: 110, data: [] });
    });

    test("textarea-only 229 commit still scrolls and emits once", async ({ page }) => {
      await page.evaluate(() => {
        const ta = window.terminalScroll.term.textarea!;
        ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Process", keyCode: 229, bubbles: true }));
        ta.value += "中文";
      });
      await expect.poll(() => page.evaluate(() => window.terminalScroll.data)).toEqual(["中文"]);
      expect(
        await page.evaluate(() => {
          const b = window.terminalScroll.term.buffer.active;
          return b.viewportY === b.baseY;
        }),
      ).toBe(true);
    });

    for (const [key, data] of [
      ["a", "a"],
      ["Shift+A", "A"],
      ["Control+c", "\x03"],
      ["ArrowLeft", "\x1b[D"],
    ]) {
      test(`ordinary input ${key} scrolls`, async ({ page }) => {
        await page.keyboard.press(key!);
        expect(await page.evaluate(() => window.terminalScroll.data)).toEqual([data]);
        expect(
          await page.evaluate(() => {
            const b = window.terminalScroll.term.buffer.active;
            return b.viewportY === b.baseY;
          }),
        ).toBe(true);
      });
    }

    test("paste scrolls but a terminal response does not", async ({ page }) => {
      const response = await page.evaluate(async () => {
        const { term, data } = window.terminalScroll;
        await new Promise<void>((resolve) => term.write("\x1b[6n\x1b[?2004h", resolve));
        return { y: term.buffer.active.viewportY, data: [...data] };
      });
      expect(response.y).toBe(110);
      expect(response.data).toEqual(["\x1b[24;1R"]);
      const pasted = await page.evaluate(() => {
        const { term, data } = window.terminalScroll;
        term.paste("one\ntwo");
        return { bottom: term.buffer.active.viewportY === term.buffer.active.baseY, data: data.at(-1) };
      });
      expect(pasted).toEqual({ bottom: true, data: "\x1b[200~one\rtwo\x1b[201~" });
    });

    test("Shift-click extends the selection and Shift-PageUp still scrolls history", async ({ page }) => {
      const box = await page.locator(".xterm-screen").boundingBox();
      await page.keyboard.down("Shift");
      await page.evaluate(() =>
        window.terminalScroll.term.textarea!.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Process",
            code: "ShiftLeft",
            keyCode: 229,
            shiftKey: true,
            bubbles: true,
          }),
        ),
      );
      await page.mouse.click(box!.x + 100, box!.y + 100);
      await page.keyboard.up("Shift");
      const selected = await page.evaluate(() => ({
        y: window.terminalScroll.term.buffer.active.viewportY,
        selection: window.terminalScroll.term.getSelection(),
        data: window.terminalScroll.data,
      }));
      expect(selected.y).toBe(110);
      expect(selected.selection).toContain("\n");
      expect(selected.data).toEqual([]);
      await page.keyboard.press("Shift+PageUp");
      expect(await page.evaluate(() => window.terminalScroll.term.buffer.active.viewportY)).toBe(87);
    });
  });
}
