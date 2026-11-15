// Resume pipeline web UI. Plain ES module, no build step. All text from the API is inserted with textContent
// (through h()), never as HTML, except the Markdown preview, which escapes everything first.
const API = new URL("api/", document.baseURI).pathname;
const app = document.getElementById("app");
let status = { llm: false };
let leaveGuard = null; // () => boolean, true when there are unsaved edits

// ------------------------------------------------------------------ helpers
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "value") el.value = v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}
const $ = (sel, root = document) => root.querySelector(sel);
const show = (...kids) => app.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(API + path.replace(/^\//, ""), {
    method, credentials: "same-origin",
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith("login")) { location.hash = "#/login"; throw new Error("Sign in first"); }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}
const fail = (e) => toast(e.message || String(e));
const when = (iso) => iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
const scoreClass = (s) => (s >= 70 ? "hi" : s >= 45 ? "mid" : "lo");

/** Minimal safe Markdown: headings, lists, bold/italic, links, paragraphs, rules. */
function markdown(src) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noopener noreferrer" target="_blank">$1</a>');
  const out = []; let list = null; let para = [];
  const flush = () => { if (para.length) { out.push(`<p>${para.map(inline).join("<br>")}</p>`); para = []; } if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of String(src).split(/\r?\n/)) {
    let m;
    if (!line.trim()) { flush(); continue; }
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { flush(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flush(); out.push("<hr>"); continue; }
    if ((m = line.match(/^\s*[-*•]\s+(.*)$/)) || (m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      const kind = /^\s*\d/.test(line) ? "ol" : "ul";
      if (para.length) { out.push(`<p>${para.map(inline).join("<br>")}</p>`); para = []; }
      if (list !== kind) { if (list) out.push(`</${list}>`); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${inline(m[1])}</li>`); continue;
    }
    if (list) { out.push(`</${list}>`); list = null; }
    para.push(line);
  }
  flush();
  return out.join("\n");
}

function download(name, text) {
  const a = h("a", { href: URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" })), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast("Copied to the clipboard"); }
  catch { toast("Copy failed: select the text and press Ctrl+C / Cmd+C"); }
}

function setNav(name) {
  $("#nav").hidden = false;
  for (const a of document.querySelectorAll("[data-nav]")) a.classList.toggle("active", a.dataset.nav === name);
}

// ------------------------------------------------------------------ router
const routes = [
  [/^#\/login$/, viewLogin],
  [/^#\/jobs$/, viewJobs],
  [/^#\/job\/([\w-]+)$/, viewJob],
  [/^#\/cvs$/, viewCvs],
  [/^#\/cv\/([\w-]+)$/, viewCv],
  [/^#\/answers$/, viewAnswers],
  [/^#\/answer\/([\w-]+)$/, viewAnswer],
];

let lastHash = location.hash;
async function render() {
  const hash = location.hash || "#/jobs";
  for (const [re, view] of routes) {
    const m = hash.match(re);
    if (m) {
      leaveGuard = null;
      try { await view(...m.slice(1)); } catch (e) { if (e.message !== "Sign in first") { show(h("div", { class: "panel" }, h("p", {}, e.message))); } }
      window.scrollTo(0, 0);
      return;
    }
  }
  location.hash = "#/jobs";
}
window.addEventListener("hashchange", () => {
  if (leaveGuard && leaveGuard() && !confirm("You have unsaved changes. Leave without saving?")) {
    history.replaceState(null, "", lastHash); return;
  }
  lastHash = location.hash;
  render();
});
window.addEventListener("beforeunload", (e) => { if (leaveGuard && leaveGuard()) { e.preventDefault(); e.returnValue = ""; } });
$("#logout").addEventListener("click", async () => { await api("logout", { method: "POST", body: {} }).catch(() => {}); location.hash = "#/login"; });

(async function start() {
  status = await api("status").catch(() => ({ configured: false, authed: false }));
  if (!status.authed) location.hash = "#/login";
  else if (!location.hash || location.hash === "#/login") location.hash = "#/jobs";
  render();
})();

// ------------------------------------------------------------------ login
async function viewLogin() {
  $("#nav").hidden = true;
  if (status.configured === false) {
    show(h("div", { class: "panel login" }, h("h1", {}, "Not set up yet"),
      h("p", {}, "Set the Worker secret APP_PASSWORD (Workers & Pages → resume-pipeline → Settings → Variables and Secrets), then reload.")));
    return;
  }
  const pw = h("input", { type: "password", autocomplete: "current-password", required: true, id: "pw" });
  const form = h("form", { class: "panel login", onsubmit: async (e) => {
    e.preventDefault();
    try {
      await api("login", { method: "POST", body: { password: pw.value } });
      status = await api("status");
      location.hash = "#/jobs";
    } catch (err) { fail(err); }
  } }, h("h1", {}, "Sign in"), h("label", { for: "pw" }, "Password"), pw, h("p", {}, h("button", { class: "primary", type: "submit" }, "Sign in")));
  show(form);
  pw.focus();
}

// ------------------------------------------------------------------ jobs
async function viewJobs() {
  setNav("jobs");
  const [{ jobs }, { cvs }] = await Promise.all([api("jobs"), api("cvs")]);
  const f = {
    title: h("input", { type: "text", required: true, placeholder: "e.g. Lead Data Analytics" }),
    company: h("input", { type: "text", placeholder: "Company" }),
    location: h("input", { type: "text", placeholder: "Amsterdam / remote" }),
    url: h("input", { type: "url", placeholder: "https://…" }),
    description: h("textarea", { required: true, placeholder: "Paste the full job description here" }),
  };
  const form = h("form", { class: "panel", onsubmit: async (e) => {
    e.preventDefault();
    try {
      const { job } = await api("jobs", { method: "POST", body: Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])) });
      location.hash = `#/job/${job.id}`;
    } catch (err) { fail(err); }
  } },
    h("h2", {}, "Add a job"),
    h("div", { class: "grid2" }, h("div", {}, h("label", {}, "Role title"), f.title), h("div", {}, h("label", {}, "Company"), f.company)),
    h("div", { class: "grid2" }, h("div", {}, h("label", {}, "Location"), f.location), h("div", {}, h("label", {}, "Link to the posting"), f.url)),
    h("label", {}, "Job description"), f.description,
    h("p", {}, h("button", { class: "primary", type: "submit" }, "Save job")));

  const list = jobs.length
    ? h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Role"), h("th", {}, "Company"), h("th", {}, "Match"), h("th", {}, "Status"), h("th", {}, "Updated"))),
        h("tbody", {}, jobs.map((j) => h("tr", { class: "click", onclick: () => (location.hash = `#/job/${j.id}`) },
          h("td", {}, h("a", { href: `#/job/${j.id}` }, j.title)), h("td", {}, j.company), h("td", {}, j.match_score === null ? "–" : h("span", { class: `chip ${j.match_score >= 70 ? "good" : j.match_score >= 45 ? "nice" : "must"}` }, `${Math.round(j.match_score)}%`)),
          h("td", {}, h("span", { class: "chip" }, j.status)), h("td", { class: "muted small" }, when(j.updated_at))))))
    : h("p", { class: "empty" }, "No jobs yet. Paste one below.");

  show(
    h("div", { class: "row spread" }, h("h1", {}, "Jobs"), h("a", { class: "btn", href: API + "export" }, "Download backup (JSON)")),
    !cvs.length ? h("div", { class: "flags" }, "Add your CV first under ", h("a", { href: "#/cvs" }, "CVs & sources"), ", then analyse jobs against it.") : null,
    h("div", { class: "panel" }, list),
    form);
}

