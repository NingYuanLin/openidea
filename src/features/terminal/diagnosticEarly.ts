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
export const EVENTS = [
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
export type Fields = Record<string, string | number | boolean | null>;

const keyCodeGetter =
  typeof KeyboardEvent === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(KeyboardEvent.prototype, "keyCode")?.get;
/** Allowlist before retaining anything. Never retain an Event, text, arbitrary key or stack. */
export function safeEvent(event: Event): Fields {
  try {
    return readEvent(event);
  } catch {
    return { unreadable: true };
  }
}
function readEvent(event: Event): Fields {
  const e = event as KeyboardEvent & InputEvent & CompositionEvent;
  const control = KEYS.has(e.key) || CODES.has(e.code) || e.keyCode === 229;
  const numeric = (value: unknown) => (control && typeof value === "number" && KEYCODES.has(value) ? value : null);
  let prototypeKeyCode: unknown = null;
  try {
    prototypeKeyCode = keyCodeGetter?.call(event);
  } catch {
    /* Non-keyboard event or unavailable getter. */
  }
  return {
    trusted: event.isTrusted,
    key: KEYS.has(e.key) ? e.key : "redacted",
    code: CODES.has(e.code) ? e.code : "redacted",
    keyCode: numeric(e.keyCode),
    which: numeric(e.which),
    prototypeKeyCode: numeric(prototypeKeyCode),
    ownKeyCode: Object.hasOwn(event, "keyCode"),
    phase: event.eventPhase,
    shift: !!e.shiftKey,
    ctrl: !!e.ctrlKey,
    alt: !!e.altKey,
    meta: !!e.metaKey,
    isComposing: !!e.isComposing,
    inputType: INPUT_TYPES.has(e.inputType) ? e.inputType : "other",
    dataLength: typeof e.data === "string" ? e.data.length : 0,
  };
}

export type DiagnosticTarget = "plain-input" | "plain-textarea" | "styled-textarea" | "terminal";
type Observer = (event: Event, fields: Fields, order: number) => void;
const observers = new Set<Observer>();
let order = 0;
const orders = new WeakMap<Event, number>();
export function eventOrder(event: Event) {
  return orders.get(event) ?? null;
}
export function observeEarly(observer: Observer) {
  observers.add(observer);
  return () => {
    observers.delete(observer);
  };
}
// Imported first by main.tsx, before app dispatcher/feature modules. Dormant when OFF:
// no fields read, event references retained, or records buffered without a subscriber.
if (typeof window !== "undefined") {
  for (const type of EVENTS)
    window.addEventListener(
      type,
      (event) => {
        if (!observers.size) return;
        const id = ++order;
        orders.set(event, id);
        const fields = safeEvent(event);
        for (const observer of observers) observer(event, fields, id);
      },
      true,
    );
}
