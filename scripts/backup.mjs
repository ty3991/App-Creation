import { DatabaseSync, backup } from "node:sqlite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.argv[2])
  throw Error("Provide a backup destination outside the Git repository.");
const db = new DatabaseSync(
  resolve(process.env.DATA_DIR || resolve(root, "data"), "quotes.sqlite"),
  { readOnly: true },
);
try {
  await backup(db, resolve(process.argv[2]));
  console.log(
    "SQLite backup completed. Includes uploads and private request data; keep it private.",
  );
} finally {
  db.close();
}