async function viewJob(id) {
  setNav("jobs");
  const [{ job, analyses, documents, decisions }, { cvs }] = await Promise.all([api(`jobs/${id}`), api("cvs")]);
  const state = { analysisId: analyses[0]?.id || null };

  // header + editable details
  const statusSel = h("select", { onchange: async () => { try { await api(`jobs/${id}`, { method: "PUT", body: { status: statusSel.value } }); toast("Status saved"); } catch (e) { fail(e); } } },
    ["new", "analysed", "apply", "applied", "interview", "offer", "rejected", "later", "skip"].map((s) => h("option", { value: s, selected: s === job.status }, s)));
  const desc = h("textarea", { value: job.description, rows: 14 });
  const details = h("details", { class: "panel" }, h("summary", {}, "Job description and details"),
    h("div", { class: "grid3" },
      field("Title", "title"), field("Company", "company"), field("Location", "location")),
    field("Link", "url"),
    h("label", {}, "Description"), desc,
    h("div", { class: "row spread" },
      h("button", { onclick: async () => {
        try {
          const body = { description: desc.value };
          for (const k of ["title", "company", "location", "url"]) body[k] = $(`[data-f=${k}]`, details).value;
          await api(`jobs/${id}`, { method: "PUT", body }); toast("Job saved");
        } catch (e) { fail(e); }
      } }, "Save details"),
      h("button", { class: "danger", onclick: async () => {
        if (!confirm("Delete this job with its analyses, documents and decisions?")) return;
        await api(`jobs/${id}`, { method: "DELETE" }).then(() => (location.hash = "#/jobs")).catch(fail);
      } }, "Delete job")));
  function field(label, key) { return h("div", {}, h("label", {}, label), h("input", { type: "text", "data-f": key, value: job[key] || "" })); }

  // analyse bar
  const cvSel = h("select", {}, cvs.filter((c) => c.kind === "cv").map((c) => h("option", { value: c.id }, `${c.title}${c.profile ? ` (${c.profile})` : ""}`)));
  const extras = cvs.filter((c) => c.kind !== "cv");
  const extraBoxes = extras.map((c) => h("label", { class: "row small" }, h("input", { type: "checkbox", value: c.id, checked: true }), `${c.title} (${c.kind})`));
  const engineSel = h("select", {}, h("option", { value: "auto" }, status.llm ? `Claude (${status.model})` : "Built-in engine"),
    status.llm ? h("option", { value: "heuristic" }, "Built-in engine (no API cost)") : null);
  const goBtn = h("button", { class: "primary", onclick: async () => {
    if (!cvSel.value) return toast("Add a CV first");
    goBtn.disabled = true; goBtn.textContent = "Analysing…";
    try {
      const r = await api(`jobs/${id}/analyze`, { method: "POST", body: { cv_id: cvSel.value, engine: engineSel.value, extra_source_ids: extraBoxes.map((l) => l.querySelector("input")).filter((i) => i.checked).map((i) => i.value) } });
      toast("Analysis and proposals ready");
      await viewJob(id);
      const el = $("#analysis-select"); if (el) { el.value = r.analysis_id; el.dispatchEvent(new Event("change")); }
    } catch (e) { fail(e); goBtn.disabled = false; goBtn.textContent = "Analyse and propose CV + letter"; }
  } }, analyses.length ? "Analyse again" : "Analyse and propose CV + letter");
  const analyseBar = h("div", { class: "panel" }, h("h2", {}, "Role vs CV"),
    cvs.some((c) => c.kind === "cv")
      ? [h("div", { class: "grid3" }, h("div", {}, h("label", {}, "CV to compare"), cvSel), h("div", {}, h("label", {}, "Engine"), engineSel), h("div", {}, h("label", {}, " "), goBtn)),
         extras.length ? h("div", {}, h("label", {}, "Extra sources (facts the proposals may use)"), extraBoxes) : null,
         h("p", { class: "muted small" }, "Proposals use only facts from the CV, the extra sources and answers you marked as evidence. Anything else is flagged.")]
      : h("p", {}, "Add a CV under ", h("a", { href: "#/cvs" }, "CVs & sources"), " first."));

  const analysisSel = h("select", { id: "analysis-select", onchange: () => { state.analysisId = analysisSel.value; showAnalysis(); } },
    analyses.map((a) => h("option", { value: a.id }, `${when(a.created_at)} · ${Math.round(a.match_score)}% · ${a.engine === "claude" ? "Claude" : "built-in"}`)));
  const analysisBox = h("div", {});
  const docsBox = h("div", {});
  const qBox = h("div", {});

  async function showAnalysis() {
    if (!state.analysisId) { analysisBox.replaceChildren(); docsBox.replaceChildren(); qBox.replaceChildren(); return; }
    const { analysis } = await api(`analyses/${state.analysisId}`);
    analysisBox.replaceChildren(renderAnalysis(analysis));
    const docs = documents.filter((d) => d.analysis_id === state.analysisId);
    docsBox.replaceChildren(renderDocs(docs, job));
    qBox.replaceChildren(renderQuestions(analysis, refreshQuestions));
  }
  // Re-render only the questions, so unsaved edits in the CV / letter editor are kept.
  async function refreshQuestions() {
    const { analysis } = await api(`analyses/${state.analysisId}`);
    qBox.replaceChildren(renderQuestions(analysis, refreshQuestions));
  }

  // decisions
  const rationale = h("textarea", { rows: 3, placeholder: "Why? e.g. strong fit on team leadership; salary below floor is fine for remote." });
  const decide = (d) => async () => {
    try {
      const cvDoc = documents.find((x) => x.analysis_id === state.analysisId && x.kind === "cv");
      await api(`jobs/${id}/decision`, { method: "POST", body: { decision: d, rationale: rationale.value, cv_id: cvSel.value || null, document_version_id: cvDoc?.current_version_id || null } });
      toast(`Decision saved: ${d}`); viewJob(id);
    } catch (e) { fail(e); }
  };
  const decisionBox = h("div", { class: "panel" }, h("h2", {}, "Your decision"),
    h("label", {}, "Rationale"), rationale,
    h("div", { class: "row" }, h("button", { class: "primary", onclick: decide("apply") }, "Apply"), h("button", { onclick: decide("later") }, "Later"), h("button", { onclick: decide("skip") }, "Skip")),
    decisions.length ? h("ul", { class: "tight small" }, decisions.map((d) => h("li", {}, h("strong", {}, d.decision), ` · ${when(d.created_at)}`, d.rationale ? ` · ${d.rationale}` : ""))) : null);

  show(
    h("div", { class: "row spread" },
      h("div", {}, h("h1", {}, job.title), h("div", { class: "muted" }, [job.company, job.location].filter(Boolean).join(" · "), job.url ? [" · ", h("a", { href: job.url, target: "_blank", rel: "noopener noreferrer" }, "posting")] : "")),
      h("div", { class: "row" }, h("span", { class: "muted small" }, "Status"), statusSel)),
    details, analyseBar,
    analyses.length > 1 ? h("div", { class: "row" }, h("span", { class: "muted small" }, "Analysis"), analysisSel) : null,
    analysisBox, docsBox, qBox, decisionBox);
  await showAnalysis();
}

