import { families, unanswered, validate } from "./schema.js";

// Deterministic guidance: no model, external request, or inferred measurement.
export function guidedIntake(snapshot = {}) {
  const brief = snapshot.brief || {};
  const text = [
    snapshot.notes || "",
    brief.purpose || "",
    brief.fit || "",
  ].join(" ");
  const questions = [...unanswered(brief)];
  const clip = /\b(clip|latch|snap|broken)\b/i.test(text);
  if (clip)
    questions.unshift(
      "What is the clip opening and the size of the mating feature? Give measured values and units, or mark them unknown.",
      "What are the wall thickness, latch dimensions, direction of flex and required clearance?",
    );
  let family = null;
  if (!clip) {
    if (/\b(sign|nameplate|name plate)\b/i.test(text)) family = "sign";
    else if (/\b(tray|organizer|organiser)\b/i.test(text)) family = "tray";
    else if (/\b(mounting plate|hole pattern|mount plate)\b/i.test(text))
      family = "plate";
  }
  const proposal = family
    ? {
        family,
        params: { ...families[family].defaults },
        proposedFields: [],
        reason:
          "Your description mentions this design family. These are starter settings, NOT measurements taken from your description or photo. Confirm or edit every dimension before submitting.",
      }
    : null;
  if (proposal && Object.keys(validate(family, proposal.params)).length)
    throw Error("Invalid rule defaults");
  const unique = [...new Set(questions)];
  return {
    available: false,
    mode: "rules",
    reply:
      "Rule-based guidance — no AI service is used and photos are not interpreted. " +
      (clip
        ? "A replacement clip needs measured fit details; a size envelope cannot define its latch or flexibility. "
        : "") +
      (proposal
        ? "A configurable family may be a starting point. Review its starter settings before choosing it. "
        : "") +
      (unique.length
        ? "Start with these questions:\n" + unique.slice(0, 3).join("\n")
        : "Your brief covers the main topics. TJ will still confirm dimensions, tolerances and production options."),
    questions: unique.slice(0, 12),
    proposal,
  };
}
