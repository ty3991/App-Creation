import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { openStore, createOwner } from "../store.mjs";
if (!process.stdin.isTTY)
  throw Error(
    "Run owner setup in a private interactive terminal, or use the local browser setup.",
  );
const rl = createInterface({ input: process.stdin, output: process.stdout });
const email = await rl.question("Owner email: ");
rl.close();
async function secret(prompt) {
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return new Promise((resolveSecret, reject) => {
    let value = "";
    const done = (error) => {
      process.stdin.off("data", data);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      error ? reject(error) : resolveSecret(value);
    };
    const data = (chunk) => {
      for (const c of chunk) {
        if (c === "\r" || c === "\n") {
          done();
          return;
        }
        if (c === "\u0003") {
          done(Error("Setup cancelled."));
          return;
        }
        if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
        else if (c.charCodeAt(0) >= 32) value += c;
      }
    };
    process.stdin.on("data", data);
  });
}
const password = await secret("Password (12–256 characters; hidden): ");
if (password !== (await secret("Confirm password (hidden): ")))
  throw Error("Passwords did not match. Nothing was changed.");
const db = openStore(
  resolve(process.env.DATA_DIR || resolve(import.meta.dirname, "../data")),
);
try {
  createOwner(db, email, password);
  console.log("Owner account created. Sign in at /owner.");
} finally {
  db.close();
}
