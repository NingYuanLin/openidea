import { EVENTS, safeEvent, observeEarly, eventOrder, type Fields, type DiagnosticTarget } from "./diagnosticEarly";
export { safeEvent } from "./diagnosticEarly";
import type { Terminal } from "@xterm/xterm";

export const DIAGNOSTIC_BASELINE = "f48cd85d0b2e6bc11b4661ab483b8c64887272a5";
export const DIAGNOSTIC_LIMIT = 6000;
export type DiagnosticLabel = "builtin-chinese" | "sogou-chinese" | "sogou-english" | "abc";
const LABELS: DiagnosticLabel[] = ["builtin-chinese", "sogou-chinese", "sogou-english", "abc"];
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
  private controls = new Map<DiagnosticTarget, HTMLInputElement | HTMLTextAreaElement>();
  registerControl(target: Exclude<DiagnosticTarget, "terminal">, element: HTMLInputElement | HTMLTextAreaElement) {
    this.controls.set(target, element);
    const listener = (event: Event) => this.recordDom(event, "target-capture");
    for (const type of EVENTS) element.addEventListener(type, listener, true);
    return () => {
      for (const type of EVENTS) element.removeEventListener(type, listener, true);
      if (this.controls.get(target) === element) this.controls.delete(target);
    };
  }
  private classify(event: Event): DiagnosticTarget | null {
    for (const [target, element] of this.controls) if (event.target === element) return target;
    return event.target instanceof Node && this.term.element?.contains(event.target) ? "terminal" : null;
  }
  private recordDom(event: Event, stage: string, fields = safeEvent(event), order = eventOrder(event)) {
    const target = this.classify(event);
    if (target)
      this.record(`${event.type}:${stage}`, {
        ...fields,
        target,
        order,
        targetLength:
          event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
            ? event.target.value.length
            : 0,
      });
  }
  focusedTarget(): DiagnosticTarget | null {
    if (document.activeElement === this.term.textarea) return "terminal";
    for (const [target, element] of this.controls) if (document.activeElement === element) return target;
    return null;
  }
  focusTarget(target: DiagnosticTarget) {
    const element = target === "terminal" ? this.term.textarea : this.controls.get(target);
    if (!element?.isConnected || this.disposed) return false;
    if (target === "styled-textarea" && this.term.textarea) {
      // Copy only explicit IME/accessibility attributes and fixed style properties, never value/id/path.
      for (const name of ["autocorrect", "autocapitalize", "spellcheck", "aria-multiline", "tabindex"]) {
        const value = this.term.textarea.getAttribute(name);
        if (value === null) element.removeAttribute(name);
        else element.setAttribute(name, value);
      }
      const computed = getComputedStyle(this.term.textarea);
      for (const name of [
        "position",
        "opacity",
        "width",
        "height",
        "line-height",
        "z-index",
        "white-space",
        "overflow",
        "resize",
        "padding",
        "border",
        "margin",
        "font-family",
        "font-size",
      ]) {
        element.style.setProperty(name, computed.getPropertyValue(name));
      }
      element.style.left = "0px";
      element.style.top = "0px";
      element.readOnly = this.term.textarea.readOnly;
    }
    element.focus({ preventScroll: true });
    const success = document.activeElement === element;
    this.record("target-focus", { target, success });
    return success;
  }
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
      this.undo.push(observeEarly((event, fields, order) => this.recordDom(event, "window-early", fields, order)));
      const targetListener = (event: Event) => this.recordDom(event, "target-capture");
      for (const type of EVENTS) {
        this.term.textarea.addEventListener(type, targetListener, true);
        this.undo.push(() => this.term.textarea?.removeEventListener(type, targetListener, true));
      }
      const host = this.term.element!;
      for (const type of EVENTS) {
        for (const capture of [true, false]) {
          const listener = (event: Event) => this.recordDom(event, capture ? "capture" : "bubble");
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
        schema: 2,
        diagnostic: "sogou-shift-controls-v2",
        baseline: DIAGNOSTIC_BASELINE,
        legend: {
          stages:
            "window-early precedes application listeners; terminal root capture precedes xterm target; target-capture on terminal is registered after xterm",
          target:
            "plain-input / plain-textarea / styled-textarea (copied attributes and cell size, local position, no xterm handlers) / terminal",
          state:
            "composing/sendingComposition/viewport/base/selectionLength/textareaLength always describe this terminal; targetLength describes the event target",
          order:
            "same DOM event shares order across stages; seq orders all observations; label is manually selected, not detected",
          trust: "isTrusted distinguishes dispatchEvent; it does not establish human origin",
        },
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
    this.controls.clear();
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
