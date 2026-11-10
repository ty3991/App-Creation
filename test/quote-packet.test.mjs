import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server.mjs";
import { readPacket, writePacket } from "../shared/quote-packet.js";
import { families, VERSION } from "../shared/schema.js";

test("inbox handoff round-trips exact version and geometry settings and rejects incompatible packets", () => {
  const settings = {
    mode: "configure",
    family: "plate",
    params: {
      ...families.plate.defaults,
      width: 139.7,
      depth: 88.9,
      spacingX: 95.25,
      spacingY: 50.8,
      holeDiameter: 6.35,
    },
    quantity: 2,
    material: "PETG",
    finish: "unsure",
    color: "#087d82",
    notes: "Reference photo attached separately.",
  };
  const id = "d".repeat(32);
  const text = writePacket(settings, id);
  assert.deepEqual(readPacket(text.replaceAll("\n", "\r\n") + "\r\n"), {
    ...settings,
    id,
    version: VERSION,
    units: "mm",
  });
  assert.throws(
    () => readPacket(text.replace(VERSION, "old-version")),
    /Unsupported generator version/,
  );
  assert.throws(
    () =>
      writePacket(
        { ...settings, params: { ...settings.params, spacingX: 200 } },
        id,
      ),
    /Hole pattern/,
  );
});

test("local quote intake rejects exhausted upload storage and protects the previously accepted file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pd-quota-"));
  const origin = "http://localhost";
  process.env.MAX_UPLOAD_STORAGE_MB = "0.0001";
  const app = await createApp({ dataDir: dir, origin });
  delete process.env.MAX_UPLOAD_STORAGE_MB;
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const cookie = async () =>
    (await fetch(base + "/api/session")).headers
      .get("set-cookie")
      .split(";")[0];
  const data =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=";
  try {
    const first = await cookie();
    const second = await cookie();
    const upload = () =>
      fetch(base + "/api/uploads", {
        method: "POST",
        headers: {
          Cookie: first,
          Origin: origin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "fixture.png", data }),
      });
    const saved = await upload();
    assert.equal(saved.status, 201);
    const { id } = await saved.json();
    const rejected = await upload();
    assert.equal(rejected.status, 507);
    assert.match(await rejected.text(), /storage is full/);
    assert.equal(
      (await fetch(base + "/api/files/" + id, { headers: { Cookie: second } }))
        .status,
      403,
    );
    const download = await fetch(base + "/api/files/" + id, {
      headers: { Cookie: first },
    });
    assert.equal(download.status, 200);
    assert.deepEqual(
      Buffer.from(await download.arrayBuffer()),
      Buffer.from(data, "base64"),
    );
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
    app.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
