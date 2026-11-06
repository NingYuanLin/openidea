import { expect, test } from "@playwright/test";

// Load only the modules under test, not the full IDE and its startup work.
test.beforeEach(async ({ page }) => {
  await page.route("**/terminal-regression", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body><script type="module">
        import RefreshRuntime from "/@react-refresh";
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => (type) => type;
        window.__vite_plugin_react_preamble_installed__ = true;
      </script></body></html>`,
    }),
  );
  await page.goto("/terminal-regression");
});

test("stock xterm reproduces Shift 229 scroll; the public-API guard preserves IME and input", async ({ page }) => {
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
      term.textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key, code, keyCode, metaKey: key === "Meta", bubbles: true }),
      );
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
    send("MetaLeft", 229, "Meta");
    send("MetaRight", 229, "Meta");
    const synchronousOption = term.options.scrollOnUserInput;
    await new Promise((resolve) => setTimeout(resolve, 10));
    const held = {
      viewport: term.buffer.active.viewportY,
      selection: term.getSelection(),
      restored: term.options.scrollOnUserInput,
    };
    send("ShiftLeft", 16);
    send("MetaLeft", 91, "Meta");
    send("MetaRight", 93, "Meta");
    term.textarea.dispatchEvent(new KeyboardEvent("keyup", { code: "MetaLeft", keyCode: 91, bubbles: true }));
    const ordinaryShiftViewport = term.buffer.active.viewportY;
    // The 229 textarea-diff timer is preserved, and runs after restoration.
    send("MetaLeft", 229, "Meta");
    term.textarea.value = "中";
    await new Promise((resolve) => setTimeout(resolve, 20));
    const commit = { data: [...received], bottom: term.buffer.active.viewportY === term.buffer.active.baseY };
    term.scrollToLine(10);
    send("KeyA", 229, "Process");
    const ordinaryIme = {
      option: term.options.scrollOnUserInput,
      bottom: term.buffer.active.viewportY === term.buffer.active.baseY,
    };
    await new Promise((resolve) => setTimeout(resolve, 10));
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
      ordinaryIme,
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
  expect(result.ordinaryIme).toEqual({ option: true, bottom: true });
  expect(result.pasteBottom).toBe(true);
  expect(result.typingBottom).toBe(true);
  expect(result.reportViewport).toBe(10);
});

test("ordinary TerminalSession installs the guard without consuming the IME event", async ({ page }) => {
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

for (const code of ["MetaLeft", "MetaRight"]) {
  test(`${code} 229 followed by Command+C preserves selection and copies once`, async ({ page }) => {
    const result = await page.evaluate(async (code) => {
      const loaderPath = "/src/features/terminal/loader.ts";
      const keysPath = "/src/features/terminal/keys.ts";
      const { loadTerminalRuntime } = await import(loaderPath);
      const { installTerminalKeys } = await import(keysPath);
      const rt = await loadTerminalRuntime();
      rt.newTab("/");
      const session = rt.activeSession();
      document.body.append(session.host);
      session.term.open(session.host);
      await new Promise<void>((resolve) => session.term.write("line\r\n".repeat(200), resolve));
      const copied: string[] = [];
      const data: string[] = [];
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            copied.push(text);
          },
        },
      });
      session.term.onData((text: string) => data.push(text));
      const removeKeys = installTerminalKeys();
      session.term.scrollToLine(10);
      session.term.select(0, 10, 4);
      const selection = session.term.getSelection();
      const meta = new KeyboardEvent("keydown", {
        key: "Meta",
        code,
        keyCode: 229,
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });
      session.term.textarea.dispatchEvent(meta);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const afterMeta = {
        viewport: session.term.buffer.active.viewportY,
        selection: session.term.getSelection(),
        prevented: meta.defaultPrevented,
      };
      const copy = new KeyboardEvent("keydown", {
        key: "c",
        code: "KeyC",
        keyCode: 67,
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });
      session.term.textarea.dispatchEvent(copy);
      session.term.textarea.dispatchEvent(
        new KeyboardEvent("keyup", { key: "c", code: "KeyC", keyCode: 67, metaKey: true, bubbles: true }),
      );
      session.term.textarea.dispatchEvent(
        new KeyboardEvent("keyup", { key: "Meta", code, keyCode: code === "MetaLeft" ? 91 : 93, bubbles: true }),
      );
      await Promise.resolve();
      const afterCopy = {
        viewport: session.term.buffer.active.viewportY,
        selection: session.term.getSelection(),
        restored: session.term.options.scrollOnUserInput,
      };
      removeKeys();
      rt.closeAll();
      session.host.remove();
      return { selection, copied, data, afterMeta, afterCopy, copyPrevented: copy.defaultPrevented };
    }, code);
    expect(result.selection).toBe("line");
    expect(result.afterMeta).toEqual({ viewport: 10, selection: "line", prevented: false });
    expect(result.afterCopy).toEqual({ viewport: 10, selection: "line", restored: true });
    expect(result.copied).toEqual(["line"]);
    expect(result.data).toEqual([]);
    expect(result.copyPrevented).toBe(true);
  });
}
