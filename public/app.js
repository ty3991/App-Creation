import {
  families,
  validate,
  dimensions,
  holeCenters,
  questionLabels,
  unanswered,
  cadPrompt,
  quoteTotal,
} from "/shared/schema.js";
import { guidedIntake } from "/shared/intake-rules.js";
import { Viewer } from "./viewer.js";
const $ = (s) => document.querySelector(s),
  app = $("#app");
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const defaults = () => ({
  mode: "configure",
  family: "sign",
  configs: Object.fromEntries(
    Object.entries(families).map(([k, v]) => [k, { ...v.defaults }]),
  ),
  units: "mm",
  color: "#087d82",
  material: "unsure",
  finish: "unsure",
  quantity: 1,
  notes: "",
  brief: {
    purpose: "",
    fit: "",
    measurements: "",
    appearance: "",
    conditions: "",
  },
  attachments: [],
  questions: [],
  history: [],
  contact: { name: "", email: "", phone: "" },
  mockup: null,
});
const memoryDraft = new Map();
const draftStorage = {
  getItem(k) {
    try {
      return sessionStorage.getItem(k) ?? memoryDraft.get(k) ?? null;
    } catch {
      return memoryDraft.get(k) ?? null;
    }
  },
  setItem(k, v) {
    memoryDraft.set(k, v);
    try {
      sessionStorage.setItem(k, v);
    } catch {
      toast(
        "Browser draft storage is full or unavailable. Keep this tab open until your request is confirmed.",
      );
    }
  },
  removeItem(k) {
    memoryDraft.delete(k);
    try {
      sessionStorage.removeItem(k);
    } catch {}
  },
};
let ownerDirty = false;
function markOwnerDirty() {
  ownerDirty = true;
  for (const id of ["approve", "download-stl", "download-manifest"]) {
    const el = $("#" + id);
    if (el) el.disabled = true;
  }
  const notice = $("#owner-dirty");
  if (notice) {
    notice.hidden = false;
    notice.textContent =
      "Unsaved working changes. Save a new revision before approving or exporting this design.";
  }
}
let state;
try {
  state = {
    ...defaults(),
    ...JSON.parse(draftStorage.getItem("pd-draft") || "{}"),
  };
} catch {
  state = defaults();
}
let viewer,
  mesh,
  worker,
  pending = false,
  generation = 0,
  errors = {},
  config,
  reviewPayload,
  ownerQuote,
  ownerRevision,
  ownerState,
  queue = [],
  proposal = null,
  guideIndex = 0;
