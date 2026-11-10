import { DatabaseSync, backup } from "node:sqlite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { access, mkdir } from "node:fs/promises";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.argv[2])
  throw Error("Provide a backup destination outside the Git repository.");
const destination = resolve(process.argv[2]);
if (
  destination === root ||
  destination.startsWith(root + (process.platform === "win32" ? "\\" : "/"))
)
  throw Error("Keep private database backups outside the Git repository.");
if (
  await access(destination).then(
    () => true,
    () => false,
  )
)
  throw Error("Backup destination already exists. Choose a new filename.");
await mkdir(dirname(destination), { recursive: true });
const db = new DatabaseSync(
  resolve(process.env.DATA_DIR || resolve(root, "data"), "quotes.sqlite"),
  { readOnly: true },
);
try {
  await backup(db, destination);
  console.log(
    "SQLite backup completed. Includes uploads and private request data; keep it private.",
  );
} finally {
  db.close();
}
