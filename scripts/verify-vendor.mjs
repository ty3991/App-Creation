import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../", import.meta.url);
const hashes = JSON.parse(
  await readFile(new URL("vendor/integrity.json", root), "utf8"),
);
for (const [file, expected] of Object.entries(hashes)) {
  const actual = createHash("sha256")
    .update(await readFile(new URL(file, root)))
    .digest("hex");
  if (actual !== expected) throw Error("Vendor integrity mismatch: " + file);
}
console.log("Pinned vendor files verified.");
