import { expect, test } from "@playwright/test";

test("stock xterm reproduces Shift 229 scroll; the public-API guard preserves IME and input", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const xtermPath = "/node_modules/@xterm/xterm/lib/xterm.mjs";
    const guardPath = "/src/features/terminal/shiftScroll.ts";
    const { Terminal } = await import(xtermPath);
    const { ShiftScrollGuard } = await import(guardPath);
    const host = document.createElement("div");
    document.body.append(host);
    const term = new Terminal({ cols: 80, rows: 10, scrollback: 1000 });
    term.open(host);
    await new Promise<void>((resolve) => term.write("line\r\n".repeat(200), resolve));
    const received: string[] = [];
    term.onData((data: string) => received.push(data));
    const send = (code: string, keyCode: number, key = "Shift") =>
      term.textarea.dispatchEvent(new KeyboardEvent("keydown", { key, code, keyCode, bubbles: true }));
    term.scrollToLine(10);
    send("ShiftLeft", 229);
    const stockBottom = term.buffer.active.viewportY === term.buffer.active.baseY;
    await new Promise((resolve) => setTimeout(resolve, 10));
    const guard = new ShiftScrollGuard(term);
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      guard.beforeKey(e);
      return true;
    });
    term.scrollToLine(10);
    term.select(0, 10, 4);
    const beforeSelection = term.getSelection();
    send("ShiftLeft", 229);
    send("ShiftRight", 229);
    const synchronousOption = term.options.scrollOnUserInput;
    await new Promise((resolve) => setTimeout(resolve, 10));
    const held = {
      viewport: term.buffer.active.viewportY,
      selection: term.getSelection(),
      restored: term.options.scrollOnUserInput,
    };
    send("ShiftLeft", 16);
    const ordinaryShiftViewport = term.buffer.active.viewportY;
    // The 229 textarea-diff timer is preserved, and runs after restoration.
    send("ShiftLeft", 229);
    term.textarea.value = "中";
    await new Promise((resolve) => setTimeout(resolve, 20));
    const commit = { data: [...received], bottom: term.buffer.active.viewportY === term.buffer.active.baseY };
    term.scrollToLine(10);
    term.paste("paste");
    const pasteBottom = term.buffer.active.viewportY === term.buffer.active.baseY;
    term.scrollToLine(10);
    send("KeyA", 65, "a");
    const typingBottom = term.buffer.active.viewportY === term.buffer.active.baseY;
    term.scrollToLine(10);
    await new Promise<void>((resolve) => term.write("\x1b[6n", resolve));
    const reportViewport = term.buffer.active.viewportY;
    guard.dispose();
    term.dispose();
    host.remove();
    return {
      stockBottom,
      synchronousOption,
      held,
      beforeSelection,
      ordinaryShiftViewport,
      commit,
      pasteBottom,
      typingBottom,
      reportViewport,
    };
  });
  expect(result.stockBottom).toBe(true);
  expect(result.synchronousOption).toBe(false);
  expect(result.held).toEqual({ viewport: 10, selection: result.beforeSelection, restored: true });
  expect(result.ordinaryShiftViewport).toBe(10);
  expect(result.commit.data).toContain("中");
  expect(result.commit.bottom).toBe(true);
  expect(result.pasteBottom).toBe(true);
  expect(result.typingBottom).toBe(true);
  expect(result.reportViewport).toBe(10);
});

test("ordinary TerminalSession installs the guard without consuming the IME event", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const sessionPath = "/src/features/terminal/session.ts";
    const { TerminalSession } = await import(sessionPath);
    const session = new TerminalSession({ key: "shift-regression", cwd: "/", onChange: () => {}, onFocus: () => {} });
    document.body.append(session.host);
    session.term.open(session.host);
    await new Promise<void>((resolve) => session.term.write("line\r\n".repeat(200), resolve));
    session.term.scrollToLine(10);
    const event = new KeyboardEvent("keydown", {
      key: "Shift",
      code: "ShiftLeft",
      keyCode: 229,
      bubbles: true,
      cancelable: true,
    });
    session.term.textarea.dispatchEvent(event);
    const sync = {
      viewport: session.term.buffer.active.viewportY,
      option: session.term.options.scrollOnUserInput,
      prevented: event.defaultPrevented,
    };
    await Promise.resolve();
    const restored = session.term.options.scrollOnUserInput;
    session.dispose();
    session.host.remove();
    return { sync, restored };
  });
  expect(result).toEqual({ sync: { viewport: 10, option: false, prevented: false }, restored: true });
});
