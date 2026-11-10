import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { readPacket } from "../shared/quote-packet.js";

const build = resolve(import.meta.dirname, "../build/godaddy");
const snippet = await readFile(
  resolve(build, "paste-into-godaddy.html"),
  "utf8",
);
const html =
  String.raw`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Printelligent · GoDaddy handoff review</title>
<style>body{margin:0;font:16px/1.5 system-ui,sans-serif;color:#153236;background:#ecf5f4}header{padding:22px;background:#142424;color:white}header p{margin:4px 0}main{max-width:860px;margin:auto;padding:12px}iframe{width:100%;height:1150px;border:0;background:#f4f9f8}form{background:white;padding:16px;border-radius:12px}label,input,textarea{display:block;width:100%;box-sizing:border-box;margin-bottom:8px}input,textarea,button{font:inherit;padding:8px}button{background:#09535a;color:white;border:0;border-radius:6px;cursor:pointer}h1{font-size:clamp(24px,5vw,36px)}</style>
<header><p>PRINTELLIGENT DESIGNS · LOCAL REVIEW</p><h1>Try the quote handoff</h1><p>Sandboxed 3D preview and a simulated contact form. Use fictional data only.</p></header>
<main><iframe title="3D design widget" sandbox="allow-scripts allow-downloads" srcdoc="__SNIPPET__"></iframe>
<form id="contact"><h2>Simulated quote form</h2><p>Paste the packet into Message, or attach the packet as a text file. Choose a fictional reference photo.</p>
<label>Message<textarea name="message" rows="5" maxlength="32768"></textarea></label>
<label>Packet file<input type="file" name="packet" accept=".txt"></label>
<label>Reference photo<input type="file" name="photo" accept="image/png,image/jpeg" required></label>
<button>Simulate send</button><p id="result" role="status"></p></form></main>
<script>
const contact=document.querySelector('#contact');
const status=document.querySelector('#result');
contact.addEventListener('submit',async event=>{
  event.preventDefault();
  const button=contact.querySelector('button');
  button.disabled=true;
  try {
    const response=await fetch('/simulate',{method:'POST',body:new FormData(contact)});
    status.textContent=(await response.json()).message;
  } catch {status.textContent='Send interrupted. The packet and selected photo are still here. Retry when ready.';}
  finally {button.disabled=false;}
});
</script></html>`.replace("__SNIPPET__", () =>
    snippet
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;"),
  );

const origin = "http://localhost:4180";
const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "GET" && req.url === "/") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(html);
  }
  const reply = (status, message) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message }));
  };
  if (req.method !== "POST" || req.url !== "/simulate")
    return reply(404, "No public inbox or attachment endpoint.");
  if (req.headers.origin !== origin)
    return reply(403, "Only the local review form may submit.");
  if (+req.headers["content-length"] > 15_100_000)
    return reply(413, "Attachments exceed the simulated form limit.");
  try {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 15_100_000)
        return reply(413, "Attachments exceed the simulated form limit.");
      chunks.push(chunk);
    }
    const content = await new Request(origin, {
      method: "POST",
      headers: { "Content-Type": req.headers["content-type"] },
      body: Buffer.concat(chunks),
    }).formData();
    const file = content.get("packet");
    const photo = content.get("photo");
    if (
      !(photo instanceof File) ||
      !photo.size ||
      !["image/jpeg", "image/png"].includes(photo.type)
    )
      throw Error("Choose a fictional PNG or JPEG reference.");
    if (photo.size >= 10_000_000 || (file instanceof File && file.size > 32768))
      return reply(
        413,
        "Attachment exceeds the simulated limit. Your packet is still in the form.",
      );
    const text =
      String(content.get("message") || "").trim() ||
      (file instanceof File ? await file.text() : "");
    const packet = readPacket(text);
    const hash = createHash("sha256")
      .update(Buffer.from(await photo.arrayBuffer()))
      .digest("hex");
    const destination = resolve(build, `fixture-${packet.id}.json`);
    try {
      await writeFile(
        destination,
        JSON.stringify(
          {
            packetText: text,
            photo: { name: photo.name, bytes: photo.size, sha256: hash },
          },
          null,
          2,
        ),
        { flag: "wx" },
      );
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      return reply(
        409,
        `Packet ${packet.id} was already received by this simulator. The real form’s duplicate behavior is unverified.`,
      );
    }
    return reply(
      201,
      `Local simulator received packet ${packet.id} and ${photo.name} (${photo.size} bytes). No email was sent.`,
    );
  } catch (error) {
    return reply(400, error.message);
  }
});
server.listen(4180, "127.0.0.1", () =>
  console.log(`GoDaddy handoff simulation: ${origin}`),
);
