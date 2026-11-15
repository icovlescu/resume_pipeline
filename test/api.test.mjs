import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/worker.js";
import { createD1, createAssets } from "./helpers/d1-shim.mjs";
import { DEMO_CV, DEMO_JOB } from "./helpers/demo.mjs";
import { CSP } from "../src/csp.js";

const BASE = "/project/resume_pipeline";
function makeEnv(extra = {}) {
  return { DB: createD1(), ASSETS: createAssets(new URL("../public", import.meta.url).pathname), BASE_PATH: BASE, APP_PASSWORD: "correct horse battery", ...extra };
}
function client(env) {
  let cookie = "";
  return async (path, method = "GET", body, headers = {}) => {
    const r = await worker.fetch(new Request(`https://x.test${BASE}/api${path}`, {
      method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }), env);
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
  };
}
async function signedIn(extra) {
  const env = makeEnv(extra);
  const call = client(env);
  const r = await call("/login", "POST", { password: "correct horse battery" });
  assert.equal(r.status, 200);
  return { env, call };
}

test("API refuses without sign-in and without a configured password", async () => {
  const call = client(makeEnv());
  assert.equal((await call("/jobs")).status, 401);
  assert.equal((await call("/status")).body.authed, false);
  const call2 = client(makeEnv({ APP_PASSWORD: "" }));
  assert.equal((await call2("/jobs")).status, 503);
});

test("wrong passwords are rate limited; cookie is HttpOnly and Secure", async () => {
  const env = makeEnv();
  const call = client(env);
  for (let i = 0; i < 5; i++) assert.equal((await call("/login", "POST", { password: "nope" })).status, 401);
  assert.equal((await call("/login", "POST", { password: "correct horse battery" })).status, 429);
  const call2 = client(makeEnv());
  const ok = await call2("/login", "POST", { password: "correct horse battery" });
  assert.match(ok.headers.get("set-cookie"), /HttpOnly; SameSite=Strict; Max-Age=\d+; Secure/);
  assert.equal((await call2("/jobs")).status, 200);
  await call2("/logout", "POST", {});
  assert.equal((await call2("/jobs")).status, 401);
});

test("cross-origin and non-JSON writes are refused", async () => {
  const { call } = await signedIn();
  assert.equal((await call("/jobs", "POST", DEMO_JOB, { origin: "https://evil.test" })).status, 403);
});

