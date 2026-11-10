import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate, stl, checkMesh } from "../shared/geometry.js";
import {
  families,
  holeCenters,
  validate,
  cadPrompt,
  quoteTotal,
  VERSION,
} from "../shared/schema.js";
import { validateIntake, intake } from "../ai.mjs";
import { createApp } from "../server.mjs";
import { createOwner } from "../store.mjs";
test("all families produce closed, oriented, dimensionally correct meshes", () => {
  for (const [f, v] of Object.entries(families)) {
    const m = generate(f, v.defaults);
    assert.equal(m.checks.valid, true);
    assert.equal(m.checks.invalidEdges, 0);
    assert.equal(m.checks.degenerateFaces, 0);
    assert.equal(m.version, VERSION);
  }
});
test("plate STL independently decodes to identical bounds and all hole centers", () => {
  const p = {
    ...families.plate.defaults,
    width: 139.7,
    depth: 88.9,
    holeDiameter: 6.35,
    spacingX: 95.25,
    spacingY: 50.8,
  };
  const m = generate("plate", p),
    b = stl(m),
    d = new DataView(b.buffer),
    positions = [],
    indices = [];
  for (let i = 0; i < d.getUint32(80, true); i++)
    for (let v = 0; v < 3; v++) {
      const o = 84 + i * 50 + 12 + v * 12;
      positions.push(
        d.getFloat32(o, true),
        d.getFloat32(o + 4, true),
        d.getFloat32(o + 8, true),
      );
      indices.push(indices.length);
    }
  const checks = checkMesh({ positions, indices }, [
    p.width,
    p.depth,
    p.thickness,
  ]);
  assert.equal(checks.valid, true);
  for (const [x, y] of holeCenters(p)) {
    const wallPoints = [];
    for (let i = 0; i < positions.length; i += 3) {
      const radius = Math.hypot(positions[i] - x, positions[i + 1] - y);
      if (Math.abs(radius - p.holeDiameter / 2) < 0.001)
        wallPoints.push([positions[i], positions[i + 1], positions[i + 2]]);
    }
    assert.ok(wallPoints.length >= 64);
    const xs = wallPoints.map((p) => p[0]),
      ys = wallPoints.map((p) => p[1]);
    assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - x) < 0.001);
    assert.ok(Math.abs((Math.min(...ys) + Math.max(...ys)) / 2 - y) < 0.001);
    assert.ok(
      wallPoints.some((p) => p[2] === 0) && wallPoints.some((p) => p[2] === 5),
    );
  }
});
test("invalid dimension combinations and AI proposals are rejected", () => {
  assert.ok(
    validate("plate", { ...families.plate.defaults, spacingX: 200 }).spacingX,
  );
  assert.ok(validate("tray", { ...families.tray.defaults, height: 1 }).height);
  assert.throws(() =>
    validateIntake({
      reply: "x",
      questions: [],
      proposal: {
        family: "plate",
        reason: "x",
        parameters: [{ name: "spacingX", value: 9999 }],
      },
    }),
  );
  assert.throws(() =>
    validateIntake({
      reply: "x",
      questions: [],
      proposal: {
        family: "sign",
        reason: "x",
        parameters: [{ name: "__proto__", value: 1 }],
      },
    }),
  );
  assert.equal(
    validateIntake({
      reply: "Try a sign",
      questions: [],
      proposal: {
        family: "sign",
        reason: "Default sizes unconfirmed",
        parameters: [
          { name: "width", value: 190 },
          { name: "text", value: "HELLO" },
        ],
      },
    }).proposal.params.width,
    190,
  );
});
test("pricing uses confirmed arithmetic and CAD prompt preserves unknowns", () => {
  assert.deepEqual(
    quoteTotal({
      grams: 100,
      hours: 2,
      materialPerKg: 20,
      machinePerHour: 2,
      laborMinutes: 30,
      laborPerHour: 30,
      extras: 1,
      margin: 50,
    }),
    { cost: 22, price: 44 },
  );
  assert.throws(() => quoteTotal({ grams: NaN }));
  const p = cadPrompt({
    mode: "custom",
    notes: "Broken clip",
    brief: {},
    quantity: 1,
    material: "unsure",
    finish: "unsure",
    attachments: [{ name: "broken-clip.jpg" }],
  });
  assert.match(p, /UNCONFIRMED/);
  assert.match(p, /broken-clip.jpg/);
  assert.match(p, /editable parametric CAD source/);
  assert.match(p, /millimeters/);
});
test("AI outage and malformed structured output preserve manual intake", async () => {
  const r = await intake({ brief: {} }, [], {
    key: "test",
    fetcher: async () => {
      throw Error("offline");
    },
  });
  assert.equal(r.available, false);
  assert.equal(r.questions.length, 5);
  const m = await intake({ brief: {} }, [], {
    key: "test",
    fetcher: async () => ({
      ok: true,
      json: async () => ({
        status: "completed",
        output: [{ content: [{ type: "output_text", text: "{}" }] }],
      }),
    }),
  });
  assert.equal(m.available, false);
});

