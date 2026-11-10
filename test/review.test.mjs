import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import { createApp } from "../server.mjs";
import { createOwner } from "../store.mjs";
import { families, unanswered, quoteTotal } from "../shared/schema.js";
import { guidedIntake } from "../shared/intake-rules.js";
const run = promisify(execFile),
  root = resolve(import.meta.dirname, "..");

test("rule guidance preserves unknown fit dimensions and never infers scale", () => {
  const clip = guidedIntake({
    notes: "Broken clip with a photo",
    brief: { fit: "I'm not sure", measurements: "unknown" },
  });
  assert.equal(clip.mode, "rules");
  assert.equal(clip.proposal, null);
  assert.ok(clip.questions.some((q) => q.includes("clip opening")));
  assert.ok(clip.questions.some((q) => q.includes("units")));
  assert.equal(
    unanswered({
      purpose: "unknown",
      fit: "tbd",
      measurements: "not measured",
      appearance: "unsure",
      conditions: "don't know",
    }).length,
    5,
  );
  const sign = guidedIntake({ notes: "A sign 12 inches wide" });
  assert.equal(sign.proposal.params.width, families.sign.defaults.width);
  assert.match(sign.proposal.reason, /NOT measurements/);
  assert.throws(() =>
    quoteTotal({
      grams: 1e100,
      hours: 1,
      materialPerKg: 1,
      machinePerHour: 1,
      laborMinutes: 1,
      laborPerHour: 1,
      extras: 1,
      margin: 20,
    }),
  );
});

