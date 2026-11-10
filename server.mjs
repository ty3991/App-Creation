import http from "node:http";
import { readFile, stat, mkdir, writeFile, unlink } from "node:fs/promises";
import { resolve, dirname, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, randomBytes } from "node:crypto";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import {
  openStore,
  hash,
  createOwner,
  verifyOwner,
  newSession,
  rateLimit,
} from "./store.mjs";
import { generate, stl, checkMesh } from "./shared/geometry.js";
import {
  VERSION,
  validate,
  dimensions,
  materials,
  finishes,
  cadPrompt,
  quoteTotal,
  unanswered,
} from "./shared/schema.js";
import { intake } from "./ai.mjs";
import { guidedIntake } from "./shared/intake-rules.js";
const ROOT = dirname(fileURLToPath(import.meta.url));
const compress = promisify(gzip);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
const fail = (code, message, errors) => {
  throw Object.assign(Error(message), { code, errors });
};
export async function createApp(options = {}) {
  const dataDir = resolve(
      options.dataDir || process.env.DATA_DIR || resolve(ROOT, "data"),
    ),
    db = openStore(dataDir);
  const origin =
      options.origin || process.env.PUBLIC_ORIGIN || "http://localhost:4173",
    secure = origin.startsWith("https:");
  const canonical = new URL(origin);
  if (
    canonical.origin !== origin ||
    !["http:", "https:"].includes(canonical.protocol)
  )
    throw Error(
      "PUBLIC_ORIGIN must be an exact HTTP(S) origin without a trailing slash.",
    );
  const localOnly = ["localhost", "127.0.0.1", "[::1]"].includes(
    canonical.hostname,
  );
  if (!localOnly && !secure)
    throw Error("Public deployments require HTTPS PUBLIC_ORIGIN.");
  const aiEnabled =
    (options.aiMode || process.env.AI_MODE || "rules") === "openai" &&
    process.env.AI_DISABLED !== "1";
  const maxStorage =
    Number(process.env.MAX_UPLOAD_STORAGE_MB || 1024) * 1024 * 1024;
  if (!Number.isFinite(maxStorage) || maxStorage <= 0)
    throw Error("MAX_UPLOAD_STORAGE_MB must be positive.");
  const volume = ["X", "Y", "Z"].map((k) =>
    Number(process.env["PRINTER_" + k] || 256),
  );
  if (volume.some((v) => !Number.isFinite(v) || v <= 0))
    throw Error("Invalid printer volume");
  const setupToken = options.setupToken || randomBytes(24).toString("hex");
  if (!db.prepare("SELECT id FROM owners").get()) {
    await writeFile(resolve(dataDir, "owner-setup-token.txt"), setupToken, {
      mode: 0o600,
    });
  }
  const json = (res, status, data) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(data));
  };
  const staticCache = new Map();
  const limited = (req, name, max, ms) => {
    if (
      !rateLimit(
        db,
        name + ":" + (req.socket.remoteAddress || "unknown"),
        max,
        ms,
      )
    )
      fail(429, "Too many requests. Please try again later.");
  };
  async function body(req, max = 12 * 1024 * 1024) {
    if (!String(req.headers["content-type"]).startsWith("application/json"))
      fail(415, "Send JSON");
    let size = 0,
      chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > max) fail(413, "File or request is too large.");
      chunks.push(c);
    }
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString());
      if (!value || typeof value !== "object" || Array.isArray(value))
        fail(400, "Send a JSON object.");
      return value;
    } catch {
      fail(400, "Invalid JSON");
    }
  }
  function session(req, role) {
    const cookies = Object.fromEntries(
      String(req.headers.cookie || "")
        .split(";")
        .map((s) => s.trim().split("=")),
    );
    const token = cookies[role === "owner" ? "pd_owner" : "pd_draft"];
    const s =
      token &&
      db
        .prepare(
          "SELECT * FROM sessions WHERE token=? AND role=? AND expires>?",
        )
        .get(hash(token), role, Date.now());
    if (!s)
      fail(
        401,
        role === "owner"
          ? "Owner sign-in required."
          : "Your draft session expired. Refresh before uploading or submitting.",
      );
    return s.token;
  }
  function cookie(res, role, token) {
    res.setHeader(
      "Set-Cookie",
      `${role === "owner" ? "pd_owner" : "pd_draft"}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${role === "owner" ? 28800 : 86400}${secure ? "; Secure" : ""}`,
    );
  }
  function uploads(ids, sid, owner = false) {
    if (!Array.isArray(ids) || ids.length > 8)
      fail(400, "Attach up to 8 files.");
    return [...new Set(ids)].map((id) => {
      const a = db
        .prepare(
          "SELECT id,session,name,mime,length(bytes) AS size FROM uploads WHERE id=?",
        )
        .get(id);
      if (!a || (!owner && a.session !== sid))
        fail(403, "Attachment does not belong to this session.");
      return { id: a.id, name: a.name, mime: a.mime, size: a.size };
    });
  }
  function cleanSnapshot(b, sid, owner = false) {
    if (!["custom", "configure"].includes(b.mode))
      fail(400, "Choose a design path.");
    if (!Number.isInteger(b.quantity) || b.quantity < 1 || b.quantity > 10000)
      fail(400, "Quantity must be 1–10,000.");
    if (
      !materials.includes(b.material) ||
      !finishes.includes(b.finish) ||
      !/^#[0-9a-f]{6}$/i.test(b.color || "")
    )
      fail(400, "Invalid appearance preferences.");
    if (typeof b.notes !== "string" || b.notes.length > 10000)
      fail(400, "Notes must be at most 10,000 characters.");
    const contact = b.contact;
    if (
      !contact ||
      typeof contact.name !== "string" ||
      contact.name.trim().length < 1 ||
      contact.name.length > 100 ||
      typeof contact.email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email) ||
      contact.email.length > 254 ||
      typeof contact.phone !== "string" ||
      contact.phone.length > 40
    )
      fail(400, "Enter your name and valid email.");
    const brief = {};
    for (const k of [
      "purpose",
      "fit",
      "measurements",
      "appearance",
      "conditions",
    ]) {
      const v = b.brief?.[k] ?? "";
      if (typeof v !== "string" || v.length > 3000)
        fail(400, "Brief answer is too long.");
      brief[k] = v;
    }
    const errors =
      b.mode === "configure" ? validate(b.family, b.params || {}) : {};
    if (Object.keys(errors).length)
      fail(422, "Correct the highlighted settings.", errors);
    const questions = b.questions || [];
    if (
      !Array.isArray(questions) ||
      questions.length > 20 ||
      questions.some((q) => typeof q !== "string" || q.length > 1000)
    )
      fail(400, "Invalid questions");
    let mockup = null;
    if (b.mockup) {
      mockup = {};
      for (const k of ["width", "depth", "height"]) {
        const x = b.mockup[k];
        if (
          x !== null &&
          (typeof x !== "number" || !Number.isFinite(x) || x < 1 || x > 500)
        )
          fail(400, "Envelope dimensions must be 1–500 mm or unknown.");
        mockup[k] = x;
      }
      mockup.approximate = true;
    }
    let previewImage = null;
    if (b.previewImage) {
      if (
        typeof b.previewImage !== "string" ||
        b.previewImage.length > 1500000 ||
        !b.previewImage.startsWith("data:image/png;base64,") ||
        !Buffer.from(b.previewImage.split(",")[1], "base64")
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      )
        fail(400, "Invalid preview image");
      previewImage = b.previewImage;
    }
    return {
      mode: b.mode,
      family: b.mode === "configure" ? b.family : null,
      params: b.mode === "configure" ? { ...b.params } : null,
      quantity: b.quantity,
      material: b.material,
      finish: b.finish,
      color: b.color,
      notes: b.notes,
      brief,
      contact: {
        name: contact.name.trim(),
        email: contact.email.trim(),
        phone: contact.phone.trim(),
      },
      attachments: uploads(b.attachmentIds || [], sid, owner),
      questions: [
        ...new Set([
          ...(b.mode === "custom"
            ? guidedIntake({ notes: b.notes, brief }).questions
            : unanswered(brief)),
          ...questions,
        ]),
      ],
      mockup,
      previewImage,
      generatorVersion: VERSION,
      units: "mm",
      productionOptionsConfirmed: false,
    };
  }
  const quote = (id) => {
    const q = db
      .prepare("SELECT id,number,created,status FROM quotes WHERE id=?")
      .get(id);
    if (!q) fail(404, "Request not found");
    return {
      ...q,
      approvedRevision:
        db.prepare("SELECT revision_id FROM approvals WHERE quote_id=?").get(id)
          ?.revision_id || null,
      revisions: db
        .prepare(
          "SELECT * FROM revisions WHERE quote_id=? ORDER BY created,rowid",
        )
        .all(id)
        .map((r) => ({
          ...r,
          snapshot: JSON.parse(r.snapshot),
          mesh: r.mesh ? JSON.parse(r.mesh) : null,
          price: r.price ? JSON.parse(r.price) : null,
        })),
    };
  };
  const server = http.createServer(async (req, res) => {
    try {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=()",
      );
      if (secure)
        res.setHeader("Strict-Transport-Security", "max-age=31536000");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      );
      const url = new URL(req.url, "http://localhost"),
        path = url.pathname,
        method = req.method;
      if (method === "GET" && path === "/api/health")
        return json(res, 200, {
          app: "printelligent-quote-desk",
          version: VERSION,
          status:
            db.prepare("SELECT 1 AS ok").get().ok === 1 ? "ready" : "error",
          instance: localOnly ? process.env.PD_LOCAL_INSTANCE || null : null,
        });
      const requestHost = String(req.headers.host || "");
      const loopbackHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(
        requestHost,
      );
      if (requestHost !== canonical.host && !(localOnly && loopbackHost))
        fail(403, "Use the configured website address.");
      if (!["GET", "HEAD"].includes(method) && req.headers.origin !== origin)
        fail(403, "Request origin not allowed.");
      if (method === "POST" && path === "/api/local/stop") {
        if (
          !localOnly ||
          !process.env.PD_LOCAL_CONTROL ||
          req.headers.authorization !==
            "Bearer " + process.env.PD_LOCAL_CONTROL ||
          !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
            req.socket.remoteAddress,
          )
        )
          fail(403, "Local launcher control required.");
        json(res, 200, { ok: true });
        server.close(() => {
          db.close();
        });
        server.closeIdleConnections();
        return;
      }
      if (method === "GET" && path === "/api/session") {
        limited(req, "session", 120, 3600000);
        let sid;
        try {
          sid = session(req, "draft");
        } catch {
          const token = newSession(db, "draft");
          cookie(res, "draft", token);
          sid = hash(token);
        }
        return json(res, 200, {
          printerVolume: volume,
          aiConfigured: aiEnabled && !!process.env.OPENAI_API_KEY,
          intakeMode:
            aiEnabled && !!process.env.OPENAI_API_KEY ? "openai" : "rules",
          ownerSetupAvailable:
            localOnly && !db.prepare("SELECT id FROM owners").get(),
          businessUrl: "https://printelligentdesigns.com/",
          generatorVersion: VERSION,
        });
      }
      if (method === "POST" && path === "/api/owner/setup") {
        if (!localOnly)
          fail(403, "Use the private server terminal to initialize the owner.");
        limited(req, "setup", 5, 3600000);
        if (
          !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
            req.socket.remoteAddress,
          )
        )
          fail(403, "Owner setup is local only.");
        const b = await body(req, 5000);
        if (b.token !== setupToken)
          fail(403, "Use the setup token in the local data folder.");
        try {
          createOwner(db, b.email, b.password);
          await unlink(resolve(dataDir, "owner-setup-token.txt")).catch(
            () => {},
          );
        } catch (e) {
          fail(400, e.message);
        }
        return json(res, 201, { ok: true });
      }
      if (method === "POST" && path === "/api/owner/login") {
        limited(req, "login", 10, 15 * 60000);
        const b = await body(req, 5000);
        if (
          typeof b.email !== "string" ||
          typeof b.password !== "string" ||
          !verifyOwner(db, b.email, b.password)
        )
          fail(401, "Email or password is incorrect.");
        const token = newSession(db, "owner");
        cookie(res, "owner", token);
        return json(res, 200, { ok: true });
      }
      if (method === "POST" && path === "/api/owner/logout") {
        const sid = session(req, "owner");
        db.prepare("DELETE FROM sessions WHERE token=?").run(sid);
        cookie(res, "owner", "");
        return json(res, 200, { ok: true });
      }
      if (
        method === "POST" &&
        (path === "/api/uploads" || path === "/api/owner/uploads")
      ) {
        const owner = path.includes("/owner/"),
          sid = session(req, owner ? "owner" : "draft");
        limited(req, "upload", 30, 3600000);
        const b = await body(req);
        if (
          typeof b.name !== "string" ||
          b.name.length > 150 ||
          typeof b.data !== "string" ||
          !b.data.match(/^[A-Za-z0-9+/]*={0,2}$/)
        )
          fail(400, "Invalid file");
        const bytes = Buffer.from(b.data, "base64");
        if (bytes.length < 1 || bytes.length > 8 * 1024 * 1024)
          fail(413, "Files must be under 8 MB.");
        const ext = extname(b.name).toLowerCase(),
          types = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
            ".pdf": "application/pdf",
            ".stl": "model/stl",
            ".3mf": "model/3mf",
            ".step": "application/step",
            ".stp": "application/step",
            ".scad": "text/plain",
            ".py": "text/plain",
          };
        if (!types[ext] || (!owner && [".py", ".scad"].includes(ext)))
          fail(415, "Unsupported file type");
        if (
          (ext === ".png" &&
            !bytes
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
          ([".jpg", ".jpeg"].includes(ext) &&
            (bytes.length < 3 || bytes.readUInt16BE(0) !== 0xffd8)) ||
          (ext === ".webp" &&
            (bytes.toString("ascii", 0, 4) !== "RIFF" ||
              bytes.toString("ascii", 8, 12) !== "WEBP")) ||
          (ext === ".pdf" && bytes.toString("ascii", 0, 5) !== "%PDF-")
        )
          fail(415, "File content does not match its extension.");
        const stored = db
          .prepare(
            "SELECT coalesce(sum(length(bytes)),0) AS n FROM uploads WHERE session=?",
          )
          .get(sid).n;
        if (stored + bytes.length > 40 * 1024 * 1024)
          fail(413, "Session upload limit is 40 MB.");
        const total = db
          .prepare("SELECT coalesce(sum(length(bytes)),0) AS n FROM uploads")
          .get().n;
        if (total + bytes.length > maxStorage)
          fail(
            507,
            "Reference storage is full. You can submit your brief without new attachments; TJ will arrange another way to receive them.",
          );
        const id = randomUUID(),
          name = basename(b.name).replace(/[\x00-\x1f\x7f"<>]/g, "_");
        db.prepare("INSERT INTO uploads VALUES(?,?,?,?,?,?)").run(
          id,
          sid,
          name,
          types[ext],
          bytes,
          Date.now(),
        );
        return json(res, 201, {
          id,
          name,
          mime: types[ext],
          size: bytes.length,
        });
      }
      if (method === "GET" && path.startsWith("/api/files/")) {
        const a = db
          .prepare("SELECT * FROM uploads WHERE id=?")
          .get(path.split("/").pop());
        if (!a) fail(404, "File not found");
        let owner = false;
        try {
          session(req, "owner");
          owner = true;
        } catch {}
        if (!owner && a.session !== session(req, "draft"))
          fail(403, "Access denied");
        res.writeHead(200, {
          "Content-Type": a.mime,
          "Content-Disposition": `attachment; filename="${a.name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(a.name)}`,
          "Cache-Control": "no-store",
          "Content-Security-Policy": "sandbox; default-src 'none'",
        });
        return res.end(a.bytes);
      }
      if (method === "POST" && path === "/api/intake") {
        const sid = session(req, "draft");
        limited(req, "intake", aiEnabled ? 12 : 120, 3600000);
        if (aiEnabled && !rateLimit(db, "AI-global", 200, 86400000))
          fail(429, "Daily intake allowance reached. Continue manually.");
        const b = await body(req, 50000);
        if (
          typeof b.notes !== "string" ||
          b.notes.length > 10000 ||
          JSON.stringify(b.brief || {}).length > 15000
        )
          fail(400, "Intake text is too long.");
        if (
          b.brief &&
          (typeof b.brief !== "object" ||
            Array.isArray(b.brief) ||
            Object.entries(b.brief).some(
              ([k, v]) =>
                ![
                  "purpose",
                  "fit",
                  "measurements",
                  "appearance",
                  "conditions",
                ].includes(k) ||
                typeof v !== "string" ||
                v.length > 3000,
            ))
        )
          fail(400, "Invalid brief fields.");
        const files = uploads(b.attachmentIds || [], sid);
        if (!aiEnabled)
          return json(
            res,
            200,
            guidedIntake({ notes: b.notes, brief: b.brief || {} }),
          );
        const images = files
          .filter(
            (a) => a.mime.startsWith("image/") && a.size < 4 * 1024 * 1024,
          )
          .slice(0, 2)
          .map((a) =>
            db.prepare("SELECT mime,bytes FROM uploads WHERE id=?").get(a.id),
          );
        return json(
          res,
          200,
          await intake(
            {
              notes: b.notes,
              brief: b.brief || {},
              quantity: b.quantity,
              history: (Array.isArray(b.history) ? b.history : []).slice(-8),
            },
            images,
            options.aiOptions,
          ),
        );
      }
      if (method === "POST" && path === "/api/quotes") {
        const sid = session(req, "draft"),
          b = await body(req);
        if (
          typeof b.idempotencyKey !== "string" ||
          !/^[-a-zA-Z0-9]{16,100}$/.test(b.idempotencyKey)
        )
          fail(400, "Invalid submission token.");
        const digest = hash(JSON.stringify(b)),
          existing = db
            .prepare("SELECT id,number,digest FROM quotes WHERE idem=?")
            .get(b.idempotencyKey);
        if (existing) {
          if (existing.digest !== digest)
            fail(
              409,
              "This submission token belongs to different settings. Review again.",
            );
          return json(res, 200, {
            id: existing.id,
            number: existing.number,
            replayed: true,
          });
        }
        limited(req, "submit", 10, 3600000);
        const snapshot = cleanSnapshot(b, sid),
          mesh =
            snapshot.mode === "configure"
              ? generate(snapshot.family, snapshot.params)
              : null;
        if (mesh && !mesh.checks.valid)
          fail(422, "Geometry failed mesh checks.");
        const id = randomUUID(),
          number =
            "PD-" +
            new Date().toISOString().slice(0, 10).replaceAll("-", "") +
            "-" +
            randomBytes(4).toString("hex").toUpperCase(),
          now = Date.now();
        db.exec("BEGIN IMMEDIATE");
        try {
          db.prepare(
            "INSERT INTO quotes(id,number,session,idem,digest,created) VALUES(?,?,?,?,?,?)",
          ).run(id, number, sid, b.idempotencyKey, digest, now);
          db.prepare("INSERT INTO revisions VALUES(?,?,?,?,?,?,?)").run(
            randomUUID(),
            id,
            "customer",
            now,
            JSON.stringify(snapshot),
            mesh ? JSON.stringify(mesh) : null,
            null,
          );
          db.exec("COMMIT");
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
        return json(res, 201, { id, number });
      }
      if (path.startsWith("/api/owner/")) {
        session(req, "owner");
        if (method === "GET" && path === "/api/owner/quotes")
          return json(res, 200, {
            quotes: db
              .prepare(
                "SELECT q.id,q.number,q.created,q.status,r.snapshot FROM quotes q JOIN revisions r ON r.quote_id=q.id AND r.kind='customer' ORDER BY q.created DESC",
              )
              .all()
              .map((r) => ({
                ...r,
                customer: JSON.parse(r.snapshot).contact.name,
                mode: JSON.parse(r.snapshot).mode,
                snapshot: undefined,
              })),
          });
        const m = path.match(
          /^\/api\/owner\/quotes\/([^/]+)(?:\/(revisions|status|approve|export|brief))?$/,
        );
        if (m) {
          const id = m[1],
            action = m[2],
            q = quote(id);
          if (method === "GET" && !action) return json(res, 200, q);
          if (method === "POST" && action === "status") {
            const b = await body(req, 1000);
            if (
              ![
                "New",
                "Needs measurements",
                "Reviewing",
                "Quoted",
                "Accepted",
                "In production",
                "Complete",
                "Declined",
              ].includes(b.status)
            )
              fail(400, "Invalid status");
            db.prepare("UPDATE quotes SET status=? WHERE id=?").run(
              b.status,
              id,
            );
            return json(res, 200, { ok: true });
          }
          if (method === "POST" && action === "revisions") {
            const b = await body(req),
              snapshot = cleanSnapshot(b, session(req, "owner"), true),
              mesh =
                snapshot.mode === "configure"
                  ? generate(snapshot.family, snapshot.params)
                  : null;
            if (mesh && !mesh.checks.valid)
              fail(422, "Geometry failed mesh checks.");
            let price = null;
            if (b.pricing) {
              if (b.pricing.confirmed !== true)
                fail(400, "Confirm slicer and cost inputs first.");
              price = { inputs: b.pricing, ...quoteTotal(b.pricing) };
            }
            if (b.finalPrice !== undefined) {
              if (
                typeof b.finalPrice !== "number" ||
                !Number.isFinite(b.finalPrice) ||
                b.finalPrice < 0 ||
                b.finalPrice > 1000000
              )
                fail(400, "Enter a valid final price.");
              price = {
                ...price,
                finalPrice: Math.round(b.finalPrice * 100) / 100,
              };
            }
            const revisionId = randomUUID();
            db.prepare("INSERT INTO revisions VALUES(?,?,?,?,?,?,?)").run(
              revisionId,
              id,
              "owner",
              Date.now(),
              JSON.stringify(snapshot),
              mesh ? JSON.stringify(mesh) : null,
              price ? JSON.stringify(price) : null,
            );
            return json(res, 201, { revisionId });
          }
          if (method === "POST" && action === "approve") {
            const b = await body(req, 2000),
              r = q.revisions.find((r) => r.id === b.revisionId);
            if (!r || r.kind !== "owner")
              fail(400, "Approve a saved owner revision.");
            db.prepare("INSERT OR REPLACE INTO approvals VALUES(?,?,?)").run(
              id,
              r.id,
              Date.now(),
            );
            return json(res, 200, { ok: true });
          }
          if (method === "GET" && ["export", "brief"].includes(action)) {
            const r = q.revisions.find(
              (r) => r.id === url.searchParams.get("revision"),
            );
            if (!r) fail(404, "Revision not found");
            if (action === "brief") {
              res.writeHead(200, {
                "Content-Type": "text/plain; charset=utf-8",
                "Content-Disposition": `attachment; filename="${q.number}-brief.txt"`,
              });
              return res.end(cadPrompt(r.snapshot));
            }
            if (r.kind !== "customer" && r.id !== q.approvedRevision)
              fail(409, "Approve this owner revision before export.");
            if (
              !r.mesh ||
              !checkMesh(
                r.mesh,
                dimensions(r.snapshot.family, r.snapshot.params),
              ).valid
            )
              fail(422, "No validated configurable geometry is available.");
            const oversized = r.mesh.checks.dimensionsMm.some(
              (x, i) => x > volume[i],
            );
            if (url.searchParams.get("format") === "manifest")
              return json(res, 200, {
                requestNumber: q.number,
                revisionId: r.id,
                ...r.snapshot,
                previewImage: undefined,
                meshChecks: r.mesh.checks,
                printerVolumeMm: volume,
                oversized,
                stlUnits: "mm",
                stlNote:
                  "STL contains no unit or color metadata; import in millimeters.",
              });
            if (oversized && url.searchParams.get("reviewed") !== "yes")
              fail(
                409,
                "Part exceeds configured build volume. Confirm the oversize review before downloading.",
              );
            res.writeHead(200, {
              "Content-Type": "model/stl",
              "Content-Disposition": `attachment; filename="${q.number}-${r.id.slice(0, 8)}-mm.stl"`,
            });
            return res.end(stl(r.mesh));
          }
        }
      }
      if (path.startsWith("/api/")) fail(404, "Endpoint not found");
      if (!localOnly && path.startsWith("/business-review"))
        fail(404, "Not found");
      if (!["GET", "HEAD"].includes(method)) fail(405, "Method not allowed");
      let file;
      if (path === "/" || path === "/owner" || path === "/quote")
        file = resolve(ROOT, "public/index.html");
      else if (/^\/(shared|vendor)\//.test(path))
        file = resolve(ROOT, "." + decodeURIComponent(path));
      else file = resolve(ROOT, "public", "." + decodeURIComponent(path));
      const allowed = [
        resolve(ROOT, "public"),
        resolve(ROOT, "shared"),
        resolve(ROOT, "vendor"),
      ];
      if (
        !allowed.some((p) =>
          file.startsWith(p + (process.platform === "win32" ? "\\" : "/")),
        )
      )
        fail(403, "Access denied");
      if (
        ![".html", ".js", ".css", ".json", ".wasm", ".png", ".svg"].includes(
          extname(file),
        )
      )
        fail(404, "Not found");
      const info = await stat(file);
      let cached = staticCache.get(file);
      if (!cached || cached.mtime !== info.mtimeMs) {
        const bytes = await readFile(file);
        cached = {
          mtime: info.mtimeMs,
          bytes,
          zipped: bytes.length > 1024 ? await compress(bytes) : null,
          etag: 'W/"' + hash(bytes) + '"',
        };
        staticCache.set(file, cached);
      }
      res.setHeader("ETag", cached.etag);
      res.setHeader("Vary", "Accept-Encoding");
      res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
      if (req.headers["if-none-match"] === cached.etag) {
        res.writeHead(304);
        return res.end();
      }
      const zipped =
        cached.zipped && /\bgzip\b/.test(req.headers["accept-encoding"] || "");
      if (zipped) res.setHeader("Content-Encoding", "gzip");
      res.writeHead(200, {
        "Content-Type": MIME[extname(file)] || "application/octet-stream",
      });
      res.end(
        method === "HEAD" ? undefined : zipped ? cached.zipped : cached.bytes,
      );
    } catch (e) {
      if (!res.headersSent)
        json(
          res,
          e.code && Number.isInteger(e.code)
            ? e.code
            : e.code === "ENOENT"
              ? 404
              : 500,
          {
            error:
              e.code && Number.isInteger(e.code)
                ? e.message
                : e.code === "ENOENT"
                  ? "Not found"
                  : "Unable to complete this request.",
            errors: e.errors,
          },
        );
      else res.end();
    }
  });
  server.requestTimeout = 45000;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;
  return { server, db, setupToken, volume };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv[2] === "setup-owner") {
    await import("./scripts/owner-setup.mjs");
  } else {
    const app = await createApp();
    const shutdown = () => {
      app.server.close(() => {
        app.db.close();
      });
      app.server.closeIdleConnections();
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
    app.server.on("error", (e) => {
      console.error(
        e.code === "EADDRINUSE"
          ? "This port is already in use. Use Start-QuoteDesk.cmd to choose an available local port."
          : "Quote Desk could not start. Check the configured data directory and port.",
      );
      process.exitCode = 1;
      app.db.close();
    });
    app.server.listen(
      Number(process.env.PORT || 4173),
      process.env.HOST || "127.0.0.1",
      () =>
        console.log(
          "Quote Desk: " +
            (process.env.PUBLIC_ORIGIN || "http://localhost:4173") +
            "\nOwner setup: /owner (token in data/owner-setup-token.txt; local access only).",
        ),
    );
  }
}