test("Responses contract accepts a validated proposal without applying it", async () => {
  let sent;
  const result = await intake(
    { notes: "A sign, 200 mm wide, HELLO", brief: {} },
    [],
    {
      key: "fixture-key",
      fetcher: async (url, options) => {
        assert.equal(url, "https://api.openai.com/v1/responses");
        sent = JSON.parse(options.body);
        return {
          ok: true,
          json: async () => ({
            status: "completed",
            output: [
              {
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({
                      reply: "Would this sign fit?",
                      questions: ["Confirm height and thickness."],
                      proposal: {
                        family: "sign",
                        reason:
                          "Height and thickness defaults are unconfirmed.",
                        parameters: [
                          { name: "width", value: 200 },
                          { name: "text", value: "HELLO" },
                        ],
                      },
                    }),
                  },
                ],
              },
            ],
          }),
        };
      },
    },
  );
  assert.equal(sent.model, "gpt-6.1-terra");
  assert.equal(sent.store, false);
  assert.equal(sent.text.format.type, "json_schema");
  assert.equal(sent.text.format.strict, true);
  assert.equal(result.available, true);
  assert.equal(result.proposal.params.width, 200);
  assert.equal(result.proposal.params.text, "HELLO");
});
test("persistent private quote lifecycle, retries, revisions and access controls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pd-tests-"));
  let app = await createApp({
    dataDir: dir,
    origin: "http://localhost",
    aiOptions: { disabled: true },
  });
  createOwner(app.db, "owner@example.test", "Test-only-password-123");
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  let base = "http://127.0.0.1:" + app.server.address().port;
  const request = async (path, data, cookie = "") => {
    const r = await fetch(base + path, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        Origin: "http://localhost",
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const ct = r.headers.get("content-type");
    return {
      status: r.status,
      cookie: r.headers.get("set-cookie")?.split(";")[0],
      data: ct?.includes("json") ? await r.json() : await r.arrayBuffer(),
    };
  };
  try {
    const a = await request("/api/session"),
      cookie = a.cookie;
    const login = await request("/api/owner/login", {
        email: "owner@example.test",
        password: "Test-only-password-123",
      }),
      owner = login.cookie;
    assert.equal(login.status, 200);
    assert.equal((await request("/api/owner/quotes")).status, 401);
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=";
    const upload = await request(
      "/api/uploads",
      { name: "broken-clip.png", data: png },
      cookie,
    );
    assert.equal(upload.status, 201);
    const other = (await request("/api/session")).cookie;
    assert.equal(
      (await request("/api/files/" + upload.data.id, undefined, other)).status,
      403,
    );
    assert.equal(
      (await request("/api/files/" + upload.data.id, undefined, owner)).status,
      200,
    );
    const p = {
      mode: "configure",
      family: "sign",
      params: { ...families.sign.defaults, width: 180, text: "TJ WORKSHOP" },
      quantity: 2,
      color: "#123456",
      material: "unsure",
      finish: "unsure",
      notes: "Phone sign test",
      brief: {},
      contact: {
        name: "Test Customer",
        email: "customer@example.test",
        phone: "",
      },
      attachmentIds: [],
      questions: [],
      mockup: null,
      previewImage: null,
      idempotencyKey: "test-idempotency-key-123",
    };
    const submitted = await request("/api/quotes", p, cookie);
    assert.equal(submitted.status, 201);
    const retry = await request("/api/quotes", p, cookie);
    assert.equal(retry.status, 200);
    assert.equal(retry.data.id, submitted.data.id);
    const newSessionRetry = await request("/api/quotes", p, other);
    assert.equal(newSessionRetry.status, 200);
    assert.equal(newSessionRetry.data.id, submitted.data.id);
    assert.equal(
      (await request("/api/uploads", { name: "bad.jpg", data: "AA==" }, cookie))
        .status,
      415,
    );
    assert.equal(
      (await request("/api/quotes", { ...p, quantity: 3 }, cookie)).status,
      409,
    );
    const qid = submitted.data.id,
      q = await request("/api/owner/quotes/" + qid, undefined, owner);
    assert.deepEqual(q.data.revisions[0].snapshot.params, p.params);
    assert.equal(q.data.revisions[0].snapshot.color, p.color);
    assert.equal(q.data.revisions[0].mesh.checks.valid, true);
    const original = q.data.revisions[0].id;
    assert.throws(() =>
      app.db
        .prepare("UPDATE revisions SET kind=? WHERE id=?")
        .run("owner", original),
    );
    const revised = await request(
      "/api/owner/quotes/" + qid + "/revisions",
      { ...p, params: { ...p.params, width: 200 }, finalPrice: 37.5 },
      owner,
    );
    assert.equal(revised.status, 201);
    assert.equal(
      (
        await request(
          "/api/owner/quotes/" +
            qid +
            "/export?revision=" +
            revised.data.revisionId,
          undefined,
          owner,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await request(
          "/api/owner/quotes/" + qid + "/approve",
          { revisionId: revised.data.revisionId },
          owner,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          "/api/owner/quotes/" +
            qid +
            "/export?revision=" +
            revised.data.revisionId,
          undefined,
          owner,
        )
      ).status,
      200,
    );
    const after = await request("/api/owner/quotes/" + qid, undefined, owner);
    assert.equal(after.data.revisions[0].snapshot.params.width, 180);
    assert.equal(after.data.revisions[1].price.finalPrice, 37.5);
    const manifest = await request(
      "/api/owner/quotes/" +
        qid +
        "/export?revision=" +
        original +
        "&format=manifest",
      undefined,
      owner,
    );
    assert.equal(manifest.data.units, "mm");
    assert.equal(manifest.data.color, p.color);
    assert.equal(manifest.data.generatorVersion, VERSION);
    const custom = {
      ...p,
      mode: "custom",
      notes: "Broken replacement clip",
      attachmentIds: [upload.data.id],
      idempotencyKey: "custom-request-key-123",
      questions: ["Confirm mating dimensions and clip opening."],
    };
    assert.equal(
      (
        await request(
          "/api/intake",
          {
            notes: custom.notes,
            brief: {},
            attachmentIds: custom.attachmentIds,
          },
          cookie,
        )
      ).data.available,
      false,
    );
    const c = await request("/api/quotes", custom, cookie);
    assert.equal(c.status, 201);
    const cq = (
      await request("/api/owner/quotes/" + c.data.id, undefined, owner)
    ).data;
    assert.ok(cq.revisions[0].snapshot.questions.length >= 5);
    assert.equal(
      cq.revisions[0].snapshot.attachments[0].name,
      "broken-clip.png",
    );
    assert.match(cadPrompt(cq.revisions[0].snapshot), /clip opening/);
    const bad = await fetch(base + "/api/quotes", {
      method: "POST",
      headers: {
        Origin: "https://evil.test",
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify(p),
    });
    assert.equal(bad.status, 403);
    assert.equal(
      (await request("/api/owner/quotes", undefined, owner)).data.quotes.length,
      2,
    );
    await new Promise((r) => app.server.close(r));
    app.db.close();
    app = await createApp({
      dataDir: dir,
      origin: "http://localhost",
      aiOptions: { disabled: true },
    });
    assert.equal(app.db.prepare("SELECT count(*) n FROM quotes").get().n, 2);
    assert.equal(app.db.prepare("SELECT count(*) n FROM revisions").get().n, 3);
  } finally {
    if (app.server.listening) await new Promise((r) => app.server.close(r));
    app.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
