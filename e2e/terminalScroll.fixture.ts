/// <reference types="vite/client" />
import { Terminal } from "@xterm/xterm";
import umd from "@xterm/xterm/lib/xterm.js?raw";
import "@xterm/xterm/css/xterm.css";

declare global {
  interface Window {
    terminalScroll: { term: Terminal; data: string[]; ready: Promise<void> };
    Terminal: typeof Terminal;
  }
}
if (new URLSearchParams(location.search).get("bundle") === "umd") {
  const script = document.createElement("script");
  script.textContent = umd;
  document.head.append(script);
}
const Constructor = window.Terminal ?? Terminal;
const term = new Constructor({ cols: 80, rows: 24, allowProposedApi: true, scrollback: 1000 });
term.open(document.querySelector<HTMLElement>("#terminal")!);
const data: string[] = [];
term.onData((text) => data.push(text));
const ready = new Promise<void>((resolve) => {
  term.write(Array.from({ length: 300 }, (_, i) => `line ${i} abcdefghijklmnopqrstuvwxyz\r\n`).join(""), () => {
    term.focus();
    term.scrollToLine(110);
    term.select(5, 112, 12);
    resolve();
  });
});
window.terminalScroll = { term, data, ready };