function renderAnalysis(a) {
  const must = a.gaps.filter((g) => g.severity === "must"), nice = a.gaps.filter((g) => g.severity !== "must");
  return h("div", { class: "panel" },
    h("div", { class: "row spread" }, h("h2", {}, "Main points and gap analysis"), h("span", { class: "muted small" }, a.engine === "claude" ? "by Claude" : "by the built-in engine")),
    h("div", { class: "row" }, h("span", { class: `score ${scoreClass(a.match_score)}` }, `${Math.round(a.match_score)}%`), h("span", { class: "muted" }, a.summary)),
    h("div", { class: "grid3" },
      h("div", {}, h("h3", {}, "What the role is about"), h("ul", { class: "tight" }, a.main_points.map((p) => h("li", {}, p)))),
      h("div", {}, h("h3", {}, `Strengths (${a.strengths.length})`),
        a.strengths.length ? a.strengths.map((s) => h("div", {}, h("span", { class: "chip good" }, s.skill), s.severity === "must" ? h("span", { class: "chip" }, "must-have") : null, s.source ? h("span", { class: "chip" }, s.source) : null,
          (s.evidence || []).slice(0, 1).map((e) => h("div", { class: "ev" }, `“${e}”`)))) : h("p", { class: "muted" }, "None found.")),
      h("div", {}, h("h3", {}, `Gaps (${a.gaps.length})`),
        a.gaps.length ? [...must, ...nice].map((g) => h("div", {}, h("span", { class: `chip ${g.severity}` }, g.skill), h("span", { class: "muted small" }, g.severity === "must" ? " must-have" : " nice to have"), h("div", { class: "ev" }, g.mitigation))) : h("p", { class: "muted" }, "No gaps found."))));
}

