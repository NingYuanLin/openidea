import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const hashes = {
  "lib/xterm.mjs": "b336ec65a086c056d4804b3d4c2347da5663d3f23c3f25be866467bd8857ad59",
  "lib/xterm.js": "14903579ff54664cd72f8e8699e6961a6272c21863ec1c3b118cdc8af5d4a972",
};
for (const [file, hash] of Object.entries(hashes)) {
  assert.equal(
    createHash("sha256")
      .update(readFileSync(`node_modules/@xterm/xterm/${file}`))
      .digest("hex"),
    hash,
    `Must use original xterm 6.0.0: ${file}`,
  );
}
assert.equal(JSON.parse(readFileSync("node_modules/@xterm/xterm/package.json", "utf8")).version, "6.0.0");
console.log("Verified original xterm 6.0.0 ESM and UMD production bundle hashes.");
