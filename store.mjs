import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
export const hash = (s) => createHash("sha256").update(s).digest("hex");
export function openStore(dir) {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(resolve(dir, "quotes.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS owners (id INTEGER PRIMARY KEY CHECK(id=1), email TEXT NOT NULL, salt TEXT NOT NULL, password TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, role TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, session TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS quotes (id TEXT PRIMARY KEY, number TEXT UNIQUE NOT NULL, session TEXT NOT NULL, idem TEXT NOT NULL, digest TEXT NOT NULL, created INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'New', UNIQUE(session,idem));
CREATE UNIQUE INDEX IF NOT EXISTS quote_idempotency ON quotes(idem);
CREATE TABLE IF NOT EXISTS revisions (id TEXT PRIMARY KEY, quote_id TEXT NOT NULL REFERENCES quotes(id), kind TEXT NOT NULL, created INTEGER NOT NULL, snapshot TEXT NOT NULL, mesh TEXT, price TEXT);
CREATE TRIGGER IF NOT EXISTS immutable_revision BEFORE UPDATE ON revisions BEGIN SELECT RAISE(ABORT,'Revisions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS no_delete_revision BEFORE DELETE ON revisions BEGIN SELECT RAISE(ABORT,'Revisions are immutable'); END;
CREATE TABLE IF NOT EXISTS approvals (quote_id TEXT PRIMARY KEY REFERENCES quotes(id), revision_id TEXT NOT NULL REFERENCES revisions(id), created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset INTEGER NOT NULL);`);
  return db;
}
export function createOwner(db, email, password) {
  if (password.length < 12 || !email.includes("@"))
    throw Error("Use an email address and password of at least 12 characters.");
  if (db.prepare("SELECT id FROM owners").get())
    throw Error("Owner already exists.");
  const salt = randomBytes(24).toString("hex"),
    digest = scryptSync(password, salt, 64).toString("hex");
  db.prepare("INSERT INTO owners VALUES(1,?,?,?)").run(
    email.toLowerCase(),
    salt,
    digest,
  );
}
export function verifyOwner(db, email, password) {
  const o = db.prepare("SELECT * FROM owners WHERE id=1").get();
  const digest = scryptSync(
    String(password).slice(0, 1024),
    o?.salt || "dummy-salt",
    64,
  );
  return (
    !!o &&
    email.toLowerCase() === o.email &&
    timingSafeEqual(Buffer.from(o.password, "hex"), digest)
  );
}
export function newSession(db, role) {
  const token = randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    hash(token),
    role,
    Date.now() + (role === "owner" ? 8 : 24) * 3600000,
  );
  return token;
}
export function rateLimit(db, key, max, windowMs) {
  const now = Date.now(),
    row = db.prepare("SELECT * FROM limits WHERE key=?").get(key);
  if (!row || row.reset < now) {
    db.prepare("INSERT OR REPLACE INTO limits VALUES(?,?,?)").run(
      key,
      1,
      now + windowMs,
    );
    return true;
  }
  if (row.count >= max) return false;
  db.prepare("UPDATE limits SET count=count+1 WHERE key=?").run(key);
  return true;
}
