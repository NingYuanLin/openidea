import { chromium } from "@playwright/test";
import fs from "node:fs";
const evidence = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const source = evidence.source.split("\n");
const groups = [
  {
    path: "/Bean.java",
    usages: evidence.cases.name.after.map(({ location, kind }) => ({
      path: "/Bean.java",
      line: location.range.start.line,
      col: location.range.start.character,
      endCol: location.range.end.character,
      text: source[location.range.start.line],
      kind,
    })),
  },
];
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
await page.goto(process.env.OPENIDEA_TEST_URL ?? "http://localhost:1450");
await page.getByRole("tree", { name: "Project" }).waitFor();
await page.evaluate(async (groups) => {
  const { useUsagesPopup } = await import("/src/features/code-insight/usages.ts");
  useUsagesPopup.setState({ open: true, anchor: { x: 940, y: 600 }, symbol: "name", groups, note: null });
}, groups);
const dialog = page.getByRole("dialog", { name: "Usages", exact: true });
await dialog.waitFor();
for (const kind of ["getter", "setter", "field"]) {
  await dialog.getByRole("combobox", { name: "Usage kind" }).selectOption(kind);
  await dialog.getByText("2 of 6 found", { exact: true }).waitFor();
  const box = await dialog.boundingBox();
  if (box.x < 0 || box.x + box.width > 1001 || box.y < 0 || box.y + box.height > 701)
    throw new Error(`Overflow ${JSON.stringify(box)}`);
}
await page.screenshot({ path: `${process.argv[3] ?? "/tmp"}/usages-browser.png` });
await dialog.getByRole("button", { name: /Open in Find Window/ }).click();
await page.getByRole("combobox", { name: "Usage kind" }).waitFor();
await page.getByRole("combobox", { name: "Usage kind" }).selectOption("getter");
await page.screenshot({ path: `${process.argv[3] ?? "/tmp"}/usages-find-browser.png` });
console.log("PASS real Chromium: category counts, edge placement, popup to Find transfer");
await browser.close();
