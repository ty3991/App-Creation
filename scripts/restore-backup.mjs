import { DatabaseSync, backup } from "node:sqlite";
import { resolve } from "node:path";
import { mkdir, access } from "node:fs/promises";

// Restore only to a NEW directory. Existing customer data is never replaced.
const [sourceArg, targetArg] = process.argv.slice(2);
if (!sourceArg || !targetArg)
  throw Error(
    "Usage: node scripts/restore-backup.mjs BACKUP_FILE NEW_DATA_DIRECTORY",
  );
const source = resolve(sourceArg),
  target = resolve(targetArg);
if (
  await access(target).then(
    () => true,
    () => false,
  )
)
  throw Error(
    "Choose a new, nonexistent data directory. Existing data will not be overwritten.",
  );
const db = new DatabaseSync(source, { readOnly: true });
try {
  if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
    throw Error("Backup failed SQLite integrity checks.");
  if (db.prepare("PRAGMA foreign_key_check").all().length)
    throw Error("Backup has broken relationships.");
  const counts = Object.fromEntries(
    ["quotes", "revisions", "uploads", "owners"].map((t) => [
      t,
      db.prepare("SELECT count(*) AS n FROM " + t).get().n,
    ]),
  );
  await mkdir(target, { recursive: true });
  await backup(db, resolve(target, "quotes.sqlite"));
  const restored = new DatabaseSync(resolve(target, "quotes.sqlite"));
  try {
    for (const [t, n] of Object.entries(counts))
      if (restored.prepare("SELECT count(*) AS n FROM " + t).get().n !== n)
        throw Error("Restore count mismatch: " + t);
    // Restored copies must require fresh authentication; preserve all quote records.
    restored.exec("DELETE FROM sessions; DELETE FROM limits;");
  } finally {
    restored.close();
  }
  console.log(
    "Backup verified and restored to " +
      target +
      ". Requests, revisions and uploads preserved; sessions revoked.",
  );
} finally {
  db.close();
}
