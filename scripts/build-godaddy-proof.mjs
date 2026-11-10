import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const out = resolve(root, "build/godaddy");
const browserGeometry = {
  name: "self-contained-browser-geometry",
  setup(build) {
    build.onResolve({ filter: /^\/vendor\// }, (args) => ({
      path: resolve(root, "." + args.path),
    }));
    build.onLoad({ filter: /[\\/]shared[\\/]geometry\.js$/ }, async (args) => {
      const source = await readFile(args.path, "utf8");
      if (!source.includes("await Module()"))
        throw Error("Review geometry initialization before bundling.");
      return {
        contents:
          'import wasmBinary from "../vendor/manifold/manifold.wasm";\n' +
          source.replace("await Module()", "await Module({ wasmBinary })"),
        loader: "js",
      };
    });
  },
};
const result = await build({
  absWorkingDir: root,
  entryPoints: ["proof/godaddy/embed.js"],
  bundle: true,
  write: false,
  minify: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  external: ["node:*"],
  loader: { ".wasm": "binary" },
  plugins: [browserGeometry],
});
const markup = await readFile(
  resolve(root, "proof/godaddy/embed.html"),
  "utf8",
);
const licenses = await Promise.all(
  ["manifold", "three"].map((name) =>
    readFile(resolve(root, "vendor", name, "LICENSE"), "utf8"),
  ),
);
const code = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const snippet = `<!-- Included dependencies\n${licenses.join("\n")}\n-->\n${markup}\n<script type="module">${code}</script>\n`;
await mkdir(out, { recursive: true });
await writeFile(resolve(out, "paste-into-godaddy.html"), snippet);
console.log(
  `GoDaddy proof generated (${Buffer.byteLength(snippet).toLocaleString()} bytes): ${out}`,
);
