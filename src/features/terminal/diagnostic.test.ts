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
