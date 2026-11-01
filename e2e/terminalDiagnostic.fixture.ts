import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { TerminalDiagnostic } from "../src/features/terminal/diagnostic";

declare global {
  interface Window {
    diagnosticTest: { terminal: Terminal; diagnostic: TerminalDiagnostic; data: string[]; ready: boolean };
  }
}
const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
terminal.open(document.querySelector("#terminal")!);
const diagnostic = new TerminalDiagnostic(terminal, Number(new URLSearchParams(location.search).get("limit")) || 6000);
const data: string[] = [];
terminal.onData((s) => data.push(s));
window.diagnosticTest = { terminal, diagnostic, data, ready: false };
terminal.write("line abcdefghijklmnopqrstuvwxyz\r\n".repeat(300), () => {
  terminal.focus();
  terminal.scrollToLine(110);
  terminal.select(2, 112, 8);
  window.diagnosticTest.ready = true;
});
