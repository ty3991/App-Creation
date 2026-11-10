import { spawn } from "node:child_process";
import { open, readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import net from "node:net";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const data = resolve(
  process.env.QUOTE_DESK_LOCAL_DATA || resolve(root, "data"),
);
const stateFile = resolve(data, "local-runtime.json");
const command = process.argv[2] || "start";
const noBrowser = process.argv.includes("--no-browser");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const readState = () =>
  readFile(stateFile, "utf8")
    .then(JSON.parse)
    .catch(() => null);
async function health(state) {
  if (!state || !/^http:\/\/localhost:\d+$/.test(state.url)) return false;
  try {
    const r = await fetch(state.url + "/api/health", {
      signal: AbortSignal.timeout(1500),
    });
    const h = await r.json();
    return (
      r.ok &&
      h.app === "printelligent-quote-desk" &&
      h.status === "ready" &&
      h.instance === state.instance
    );
  } catch {
    return false;
  }
}
function openBrowser(url) {
  if (noBrowser) return;
  // Generated loopback URL only; never interpolated from a remote response.
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-Command", "Start-Process -FilePath " + "'" + url + "'"],
    { windowsHide: true, stdio: "ignore", detached: true },
  );
  child.on("error", () =>
    console.log("Open this address in your browser: " + url),
  );
  child.unref();
}
async function portAvailable(port) {
  return new Promise((resolveAvailable) => {
    const s = net.createServer();
    s.once("error", () => resolveAvailable(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolveAvailable(true)));
  });
}
async function main() {
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw Error(
      "Node.js 24 or newer is required. Install it from https://nodejs.org/ and open the launcher again.",
    );
  await mkdir(data, { recursive: true });
  const old = await readState();
  if (command === "stop") {
    if (!(await health(old))) {
      console.log(
        "Quote Desk is already stopped. No unrelated process was changed.",
      );
      return;
    }
    const r = await fetch(old.url + "/api/local/stop", {
      method: "POST",
      headers: { Origin: old.url, Authorization: "Bearer " + old.control },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok)
      throw Error(
        "Could not stop the verified app. Close it from its original terminal.",
      );
    for (let i = 0; i < 30; i++) {
      if (!(await health(old))) {
        await unlink(stateFile).catch(() => {});
        console.log("Quote Desk stopped. Saved requests are preserved.");
        return;
      }
      await pause(100);
    }
    throw Error("Shutdown is still finishing. Try Stop Quote Desk again.");
  }
  if (await health(old)) {
    console.log("Quote Desk is already running: " + old.url);
    openBrowser(old.url + (command === "owner" ? "/owner" : ""));
    return;
  }
  const lockFile = resolve(data, "local-launch.lock");
  let lock;
  try {
    lock = await open(lockFile, "wx");
  } catch {
    for (let i = 0; i < 40; i++) {
      await pause(250);
      const s = await readState();
      if (await health(s)) {
        console.log("Quote Desk is ready: " + s.url);
        openBrowser(s.url + (command === "owner" ? "/owner" : ""));
        return;
      }
    }
    throw Error(
      "Another start is still in progress, or a previous launch was interrupted. If no launcher is running, remove data/local-launch.lock and retry.",
    );
  }
  try {
    const first = Number(process.env.QUOTE_DESK_LOCAL_PORT || 4173);
    if (!Number.isInteger(first) || first < 1024 || first > 65520)
      throw Error("Choose a local port from 1024 to 65520.");
    let port;
    for (let p = first; p < first + 10; p++)
      if (await portAvailable(p)) {
        port = p;
        break;
      }
    if (!port)
      throw Error(
        "The local ports are busy. Close another local development server and retry.",
      );
    const state = {
      url: "http://localhost:" + port,
      instance: randomBytes(16).toString("hex"),
      control: randomBytes(32).toString("hex"),
    };
    const output = await open(resolve(data, "local-server.log"), "a");
    const child = spawn(
      process.execPath,
      ["--env-file-if-exists=../.env.local", resolve(root, "server.mjs")],
      {
        cwd: root,
        detached: true,
        windowsHide: true,
        stdio: ["ignore", output.fd, output.fd],
        env: {
          ...process.env,
          HOST: "127.0.0.1",
          PORT: String(port),
          PUBLIC_ORIGIN: state.url,
          DATA_DIR: data,
          AI_MODE: "rules",
          PD_LOCAL_INSTANCE: state.instance,
          PD_LOCAL_CONTROL: state.control,
        },
      },
    );
    let startError;
    child.on("error", (e) => {
      startError = e;
    });
    child.unref();
    await output.close();
    await writeFile(stateFile, JSON.stringify(state), { mode: 0o600 });
    for (let i = 0; i < 60; i++) {
      if (startError)
        throw Error("The server could not be started: " + startError.code);
      if (await health(state)) {
        console.log(
          "Quote Desk is ready: " +
            state.url +
            "\nFree rule-based guidance is enabled. Use Stop-QuoteDesk.cmd when finished.",
        );
        if (port !== first)
          console.log(
            "The usual port was occupied; the app safely selected " +
              port +
              ".",
          );
        openBrowser(state.url + (command === "owner" ? "/owner" : ""));
        return;
      }
      await pause(200);
    }
    throw Error(
      "Startup did not complete. Read data/local-server.log for details. No data was erased.",
    );
  } finally {
    await lock.close();
    await unlink(lockFile).catch(() => {});
  }
}
main().catch((e) => {
  console.error("\n" + e.message);
  process.exitCode = 1;
});
