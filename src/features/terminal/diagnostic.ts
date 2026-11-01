import type { Terminal } from "@xterm/xterm";

export const DIAGNOSTIC_BASELINE = "f48cd85d0b2e6bc11b4661ab483b8c64887272a5";
export const DIAGNOSTIC_LIMIT = 6000;
export type DiagnosticLabel = "builtin-chinese" | "sogou-chinese" | "sogou-english" | "abc";
const LABELS: DiagnosticLabel[] = ["builtin-chinese", "sogou-chinese", "sogou-english", "abc"];
const KEYS = new Set([
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "CapsLock",
  "Escape",
  "Enter",
  "Tab",
  "Backspace",
  "Delete",
  "Process",
  "Unidentified",
]);
const CODES = new Set([
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  "CapsLock",
  "Escape",
  "Enter",
  "Tab",
  "Backspace",
  "Delete",
]);
const KEYCODES = new Set([8, 9, 13, 16, 17, 18, 20, 27, 46, 91, 92, 93, 229]);
const INPUT_TYPES = new Set([
  "insertText",
  "insertCompositionText",
  "insertFromComposition",
  "deleteCompositionText",
  "insertFromPaste",
  "deleteContentBackward",
  "deleteContentForward",
]);
const EVENTS = [
  "keydown",
  "keyup",
  "keypress",
  "beforeinput",
  "input",
  "compositionstart",
  "compositionupdate",
  "compositionend",
  "focus",
  "blur",
  "mousedown",
  "mouseup",
  "wheel",
  "paste",
] as const;
type Fields = Record<string, string | number | boolean | null>;
type Target = Record<string, unknown>;
type Source =
  | "keydown"
  | "keyup"
  | "keypress"
  | "input"
  | "composition-key"
  | "composition-start"
  | "composition-update"
  | "composition-end"
  | "composition-finalize"
  | "textarea-diff"
  | "user-data"
  | "binary-data"
  | "mouse-report"
  | "public-bottom"
  | "public-lines"
  | "public-line"
  | "focus"
  | "selection-drag"
  | "buffer-output-scroll"
  | "bottom"
  | "lines"
  | "viewport";

/** Allowlist before retaining anything. Never retain an Event, text, arbitrary key or stack. */
export function safeEvent(event: Event): Fields {
  const e = event as KeyboardEvent & InputEvent & CompositionEvent;
  return {
    trusted: event.isTrusted,
    key: KEYS.has(e.key) ? e.key : "redacted",
    code: CODES.has(e.code) ? e.code : "redacted",
    keyCode: KEYCODES.has(e.keyCode) ? e.keyCode : null,
    shift: !!e.shiftKey,
    ctrl: !!e.ctrlKey,
    alt: !!e.altKey,
    meta: !!e.metaKey,
    isComposing: !!e.isComposing,
    inputType: INPUT_TYPES.has(e.inputType) ? e.inputType : "other",
    dataLength: typeof e.data === "string" ? e.data.length : 0,
  };
}

export function safeRuntime() {
  const ua = navigator.userAgent;
  const engine = /AppleWebKit\/(\d+(?:\.\d+){0,3})/.exec(ua)?.[1] ?? "unknown";
  const chromium = /(?:Chrome|Chromium)\/(\d+(?:\.\d+){0,3})/.exec(ua)?.[1] ?? null;
  return {
    engine,
    chromium,
    platform: /Mac/.test(navigator.platform) ? "macos" : /Win/.test(navigator.platform) ? "windows" : "other",
  };
}