// ------------------------------------------------------------------ document editor
function renderDocs(docs, job) {
  if (!docs.length) return h("div");
  const wrap = h("div", { class: "panel" });
  const tabs = h("div", { class: "tabs" });
  const body = h("div", {});
  const editors = new Map();
  const order = ["cv", "letter"].map((k) => docs.find((d) => d.kind === k)).filter(Boolean);
  const show = async (doc) => {
    for (const b of tabs.children) b.classList.toggle("on", b.dataset.id === doc.id);
    if (!editors.has(doc.id)) editors.set(doc.id, await documentEditor(doc.id, job));
    body.replaceChildren(editors.get(doc.id).el);
  };
  for (const d of order) tabs.append(h("button", { "data-id": d.id, onclick: () => show(d).catch(fail) }, d.kind === "cv" ? "Tailored CV" : "Motivation letter"));
  leaveGuard = () => [...editors.values()].some((e) => e.dirty());
  wrap.append(h("h2", {}, "Proposed CV and motivation letter"),
    h("p", { class: "muted small" }, "Edit the proposal, or paste your own text. Every save is a new version; the proposal is kept and any version can be restored."),
    tabs, body);
  show(order[0]).catch(fail);
  return wrap;
}

async function documentEditor(docId, job) {
  let { document: doc, versions } = await api(`documents/${docId}`);
  let current = versions.find((v) => v.id === doc.current_version_id) || versions[0];
  let saved = current.body;
  let origin = "edited";
  let mode = "edit";
  const ta = h("textarea", { class: "doc", spellcheck: "true", value: current.body, "aria-label": doc.title });
  const preview = h("div", { class: "preview", hidden: true });
  const dirtyEl = h("span", { class: "dirty" });
  const flagsEl = h("div", {});
  const note = h("input", { type: "text", placeholder: "Note for this version (optional)", maxlength: "500" });
  const versionList = h("ul", { class: "versions" });
  const modeBtn = h("button", { onclick: () => setMode(mode === "edit" ? "preview" : "edit") }, "Preview");

  const isDirty = () => ta.value !== saved;
  const refreshDirty = () => { dirtyEl.className = isDirty() ? "dirty" : "muted small"; dirtyEl.textContent = isDirty() ? (origin === "pasted" ? "Unsaved (your pasted text)" : "Unsaved changes") : "Saved"; };
  ta.addEventListener("input", refreshDirty);
  ta.addEventListener("paste", (e) => {
    const pasted = e.clipboardData?.getData("text") || "";
    const selLen = ta.selectionEnd - ta.selectionStart;
    if (pasted.length > 200 && selLen >= ta.value.length * 0.8) origin = "pasted";
  });

  function setMode(m) {
    mode = m;
    ta.hidden = m !== "edit"; preview.hidden = m === "edit";
    if (m !== "edit") preview.innerHTML = markdown(ta.value);
    modeBtn.textContent = m === "edit" ? "Preview" : "Edit";
  }
  function showFlags(flags) {
    flagsEl.replaceChildren(flags && flags.length
      ? h("div", { class: "flags" }, h("strong", {}, "Check these: "), "not found in your CV or evidence answers, so make sure they are true: ",
          flags.map((f) => h("span", { class: "chip nice", title: f.reason }, f.skill)))
      : h("div", { class: "muted small" }, "Fact check: every skill named here is backed by your sources."));
  }
  function renderVersions() {
    versionList.replaceChildren(...versions.map((v) => h("li", { class: v.id === doc.current_version_id ? "cur" : "" },
      h("div", { class: "row spread" }, h("strong", {}, `v${v.version_no}`), h("span", { class: "chip" }, v.origin)),
      h("div", { class: "muted" }, when(v.created_at)), v.note ? h("div", {}, v.note) : null,
      v.fact_flags?.length ? h("div", { class: "small", style: null }, `${v.fact_flags.length} to check`) : null,
      h("div", { class: "row" },
        h("button", { class: "link", onclick: () => { if (isDirty() && !confirm("Replace your unsaved text with this version?")) return; ta.value = v.body; origin = "edited"; refreshDirty(); setMode(mode); } }, "Load"),
        v.id !== doc.current_version_id ? h("button", { class: "link", onclick: () => restore(v) }, "Make current") : h("span", { class: "muted small" }, "current")))));
  }
  async function reload() {
    ({ document: doc, versions } = await api(`documents/${docId}`));
    renderVersions();
  }
  async function save() {
    try {
      const { version } = await api(`documents/${docId}/versions`, { method: "POST", body: { body: ta.value, origin, note: note.value } });
      saved = ta.value; origin = "edited"; note.value = "";
      refreshDirty(); showFlags(version.fact_flags); await reload();
      toast(`Saved as version ${version.version_no}`);
    } catch (e) { fail(e); }
  }
  async function restore(v) {
    try {
      const { version } = await api(`documents/${docId}/restore`, { method: "POST", body: { version_id: v.id } });
      ta.value = version.body; saved = version.body; origin = "edited";
      refreshDirty(); showFlags(version.fact_flags); setMode(mode); await reload();
      toast(`Version ${v.version_no} restored as version ${version.version_no}`);
    } catch (e) { fail(e); }
  }
  async function pasteReplace() {
    if (ta.value.trim() && !confirm("Replace the whole text with what is on your clipboard?")) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return toast("The clipboard is empty");
      ta.value = text; origin = "pasted"; setMode("edit"); refreshDirty();
      toast("Pasted. Review it, then save as a version.");
    } catch {
      ta.value = ""; origin = "pasted"; setMode("edit"); ta.focus(); refreshDirty();
      toast("The browser blocked clipboard access: press Ctrl+V / Cmd+V in the editor");
    }
  }
  const slug = (job.company || job.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const toolbar = h("div", { class: "toolbar" },
    modeBtn,
    h("button", { onclick: () => copyText(ta.value) }, "Copy"),
    h("button", { onclick: pasteReplace, title: "Replace the text with your own version from the clipboard" }, "Paste my own version"),
    h("button", { onclick: () => download(`${doc.kind === "cv" ? "cv" : "motivation-letter"}-${slug}.md`, ta.value) }, "Download .md"),
    h("button", { onclick: () => { const p = versions.find((v) => v.origin === "proposed"); if (p && (!isDirty() || confirm("Discard your unsaved text and load the proposal?"))) { ta.value = p.body; origin = "edited"; refreshDirty(); setMode(mode); } } }, "Back to proposal"),
    dirtyEl);
  const el = h("div", { class: "editor-wrap" },
    h("div", {}, toolbar, ta, preview, flagsEl,
      h("div", { class: "row", style: null }, note, h("button", { class: "primary", onclick: save }, "Save as new version"))),
    h("div", {}, h("h3", {}, "Versions"), versionList));
  ta.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(); } });
  refreshDirty(); showFlags(current.fact_flags); renderVersions();
  return { el, dirty: isDirty };
}

