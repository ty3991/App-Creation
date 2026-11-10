// Local feasibility test only. This Worker is never deployed.
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readPacket } from "../shared/quote-packet.js";

const [runtime, packetPath, photoPath] = process.argv.slice(2);
if (!runtime || !packetPath || !photoPath)
  throw Error(
    "Usage: node scripts/probe-free-d1.mjs MINIFLARE_ENTRY PACKET.txt REFERENCE.png",
  );
const { Miniflare } = await import(pathToFileURL(resolve(runtime)));
const packet = await readFile(packetPath, "utf8");
readPacket(packet);
const photo = await readFile(photoPath);
const secret = randomBytes(32).toString("hex");
const maxBytes = 8 * 1024 * 1024;

const emulator = new Miniflare({
  modules: true,
  compatibilityDate: "2026-07-30",
  d1Databases: ["DB"],
  bindings: { SECRET: secret },
  script: `export default { async fetch(request, env) {
    if (request.headers.get('Authorization') !== 'Bearer ' + env.SECRET) return new Response('Private', {status: 403});
    const id = new URL(request.url).pathname.slice(1);
    if (request.method === 'POST') {
      const settings = decodeURIComponent(request.headers.get('x-fixture-packet'));
      const bytes = new Uint8Array(await request.arrayBuffer());
      const statements = [env.DB.prepare('UPDATE quota SET used=used+?').bind(bytes.length), env.DB.prepare('INSERT INTO packets VALUES (?,?)').bind(id,settings)];
      for (let offset=0; offset<bytes.length; offset+=1048576) {
        statements.push(env.DB.prepare('INSERT INTO chunks VALUES (?,?,?)').bind(id,offset,bytes.slice(offset,offset+1048576).buffer));
      }
      try { await env.DB.batch(statements); }
      catch (error) {
        if (/CHECK constraint failed/i.test(error.message)) return new Response('Simulated storage quota reached', {status: 507});
        throw error;
      }
      return new Response(String(statements.length-2), {status: 201});
    }
    const settings = await env.DB.prepare('SELECT settings FROM packets WHERE id=?').bind(id).first('settings');
    if (settings === null) return new Response('Missing packet', {status: 404});
    const { results } = await env.DB.prepare('SELECT bytes FROM chunks WHERE id=? ORDER BY offset').bind(id).all();
    const stream = new ReadableStream({start(controller) {
      for (const row of results) controller.enqueue(new Uint8Array(row.bytes));
      controller.close();
    }});
    return new Response(stream, {headers: {'x-fixture-packet': encodeURIComponent(settings), 'Cache-Control':'no-store'}});
  }};`,
});

try {
  const db = await emulator.getD1Database("DB");
  await db.batch([
    db.prepare(
      "CREATE TABLE packets (id TEXT PRIMARY KEY, settings TEXT NOT NULL)",
    ),
    db.prepare(
      "CREATE TABLE chunks (id TEXT NOT NULL REFERENCES packets(id), offset INTEGER NOT NULL, bytes BLOB NOT NULL CHECK(length(bytes)<=1048576), PRIMARY KEY(id,offset))",
    ),
    db.prepare(
      `CREATE TABLE quota (used INTEGER NOT NULL CHECK(used<=${maxBytes + photo.length}))`,
    ),
    db.prepare("INSERT INTO quota VALUES (0)"),
  ]);
  const headers = {
    Authorization: `Bearer ${secret}`,
    "x-fixture-packet": encodeURIComponent(packet),
  };
  const send = (id, body) =>
    emulator.dispatchFetch(`http://probe.test/${id}`, {
      method: "POST",
      headers,
      body,
    });
  const open = (id) =>
    emulator.dispatchFetch(`http://probe.test/${id}`, { headers });
  const digest = (data) => createHash("sha256").update(data).digest("hex");
  const reference = await send("reference", photo);
  assert.equal(reference.status, 201, await reference.clone().text());
  const result = await open("reference");
  assert.equal(
    decodeURIComponent(result.headers.get("x-fixture-packet")),
    packet,
  );
  assert.equal(digest(Buffer.from(await result.arrayBuffer())), digest(photo));
  assert.equal(
    (await emulator.dispatchFetch("http://probe.test/reference")).status,
    403,
  );
  const big = randomBytes(maxBytes);
  const time = performance.now();
  const large = await send("large", big);
  const writeMs = performance.now() - time;
  assert.equal(large.status, 201, await large.clone().text());
  assert.equal(await large.text(), "8");
  assert.equal(
    digest(Buffer.from(await (await open("large")).arrayBuffer())),
    digest(big),
  );
  assert.equal((await send("over", photo)).status, 507);
  assert.equal((await open("over")).status, 404);
  assert.equal((await open("reference")).status, 200);
  console.log(
    JSON.stringify(
      {
        referenceBytes: photo.length,
        packetBytes: Buffer.byteLength(packet),
        largeUploadBytes: big.length,
        chunks: 8,
        writeWallMs: Math.round(writeMs),
        privateRead: 403,
        simulatedQuota: 507,
        atomicFailure: true,
      },
      null,
      2,
    ),
  );
} finally {
  await emulator.dispose();
}