export class TerminalDiagnostic {
  private rows: { seq: number; ms: number; event: string; source: Source | "observer"; fields: Fields }[] = [];
  private undo: (() => void)[] = [];
  private subscribers = new Set<() => void>();
  private sources: Source[] = [];
  private started = 0;
  private label: DiagnosticLabel = "builtin-chinese";
  private state = { active: false, reason: "off", count: 0 };
  private disposed = false;
  constructor(
    private term: Terminal,
    private limit = DIAGNOSTIC_LIMIT,
  ) {}
  subscribe = (fn: () => void) => {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  };
  snapshot = () => this.state;
  private notify(active: boolean, reason: string) {
    this.state = { active, reason, count: this.rows.length };
    this.subscribers.forEach((fn) => fn());
  }
  private core() {
    return (this.term as unknown as { _core: Target })._core;
  }
  private record(event: string, fields: Fields = {}) {
    if (!this.state.active) return;
    const core = this.core();
    const helper = core._compositionHelper as Target;
    const buffer = this.term.buffer.active;
    this.rows.push({
      seq: this.rows.length,
      ms: Math.round((performance.now() - this.started) * 1000) / 1000,
      event,
      source: this.sources.at(-1) ?? "observer",
      fields: {
        composing: !!helper._isComposing,
        sendingComposition: !!helper._isSendingComposition,
        keyDownSeen: !!core._keyDownSeen,
        keyPressHandled: !!core._keyPressHandled,
        viewport: buffer.viewportY,
        base: buffer.baseY,
        cursorY: buffer.cursorY,
        selectionLength: this.term.getSelection().length,
        textareaLength: this.term.textarea?.value.length ?? 0,
        focused: document.activeElement === this.term.textarea,
        scrollOnUserInput: !!this.term.options.scrollOnUserInput,
        macOptionIsMeta: !!this.term.options.macOptionIsMeta,
        ...fields,
      },
    });
    if (this.rows.length >= this.limit) this.stop("buffer-limit");
  }
  private hook(target: Target, name: string, source: Source) {
    const original = target[name];
    if (typeof original !== "function") throw new Error("Unsupported xterm diagnostic interface");
    // oxlint-disable-next-line typescript/no-this-alias -- Preserve the original method's dynamic receiver.
    const observer = this;
    const wrapped = function (this: unknown, ...args: unknown[]) {
      if (!observer.state.active) return Reflect.apply(original, this, args);
      const parent = observer.sources.at(-1) ?? "observer";
      observer.sources.push(source);
      const fields: Fields = { caller: parent };
      if (source === "user-data" || source === "binary-data") {
        fields.length = typeof args[0] === "string" ? args[0].length : 0;
        fields.wasUserInput = args[1] === true;
      }
      observer.record("enter", fields);
      let result: unknown;
      try {
        result = Reflect.apply(original, this, args);
        return result;
      } finally {
        observer.record("leave", source === "composition-key" ? { continueKey: result === true } : {});
        observer.sources.pop();
      }
    };
    target[name] = wrapped;
    this.undo.push(() => {
      if (target[name] === wrapped) target[name] = original;
    });
  }
  start(label: DiagnosticLabel) {
    if (this.disposed || !this.term.textarea || !LABELS.includes(label)) return false;
    this.stop();
    this.rows = [];
    this.sources = [];
    this.label = label;
    this.started = performance.now();
    this.notify(true, "recording");
    try {
      const core = this.core();
      for (const [name, source] of Object.entries({
        _keyDown: "keydown",
        _keyUp: "keyup",
        _keyPress: "keypress",
        _inputEvent: "input",
        scrollToBottom: "bottom",
        scrollLines: "lines",
        focus: "focus",
      }))
        this.hook(core, name, source as Source);
      const helper = core._compositionHelper as Target;
      for (const [name, source] of Object.entries({
        keydown: "composition-key",
        compositionstart: "composition-start",
        compositionupdate: "composition-update",
        compositionend: "composition-end",
        _finalizeComposition: "composition-finalize",
        _handleAnyTextareaChanges: "textarea-diff",
      }))
        this.hook(helper, name, source as Source);
      this.hook(core.coreService as Target, "triggerDataEvent", "user-data");
      this.hook(core.coreService as Target, "triggerBinaryEvent", "binary-data");
      this.hook(core.coreMouseService as Target, "triggerMouseEvent", "mouse-report");
      this.hook(this.term as unknown as Target, "scrollToBottom", "public-bottom");
      this.hook(this.term as unknown as Target, "scrollLines", "public-lines");
      this.hook(this.term as unknown as Target, "scrollToLine", "public-line");
      this.hook(core._selectionService as Target, "_dragScroll", "selection-drag");
      this.hook(core._bufferService as Target, "scroll", "buffer-output-scroll");
      this.hook(core._viewport as Target, "scrollToLine", "viewport");
      const host = this.term.element!;
      for (const type of EVENTS) {
        for (const capture of [true, false]) {
          const listener = (event: Event) => this.record(`${type}:${capture ? "capture" : "bubble"}`, safeEvent(event));
          host.addEventListener(type, listener, capture);
          this.undo.push(() => host.removeEventListener(type, listener, capture));
        }
      }
      const scroll = this.term.onScroll(() => this.record("scroll"));
      this.undo.push(() => scroll.dispose());
      const selection = this.term.onSelectionChange(() => this.record("selection"));
      this.undo.push(() => selection.dispose());
      const close = () => this.dispose();
      window.addEventListener("pagehide", close);
      window.addEventListener("beforeunload", close);
      this.undo.push(() => {
        window.removeEventListener("pagehide", close);
        window.removeEventListener("beforeunload", close);
      });
      this.record("start");
      return true;
    } catch {
      this.stop("unsupported-runtime");
      return false;
    }
  }
  stop(reason = "stopped") {
    for (const undo of this.undo.splice(0).reverse()) undo();
    this.notify(false, reason);
  }
  clear() {
    this.stop("cleared");
    this.rows = [];
    this.notify(false, "cleared");
  }
  exportJson() {
    return JSON.stringify(
      {
        schema: 1,
        diagnostic: "sogou-shift-original-v1",
        baseline: DIAGNOSTIC_BASELINE,
        build: import.meta.env.VITE_DIAGNOSTIC_COMMIT ?? "local-uncommitted",
        xterm: "6.0.0-stock",
        runtime: safeRuntime(),
        label: this.label,
        reason: this.state.reason,
        limit: this.limit,
        rows: this.rows,
      },
      null,
      2,
    );
  }
  dispose() {
    this.stop("disposed");
    this.rows = [];
    this.disposed = true;
    this.subscribers.clear();
  }
}

/** Dialog cancellation performs no write; the native adapter must explicitly bypass remote routing. */
export async function exportDiagnostic(
  json: string,
  choose: () => Promise<string | null>,
  write: (path: string, text: string) => Promise<void>,
) {
  const path = await choose();
  if (!path) return false;
  await write(path, json);
  return true;
}
