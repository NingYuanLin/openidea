import { save } from "@tauri-apps/plugin-dialog";
import { invokeLocal } from "@/platform/tauriCore";
import { exportDiagnostic, type DiagnosticLabel } from "./diagnostic";

export function saveDiagnosticLocally(json: string, label: DiagnosticLabel) {
  return exportDiagnostic(
    json,
    () =>
      save({
        defaultPath: `terminal-diagnostic-${label}.json`,
        filters: [{ name: "Diagnostic JSON", extensions: ["json"] }],
      }),
    async (path, text) => {
      // Direct local IPC returns null on success, rejects on failure. Do not route to a remote project.
      await invokeLocal("db_export_file", { path, text });
    },
  );
}