test("full flow: CV, job, analysis, proposed docs, edits, restore, decision", async () => {
  const { call } = await signedIn();
  const { cv } = (await call("/cvs", "POST", { title: "Base CV", profile: "Lead Data Analytics", body: DEMO_CV })).body;
  const { job } = (await call("/jobs", "POST", DEMO_JOB)).body;
  const an = await call(`/jobs/${job.id}/analyze`, "POST", { cv_id: cv.id });
  assert.equal(an.status, 201);
  assert.equal(an.body.engine, "heuristic");

  const { analysis } = (await call(`/analyses/${an.body.analysis_id}`)).body;
  assert.ok(analysis.match_score > 30 && analysis.match_score < 100, `score ${analysis.match_score}`);
  const gapNames = analysis.gaps.map((g) => g.skill);
  assert.ok(gapNames.includes("causal inference"), gapNames.join());
  assert.ok(gapNames.includes("looker"));
  assert.equal(analysis.gaps.find((g) => g.skill === "looker").severity, "nice");
  assert.equal(analysis.gaps.find((g) => g.skill === "causal inference").severity, "must");
  const strengthNames = analysis.strengths.map((s) => s.skill);
  for (const s of ["sql", "python", "dbt", "snowflake", "team leadership"]) assert.ok(strengthNames.includes(s), s);
  assert.ok(analysis.main_points.length >= 4);
  assert.ok(analysis.questions.length >= 8);
  assert.ok(analysis.questions.some((q) => q.type === "gap" && /causal inference/.test(q.question)));

  const jobView = (await call(`/jobs/${job.id}`)).body;
  assert.equal(jobView.job.status, "analysed");
  assert.equal(jobView.documents.length, 2);
  const cvDocId = an.body.documents.cv;
  const d = (await call(`/documents/${cvDocId}`)).body;
  assert.equal(d.versions.length, 1);
  assert.equal(d.versions[0].origin, "proposed");
  assert.deepEqual(d.versions[0].fact_flags, [], "proposal must not add unbacked skills");
  assert.ok(!/causal inference|looker/i.test(d.versions[0].body), "gaps must not appear in the proposed CV");
  const letter = (await call(`/documents/${an.body.documents.letter}`)).body.versions[0];
  assert.match(letter.body, /Fieldnote/);
  assert.deepEqual(letter.fact_flags, []);

  // edit: adding an unbacked skill is flagged
  const v2 = (await call(`/documents/${cvDocId}/versions`, "POST", { body: d.versions[0].body + "\n- Causal inference\n", note: "added line" })).body.version;
  assert.equal(v2.version_no, 2);
  assert.deepEqual(v2.fact_flags.map((f) => f.skill), ["causal inference"]);
  // paste own version
  const v3 = (await call(`/documents/${cvDocId}/versions`, "POST", { body: "My own CV text with Python.", origin: "pasted" })).body.version;
  assert.equal(v3.origin, "pasted");
  // restore the proposal
  const v4 = (await call(`/documents/${cvDocId}/restore`, "POST", { version_id: d.versions[0].id })).body.version;
  assert.equal(v4.version_no, 4);
  assert.equal(v4.body, d.versions[0].body);
  const after = (await call(`/documents/${cvDocId}`)).body;
  assert.equal(after.document.current_version_id, v4.id);
  assert.deepEqual(after.versions.map((v) => v.origin), ["restored", "pasted", "edited", "proposed"]);

  const dec = await call(`/jobs/${job.id}/decision`, "POST", { decision: "apply", rationale: "Strong fit", cv_id: cv.id, document_version_id: v4.id });
  assert.equal(dec.status, 201);
  assert.equal((await call(`/jobs/${job.id}`)).body.job.status, "apply");
});

test("answer bank: versions, matching to expected questions, links, evidence", async () => {
  const { call } = await signedIn();
  const { cv } = (await call("/cvs", "POST", { title: "Base CV", body: DEMO_CV })).body;
  const { job } = (await call("/jobs", "POST", DEMO_JOB)).body;
  const team = (await call("/answers", "POST", { question: "Tell me about a time you built and grew a data team", tags: "team leadership, hiring", body: "Grew ShopCo analytics from 3 to 7 people.", rating: 3 })).body.answer;
  await call("/answers", "POST", { question: "What is your favourite pizza?", body: "Margherita." });
  const v2 = (await call(`/answers/${team.id}/versions`, "POST", { body: "Grew ShopCo analytics from 3 to 7 people; 0 regretted leavers in 2 years.", note: "added result", rating: 4 })).body.answer;
  assert.equal(v2.version_no, 2);
  assert.equal(v2.versions, 2);

  const an = (await call(`/jobs/${job.id}/analyze`, "POST", { cv_id: cv.id })).body;
  const { analysis } = (await call(`/analyses/${an.analysis_id}`)).body;
  const q = analysis.questions.find((x) => /build, grow and keep a strong data team/.test(x.question));
  assert.ok(q, "lead-level question expected");
  assert.equal(q.matches[0]?.answer_id, team.id);
  assert.match(q.matches[0].body, /regretted/);
  assert.ok(!q.matches.some((m) => /pizza/.test(m.question)));

  assert.equal((await call(`/analyses/${an.analysis_id}/questions/${q.index}/link`, "PUT", { answer_id: team.id })).status, 200);
  const again = (await call(`/analyses/${an.analysis_id}`)).body.analysis.questions[q.index];
  assert.equal(again.linked_answer_id, team.id);
  const detail = (await call(`/answers/${team.id}`)).body;
  assert.equal(detail.used_in[0].job_id, job.id);
  assert.equal(detail.versions.length, 2);

  const search = (await call(`/answers?q=${encodeURIComponent("how did you hire and grow your team")}`)).body.answers;
  assert.equal(search[0].id, team.id);

  // an answer marked as evidence makes a skill count as backed and keeps the fact check quiet
  const causal = (await call("/answers", "POST", { question: "Have you used causal inference?", body: "Yes: at PayFast I used difference-in-differences to measure a pricing change.", use_as_evidence: true })).body.answer;
  assert.equal(causal.use_as_evidence, 1);
  const an2 = (await call(`/jobs/${job.id}/analyze`, "POST", { cv_id: cv.id })).body;
  const a2 = (await call(`/analyses/${an2.analysis_id}`)).body.analysis;
  assert.ok(a2.strengths.some((s) => s.skill === "causal inference" && s.source === "answer bank"));
  const flagged = (await call(`/documents/${an2.documents.cv}/versions`, "POST", { body: "Causal inference and Looker" })).body.version.fact_flags.map((f) => f.skill);
  assert.deepEqual(flagged, ["looker"]);
});

