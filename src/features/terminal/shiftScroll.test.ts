import { expect, it } from "vitest";
import { ShiftScrollGuard } from "./shiftScroll";

const shift = (code = "ShiftLeft") => new KeyboardEvent("keydown", { code, key: "Process", keyCode: 229 });
const setup = (value = true) => {
  const term = { options: { scrollOnUserInput: value } };
  return { term, guard: new ShiftScrollGuard(term) };
};

it.each(["ShiftLeft", "ShiftRight"])(
  "suppresses only the synchronous %s 229 interval without changing the event",
  async (code) => {
    const { term, guard } = setup();
    const event = shift(code);
    guard.beforeKey(event);
    expect(term.options.scrollOnUserInput).toBe(false);
    expect(event.keyCode).toBe(229);
    expect(event.defaultPrevented).toBe(false);
    await Promise.resolve();
    expect(term.options.scrollOnUserInput).toBe(true);
  },
);

it.each([
  new KeyboardEvent("keydown", { code: "ShiftLeft", keyCode: 16 }),
  new KeyboardEvent("keyup", { code: "ShiftLeft", keyCode: 229 }),
  new KeyboardEvent("keydown", { code: "KeyA", keyCode: 229 }),
  new KeyboardEvent("keydown", { code: "Unidentified", keyCode: 229 }),
  new KeyboardEvent("keydown", { code: "KeyC", keyCode: 67, ctrlKey: true }),
])("leaves ordinary modifiers, text, unidentified IME and controls alone", async (event) => {
  const { term, guard } = setup();
  guard.beforeKey(event);
  expect(term.options.scrollOnUserInput).toBe(true);
  await Promise.resolve();
  expect(term.options.scrollOnUserInput).toBe(true);
});

it("coalesces repeated Shift events and keeps configured false", async () => {
  const { term, guard } = setup();
  guard.beforeKey(shift());
  guard.beforeKey(shift("ShiftRight"));
  await Promise.resolve();
  expect(term.options.scrollOnUserInput).toBe(true);
  term.options.scrollOnUserInput = false;
  guard.beforeKey(shift());
  await Promise.resolve();
  expect(term.options.scrollOnUserInput).toBe(false);
});

it("restores before reentrant ordinary input and ignores the older microtask", async () => {
  const { term, guard } = setup();
  guard.beforeKey(shift());
  guard.beforeKey(new KeyboardEvent("keydown", { code: "KeyA", keyCode: 65 }));
  expect(term.options.scrollOnUserInput).toBe(true);
  guard.beforeKey(shift());
  expect(term.options.scrollOnUserInput).toBe(false);
  await Promise.resolve();
  expect(term.options.scrollOnUserInput).toBe(true);
});

it("preserves newer settings, including a write of the same false value", async () => {
  const { term, guard } = setup();
  guard.beforeKey(shift());
  guard.beforeOptionsChange();
  term.options.scrollOnUserInput = false;
  await Promise.resolve();
  expect(term.options.scrollOnUserInput).toBe(false);
  term.options.scrollOnUserInput = true;
  guard.beforeKey(shift());
  term.options.scrollOnUserInput = true;
  await Promise.resolve();
  expect(term.options.scrollOnUserInput).toBe(true);
});

it("restores on disposal and never touches a disposed terminal or a new instance", async () => {
  const { term, guard } = setup();
  guard.beforeKey(shift());
  guard.dispose();
  expect(term.options.scrollOnUserInput).toBe(true);
  Object.defineProperty(term, "options", {
    get() {
      throw new Error("disposed terminal accessed");
    },
  });
  guard.beforeKey(shift());
  guard.dispose();
  const next = setup();
  next.guard.beforeKey(shift());
  await Promise.resolve();
  expect(next.term.options.scrollOnUserInput).toBe(true);
});
