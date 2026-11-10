import { Viewer } from "../../public/viewer.js";
import { generate } from "../../shared/geometry.js";
import { families, finishes, materials } from "../../shared/schema.js";
import { guidedIntake } from "../../shared/intake-rules.js";
import { writePacket } from "../../shared/quote-packet.js";

const $ = (id) => document.getElementById(id);
const form = $("design");
const fields = $("fields");
const packet = $("packet");
const names = {
  depth: "Depth",
  width: "Width",
  thickness: "Thickness",
  textHeight: "Letter height",
  text: "Text",
  height: "Height",
  wall: "Wall thickness",
  columns: "Columns",
  rows: "Rows",
  holeDiameter: "Hole diameter",
  spacingX: "Horizontal spacing",
  spacingY: "Vertical spacing",
};
const counts = ["rows", "columns"];
let viewer;
try {
  viewer = new Viewer($("viewer"));
} catch {
  $("viewer").textContent =
    "3D is unavailable in this browser. You can still prepare a design packet.";
}
let ready = false;
let pending;
let packetId;

function options(select, values) {
  for (const [key, label] of values) select.add(new Option(label, key));
}
options($("family"), [
  ...Object.entries(families).map(([key, f]) => [key, f.name]),
  ["custom", "Custom idea"],
]);
options(
  $("material"),
  materials.map((v) => [v, v === "unsure" ? "I’m not sure" : v]),
);
options(
  $("finish"),
  finishes.map((v) => [v, v === "unsure" ? "I’m not sure" : v]),
);

function settings() {
  const family = $("family").value;
  const common = {
    notes: $("notes").value,
    quantity: $("quantity").valueAsNumber,
    color: $("color").value,
    material: $("material").value,
    finish: $("finish").value,
  };
  if (family === "custom")
    return {
      ...common,
      mode: "custom",
      brief: Object.fromEntries(
        [...$("brief").querySelectorAll("textarea")].map((el) => [
          el.name,
          el.value,
        ]),
      ),
    };
  return {
    ...common,
    mode: "configure",
    family,
    params: Object.fromEntries(
      [...fields.querySelectorAll("input")].map((el) => [
        el.name,
        el.type === "number" ? el.valueAsNumber : el.value,
      ]),
    ),
  };
}

function update() {
  clearTimeout(pending);
  ready = false;
  $("prepare").disabled = true;
  if (packet.value)
    $("packet-state").textContent =
      "This packet is from before your latest edit. Prepare an updated packet before sending, or keep this copy to retry the earlier design.";
  packetId = undefined;
  pending = setTimeout(() => {
    const s = settings();
    try {
      if (s.mode === "configure") {
        const mesh = generate(s.family, s.params);
        viewer?.setMesh(mesh, s.color);
        $("dimensions").textContent =
          mesh.checks.dimensionsMm
            .map((n) => Number(n.toFixed(2)))
            .join(" × ") + " mm";
      } else {
        viewer?.clear();
        $("dimensions").textContent =
          "Custom brief. Measurements remain unconfirmed.";
      }
      $("validation").textContent = "";
      ready = true;
      $("prepare").disabled = false;
    } catch (error) {
      $("validation").textContent =
        Object.values(error.errors || {}).join(" ") || error.message;
    }
  }, 120);
}

function showFamily() {
  const family = $("family").value;
  $("brief").hidden = family !== "custom";
  $("viewer").hidden = family === "custom";
  fields.replaceChildren();
  for (const [key, value] of Object.entries(families[family]?.defaults || {})) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    const numeric = typeof value === "number";
    label.textContent =
      names[key] + (numeric && !counts.includes(key) ? " (mm)" : "");
    input.name = key;
    input.type = numeric ? "number" : "text";
    if (numeric) input.step = counts.includes(key) ? "1" : "any";
    else input.maxLength = 32;
    input.required = true;
    input.value = value;
    label.append(input);
    fields.append(label);
  }
  update();
}

form.addEventListener("input", update);
$("family").addEventListener("change", showFamily);
$("guide").addEventListener("click", () => {
  $("guidance").textContent = guidedIntake(settings()).reply;
});
form.addEventListener("submit", (event) => event.preventDefault());
$("prepare").addEventListener("click", () => {
  if (!ready || !form.reportValidity()) return;
  try {
    packetId ||= Array.from(
      crypto.getRandomValues(new Uint8Array(16)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    packet.value = writePacket(settings(), packetId);
    $("packet-box").hidden = false;
    $("packet-state").textContent =
      "Packet ready. Copy it into the quote form’s Message field or attach the downloaded text file. Add your reference photo in the form, then send.";
    packet.focus();
  } catch (error) {
    $("validation").textContent = error.message;
  }
});
$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(packet.value);
    $("handoff-status").textContent = "Copied. Paste into the quote form.";
  } catch {
    packet.focus();
    packet.select();
    $("handoff-status").textContent =
      "Text selected. Use your device’s Copy command.";
  }
});
$("save").addEventListener("click", () => {
  const url = URL.createObjectURL(
    new Blob([packet.value], { type: "text/plain" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "printelligent-quote.txt";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
});
showFamily();