function persist() {
  draftStorage.setItem("pd-draft", JSON.stringify(state));
}
function toast(s) {
  const e = $("#toast");
  e.textContent = s;
  e.style.display = "block";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (e.style.display = "none"), 6000);
}
async function api(path, data) {
  const res = await fetch(path, {
    signal: AbortSignal.timeout(45000),
    method: data === undefined ? "GET" : "POST",
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await res.json();
  if (!res.ok)
    throw Object.assign(Error(result.error || "Request failed"), {
      status: res.status,
      errors: result.errors,
    });
  return result;
}
function action(id, fn) {
  const e = $(id);
  if (e)
    e.addEventListener("click", async (ev) => {
      if (e.dataset.busy) return;
      e.dataset.busy = "1";
      try {
        await fn(ev);
      } catch (err) {
        toast(err.message);
      } finally {
        delete e.dataset.busy;
      }
    });
}
function dispose() {
  generation++;
  pending = false;
  if (viewer) {
    viewer.dispose();
    viewer = null;
  }
}
function previewHTML() {
  return `<div class="preview-card"><div class="preview-top"><span class="badge" id="preview-badge">LIVE DESIGN PREVIEW</span><button type="button" id="reset-view">↻ Reset view</button></div><div class="viewer" id="viewer"></div><div class="preview-bottom"><span class="dimension-label" id="dimensions">Preparing geometry…</span><span>Drag to rotate · Scroll to zoom</span></div></div><div class="preview-caption"><span>Preview colors are illustrative.</span><span>Dimensions shown in mm</span></div><div id="preview-notice" role="status"></div>`;
}
function mountViewer(previous) {
  try {
    viewer = new Viewer($("#viewer"));
    if (previous) {
      viewer.camera.position.copy(previous.position);
      viewer.controls.target.copy(previous.target);
    }
    action("#reset-view", () => viewer.reset());
  } catch {
    $("#viewer").innerHTML =
      '<div class="empty">3D display is unavailable on this device. You can still enter dimensions, describe your idea and submit. A preview image may be unavailable.</div>';
    viewer = null;
  }
}
function setMesh(m, s) {
  mesh = m;
  viewer?.setMesh(m, s.color);
  $("#dimensions").textContent =
    m.checks.dimensionsMm.map((n) => Number(n.toFixed(2))).join(" × ") + " mm";
  $("#preview-badge").textContent = "LIVE DESIGN PREVIEW";
  const over = m.checks.dimensionsMm.some(
    (n, i) => n > config.printerVolume[i],
  );
  $("#preview-notice").innerHTML = over
    ? '<div class="notice warn">This part exceeds the configured printer volume. TJ will review whether it needs splitting or a different production plan.</div>'
    : "";
}
function updatePreview(s = state) {
  if (s.mode === "custom") {
    generation++;
    pending = false;
    mesh = null;
    const m = s.mockup;
    const invalid =
      m &&
      Object.values(m).some(
        (v) => v !== null && (!Number.isFinite(v) || v < 1 || v > 500),
      );
    if (invalid) {
      $("#preview-notice").innerHTML =
        '<div class="notice warn">Envelope measurements must be 1–500 mm, or left blank when unknown. The last valid preview is preserved.</div>';
      if ($("#review")) $("#review").disabled = true;
      return;
    }
    if ($("#review")) $("#review").disabled = false;
    $("#preview-badge").textContent = m
      ? "APPROXIMATE SIZE ENVELOPE"
      : "CUSTOM IDEA / BRIEF";
    if (m) {
      viewer?.envelope(m, s.color);
      $("#dimensions").textContent =
        ["width", "depth", "height"]
          .map((k) => (m[k] === null ? "?" : m[k]))
          .join(" × ") + " mm";
      $("#preview-notice").innerHTML =
        '<div class="notice warn">Rough size envelope only—not the shape of your part or production CAD. Dashed geometry uses 60 × 40 × 20 mm placeholders wherever dimensions are unknown.</div>';
    } else {
      viewer?.clear();
      $("#dimensions").textContent = "Shape and dimensions not yet confirmed";
      $("#preview-notice").innerHTML =
        '<div class="notice">A clear brief is enough to begin. You don’t need a finished model to request a quote.</div>';
    }
    return;
  }
  const p = s.configs[s.family];
  errors = validate(s.family, p);
  for (const k of Object.keys(families[s.family].defaults)) {
    const e = $("#error-" + k),
      input = $("#param-" + k);
    if (e) e.textContent = errors[k] || "";
    input?.setAttribute("aria-invalid", !!errors[k]);
  }
  const button = $("#review");
  if (Object.keys(errors).length) {
    pending = false;
    generation++;
    if (button) button.disabled = true;
    if (!mesh)
      $("#dimensions").textContent = "Correct the settings to create a preview";
    $("#preview-notice").innerHTML = mesh
      ? '<div class="notice warn">The preview shows your last valid design. Correct the highlighted settings to update it.</div>'
      : '<div class="notice warn">Correct the highlighted settings to create your preview.</div>';
    return;
  }
  pending = true;
  if (button) button.disabled = true;
  const id = ++generation;
  clearTimeout(updatePreview.timer);
  updatePreview.timer = setTimeout(
    () => worker.postMessage({ id, family: s.family, params: p }),
    100,
  );
}
function numericField(
  key,
  label,
  value,
  { wide = false, hint = "", unit = "mm", step = "0.1" } = {},
) {
  return `<label class="field ${wide ? "wide" : ""}"><span class="label">${label}${unit ? " (" + unit + ")" : ""}</span><input id="param-${key}" data-param="${key}" type="number" step="${step}" value="${Number.isFinite(value) ? Number(value.toFixed(4)) : ""}" inputmode="decimal" aria-describedby="error-${key}"><span class="error" id="error-${key}"></span>${hint ? '<span class="hint">' + hint + "</span>" : ""}</label>`;
}
function paramFields(s) {
  const p = s.configs[s.family],
    unit = s.units || "mm",
    n = (k) => p[k] / (unit === "in" ? 25.4 : 1);
  let html =
    numericField("width", "Width", n("width"), { unit }) +
    numericField(
      "depth",
      s.family === "sign" ? "Height" : "Depth",
      n("depth"),
      { unit },
    ) +
    numericField(
      "thickness",
      s.family === "tray" ? "Floor thickness" : "Thickness",
      n("thickness"),
      { unit },
    );
  if (s.family === "sign")
    html +=
      numericField("textHeight", "Raised lettering", n("textHeight"), {
        unit,
      }) +
      `<label class="field wide"><span class="label">Your text</span><input id="param-text" data-param="text" maxlength="32" value="${esc(p.text)}" aria-describedby="error-text"><span class="error" id="error-text"></span><span class="hint">Lettering automatically fits inside an 8 mm total margin.</span></label>`;
  if (s.family === "tray")
    html +=
      numericField("height", "Outside height", n("height"), { unit }) +
      numericField("wall", "Wall thickness", n("wall"), { unit }) +
      numericField("columns", "Compartments", p.columns, {
        unit: "",
        step: "1",
        hint: "Equal compartments across the width. Dimensions are outside dimensions.",
      });
  if (s.family === "plate")
    html +=
      numericField("holeDiameter", "Hole diameter", n("holeDiameter"), {
        unit,
      }) +
      numericField("columns", "Hole columns", p.columns, {
        unit: "",
        step: "1",
      }) +
      numericField("rows", "Hole rows", p.rows, { unit: "", step: "1" }) +
      numericField("spacingX", "Horizontal spacing", n("spacingX"), {
        unit,
        hint: "Center to center. Pattern is centered.",
      }) +
      numericField("spacingY", "Vertical spacing", n("spacingY"), {
        unit,
        hint: "Center to center.",
      });
  return html;
}
function settingsHTML(s) {
  return `<div class="section-label"><h3>Make it yours</h3><div class="unit-switch"><button data-unit="mm" class="${s.units === "mm" ? "selected" : ""}">mm</button><button data-unit="in" class="${s.units === "in" ? "selected" : ""}">in</button></div></div><div class="fields" id="params">${paramFields(s)}</div>`;
}
function preferencesHTML(s) {
  return `<div class="section-label"><h3>Color & production preferences</h3></div><span class="label">Preview color</span><div class="swatches">${["#087d82", "#d5a86e", "#efe8d8", "#353c3d", "#92769d", "#bd6c50"].map((c) => `<button class="swatch ${s.color === c ? "selected" : ""}" data-color="${c}" aria-label="Preview color ${c}" aria-pressed="${s.color === c}"></button>`).join("")}<input type="color" class="color-picker" id="color-custom" aria-label="Custom preview color" value="${s.color}"></div><p class="hint">Color, finish and material availability are confirmed during review.</p><div class="fields"><label class="field"><span class="label">Material preference</span><select id="material">${["unsure", "PLA", "PETG", "ASA"].map((x) => `<option value="${x}" ${s.material === x ? "selected" : ""}>${x === "unsure" ? "I’m not sure" : x}</option>`).join("")}</select></label><label class="field"><span class="label">Quantity</span><input type="number" id="quantity" min="1" max="10000" step="1" value="${s.quantity}"></label><label class="field wide"><span class="label">Finish preference</span><select id="finish">${["unsure", "visible layer lines okay", "smooth appearance preferred"].map((x) => `<option value="${x}" ${s.finish === x ? "selected" : ""}>${x === "unsure" ? "I’m not sure" : x}</option>`).join("")}</select></label></div>`;
}
function attachmentsHTML(s, owner = false) {
  return `<label class="upload-zone">＋ Add ${owner ? "production CAD, STL or references" : "photos, sketches or model files"}<br><span class="hint">Up to 8 files · 8 MB each · Private to this request</span><input id="upload" type="file" multiple accept=".png,.jpg,.jpeg,.webp,.pdf,.stl,.3mf,.step,.stp${owner ? ",.scad,.py" : ""}"></label><div class="attachments" id="attachments">${attachmentRows(s)}</div>`;
}
function attachmentRows(s) {
  return s.attachments
    .map(
      (a) =>
        `<div class="attachment"><a href="/api/files/${a.id}" target="_blank" rel="noopener">↗ ${esc(a.name)} · ${Math.ceil(a.size / 1024)} KB</a><button type="button" data-remove="${a.id}" aria-label="Remove ${esc(a.name)}">×</button></div>`,
    )
    .join("");
}
function customHTML() {
  return `<h3>Tell us what you have in mind.</h3><p class="muted">A rough idea, a broken part, a sketch—we can start there.</p><label class="field"><span class="label">Your idea</span><textarea id="notes" rows="4" maxlength="10000" placeholder="I need a replacement clip for…">${esc(state.notes)}</textarea></label>${attachmentsHTML(state)}<div class="guide-box"><h3>A little help shaping your brief</h3><p class="muted">Answer directly below, or talk it through. Suggested designs always need your confirmation.</p><div id="conversation" class="conversation">${state.history.map((m) => `<div class="message ${m.role === "user" ? "user" : ""}">${esc(m.text)}</div>`).join("")}</div><label class="field"><span class="label">Add a message</span><textarea id="chat-message" rows="2" placeholder="What measurements do you need from me?"></textarea></label><button class="secondary full" id="ask-ai">${config.aiConfigured ? "Ask optional AI" : "Get free guided help"}</button><p class="hint">${config.aiConfigured ? "Your description and up to two supported photos are sent to OpenAI only when you select this button. You can submit without AI." : "Rule-based guidance · No AI charges · Photos stay with your private request and are not interpreted."}</p><div id="proposal"></div></div><div class="section-label"><h3>The useful details</h3><button class="quiet" id="guide-next">One at a time →</button></div><div id="brief-fields">${Object.entries(
    questionLabels,
  )
    .map(
      ([k, label]) =>
        `<label class="field brief-field" data-brief-field="${k}"><span class="label">${label}</span><textarea data-brief="${k}" maxlength="3000" rows="2" placeholder="I’m not sure yet is okay">${esc(state.brief[k])}</textarea></label>`,
    )
    .join(
      "",
    )}</div><div id="missing-questions"></div><details><summary>Show a rough size envelope</summary><p class="hint">Optional bounding box, not a clip or detailed CAD model. Leave unknown measurements blank.</p><label class="check-label"><input type="checkbox" id="mockup-on" ${state.mockup ? "checked" : ""}>Show approximate envelope</label><div class="fields">${["width", "depth", "height"].map((k) => `<label class="field"><span class="label">${k} (mm)</span><input data-mockup="${k}" type="number" min="1" max="500" placeholder="Unconfirmed" value="${state.mockup?.[k] ?? ""}"></label>`).join("")}</div></details>`;
}
function renderDesigner() {
  const previous = viewer
    ? {
        position: viewer.camera.position.clone(),
        target: viewer.controls.target.clone(),
      }
    : null;
  dispose();
  app.innerHTML = `<main class="page"><div class="intro"><div><p class="eyebrow">YOUR IDEA, TAKING SHAPE</p><h1>A good idea.<br><em>A part that fits.</em></h1><p class="intro-copy">Make something your own, or tell us what you need.<br>We’ll turn the details into a thoughtful, personal quote.</p></div><p class="promise">Every request is reviewed by TJ.<br>No automatic prices. No commitment.</p></div><div class="steps"><span class="active"><span class="step-no">01</span>Shape your idea</span><span><span class="step-no">02</span>Review the details</span><span><span class="step-no">03</span>Request a quote</span></div><div class="workspace"><section class="editor"><div class="tabs"><button data-mode="configure" class="${state.mode === "configure" ? "selected" : ""}">Customize a design</button><button data-mode="custom" class="${state.mode === "custom" ? "selected" : ""}">Develop an idea</button></div>${
    state.mode === "configure"
      ? `<div class="family-cards">${Object.entries(families)
          .map(
            ([k, f], i) =>
              `<button class="family-card ${state.family === k ? "selected" : ""}" data-family="${k}"><span class="family-icon">${["▰", "▥", "⠿"][i]}</span><span><strong>${f.name}</strong><small>${f.description}</small></span><span class="check">${state.family === k ? "✓" : "↗"}</span></button>`,
          )
          .join("")}</div>${settingsHTML(state)}`
      : customHTML()
  }${preferencesHTML(state)}${state.mode === "configure" ? `<div class="section-label"><h3>Anything else we should know?</h3></div><textarea class="text-input" id="notes" aria-label="Additional notes" maxlength="10000" rows="3" placeholder="Where it will go, how it should fit, or any questions…">${esc(state.notes)}</textarea>${attachmentsHTML(state)}` : ""}<button class="primary full review-button" id="review">Review my request <span>→</span></button><p class="hint">You’ll add contact details and review everything before submitting.</p></section><section class="preview-column">${previewHTML()}<div class="preview-aside"><span class="aside-icon">◈</span><p><strong>Built around your needs.</strong>Dimensions, fit and purpose come first. We’ll select the print settings after reviewing your request.</p></div></section></div></main>`;
  mountViewer(previous);
  bindEditor(state, false);
  document.querySelectorAll("[data-mode]").forEach(
    (e) =>
      (e.onclick = () => {
        state.mode = e.dataset.mode;
        persist();
        renderDesigner();
      }),
  );
  document.querySelectorAll("[data-family]").forEach(
    (e) =>
      (e.onclick = () => {
        state.family = e.dataset.family;
        persist();
        renderDesigner();
      }),
  );
  document
    .querySelectorAll("[data-mode],[data-family],[data-unit]")
    .forEach((e) =>
      e.setAttribute("aria-pressed", e.classList.contains("selected")),
    );
  action("#review", review);
  if (state.mode === "custom") bindCustom();
  updatePreview();
}
function bindEditor(s, owner) {
  const save = () => {
    if (!owner) persist();
    else markOwnerDirty();
  };
  document.querySelectorAll("[data-param]").forEach((e) =>
    e.addEventListener("input", () => {
      const k = e.dataset.param;
      let v = k === "text" ? e.value : e.value === "" ? NaN : Number(e.value);
      if (k !== "text" && !["rows", "columns"].includes(k) && s.units === "in")
        v *= 25.4;
      s.configs[s.family][k] = v;
      save();
      updatePreview(s);
    }),
  );
  document.querySelectorAll("[data-unit]").forEach(
    (e) =>
      (e.onclick = () => {
        s.units = e.dataset.unit;
        save();
        owner ? renderOwnerDetail() : renderDesigner();
      }),
  );
  document.querySelectorAll("[data-color]").forEach((e) => {
    e.style.backgroundColor = e.dataset.color;
    e.onclick = () => {
      s.color = e.dataset.color;
      viewer?.color(s.color);
      save();
      document.querySelectorAll("[data-color]").forEach((b) => {
        b.classList.toggle("selected", b.dataset.color === s.color);
        b.setAttribute("aria-pressed", b.dataset.color === s.color);
      });
      $("#color-custom").value = s.color;
    };
  });
  $("#color-custom").oninput = (e) => {
    s.color = e.target.value;
    viewer?.color(s.color);
    save();
  };
  for (const id of ["material", "finish", "quantity", "notes"]) {
    const e = $("#" + id);
    if (e)
      e.oninput = () => {
        s[id] = id === "quantity" ? Number(e.value) : e.value;
        save();
        if (!owner && s.mode === "custom") showMissing();
      };
  }
  const upload = $("#upload");
  if (upload)
    upload.onchange = async () => {
      upload.disabled = true;
      try {
        for (const file of upload.files) {
          if (s.attachments.length >= 8) throw Error("Attach up to 8 files.");
          if (file.size > 8 * 1024 * 1024)
            throw Error("Each file must be smaller than 8 MB.");
          const data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(",")[1]);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          s.attachments.push(
            await api(owner ? "/api/owner/uploads" : "/api/uploads", {
              name: file.name,
              data,
            }),
          );
          save();
        }
        refreshAttachments(s, save);
        toast("Files attached privately.");
      } catch (e) {
        toast(e.message);
      } finally {
        upload.disabled = false;
        upload.value = "";
      }
    };
  refreshAttachments(s, save);
}
function refreshAttachments(s, save) {
  const e = $("#attachments");
  if (!e) return;
  e.innerHTML = attachmentRows(s);
  e.querySelectorAll("[data-remove]").forEach(
    (b) =>
      (b.onclick = () => {
        s.attachments = s.attachments.filter((a) => a.id !== b.dataset.remove);
        save();
        refreshAttachments(s, save);
      }),
  );
}
function showMissing() {
  if (!$("#missing-questions")) return;
  const clip = /clip|latch|snap/i.test(state.notes),
    extra = clip
      ? [
          "Measure the clip opening and the mating feature it grips.",
          "Confirm the wall thickness, latch dimensions and direction of flex.",
        ]
      : [];
  const qs = [
    ...new Set([...unanswered(state.brief), ...extra, ...state.questions]),
  ];
  $("#missing-questions").innerHTML = qs.length
    ? `<div class="notice warn"><strong>Still useful to confirm</strong><ul class="question-list">${qs.map((q) => `<li>${esc(q)}</li>`).join("")}</ul><p class="small">You can submit now. These open questions will travel with your brief.</p></div>`
    : "";
}
function bindCustom() {
  showMissing();
  document.querySelectorAll("[data-brief]").forEach(
    (e) =>
      (e.oninput = () => {
        state.brief[e.dataset.brief] = e.value;
        persist();
        showMissing();
      }),
  );
  action("#guide-next", () => {
    const fields = [...document.querySelectorAll(".brief-field")];
    fields.forEach((e, i) =>
      e.classList.toggle("hidden", i !== guideIndex % fields.length),
    );
    fields[guideIndex % fields.length].querySelector("textarea").focus();
    guideIndex++;
    $("#guide-next").textContent = "Next question →";
  });
  $("#mockup-on").onchange = (e) => {
    state.mockup = e.target.checked
      ? { width: null, depth: null, height: null }
      : null;
    persist();
    updatePreview();
  };
  document.querySelectorAll("[data-mockup]").forEach(
    (e) =>
      (e.oninput = () => {
        if (!state.mockup) {
          state.mockup = { width: null, depth: null, height: null };
          $("#mockup-on").checked = true;
        }
        state.mockup[e.dataset.mockup] =
          e.value === "" ? null : Number(e.value);
        persist();
        updatePreview();
      }),
  );
  action("#ask-ai", async () => {
    const btn = $("#ask-ai");
    btn.disabled = true;
    btn.textContent = config.aiConfigured
      ? "Thinking through your idea…"
      : "Preparing measurement questions…";
    try {
      const msg = $("#chat-message").value.trim();
      if (msg) {
        state.history.push({ role: "user", text: msg });
        state.notes += (state.notes ? "\n" : "") + msg;
        $("#notes").value = state.notes;
        $("#chat-message").value = "";
      }
      const r = await api("/api/intake", {
        notes: state.notes,
        brief: state.brief,
        quantity: state.quantity,
        history: state.history,
        attachmentIds: state.attachments.map((a) => a.id),
      });
      state.history.push({ role: "assistant", text: r.reply });
      state.questions = [
        ...new Set([...state.questions, ...r.questions]),
      ].slice(-12);
      proposal = r.proposal;
      $("#proposal").innerHTML = "";
      persist();
      $("#conversation").innerHTML = state.history
        .map(
          (m) =>
            `<div class="message ${m.role === "user" ? "user" : ""}">${esc(m.text)}</div>`,
        )
        .join("");
      $("#conversation").scrollTop = 999999;
      showMissing();
      if (proposal) {
        $("#proposal").innerHTML =
          `<div class="notice"><strong>Suggested: ${families[proposal.family].name}</strong><p>${esc(proposal.reason)}</p><pre>${esc(JSON.stringify(proposal.params, null, 2))}</pre><button class="primary" id="apply-proposal">Use these proposed settings</button><p class="hint">Settings are in millimeters. Confirm any suggested default dimensions before submitting.</p></div>`;
        action("#apply-proposal", () => {
          if (Object.keys(validate(proposal.family, proposal.params)).length)
            throw Error("Invalid proposed settings");
          state.family = proposal.family;
          state.configs[proposal.family] = proposal.params;
          state.mode = "configure";
          persist();
          renderDesigner();
        });
      }
    } finally {
      btn.disabled = false;
      btn.textContent = config.aiConfigured
        ? "Ask optional AI"
        : "Get free guided help";
    }
  });
}
function payload(s) {
  let qs = [...(s.questions || [])];
  if (s.mode === "custom" && /clip|latch|snap/i.test(s.notes))
    qs.push(
      "Confirm clip opening, mating feature dimensions, wall thickness, latch dimensions and flex direction.",
    );
  return {
    mode: s.mode,
    family: s.family,
    params:
      s.mode === "configure" ? structuredClone(s.configs[s.family]) : null,
    quantity: s.quantity,
    material: s.material,
    finish: s.finish,
    color: s.color,
    notes: s.notes,
    brief: s.brief,
    contact: s.contact,
    attachmentIds: s.attachments.map((a) => a.id),
    questions: [...new Set(qs)],
    mockup: s.mockup,
    previewImage: viewer?.snapshot() || null,
  };
}
function summaryHTML(s) {
  const p = s.params || {};
  return `<table class="summary-table"><tbody><tr><td>Design</td><td>${s.mode === "configure" ? families[s.family].name : "Custom idea"}</td></tr>${Object.entries(
    p,
  )
    .map(
      ([k, v]) =>
        `<tr><td>${esc(k)}</td><td>${esc(v)}${typeof v === "number" && !["rows", "columns"].includes(k) ? " mm" : ""}</td></tr>`,
    )
    .join(
      "",
    )}<tr><td>Quantity</td><td>${s.quantity}</td></tr><tr><td>Material</td><td>${s.material === "unsure" ? "Not sure yet" : esc(s.material)}</td></tr><tr><td>Preview color</td><td>${esc(s.color)}</td></tr><tr><td>Finish</td><td>${esc(s.finish)}</td></tr></tbody></table>`;
}
function review() {
  if (
    pending ||
    (state.mode === "configure" &&
      Object.keys(validate(state.family, state.configs[state.family])).length)
  )
    throw Error("Wait for valid geometry before reviewing.");
  if (
    !Number.isInteger(state.quantity) ||
    state.quantity < 1 ||
    state.quantity > 10000
  )
    throw Error("Choose a quantity from 1 to 10,000.");
  if (
    state.mockup &&
    Object.values(state.mockup).some(
      (v) => v !== null && (!Number.isFinite(v) || v < 1 || v > 500),
    )
  )
    throw Error("Correct the envelope measurements or leave them blank.");
  reviewPayload = payload(state);
  dispose();
  app.innerHTML = `<main class="page"><p class="eyebrow">ONE LAST LOOK</p><h1>Your idea, <em>ready for review.</em></h1><p class="intro-copy">Check the design and details below. TJ will review fit, production options and pricing personally.</p><div class="steps"><span>01 Shape your idea</span><span class="active">02 Review the details</span><span>03 Request a quote</span></div><div class="review-grid"><div class="panel">${reviewPayload.previewImage ? `<img class="review-image" alt="Frozen preview of your submitted design" src="${reviewPayload.previewImage}">` : '<p class="muted">No preview image available. Your exact settings and brief will be saved.</p>'}${summaryHTML(reviewPayload)}${state.mode === "custom" ? '<div class="notice warn">Custom idea: no production geometry is approved. Any size envelope is approximate.</div>' : ""}</div><div><section class="panel"><h2>Your brief & references</h2><p class="text-block">${esc(state.notes || "No additional notes.")}</p>${Object.entries(
    state.brief,
  )
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<h3>${questionLabels[k]}</h3><p class="text-block">${esc(v)}</p>`,
    )
    .join(
      "",
    )}<div class="attachments">${state.attachments.map((a) => `<div class="attachment">${esc(a.name)}</div>`).join("") || '<p class="muted">No attachments.</p>'}</div>${state.mode === "custom" ? `<h3>Unconfirmed details</h3><ul class="question-list">${[...new Set([...unanswered(state.brief), ...reviewPayload.questions])].map((q) => `<li>${esc(q)}</li>`).join("")}</ul>` : ""}</section><section class="panel"><h2>Where should we follow up?</h2><form id="submit-form"><div class="fields"><label class="field wide"><span class="label">Your name</span><input id="name" required maxlength="100" autocomplete="name" value="${esc(state.contact.name)}"></label><label class="field wide"><span class="label">Email address</span><input id="email" required type="email" maxlength="254" autocomplete="email" value="${esc(state.contact.email)}"></label><label class="field wide"><span class="label">Phone (optional)</span><input id="phone" type="tel" maxlength="40" autocomplete="tel" value="${esc(state.contact.phone)}"></label></div><label class="check-label"><input id="consent" type="checkbox" required>I understand this is a quote request. Pricing, production options and any unconfirmed dimensions require review.</label><div class="actions"><button class="quiet" type="button" id="back">← Keep editing</button><button class="primary" id="submit" type="submit">Send quote request →</button></div><p class="inline-error" id="submit-error" role="alert"></p></form></section></div></div></main>`;
  action("#back", () => {
    draftStorage.removeItem("pd-pending");
    renderDesigner();
  });
  $("#submit-form").onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("#submit");
    btn.disabled = true;
    $("#submit-error").textContent = "";
    try {
      let frozen;
      const previous = draftStorage.getItem("pd-pending");
      if (previous) frozen = JSON.parse(previous);
      else {
        state.contact = {
          name: $("#name").value.trim(),
          email: $("#email").value.trim(),
          phone: $("#phone").value.trim(),
        };
        persist();
        frozen = {
          ...reviewPayload,
          contact: state.contact,
          idempotencyKey: crypto.randomUUID(),
        };
        draftStorage.setItem("pd-pending", JSON.stringify(frozen));
      }
      const r = await api("/api/quotes", frozen);
      draftStorage.removeItem("pd-draft");
      draftStorage.removeItem("pd-pending");
      app.innerHTML = `<main class="page"><section class="success panel"><div class="success-symbol">✓</div><p class="eyebrow">YOUR IDEA IS IN GOOD HANDS</p><h1>Request received.</h1><p class="request-number">${esc(r.number)}</p><p>TJ will review your design, references and open questions, then follow up using the contact details you provided.</p><p class="muted">Your submitted revision is saved exactly as sent. This confirmation is not a price or production approval.</p><a class="primary" href="/">Start another idea →</a></section></main>`;
    } catch (err) {
      $("#submit-error").textContent =
        err.message +
        " Your frozen request is saved for retry. To change any details, select Keep editing.";
      btn.textContent = "Retry the same request";
    } finally {
      btn.disabled = false;
    }
  };
}
async function owner() {
  dispose();
  try {
    const r = await api("/api/owner/quotes");
    queue = r.quotes;
    renderQueue();
  } catch (e) {
    if (e.status !== 401) throw e;
    renderLogin();
  }
}
function renderLogin() {
  app.innerHTML = `<main class="page"><section class="panel login-panel"><p class="eyebrow">PRIVATE OWNER WORKSPACE</p><h1>Welcome back, TJ.</h1><p class="muted">Review requests, refine designs and prepare a personal quote.</p><form id="login"><label class="field"><span class="label">Owner email</span><input id="owner-email" type="email" required autocomplete="username"></label><label class="field"><span class="label">Password</span><input id="owner-password" type="password" required autocomplete="current-password"></label><button class="primary full">Sign in →</button><p class="inline-error" id="login-error" role="alert"></p></form><details><summary>First time? Create your owner login</summary><p class="muted">Open the local data/owner-setup-token.txt file. This setup works only on the server’s own computer.</p><form id="setup"><label class="field"><span class="label">Local setup token</span><input id="setup-token" required autocomplete="off"></label><label class="field"><span class="label">Owner email</span><input id="setup-email" type="email" required></label><label class="field"><span class="label">New password (12+ characters)</span><input id="setup-password" type="password" minlength="12" required autocomplete="new-password"></label><button class="secondary">Create owner login</button><p class="inline-error" id="setup-error" role="alert"></p></form></details></section></main>`;
  if (!config.ownerSetupAvailable) $("#setup").closest("details").hidden = true;
  $("#login").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api("/api/owner/login", {
        email: $("#owner-email").value,
        password: $("#owner-password").value,
      });
      await owner();
    } catch (err) {
      $("#login-error").textContent = err.message;
    }
  };
  $("#setup").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api("/api/owner/setup", {
        token: $("#setup-token").value,
        email: $("#setup-email").value,
        password: $("#setup-password").value,
      });
      toast("Owner login created. You can sign in now.");
      $("#owner-email").value = $("#setup-email").value;
      $("#setup").reset();
    } catch (err) {
      $("#setup-error").textContent = err.message;
    }
  };
}
function renderQueue() {
  app.innerHTML = `<main class="page"><div class="owner-head"><div><p class="eyebrow">PRINTELLIGENT / OWNER WORKSPACE</p><h1>Ideas worth making.</h1><p class="muted">${queue.length} request${queue.length === 1 ? "" : "s"} · Customer originals are preserved.</p></div><button class="quiet" id="logout">Sign out</button></div><div class="queue-grid"><aside class="queue-list">${queue.map((q) => `<button class="queue-item ${ownerQuote?.id === q.id ? "selected" : ""}" data-quote="${q.id}"><strong>${esc(q.customer)}</strong><small>${esc(q.number)}</small><small>${new Date(q.created).toLocaleDateString()} · ${q.mode === "configure" ? "Configurable design" : "Custom idea"}</small><span class="status-pill">${q.status}</span></button>`).join("") || '<div class="empty">New requests will appear here.</div>'}</aside><section id="owner-detail" class="owner-detail"><div class="panel empty">Select a request to inspect its frozen revision.</div></section></div></main>`;
  action("#logout", async () => {
    await api("/api/owner/logout", {});
    ownerQuote = null;
    renderLogin();
  });
  document.querySelectorAll("[data-quote]").forEach(
    (e) =>
      (e.onclick = async () => {
        try {
          await openQuote(e.dataset.quote);
        } catch (err) {
          toast(err.message);
        }
      }),
  );
  if (ownerQuote) renderOwnerDetail();
}
function revisionToState(r) {
  const s = r.snapshot;
  return {
    ...defaults(),
    ...s,
    family: s.family || "sign",
    configs: {
      ...defaults().configs,
      ...(s.family ? { [s.family]: structuredClone(s.params) } : {}),
    },
    attachments: structuredClone(s.attachments),
    brief: { ...s.brief },
    contact: { ...s.contact },
    units: "mm",
  };
}
async function openQuote(id, revisionId) {
  dispose();
  ownerQuote = await api("/api/owner/quotes/" + id);
  ownerRevision =
    ownerQuote.revisions.find((r) => r.id === revisionId) ||
    ownerQuote.revisions[0];
  ownerState = revisionToState(ownerRevision);
  ownerDirty = false;
  renderQueue();
}
function renderOwnerDetail() {
  const previous = viewer
    ? {
        position: viewer.camera.position.clone(),
        target: viewer.controls.target.clone(),
      }
    : null;
  dispose();
  if (!ownerState) ownerState = revisionToState(ownerRevision);
  const q = ownerQuote,
    r = ownerRevision,
    s = ownerState;
  $("#owner-detail").innerHTML =
    `<div class="panel"><div class="toolbar"><h2>${esc(q.number)}</h2><select id="status" aria-label="Request status">${["New", "Needs measurements", "Reviewing", "Quoted", "Accepted", "In production", "Complete", "Declined"].map((x) => `<option ${q.status === x ? "selected" : ""}>${x}</option>`).join("")}</select></div><div class="toolbar"><label for="revision-select">Inspect revision</label><select id="revision-select">${q.revisions.map((x, i) => `<option value="${x.id}" ${r.id === x.id ? "selected" : ""}>${x.kind === "customer" ? "Customer original" : "Owner revision " + i}${q.approvedRevision === x.id ? " · APPROVED" : ""} · ${new Date(x.created).toLocaleString()}</option>`).join("")}</select></div><div class="notice">You are editing a working copy. Save creates a separate owner revision. Customer originals cannot be overwritten. Approving a revision does not send a quote.</div><div class="owner-split"><section class="owner-viewer">${previewHTML()}${s.mode === "configure" ? settingsHTML(s) : `<h3>Custom CAD handoff</h3><p class="text-block">${esc(s.notes)}</p><button class="secondary full" id="copy-cad">Copy ChatGPT CAD Prompt</button><a class="quiet full" href="/api/owner/quotes/${q.id}/brief?revision=${r.id}">Download submitted brief</a><pre>${esc(cadPrompt(r.snapshot))}</pre>`}${preferencesHTML(s)}</section><section><h3>Customer & brief</h3><p class="text-block">${esc(s.contact.name)}<br>${esc(s.contact.email)}<br>${esc(s.contact.phone)}</p><label class="field"><span class="label">Working notes</span><textarea id="notes" rows="4" maxlength="10000">${esc(s.notes)}</textarea></label>${Object.entries(
      questionLabels,
    )
      .map(
        ([k, label]) =>
          `<label class="field"><span class="label">${label}</span><textarea data-owner-brief="${k}" rows="2">${esc(s.brief[k])}</textarea></label>`,
      )
      .join(
        "",
      )}${attachmentsHTML(s, true)}<label class="field"><span class="label">Your final quote price, USD (optional)</span><input id="final-price" type="number" min="0" step="0.01" value="${r.price?.finalPrice ?? ""}" placeholder="Set after your review"></label><details><summary>Slicer-based price calculation</summary><p class="hint">Enter totals for the entire order from Bambu Studio and your cost assumptions. Nothing is estimated by AI.</p><div class="pricing">${Object.entries(
      {
        grams: "Total material (g)",
        hours: "Total print hours",
        materialPerKg: "Material $/kg",
        machinePerHour: "Machine $/hour",
        laborMinutes: "Labor minutes",
        laborPerHour: "Labor $/hour",
        extras: "Other costs ($)",
        margin: "Gross margin (%)",
      },
    )
      .map(
        ([k, v]) =>
          `<label class="field"><span class="label">${v}</span><input data-price="${k}" type="number" min="0" step="0.01" value="${r.price?.inputs?.[k] ?? ""}"></label>`,
      )
      .join(
        "",
      )}</div><button class="secondary full" id="calculate">Calculate proposed price</button><p id="price-result" class="notice">${Number.isFinite(r.price?.price) ? "Saved estimate: $" + r.price.price.toFixed(2) : "Enter all inputs to calculate."}</p><label class="check-label"><input id="price-confirm" type="checkbox">I confirm these slicer and cost inputs for this revision.</label></details></section></div><div class="actions"><button class="primary" id="save-revision">Save a new owner revision</button><button class="secondary" id="approve" ${r.kind === "customer" ? "disabled" : ""}>Approve saved revision</button></div><p class="hint">Approval applies to the selected saved revision. Save working changes first.</p><div class="separator"></div><div id="owner-dirty" class="notice warn" role="status" hidden></div><h3>Exports from the selected saved revision</h3><p class="hint">${r.snapshot.generatorVersion} · ${r.mesh ? r.mesh.checks.triangles + " triangles · Mesh " + (r.mesh.checks.valid ? "checks passed" : "checks failed") : "Custom request: attach CAD and STL as an owner revision."}</p>${r.mesh ? `<label class="check-label"><input type="checkbox" id="oversize">I reviewed any printer-volume warning and production plan.</label><div class="actions"><button class="secondary" id="download-stl" ${r.kind !== "customer" && q.approvedRevision !== r.id ? "disabled" : ""}>Download STL (mm)</button><button class="quiet" id="download-manifest" ${r.kind !== "customer" && q.approvedRevision !== r.id ? "disabled" : ""}>Settings manifest</button></div>` : ""}${r.snapshot.previewImage ? `<details><summary>Original frozen preview image</summary><img class="review-image" src="${r.snapshot.previewImage}" alt="Saved revision preview"></details>` : ""}</div>`;
  mountViewer(previous);
  bindEditor(s, true);
  $("#owner-detail").addEventListener("input", (e) => {
    if (!["status", "revision-select", "oversize"].includes(e.target.id))
      markOwnerDirty();
  });
  if (ownerDirty) markOwnerDirty();
  if (r.mesh) {
    setMesh(r.mesh, s);
    if (!previous) viewer?.reset();
    if (
      JSON.stringify(s.configs[s.family]) !== JSON.stringify(r.snapshot.params)
    )
      updatePreview(s);
  } else updatePreview(s);
  document
    .querySelectorAll("[data-owner-brief]")
    .forEach(
      (e) => (e.oninput = () => (s.brief[e.dataset.ownerBrief] = e.value)),
    );
  $("#revision-select").onchange = (e) => {
    ownerRevision = q.revisions.find((r) => r.id === e.target.value);
    ownerState = revisionToState(ownerRevision);
    ownerDirty = false;
    renderOwnerDetail();
  };
  $("#status").onchange = async (e) => {
    try {
      await api("/api/owner/quotes/" + q.id + "/status", {
        status: e.target.value,
      });
      q.status = e.target.value;
      toast("Status updated.");
    } catch (err) {
      toast(err.message);
    }
  };
  action("#copy-cad", async () => {
    await navigator.clipboard.writeText(
      cadPrompt({ ...payload(s), attachments: s.attachments }),
    );
    toast("CAD prompt copied. Attach the referenced files in ChatGPT too.");
  });
  const pricing = () =>
    Object.fromEntries(
      [...document.querySelectorAll("[data-price]")].map((e) => [
        e.dataset.price,
        e.value === "" ? NaN : Number(e.value),
      ]),
    );
  action("#calculate", () => {
    const p = quoteTotal(pricing());
    $("#price-result").textContent =
      `Cost $${p.cost.toFixed(2)} · Proposed price $${p.price.toFixed(2)}`;
  });
  document.querySelectorAll("[data-price]").forEach(
    (e) =>
      (e.oninput = () => {
        $("#price-confirm").checked = false;
      }),
  );
  action("#save-revision", async () => {
    if (pending) throw Error("Wait for the geometry update.");
    if (
      s.mode === "configure" &&
      Object.keys(validate(s.family, s.configs[s.family])).length
    )
      throw Error("Correct the model settings first.");
    const b = payload(s);
    if ($("#price-confirm").checked)
      b.pricing = { ...pricing(), confirmed: true };
    if ($("#final-price").value !== "")
      b.finalPrice = Number($("#final-price").value);
    const result = await api("/api/owner/quotes/" + q.id + "/revisions", b);
    toast("Owner revision saved. Customer original preserved.");
    await openQuote(q.id, result.revisionId);
  });
  action("#approve", async () => {
    if (ownerDirty) throw Error("Save your working changes first.");
    await api("/api/owner/quotes/" + q.id + "/approve", { revisionId: r.id });
    toast("Saved revision approved. No quote was sent.");
    await openQuote(q.id, r.id);
  });
  action("#download-stl", async () => {
    await download(
      `/api/owner/quotes/${q.id}/export?revision=${r.id}&reviewed=${$("#oversize").checked ? "yes" : "no"}`,
      q.number + "-mm.stl",
    );
  });
  action("#download-manifest", async () => {
    await download(
      `/api/owner/quotes/${q.id}/export?revision=${r.id}&format=manifest`,
      q.number + "-manifest.json",
    );
  });
}
async function download(url, name) {
  const r = await fetch(url);
  if (!r.ok) throw Error((await r.json()).error);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(await r.blob());
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
function renderPending() {
  const frozen = JSON.parse(draftStorage.getItem("pd-pending"));
  dispose();
  app.innerHTML =
    '<main class="page"><section class="panel"><p class="eyebrow">SUBMISSION RECOVERY</p><h1>Let’s confirm your request.</h1><p>A previous submission did not finish confirming. Retry the exact saved request to retrieve its number without creating a duplicate.</p>' +
    summaryHTML(frozen) +
    '<p class="text-block">' +
    esc(frozen.notes) +
    '</p><button class="primary" id="recover">Confirm saved submission</button><p class="inline-error" id="recovery-error"></p></section></main>';
  action("#recover", async () => {
    const btn = $("#recover");
    btn.disabled = true;
    try {
      const r = await api("/api/quotes", frozen);
      draftStorage.removeItem("pd-pending");
      draftStorage.removeItem("pd-draft");
      app.innerHTML =
        '<main class="page"><section class="success panel"><div class="success-symbol">✓</div><h1>Request confirmed.</h1><p class="request-number">' +
        esc(r.number) +
        '</p><p>Your exact saved revision is in the queue.</p><a class="primary" href="/">Start another idea</a></section></main>';
    } catch (e) {
      $("#recovery-error").textContent = e.message;
      btn.disabled = false;
    }
  });
}
async function boot() {
  config = await api("/api/session");
  $("#mode-label").textContent = config.aiConfigured
    ? "Optional AI available"
    : "Free guided intake";
  worker = new Worker("/geometry-worker.js", { type: "module" });
  worker.onmessage = ({ data }) => {
    if (data.id !== generation) return;
    pending = false;
    if (data.error) {
      $("#preview-notice").innerHTML =
        '<div class="notice warn">Geometry could not update. The last valid preview is preserved. ' +
        esc(data.error) +
        "</div>";
      return;
    }
    const s = location.pathname === "/owner" ? ownerState : state;
    if (!s || !$("#viewer")) return;
    setMesh(data.mesh, s);
    if ($("#review")) $("#review").disabled = false;
  };
  worker.onerror = () => {
    pending = false;
    toast(
      "Geometry generation is unavailable. You can still submit a custom idea and references.",
    );
  };
  if (location.pathname === "/owner") await owner();
  else {
    renderDesigner();
    if (draftStorage.getItem("pd-pending")) renderPending();
  }
}
boot().catch((e) => {
  app.innerHTML = `<main class="page"><div class="panel"><h1>Unable to open the desk.</h1><p>${esc(e.message)}</p><a href="/" class="primary">Try again</a></div></main>`;
});