// ------------------------------------------------------------------ expected questions + answer matching
function renderQuestions(a, refresh) {
  return h("div", { class: "panel" },
    h("h2", {}, `Expected interview questions (${a.questions.length})`),
    h("p", { class: "muted small" }, "Matched against your answer bank. Pick a good previous answer, or write a new one; it is saved to the bank so it can be refined later."),
    a.questions.map((q) => questionCard(a, q, refresh)));
}

function questionCard(a, q, refresh) {
  const box = h("div", { class: "q" });
  const linked = q.matches.find((m) => m.answer_id === q.linked_answer_id);
  const link = async (answer_id) => { try { await api(`analyses/${a.id}/questions/${q.index}/link`, { method: "PUT", body: { answer_id } }); refresh(); } catch (e) { fail(e); } };
  const form = h("div", { hidden: true });
  const fBody = h("textarea", { rows: 6, placeholder: "Your answer (STAR: situation, task, action, result)" });
  const fTags = h("input", { type: "text", placeholder: "Tags, e.g. leadership, stakeholder management" });
  const fEv = h("input", { type: "checkbox" });
  form.append(h("label", {}, "New answer"), fBody, h("label", {}, "Tags"), fTags,
    h("label", { class: "row" }, fEv, "Use as evidence for CVs (only if it is true and you would say it in an interview)"),
    h("div", { class: "row" }, h("button", { class: "primary", onclick: async () => {
      try {
        await api("answers", { method: "POST", body: { question: q.question, body: fBody.value, tags: fTags.value, use_as_evidence: fEv.checked, link: { analysis_id: a.id, question_index: q.index } } });
        toast("Answer saved to the bank"); refresh();
      } catch (e) { fail(e); }
    } }, "Save answer"), h("button", { onclick: () => (form.hidden = true) }, "Cancel")));
  box.append(...[
    h("div", { class: "row spread" }, h("span", { class: "qt" }, q.question), h("span", { class: "chip" }, q.type)),
    q.why ? h("div", { class: "muted small" }, q.why) : null,
    q.linked_answer_id && !linked ? h("div", { class: "match linked" }, "Linked to ", h("a", { href: `#/answer/${q.linked_answer_id}` }, "a saved answer"), ".") : null,
    q.matches.map((m) => h("div", { class: `match ${m.answer_id === q.linked_answer_id ? "linked" : ""}` },
      h("div", { class: "row spread small" }, h("span", {}, h("strong", {}, `${Math.round(m.score * 100)}% match`), " · saved for: ", m.question, ` · v${m.version_no}`),
        h("span", { class: "row" },
          m.answer_id === q.linked_answer_id ? h("button", { class: "link", onclick: () => link(null) }, "Unlink") : h("button", { class: "link", onclick: () => link(m.answer_id) }, "Use this"),
          h("a", { href: `#/answer/${m.answer_id}` }, "Refine"))),
      m.body)),
    !q.matches.length ? h("div", { class: "muted small" }, "No similar answer saved yet.") : null,
    h("div", { class: "row" }, h("button", { class: "link", onclick: () => { form.hidden = false; fBody.focus(); } }, "+ Write an answer")),
    form].flat().filter(Boolean));
  return box;
}