test("Claude engine is used when a key is set, and its output is fact-checked", async () => {
  const calls = [];
  const fake = { beta: { messages: { create: async (req) => {
    calls.push(req);
    const isDocs = req.output_config.format.schema.properties.cv_markdown;
    const out = isDocs
      ? { cv_markdown: "# Alex\nPython, SQL and Tableau.", letter_markdown: "Dear Fieldnote team, ..." }
      : { match_score: 77, summary: "Good fit", main_points: ["Lead the team"], strengths: [{ skill: "sql", severity: "must", evidence: ["Strong SQL"] }], gaps: [{ skill: "dutch fluency", severity: "must", mitigation: "B1 now" }], questions: [{ question: "Why us?", type: "motivation", why: "always" }] };
    return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(out) }] };
  } } } };
  const { call } = await signedIn({ __anthropic: fake });
  assert.equal((await call("/status")).body.llm, true);
  const { cv } = (await call("/cvs", "POST", { title: "Base CV", body: DEMO_CV })).body;
  const { job } = (await call("/jobs", "POST", DEMO_JOB)).body;
  const an = (await call(`/jobs/${job.id}/analyze`, "POST", { cv_id: cv.id })).body;
  assert.equal(an.engine, "claude");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].model, "claude-opus-5-5");
  assert.equal(calls[0].fallbacks, "default");
  const doc = (await call(`/documents/${an.documents.cv}`)).body.versions[0];
  assert.deepEqual(doc.fact_flags.map((f) => f.skill), ["tableau"]);
  // the built-in engine can still be chosen
  assert.equal((await call(`/jobs/${job.id}/analyze`, "POST", { cv_id: cv.id, engine: "heuristic" })).body.engine, "heuristic");
});

test("validation errors are 400 with a message", async () => {
  const { call } = await signedIn();
  assert.equal((await call("/jobs", "POST", { title: "" })).status, 400);
  assert.equal((await call("/jobs", "POST", { ...DEMO_JOB, url: "javascript:alert(1)" })).status, 400);
  assert.equal((await call("/answers", "POST", { question: "q", body: "b", rating: 9 })).status, 400);
  assert.equal((await call("/nope")).status, 404);
});

test("static files and security headers; CSP matches public/_headers", async () => {
  const env = makeEnv();
  const r = await worker.fetch(new Request(`https://x.test${BASE}/`), env);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Resume pipeline/);
  assert.equal(r.headers.get("content-security-policy"), CSP);
  const headersFile = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");
  assert.ok(headersFile.includes(`Content-Security-Policy: ${CSP}`));
  const redirect = await worker.fetch(new Request(`https://x.test${BASE}`), env);
  assert.equal(redirect.status, 308);
});

test("export returns every table", async () => {
  const { call } = await signedIn();
  await call("/cvs", "POST", { title: "Base CV", body: DEMO_CV });
  const r = await call("/export");
  assert.equal(r.status, 200);
  assert.equal(r.body.cvs.length, 1);
  for (const t of ["jobs", "analyses", "documents", "document_versions", "answers", "answer_versions", "question_links", "decisions"]) assert.ok(Array.isArray(r.body[t]), t);
});
