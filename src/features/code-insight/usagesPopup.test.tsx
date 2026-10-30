import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const calls: string[] = [];
const loc = { path: "/p/b.ts", range: { start: { line: 1, col: 4 }, end: { line: 1, col: 8 } } };
vi.mock("./ipc", async (orig) => ({
  ...(await orig<typeof import("./ipc")>()),
  caretContext: () => ({ doc: 1, path: "/p/a.ts", line: 0, col: 0, word: "used", view: null }),
  lspRequest: async () => ({ locations: [loc], incomplete: null }),
  readManyFileLines: async () => new Map([["/p/b.ts", ["", "    used();"]]]),
  openLocation: async (path: string, line: number) => void calls.push(`open ${path}:${line}`),
  hint: (text: string) => void calls.push(`hint ${text}`),
}));
const showUsageResults = vi.fn();
vi.mock("./usages", async (orig) => ({
  ...(await orig<typeof import("./usages")>()),
  showUsageResults: (a: unknown) => showUsageResults(a),
}));

const { UsagesPopup, filterUsages, usageLocations } = await import("./UsagesPopup");
const { showUsagesPopup, useUsagesPopup } = await import("./usages");

const usage = (path: string, line: number, text: string) => ({ path, line, col: 0, endCol: 3, text });
const groups = [
  { path: "/p/a.ts", usages: [usage("/p/a.ts", 2, "foo(order)"), usage("/p/a.ts", 5, "foo(cart)")] },
  { path: "/p/b.ts", usages: [usage("/p/b.ts", 1, "foo(order, 2)")] },
];

function open() {
  render(<UsagesPopup />);
  act(() => useUsagesPopup.setState({ open: true, anchor: { x: 0, y: 0 }, symbol: "foo", groups, note: null }));
  return screen.getByRole("dialog", { name: "Usages" }).querySelector<HTMLElement>("[tabindex='0']")!;
}

afterEach(() => act(() => useUsagesPopup.setState({ open: false })));

describe("Show Usages popup", () => {
  it("filters by typing; Esc clears the filter, then closes", () => {
    const body = open();
    expect(screen.getAllByRole("option")).toHaveLength(3);
    for (const key of "cart") fireEvent.keyDown(body, { key });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByText("1 of 3 found")).toBeInTheDocument();
    fireEvent.keyDown(body, { key: "Escape" });
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(useUsagesPopup.getState().open).toBe(true);
    fireEvent.keyDown(body, { key: "Escape" });
    expect(useUsagesPopup.getState().open).toBe(false);
  });

  it("matches file names and line text", () => {
    const all = groups.flatMap((g) => g.usages);
    expect(filterUsages(all, "b.ts")).toHaveLength(1);
    expect(filterUsages(all, "ORDER")).toHaveLength(2);
    expect(filterUsages(all, "")).toBe(all);
  });

  it("Open in Find Window moves the found usages instead of searching again", () => {
    open();
    fireEvent.click(screen.getByText(/Open in Find Window/));
    expect(useUsagesPopup.getState().open).toBe(false);
    expect(showUsageResults).toHaveBeenCalledWith({
      symbol: "foo",
      note: null,
      classified: expect.arrayContaining([expect.objectContaining({ kind: "unknown" })]),
      locations: [
        { path: "/p/a.ts", range: { start: { line: 2, col: 0 }, end: { line: 2, col: 3 } } },
        { path: "/p/a.ts", range: { start: { line: 5, col: 0 }, end: { line: 5, col: 3 } } },
        { path: "/p/b.ts", range: { start: { line: 1, col: 0 }, end: { line: 1, col: 3 } } },
      ],
    });
  });

  it("the preview pane toggles", () => {
    open();
    expect(screen.queryByRole("region", { name: "Preview" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show Preview" }));
    expect(screen.getByRole("region", { name: "Preview" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show Preview" }));
  });

  it("a single usage is opened with a hint in its editor", async () => {
    calls.length = 0;
    await showUsagesPopup();
    expect(calls).toEqual(["open /p/b.ts:1", "hint Only one usage in Project Files"]);
    expect(useUsagesPopup.getState().open).toBe(false);
  });
});

describe("semantic usage categories", () => {
  it("separates calls on the same line and preserves categories when opening the Find window", () => {
    open();
    const text = "b.setName(b.getName())";
    act(() =>
      useUsagesPopup.setState({
        groups: [
          {
            path: "/p/Bean.java",
            usages: [
              { path: "/p/Bean.java", line: 2, col: 2, endCol: 9, text, kind: "setter" },
              { path: "/p/Bean.java", line: 2, col: 12, endCol: 19, text, kind: "getter" },
              { path: "/p/Bean.java", line: 3, col: 0, endCol: 4, text: "name", kind: "field" },
              { path: "/p/Bean.java", line: 4, col: 0, endCol: 4, text: "other" },
            ],
          },
        ],
      }),
    );
    const select = screen.getByRole("combobox", { name: "Usage kind" });
    for (const kind of ["getter", "setter", "field", "unknown"]) {
      fireEvent.change(select, { target: { value: kind } });
      expect(screen.getByText("1 of 4 found")).toBeInTheDocument();
    }
    fireEvent.click(screen.getByText(/Open in Find Window/));
    expect(showUsageResults).toHaveBeenLastCalledWith(
      expect.objectContaining({
        classified: expect.arrayContaining([
          expect.objectContaining({ kind: "getter" }),
          expect.objectContaining({ kind: "setter" }),
          expect.objectContaining({ kind: "field" }),
          expect.objectContaining({ kind: "unknown" }),
        ]),
      }),
    );
  });
});

it("keeps unknown results visible after classified results are replaced", () => {
  open();
  act(() =>
    useUsagesPopup.setState({
      groups: [{ path: "/Bean.java", usages: [{ ...usage("/Bean.java", 1, "getName()"), kind: "getter" }] }],
    }),
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Usage kind" }), { target: { value: "getter" } });
  act(() => useUsagesPopup.setState({ groups }));
  expect(screen.queryByRole("combobox", { name: "Usage kind" })).toBeNull();
  expect(screen.getAllByRole("option")).toHaveLength(3);
});

it("preserves an exact multiline semantic range when transferring to Find", () => {
  const sourceLocation = { path: "/Bean.java", range: { start: { line: 1, col: 0 }, end: { line: 2, col: 10 } } };
  expect(
    usageLocations([{ path: "/Bean.java", usages: [{ ...usage("/Bean.java", 1, "b.value()"), sourceLocation }] }]),
  ).toEqual([sourceLocation]);
});
