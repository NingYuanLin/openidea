import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ save: vi.fn(), invokeLocal: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: mocks.save }));
vi.mock("@/platform/tauriCore", () => ({ invokeLocal: mocks.invokeLocal }));
import { saveDiagnosticLocally } from "./diagnosticExport";

it("native cancellation does not invoke any file command", async () => {
  mocks.invokeLocal.mockClear();
  mocks.save.mockResolvedValue(null);
  expect(await saveDiagnosticLocally("{}", "abc")).toBe(false);
  expect(mocks.invokeLocal).not.toHaveBeenCalled();
});
it("uses local IPC and accepts the actual null success return", async () => {
  mocks.invokeLocal.mockReset().mockResolvedValue(null);
  mocks.save.mockResolvedValue("/chosen/diagnostic.json");
  expect(await saveDiagnosticLocally('{"rows":[]}', "sogou-english")).toBe(true);
  expect(mocks.invokeLocal).toHaveBeenCalledExactlyOnceWith("db_export_file", {
    path: "/chosen/diagnostic.json",
    text: '{"rows":[]}',
  });
});
it("propagates a local save failure so the UI can offer retry", async () => {
  mocks.save.mockResolvedValue("/chosen/diagnostic.json");
  mocks.invokeLocal.mockRejectedValue(new Error("failed"));
  await expect(saveDiagnosticLocally("{}", "abc")).rejects.toThrow("failed");
});