// ------------------------------------------------------------------ CVs and sources
async function viewCvs() {
  setNav("cvs");
  const { cvs } = await api("cvs");
  show(
    h("div", { class: "row spread" }, h("h1", {}, "CVs and sources"), h("a", { class: "btn", href: "#/cv/new" }, "+ Add CV or source")),
    h("p", { class: "muted" }, "Base CVs (one per profile, e.g. Lead Data Analytics, Data Scientist), your LinkedIn text and notes. Tailored CVs and letters use only facts from these."),
    h("div", { class: "panel" }, cvs.length
      ? h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Title"), h("th", {}, "Kind"), h("th", {}, "Profile"), h("th", {}, "Size"), h("th", {}, "Updated"))),
          h("tbody", {}, cvs.map((c) => h("tr", { class: "click", onclick: () => (location.hash = `#/cv/${c.id}`) },
            h("td", {}, h("a", { href: `#/cv/${c.id}` }, c.title)), h("td", {}, c.kind), h("td", {}, c.profile), h("td", { class: "muted small" }, `${c.chars} chars`), h("td", { class: "muted small" }, when(c.updated_at))))))
      : h("p", { class: "empty" }, "No CV yet. Add one: paste the text of your CV.")));
}

async function viewCv(id) {
  setNav("cvs");
  const cv = id === "new" ? { title: "", profile: "", kind: "cv", body: "" } : (await api(`cvs/${id}`)).cv;
  const f = {
    title: h("input", { type: "text", value: cv.title, placeholder: "e.g. CV – Lead Data Analytics" }),
    profile: h("input", { type: "text", value: cv.profile, placeholder: "Lead Data Analytics / Data Scientist / Product Builder / Manager DS&A", list: "profiles" }),
    kind: h("select", {}, [["cv", "CV"], ["linkedin", "LinkedIn text"], ["notes", "Notes / extra facts"]].map(([v, l]) => h("option", { value: v, selected: v === cv.kind }, l))),
    body: h("textarea", { class: "doc", value: cv.body, placeholder: "Paste the full text (Markdown is fine)" }),
  };
  let saved = JSON.stringify(Object.values(f).map((e) => e.value));
  leaveGuard = () => JSON.stringify(Object.values(f).map((e) => e.value)) !== saved;
  show(
    h("p", {}, h("a", { href: "#/cvs" }, "← CVs and sources")),
    h("div", { class: "panel" },
      h("h1", {}, id === "new" ? "Add CV or source" : cv.title),
      h("datalist", { id: "profiles" }, ["Lead Data Analytics", "Data Scientist", "Product Builder", "Manager Data Science & Analytics"].map((p) => h("option", { value: p }))),
      h("div", { class: "grid3" }, h("div", {}, h("label", {}, "Title"), f.title), h("div", {}, h("label", {}, "Profile"), f.profile), h("div", {}, h("label", {}, "Kind"), f.kind)),
      h("label", {}, "Text"), f.body,
      h("div", { class: "row spread" },
        h("button", { class: "primary", onclick: async () => {
          try {
            const body = Object.fromEntries(Object.entries(f).map(([k, e]) => [k, e.value]));
            const r = id === "new" ? await api("cvs", { method: "POST", body }) : await api(`cvs/${id}`, { method: "PUT", body });
            saved = JSON.stringify(Object.values(f).map((e) => e.value));
            toast("Saved");
            if (id === "new") location.hash = `#/cv/${r.cv.id}`;
          } catch (e) { fail(e); }
        } }, "Save"),
        id !== "new" ? h("button", { class: "danger", onclick: async () => { if (confirm("Delete this source? Analyses keep their results.")) await api(`cvs/${id}`, { method: "DELETE" }).then(() => { leaveGuard = null; location.hash = "#/cvs"; }).catch(fail); } }, "Delete") : null)));
}