test("free mode, malformed bodies, private downloads, no-cache and backup restoration", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pd-review-"));
  const origin = "http://localhost";
  const app = await createApp({
    dataDir: join(dir, "live"),
    origin,
    aiOptions: {
      key: "never-used",
      fetcher: () => {
        throw Error("Paid AI must not be called");
      },
    },
  });
  createOwner(app.db, "qa@example.test", "Only-a-test-password-123");
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + app.server.address().port;

  const req = async (path, data, cookie = "") =>
    fetch(url + path, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  try {
    const session = await req("/api/session"),
      cookie = session.headers.get("set-cookie").split(";")[0];
    const config = await session.json();
    assert.equal(config.intakeMode, "rules");
    assert.equal(config.aiConfigured, false);
    assert.equal((await req("/api/intake", null, cookie)).status, 400);
    assert.equal(
      (await req("/api/intake", { notes: "clip", brief: { fit: 22 } }, cookie))
        .status,
      400,
    );
    const intake = await (
      await req("/api/intake", { notes: "broken clip", brief: {} }, cookie)
    ).json();
    assert.equal(intake.mode, "rules");
    assert.match(intake.reply, /not interpreted/);
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=";
    const a = await (
      await req("/api/uploads", { name: "référence.png", data: png }, cookie)
    ).json();
    const file = await req("/api/files/" + a.id, undefined, cookie);
    assert.equal(file.status, 200);
    assert.match(file.headers.get("content-disposition"), /filename\*=UTF-8/);
    const quote = {
      mode: "custom",
      quantity: 1,
      material: "unsure",
      finish: "unsure",
      color: "#087d82",
      notes: "Broken clip",
      brief: { fit: "unknown", measurements: "tbd" },
      contact: { name: "Fixture", email: "fixture@example.test", phone: "" },
      attachmentIds: [a.id],
      idempotencyKey: "review-quote-unique-12345",
    };
    const submitted = await (await req("/api/quotes", quote, cookie)).json();
    assert.ok(submitted.number);
    const replay = await (await req("/api/quotes", quote, cookie)).json();
    assert.equal(replay.id, submitted.id);
    const login = await req("/api/owner/login", {
        email: "qa@example.test",
        password: "Only-a-test-password-123",
      }),
      owner = login.headers.get("set-cookie").split(";")[0];
    const detail = await (
      await req("/api/owner/quotes/" + submitted.id, undefined, owner)
    ).json();
    assert.ok(
      detail.revisions[0].snapshot.questions.some((q) =>
        q.includes("clip opening"),
      ),
    );
    const brief = await req(
      "/api/owner/quotes/" +
        submitted.id +
        "/brief?revision=" +
        detail.revisions[0].id,
      undefined,
      owner,
    );
    assert.equal(brief.headers.get("cache-control"), "no-store");
    assert.match(await brief.text(), /unknown/);
    assert.equal((await req("/api/local/stop", {}, cookie)).status, 403);
    assert.equal((await req("/data/quotes.sqlite")).status, 404);
    assert.equal((await req("/.env.local")).status, 404);
    const asset = await fetch(url + "/app.js", {
      headers: { "Accept-Encoding": "gzip" },
    });
    assert.equal(asset.headers.get("content-encoding"), "gzip");
    assert.match(await asset.text(), /renderDesigner/);
    assert.equal(
      (
        await fetch(url + "/app.js", {
          headers: { "If-None-Match": asset.headers.get("etag") },
        })
      ).status,
      304,
    );
    const restored = join(dir, "restored"),
      backup = join(dir, "backup.sqlite");
    await run(process.execPath, ["scripts/backup.mjs", backup], {
      cwd: root,
      env: { ...process.env, DATA_DIR: join(dir, "live") },
    });
    await run(
      process.execPath,
      ["scripts/restore-backup.mjs", backup, restored],
      { cwd: root },
    );
    const copy = await createApp({ dataDir: restored, origin });
    try {
      assert.equal(copy.db.prepare("SELECT count(*) n FROM quotes").get().n, 1);
      assert.equal(
        copy.db.prepare("SELECT count(*) n FROM uploads").get().n,
        1,
      );
      assert.equal(
        copy.db.prepare("SELECT count(*) n FROM sessions").get().n,
        0,
      );
      assert.equal(
        copy.db.prepare("SELECT snapshot FROM revisions").get().snapshot,
        app.db.prepare("SELECT snapshot FROM revisions").get().snapshot,
      );
    } finally {
      copy.db.close();
    }
    await assert.rejects(
      run(process.execPath, ["scripts/restore-backup.mjs", backup, restored], {
        cwd: root,
      }),
    );
  } finally {
    await new Promise((r) => app.server.close(r));
    app.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("public origin blocks bootstrap and review pages, requires canonical host and secure sessions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pd-public-"));
  const app = await createApp({
    dataDir: dir,
    origin: "https://quote.example.test",
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + app.server.address().port;
  // Node fetch normalizes Host; raw HTTP simulates the TLS proxy's canonical host.
  const publicRequest = (path, options = {}) =>
    new Promise((resolveResponse, reject) => {
      const request = httpRequest(url + path, options, (response) => {
        const chunks = [];
        response.on("data", (c) => chunks.push(c));
        response.on("end", () =>
          resolveResponse({
            status: response.statusCode,
            headers: {
              get: (key) => {
                const value = response.headers[key];
                return Array.isArray(value) ? value.join("; ") : value || null;
              },
            },
            json: async () => JSON.parse(Buffer.concat(chunks).toString()),
          }),
        );
      });
      request.on("error", reject);
      request.end(options.body);
    });
  try {
    assert.equal((await publicRequest("/api/health")).status, 200);
    assert.equal((await publicRequest("/api/session")).status, 403);
    const headers = {
      Host: "quote.example.test",
      Origin: "https://quote.example.test",
      "Content-Type": "application/json",
    };
    const session = await publicRequest("/api/session", { headers });
    assert.match(session.headers.get("set-cookie"), /; Secure/);
    assert.match(session.headers.get("strict-transport-security"), /max-age/);
    assert.equal((await session.json()).ownerSetupAvailable, false);
    assert.equal(
      (
        await publicRequest("/api/owner/setup", {
          method: "POST",
          headers,
          body: JSON.stringify({
            token: app.setupToken,
            email: "bad@example.test",
            password: "Bad-test-password123",
          }),
        })
      ).status,
      403,
    );
    assert.equal(
      (await publicRequest("/business-review.html", { headers })).status,
      404,
    );
  } finally {
    await new Promise((r) => app.server.close(r));
    app.db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("launcher survives parent exit, reuses instance, handles occupied port, stops and restarts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pd-launch-"));
  const occupied = createServer();
  await new Promise((r) => occupied.listen(0, "127.0.0.1", r));
  const port = occupied.address().port;
  const opts = {
    cwd: root,
    env: {
      ...process.env,
      QUOTE_DESK_LOCAL_DATA: dir,
      QUOTE_DESK_LOCAL_PORT: String(port),
    },
    timeout: 25000,
  };
  const launch = (action) =>
    run(
      process.execPath,
      ["scripts/local-app.mjs", action, "--no-browser"],
      opts,
    );
  try {
    const first = await launch("start");
    assert.match(first.stdout, /usual port was occupied/);
    let s = JSON.parse(await readFile(join(dir, "local-runtime.json"), "utf8"));
    assert.notEqual(new URL(s.url).port, String(port));
    const h = await (await fetch(s.url + "/api/health")).json();
    assert.equal(h.instance, s.instance);
    assert.equal((await fetch(s.url)).status, 200);
    assert.equal((await fetch(s.url + "/owner")).status, 200);
    assert.match((await launch("start")).stdout, /already running/);
    assert.equal(
      JSON.parse(await readFile(join(dir, "local-runtime.json"), "utf8"))
        .instance,
      s.instance,
    );
    await launch("stop");
    await assert.rejects(fetch(s.url + "/api/health"));
    await launch("start");
    const restarted = JSON.parse(
      await readFile(join(dir, "local-runtime.json"), "utf8"),
    );
    assert.notEqual(restarted.instance, s.instance);
    await launch("stop");
    assert.match((await launch("stop")).stdout, /already stopped/);
  } finally {
    await launch("stop").catch(() => {});
    await new Promise((r) => occupied.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});
