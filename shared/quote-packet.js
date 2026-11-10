import { VERSION, families, finishes, materials, validate } from "./schema.js";

const header = "PRINTELLIGENT QUOTE PACKET 1\n";
export const packetLimit = 32768;
const briefFields = [
  "purpose",
  "fit",
  "measurements",
  "appearance",
  "conditions",
];

export function readPacket(text) {
  if (typeof text !== "string" || text.length > packetLimit)
    throw Error("Quote packet is too large.");
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized.startsWith(header))
    throw Error("Missing Printelligent quote packet header.");
  const packet = JSON.parse(normalized.slice(header.length));
  if (!packet || packet.version !== VERSION || packet.units !== "mm")
    throw Error("Unsupported generator version or units.");
  if (
    !/^[a-f0-9]{32}$/.test(packet.id) ||
    !["configure", "custom"].includes(packet.mode)
  )
    throw Error("Invalid packet identifier or design path.");
  if (
    !Number.isInteger(packet.quantity) ||
    packet.quantity < 1 ||
    packet.quantity > 10000
  )
    throw Error("Enter a quantity from 1 to 10,000.");
  if (
    !materials.includes(packet.material) ||
    !finishes.includes(packet.finish) ||
    !/^#[a-f0-9]{6}$/i.test(packet.color)
  )
    throw Error("Invalid appearance preferences.");
  if (typeof packet.notes !== "string" || packet.notes.length > 4000)
    throw Error("Notes must be at most 4,000 characters.");
  if (packet.mode === "configure") {
    const errors = validate(packet.family, packet.params);
    if (Object.keys(errors).length)
      throw Error(Object.values(errors).join(" "));
    packet.params = Object.fromEntries(
      Object.keys(families[packet.family].defaults).map((key) => [
        key,
        packet.params[key],
      ]),
    );
  } else {
    for (const key of briefFields)
      if (
        typeof packet.brief?.[key] !== "string" ||
        packet.brief[key].length > 1500
      )
        throw Error("Invalid custom brief field.");
    if (!packet.notes.trim() && !packet.brief.purpose.trim())
      throw Error("Describe what you want made.");
  }
  return packet;
}

export function writePacket(settings, id) {
  const text =
    header + JSON.stringify({ ...settings, id, version: VERSION, units: "mm" });
  return header + JSON.stringify(readPacket(text));
}