// ------------------------------------------------------------------ answer bank
async function viewAnswers() {
  setNav("answers");
  const search = h("input", { type: "search", placeholder: "Search or paste an interview question to find your best previous answers" });
  const listBox = h("div", {});
  const load = async () => {
    const q = search.value.trim();
    const { answers } = await api(`answers${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    listBox.replaceChildren(...[].concat(answers.length
      ? answers.map((a) => h("div", { class: "q" },
          h("div", { class: "row spread" }, h("a", { class: "qt", href: `#/answer/${a.id}` }, a.question),
            h("span", {}, a.score !== undefined ? h("span", { class: "chip good" }, `${Math.round(a.score * 100)}% match`) : null, h("span", { class: "chip" }, `v${a.version_no} of ${a.versions}`), a.rating ? h("span", { class: "chip" }, "★".repeat(a.rating)) : null, a.use_as_evidence ? h("span", { class: "chip good" }, "evidence") : null)),
          a.tags ? h("div", { class: "muted small" }, a.tags) : null,
          h("div", { class: "pre small" }, a.body.length > 360 ? a.body.slice(0, 360) + "…" : a.body)))
      : h("p", { class: "empty" }, q ? "No similar answers yet." : "No answers yet. Write them from a job's expected questions, or add one below.")));
  };
  let t; search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => load().catch(fail), 250); });
  const nq = h("input", { type: "text", placeholder: "Question" });
  const nb = h("textarea", { rows: 6, placeholder: "Your answer" });
  const nt = h("input", { type: "text", placeholder: "Tags" });
  const ne = h("input", { type: "checkbox" });
  show(
    h("h1", {}, "Answer bank"),
    h("p", { class: "muted" }, "Your interview stories and answers. Refine them into new versions as your story improves; they are matched with the expected questions of each job."),
    h("div", { class: "panel" }, search, h("div", { style: null }, listBox)),
    h("details", { class: "panel" }, h("summary", {}, "Add an answer"),
      h("label", {}, "Question"), nq, h("label", {}, "Answer"), nb, h("label", {}, "Tags"), nt,
      h("label", { class: "row" }, ne, "Use as evidence for CVs"),
      h("button", { class: "primary", onclick: async () => {
        try { const { answer } = await api("answers", { method: "POST", body: { question: nq.value, body: nb.value, tags: nt.value, use_as_evidence: ne.checked } }); location.hash = `#/answer/${answer.id}`; }
        catch (e) { fail(e); }
      } }, "Save answer")));
  await load();
}

