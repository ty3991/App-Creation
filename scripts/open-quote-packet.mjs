import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { readPacket } from "../shared/quote-packet.js";
import { cadPrompt } from "../shared/schema.js";

const [path, destination, ...references] = process.argv.slice(2);
if (!path || !destination)
  throw Error(
    "Usage: node scripts/open-quote-packet.mjs PACKET.txt OUTPUT.stl-or-txt [REFERENCE_FILES...]",
  );
const packet = readPacket(await readFile(path, "utf8"));
if (packet.mode === "configure") {
  const { generate, stl } = await import("../shared/geometry.js");
  const mesh = generate(packet.family, packet.params);
  await writeFile(destination, stl(mesh), { flag: "wx" });
  console.log(
    JSON.stringify(
      {
        id: packet.id,
        version: packet.version,
        settings: packet.params,
        checks: mesh.checks,
        exceedsX1Carbon: mesh.checks.dimensionsMm.some((value) => value > 256),
      },
      null,
      2,
    ),
  );
} else {
  const { guidedIntake } = await import("../shared/intake-rules.js");
  const snapshot = {
    ...packet,
    questions: guidedIntake(packet).questions,
    attachments: references.map((path) => ({ name: basename(path) })),
  };
  await writeFile(destination, cadPrompt(snapshot), { flag: "wx" });
  console.log(
    `Wrote CAD brief for ${packet.id}. Reference files are included by filename.`,
  );
}
