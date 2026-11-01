import { describe, expect, it, vi } from "vitest";
import { exportDiagnostic, safeEvent } from "./diagnostic";

describe("diagnostic privacy boundary", () => {
  it("redacts every printable key/code/numeric keycode", () => {
    const secret = "PRIVATE_SENTINEL_4c719b";
    for (let code = 32; code <= 90; code++) {
      if (code === 46) continue; // Delete control code
      const row = safeEvent(new KeyboardEvent("keydown", { key: secret, code: secret, keyCode: code }));
      expect(row.key).toBe("redacted");
      expect(row.code).toBe("redacted");
      expect(row.keyCode).toBeNull();
      expect(JSON.stringify(row)).not.toContain(secret);
    }
  });
  it("keeps only safe modifiers and text lengths", () => {
    expect(
      safeEvent(new KeyboardEvent("keydown", { key: "Shift", code: "ShiftLeft", keyCode: 229, shiftKey: true })),
    ).toMatchObject({ key: "Shift", code: "ShiftLeft", keyCode: 229, shift: true, trusted: false });
    const secret = "PRIVATE_SENTINEL_4c719b";
    const event = new InputEvent("input", { data: secret, inputType: secret });
    expect(safeEvent(event)).toMatchObject({ dataLength: secret.length, inputType: "other" });
    expect(JSON.stringify(safeEvent(event))).not.toContain(secret);
  });
  it("cancelled export never writes", async () => {
    const write = vi.fn();
    expect(await exportDiagnostic("{}", async () => null, write)).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });
  it("exports exactly the snapshot only to the chosen local destination", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    expect(await exportDiagnostic('{"rows":[]}', async () => "/chosen/file.json", write)).toBe(true);
    expect(write).toHaveBeenCalledExactlyOnceWith("/chosen/file.json", '{"rows":[]}');
  });
});

describe("v2 prototype and numeric privacy", () => {
  it("redacts all numeric channels for printable keypresses, including punctuation", () => {
    for (let code = 32; code < 127; code++) {
      const event = new KeyboardEvent("keypress", {
        key: String.fromCharCode(code),
        code: "KeyA",
        keyCode: code,
        charCode: code,
      });
      expect(safeEvent(event)).toMatchObject({
        key: "redacted",
        code: "redacted",
        keyCode: null,
        which: null,
        prototypeKeyCode: null,
      });
    }
  });
  it("compares native getter with shadowed control value without changing either", () => {
    const event = new KeyboardEvent("keydown", { key: "Shift", code: "ShiftLeft", keyCode: 16 });
    Object.defineProperty(event, "keyCode", { value: 229 });
    expect(safeEvent(event)).toMatchObject({ keyCode: 229, prototypeKeyCode: 16, ownKeyCode: true });
    expect(event.keyCode).toBe(229);
  });
  it("handles non-keyboard prototype getter failure and cannot retain a shadowed secret", () => {
    expect(safeEvent(new Event("focus")).prototypeKeyCode).toBeNull();
    const event = new KeyboardEvent("keydown", { key: "Shift", code: "ShiftLeft", keyCode: 65 });
    Object.defineProperty(event, "keyCode", { value: "PRIVATE_SENTINEL_4c719b" });
    expect(safeEvent(event)).toMatchObject({ keyCode: null, prototypeKeyCode: null, ownKeyCode: true });
    expect(JSON.stringify(safeEvent(event))).not.toContain("PRIVATE_SENTINEL");
  });
});

it("unreadable shadowed properties never break event delivery or retain thrown content", () => {
  const event = new KeyboardEvent("keydown", { key: "Shift", keyCode: 16 });
  Object.defineProperty(event, "keyCode", {
    get() {
      throw new Error("PRIVATE_SENTINEL_4c719b");
    },
  });
  expect(safeEvent(event)).toEqual({ unreadable: true });
});