async function viewAnswer(id) {
  setNav("answers");
  const { answer: a, versions, used_in } = await api(`answers/${id}`);
  const q = h("input", { type: "text", value: a.question });
  const tags = h("input", { type: "text", value: a.tags });
  const ev = h("input", { type: "checkbox", checked: Boolean(a.use_as_evidence) });
  const body = h("textarea", { class: "doc", value: a.body, style: null });
  const note = h("input", { type: "text", placeholder: "What changed? e.g. tighter result, added numbers" });
  let rating = a.rating || 0;
  const stars = h("span", { class: "stars" });
  const drawStars = () => stars.replaceChildren(...[1, 2, 3, 4, 5].map((n) => h("button", { class: "link", title: `${n} of 5`, onclick: () => { rating = n; drawStars(); } }, n <= rating ? "★" : "☆")));
  drawStars();
  let saved = a.body;
  leaveGuard = () => body.value !== saved;
  show(
    h("p", {}, h("a", { href: "#/answers" }, "← Answer bank")),
    h("div", { class: "panel" },
      h("label", {}, "Question"), q,
      h("div", { class: "grid2" }, h("div", {}, h("label", {}, "Tags"), tags), h("div", {}, h("label", {}, " "), h("label", { class: "row" }, ev, "Use as evidence for CVs and letters"))),
      h("div", { class: "row" }, h("button", { onclick: async () => { try { await api(`answers/${id}`, { method: "PUT", body: { question: q.value, tags: tags.value, use_as_evidence: ev.checked } }); toast("Saved"); } catch (e) { fail(e); } } }, "Save question and tags"),
        h("button", { class: "danger", onclick: async () => { if (confirm("Delete this answer and all its versions?")) await api(`answers/${id}`, { method: "DELETE" }).then(() => { leaveGuard = null; location.hash = "#/answers"; }).catch(fail); } }, "Delete"))),
    h("div", { class: "editor-wrap" },
      h("div", { class: "panel" }, h("h2", {}, "Refine"),
        h("p", { class: "muted small" }, `Showing the current version (v${a.version_no}). Saving creates a new version; older ones stay below.`),
        h("div", { class: "toolbar" }, h("button", { onclick: () => copyText(body.value) }, "Copy")),
        body,
        h("div", { class: "row" }, h("span", { class: "muted small" }, "How good is it?"), stars),
        h("div", { class: "row" }, note, h("button", { class: "primary", onclick: async () => {
          try { await api(`answers/${id}/versions`, { method: "POST", body: { body: body.value, note: note.value, rating: rating || null } }); saved = body.value; toast("New version saved"); viewAnswer(id); }
          catch (e) { fail(e); }
        } }, "Save as new version"))),
      h("div", {},
        h("div", { class: "panel" }, h("h3", {}, "Versions"), h("ul", { class: "versions" }, versions.map((v) => h("li", { class: v.id === a.current_version_id ? "cur" : "" },
          h("div", { class: "row spread" }, h("strong", {}, `v${v.version_no}`), v.rating ? h("span", {}, "★".repeat(v.rating)) : null),
          h("div", { class: "muted" }, when(v.created_at)), v.note ? h("div", {}, v.note) : null,
          h("details", {}, h("summary", {}, "text"), h("div", { class: "pre small" }, v.body)),
          v.id !== a.current_version_id ? h("button", { class: "link", onclick: async () => { await api(`answers/${id}/current`, { method: "POST", body: { version_id: v.id } }).then(() => viewAnswer(id)).catch(fail); } }, "Make current") : h("span", { class: "muted small" }, "current"))))),
        used_in.length ? h("div", { class: "panel" }, h("h3", {}, "Used for"), h("ul", { class: "tight small" }, used_in.map((u) => h("li", {}, h("a", { href: `#/job/${u.job_id}` }, `${u.job_title}${u.company ? `, ${u.company}` : ""}`))))) : null)));
}
