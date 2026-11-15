// JSON API. All routes except /status and /login need the owner session (src/auth.js).
import { HttpError, bad, json } from "./errors.js";
import { ensureSchema } from "./schema.js";
import { requireAuth, isAuthed, configured, login, logout } from "./auth.js";
import { readJson, str, oneOf, newId, nowIso, parseJson } from "./util.js";
import { analyseHeuristic, proposeCv, proposeLetter, factCheck, matchAnswers } from "./analysis.js";
import { llmEnabled, analyseWithClaude, documentsWithClaude } from "./llm.js";

const JOB_STATUSES = ["new", "analysed", "apply", "applied", "later", "skip", "interview", "offer", "rejected"];
const notFound = (what) => new HttpError(404, `${what} not found`);

export async function handleApi(request, env, url, path) {
  const method = request.method;
  // Writes must come from our own page (on top of the SameSite=Strict cookie).
  if (method !== "GET" && method !== "HEAD") {
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) throw new HttpError(403, "Cross-origin request refused");
    if (!(request.headers.get("content-type") || "").includes("application/json")) throw new HttpError(415, "Send JSON");
  }
  await ensureSchema(env.DB);
  const db = env.DB;
  const now = nowIso(env);
  const seg = path.split("/").filter(Boolean);
  const route = (m, pattern) => {
    if (m !== method) return null;
    const p = pattern.split("/").filter(Boolean);
    if (p.length !== seg.length) return null;
    const params = {};
    for (let i = 0; i < p.length; i++) {
      if (p[i].startsWith(":")) params[p[i].slice(1)] = decodeURIComponent(seg[i]);
      else if (p[i] !== seg[i]) return null;
    }
    return params;
  };
  let p;

  // ------------------------------------------------------------ session
  if ((p = route("GET", "/status"))) {
    return json({ configured: configured(env), authed: await isAuthed(request, env), llm: llmEnabled(env), model: llmEnabled(env) ? (env.CLAUDE_MODEL || "claude-opus-5-5") : null });
  }
  if ((p = route("POST", "/login"))) {
    const body = await readJson(request);
    const setCookie = await login(request, env, body.password);
    return json({ ok: true }, 200, { "set-cookie": setCookie });
  }
  if ((p = route("POST", "/logout"))) {
    return json({ ok: true }, 200, { "set-cookie": await logout(request, env) });
  }

  await requireAuth(request, env);

  // ------------------------------------------------------------ CVs and source documents
  if ((p = route("GET", "/cvs"))) {
    const { results } = await db.prepare("SELECT id, title, profile, kind, length(body) AS chars, created_at, updated_at FROM cvs ORDER BY updated_at DESC").all();
    return json({ cvs: results });
  }
  if ((p = route("POST", "/cvs"))) {
    const b = await readJson(request);
    const row = { id: newId("cv"), title: str(b.title, "title", { max: 200 }), profile: str(b.profile, "profile", { max: 100, required: false }), kind: oneOf(b.kind, "kind", ["cv", "linkedin", "notes"], "cv"), body: str(b.body, "body") };
    await db.prepare("INSERT INTO cvs(id, title, profile, kind, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(row.id, row.title, row.profile, row.kind, row.body, now, now).run();
    return json({ cv: { ...row, created_at: now, updated_at: now } }, 201);
  }
  if ((p = route("GET", "/cvs/:id"))) {
    const cv = await db.prepare("SELECT * FROM cvs WHERE id = ?").bind(p.id).first();
    if (!cv) throw notFound("CV");
    return json({ cv });
  }
  if ((p = route("PUT", "/cvs/:id"))) {
    const b = await readJson(request);
    const cv = await db.prepare("SELECT * FROM cvs WHERE id = ?").bind(p.id).first();
    if (!cv) throw notFound("CV");
    const next = {
      title: b.title !== undefined ? str(b.title, "title", { max: 200 }) : cv.title,
      profile: b.profile !== undefined ? str(b.profile, "profile", { max: 100, required: false }) : cv.profile,
      kind: b.kind !== undefined ? oneOf(b.kind, "kind", ["cv", "linkedin", "notes"]) : cv.kind,
      body: b.body !== undefined ? str(b.body, "body") : cv.body,
    };
    await db.prepare("UPDATE cvs SET title = ?, profile = ?, kind = ?, body = ?, updated_at = ? WHERE id = ?").bind(next.title, next.profile, next.kind, next.body, now, p.id).run();
    return json({ cv: { ...cv, ...next, updated_at: now } });
  }
  if ((p = route("DELETE", "/cvs/:id"))) {
    const r = await db.prepare("DELETE FROM cvs WHERE id = ?").bind(p.id).run();
    if (!r.meta.changes) throw notFound("CV");
    return json({ ok: true });
  }

  // ------------------------------------------------------------ jobs
  if ((p = route("GET", "/jobs"))) {
    const { results } = await db.prepare(
      `SELECT j.id, j.title, j.company, j.location, j.url, j.status, j.created_at, j.updated_at,
              (SELECT match_score FROM analyses a WHERE a.job_id = j.id ORDER BY a.created_at DESC LIMIT 1) AS match_score
         FROM jobs j ORDER BY j.updated_at DESC`).all();
    return json({ jobs: results });
  }
  if ((p = route("POST", "/jobs"))) {
    const b = await readJson(request);
    const row = {
      id: newId("job"), title: str(b.title, "title", { max: 200 }), company: str(b.company, "company", { max: 200, required: false }),
      url: str(b.url, "url", { max: 1000, required: false }), location: str(b.location, "location", { max: 200, required: false }),
      source: str(b.source, "source", { max: 50, required: false }) || "pasted", description: str(b.description, "description"),
    };
    if (row.url && !/^https?:\/\//i.test(row.url)) throw bad("url must start with http:// or https://");
    await db.prepare("INSERT INTO jobs(id, title, company, url, location, source, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)")
      .bind(row.id, row.title, row.company, row.url, row.location, row.source, row.description, now, now).run();
    return json({ job: { ...row, status: "new", created_at: now, updated_at: now } }, 201);
  }
  if ((p = route("GET", "/jobs/:id"))) {
    const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(p.id).first();
    if (!job) throw notFound("Job");
    const analyses = (await db.prepare("SELECT id, cv_id, engine, match_score, summary, created_at FROM analyses WHERE job_id = ? ORDER BY created_at DESC").bind(p.id).all()).results;
    const documents = (await db.prepare(
      `SELECT d.id, d.kind, d.title, d.cv_id, d.analysis_id, d.current_version_id, d.created_at, d.updated_at,
              (SELECT COUNT(*) FROM document_versions v WHERE v.document_id = d.id) AS versions
         FROM documents d WHERE d.job_id = ? ORDER BY d.created_at DESC`).bind(p.id).all()).results;
    const decisions = (await db.prepare("SELECT * FROM decisions WHERE job_id = ? ORDER BY created_at DESC").bind(p.id).all()).results;
    return json({ job, analyses, documents, decisions });
  }
  if ((p = route("PUT", "/jobs/:id"))) {
    const b = await readJson(request);
    const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(p.id).first();
    if (!job) throw notFound("Job");
    const n = { ...job };
    for (const [k, max] of [["title", 200], ["company", 200], ["url", 1000], ["location", 200]]) if (b[k] !== undefined) n[k] = str(b[k], k, { max, required: k === "title" });
    if (b.description !== undefined) n.description = str(b.description, "description");
    if (b.status !== undefined) n.status = oneOf(b.status, "status", JOB_STATUSES);
    if (n.url && !/^https?:\/\//i.test(n.url)) throw bad("url must start with http:// or https://");
    await db.prepare("UPDATE jobs SET title = ?, company = ?, url = ?, location = ?, description = ?, status = ?, updated_at = ? WHERE id = ?")
      .bind(n.title, n.company, n.url, n.location, n.description, n.status, now, p.id).run();
    return json({ job: { ...n, updated_at: now } });
  }
  if ((p = route("DELETE", "/jobs/:id"))) {
    const r = await db.prepare("DELETE FROM jobs WHERE id = ?").bind(p.id).run();
    if (!r.meta.changes) throw notFound("Job");
    return json({ ok: true });
  }

  // Analyse a job against a CV, then propose a tailored CV and letter (each stored as version 1, origin "proposed").
  if ((p = route("POST", "/jobs/:id/analyze"))) {
    const b = await readJson(request);
    const job = await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(p.id).first();
    if (!job) throw notFound("Job");
    const cv = await db.prepare("SELECT * FROM cvs WHERE id = ?").bind(str(b.cv_id, "cv_id")).first();
    if (!cv) throw notFound("CV");
    const extraIds = Array.isArray(b.extra_source_ids) ? b.extra_source_ids.filter((x) => typeof x === "string").slice(0, 5) : [];
    const extras = [];
    for (const id of extraIds) { const r = await db.prepare("SELECT body FROM cvs WHERE id = ?").bind(id).first(); if (r) extras.push(r.body); }
    const sources = { cv: [cv.body, ...extras].join("\n\n"), evidence: await evidenceText(db) };
    const engine = oneOf(b.engine, "engine", ["auto", "claude", "heuristic"], "auto");
    const useClaude = engine === "claude" || (engine === "auto" && llmEnabled(env));
    if (useClaude && !llmEnabled(env)) throw bad("Claude is not set up: add the ANTHROPIC_API_KEY secret, or use the built-in engine.");

    let a, docs;
    if (useClaude) {
      a = await analyseWithClaude(env, job, sources);
      const d = await documentsWithClaude(env, job, sources, a);
      docs = { cv: d.cv_markdown, letter: d.letter_markdown };
    } else {
      a = analyseHeuristic(job, sources);
      docs = { cv: proposeCv(job, a, sources.cv), letter: proposeLetter(job, a, sources.cv) };
    }
    const analysisId = newId("an");
    const srcText = `${sources.cv}\n${sources.evidence}`;
    const stmts = [
      db.prepare("INSERT INTO analyses(id, job_id, cv_id, engine, match_score, summary, main_points_json, strengths_json, gaps_json, questions_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(analysisId, job.id, cv.id, a.engine, a.match_score, a.summary || "", JSON.stringify(a.main_points), JSON.stringify(a.strengths), JSON.stringify(a.gaps), JSON.stringify(a.questions), now),
      db.prepare("UPDATE jobs SET status = CASE WHEN status = 'new' THEN 'analysed' ELSE status END, updated_at = ? WHERE id = ?").bind(now, job.id),
    ];
    const created = {};
    for (const kind of ["cv", "letter"]) {
      const docId = newId("doc"), verId = newId("ver");
      const title = `${kind === "cv" ? "CV" : "Motivation letter"}: ${job.title}${job.company ? `, ${job.company}` : ""}`;
      const flags = factCheck(docs[kind], srcText, job.description);
      stmts.push(
        db.prepare("INSERT INTO documents(id, job_id, cv_id, analysis_id, kind, title, current_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(docId, job.id, cv.id, analysisId, kind, title, verId, now, now),
        db.prepare("INSERT INTO document_versions(id, document_id, version_no, origin, body, note, fact_flags_json, created_at) VALUES (?, ?, 1, 'proposed', ?, ?, ?, ?)").bind(verId, docId, docs[kind], `Proposed by ${a.engine === "claude" ? "Claude" : "the built-in engine"}`, JSON.stringify(flags), now),
      );
      created[kind] = docId;
    }
    await db.batch(stmts);
    return json({ analysis_id: analysisId, documents: created, engine: a.engine }, 201);
  }

  if ((p = route("POST", "/jobs/:id/decision"))) {
    const b = await readJson(request);
    const job = await db.prepare("SELECT id FROM jobs WHERE id = ?").bind(p.id).first();
    if (!job) throw notFound("Job");
    const decision = oneOf(b.decision, "decision", ["apply", "skip", "later"]);
    const row = { id: newId("dec"), job_id: p.id, cv_id: b.cv_id || null, document_version_id: b.document_version_id || null, decision, rationale: str(b.rationale, "rationale", { max: 4000, required: false }), created_at: now };
    await db.batch([
      db.prepare("INSERT INTO decisions(id, job_id, cv_id, document_version_id, decision, rationale, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(row.id, row.job_id, row.cv_id, row.document_version_id, row.decision, row.rationale, now),
      db.prepare("UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?").bind(decision, now, p.id),
    ]);
    return json({ decision: row }, 201);
  }

  // ------------------------------------------------------------ analyses
  if ((p = route("GET", "/analyses/:id"))) {
    const a = await db.prepare("SELECT * FROM analyses WHERE id = ?").bind(p.id).first();
    if (!a) throw notFound("Analysis");
    const questions = parseJson(a.questions_json, []);
    const answers = await answersWithBodies(db);
    const links = new Map((await db.prepare("SELECT question_index, answer_id FROM question_links WHERE analysis_id = ?").bind(p.id).all()).results.map((r) => [r.question_index, r.answer_id]));
    const byId = new Map(answers.map((x) => [x.id, x]));
    const enriched = questions.map((q, i) => ({
      ...q,
      index: i,
      linked_answer_id: links.get(i) || null,
      matches: matchAnswers(q.question, answers).map((m) => ({ ...m, question: byId.get(m.answer_id).question, body: byId.get(m.answer_id).body, version_no: byId.get(m.answer_id).version_no })),
    }));
    return json({
      analysis: {
        id: a.id, job_id: a.job_id, cv_id: a.cv_id, engine: a.engine, match_score: a.match_score, summary: a.summary, created_at: a.created_at,
        main_points: parseJson(a.main_points_json, []), strengths: parseJson(a.strengths_json, []), gaps: parseJson(a.gaps_json, []), questions: enriched,
      },
    });
  }
  if ((p = route("PUT", "/analyses/:id/questions/:index/link"))) {
    const b = await readJson(request);
    const idx = Number(p.index);
    const a = await db.prepare("SELECT questions_json FROM analyses WHERE id = ?").bind(p.id).first();
    if (!a) throw notFound("Analysis");
    if (!Number.isInteger(idx) || idx < 0 || idx >= parseJson(a.questions_json, []).length) throw bad("No such question");
    if (b.answer_id === null) {
      await db.prepare("DELETE FROM question_links WHERE analysis_id = ? AND question_index = ?").bind(p.id, idx).run();
      return json({ ok: true });
    }
    const ans = await db.prepare("SELECT id FROM answers WHERE id = ?").bind(str(b.answer_id, "answer_id")).first();
    if (!ans) throw notFound("Answer");
    await db.prepare("INSERT INTO question_links(analysis_id, question_index, answer_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(analysis_id, question_index) DO UPDATE SET answer_id = excluded.answer_id, created_at = excluded.created_at")
      .bind(p.id, idx, ans.id, now).run();
    return json({ ok: true });
  }

  // ------------------------------------------------------------ documents (tailored CV / letter) and versions
  if ((p = route("GET", "/documents/:id"))) {
    const d = await db.prepare("SELECT * FROM documents WHERE id = ?").bind(p.id).first();
    if (!d) throw notFound("Document");
    const versions = (await db.prepare("SELECT id, version_no, origin, body, note, fact_flags_json, created_at FROM document_versions WHERE document_id = ? ORDER BY version_no DESC").bind(p.id).all())
      .results.map((v) => ({ ...v, fact_flags: parseJson(v.fact_flags_json, []), fact_flags_json: undefined }));
    return json({ document: d, versions });
  }
  if ((p = route("POST", "/documents/:id/versions"))) {
    const b = await readJson(request);
    const d = await db.prepare("SELECT d.*, j.description AS job_description FROM documents d JOIN jobs j ON j.id = d.job_id WHERE d.id = ?").bind(p.id).first();
    if (!d) throw notFound("Document");
    const body = str(b.body, "body");
    const origin = oneOf(b.origin, "origin", ["edited", "pasted"], "edited");
    return json({ version: await addVersion(db, d, body, origin, str(b.note, "note", { max: 500, required: false }), now) }, 201);
  }
  if ((p = route("POST", "/documents/:id/restore"))) {
    const b = await readJson(request);
    const d = await db.prepare("SELECT d.*, j.description AS job_description FROM documents d JOIN jobs j ON j.id = d.job_id WHERE d.id = ?").bind(p.id).first();
    if (!d) throw notFound("Document");
    const v = await db.prepare("SELECT * FROM document_versions WHERE id = ? AND document_id = ?").bind(str(b.version_id, "version_id"), p.id).first();
    if (!v) throw notFound("Version");
    return json({ version: await addVersion(db, d, v.body, "restored", `Restored version ${v.version_no}`, now) }, 201);
  }
  if ((p = route("DELETE", "/documents/:id"))) {
    const r = await db.prepare("DELETE FROM documents WHERE id = ?").bind(p.id).run();
    if (!r.meta.changes) throw notFound("Document");
    return json({ ok: true });
  }
  if ((p = route("POST", "/factcheck"))) {
    const b = await readJson(request);
    const d = await db.prepare("SELECT d.*, j.description AS job_description FROM documents d JOIN jobs j ON j.id = d.job_id WHERE d.id = ?").bind(str(b.document_id, "document_id")).first();
    if (!d) throw notFound("Document");
    return json({ flags: factCheck(str(b.body, "body", { required: false }), await sourcesFor(db, d), d.job_description) });
  }

  // ------------------------------------------------------------ answer bank
  if ((p = route("GET", "/answers"))) {
    const answers = await answersWithBodies(db);
    const q = url.searchParams.get("q");
    if (q) {
      const ranked = matchAnswers(q, answers, { limit: 20, min: 0.05 });
      const byId = new Map(answers.map((a) => [a.id, a]));
      return json({ answers: ranked.map((r) => ({ ...byId.get(r.answer_id), score: r.score })) });
    }
    return json({ answers });
  }
  if ((p = route("POST", "/answers"))) {
    const b = await readJson(request);
    const id = newId("ans"), verId = newId("av");
    const question = str(b.question, "question", { max: 1000 });
    const body = str(b.body, "body", { max: 20000 });
    await db.batch([
      db.prepare("INSERT INTO answers(id, question, tags, use_as_evidence, current_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(id, question, str(b.tags, "tags", { max: 500, required: false }), b.use_as_evidence ? 1 : 0, verId, now, now),
      db.prepare("INSERT INTO answer_versions(id, answer_id, version_no, body, note, rating, created_at) VALUES (?, ?, 1, ?, ?, ?, ?)")
        .bind(verId, id, body, str(b.note, "note", { max: 500, required: false }), rating(b.rating), now),
    ]);
    if (b.link && typeof b.link === "object") {
      const a = await db.prepare("SELECT id FROM analyses WHERE id = ?").bind(String(b.link.analysis_id || "")).first();
      if (a && Number.isInteger(b.link.question_index)) {
        await db.prepare("INSERT INTO question_links(analysis_id, question_index, answer_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(analysis_id, question_index) DO UPDATE SET answer_id = excluded.answer_id")
          .bind(a.id, b.link.question_index, id, now).run();
      }
    }
    return json({ answer: await answerById(db, id) }, 201);
  }
  if ((p = route("GET", "/answers/:id"))) {
    const a = await answerById(db, p.id);
    if (!a) throw notFound("Answer");
    const versions = (await db.prepare("SELECT * FROM answer_versions WHERE answer_id = ? ORDER BY version_no DESC").bind(p.id).all()).results;
    const used = (await db.prepare(
      `SELECT l.analysis_id, l.question_index, j.id AS job_id, j.title AS job_title, j.company FROM question_links l
         JOIN analyses an ON an.id = l.analysis_id JOIN jobs j ON j.id = an.job_id WHERE l.answer_id = ? ORDER BY l.created_at DESC`).bind(p.id).all()).results;
    return json({ answer: a, versions, used_in: used });
  }
  if ((p = route("PUT", "/answers/:id"))) {
    const b = await readJson(request);
    const a = await db.prepare("SELECT * FROM answers WHERE id = ?").bind(p.id).first();
    if (!a) throw notFound("Answer");
    const question = b.question !== undefined ? str(b.question, "question", { max: 1000 }) : a.question;
    const tags = b.tags !== undefined ? str(b.tags, "tags", { max: 500, required: false }) : a.tags;
    const ev = b.use_as_evidence !== undefined ? (b.use_as_evidence ? 1 : 0) : a.use_as_evidence;
    await db.prepare("UPDATE answers SET question = ?, tags = ?, use_as_evidence = ?, updated_at = ? WHERE id = ?").bind(question, tags, ev, now, p.id).run();
    return json({ answer: await answerById(db, p.id) });
  }
  if ((p = route("POST", "/answers/:id/versions"))) {
    const b = await readJson(request);
    const a = await db.prepare("SELECT id FROM answers WHERE id = ?").bind(p.id).first();
    if (!a) throw notFound("Answer");
    const next = (await db.prepare("SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM answer_versions WHERE answer_id = ?").bind(p.id).first("n"));
    const verId = newId("av");
    await db.batch([
      db.prepare("INSERT INTO answer_versions(id, answer_id, version_no, body, note, rating, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(verId, p.id, next, str(b.body, "body", { max: 20000 }), str(b.note, "note", { max: 500, required: false }), rating(b.rating), now),
      db.prepare("UPDATE answers SET current_version_id = ?, updated_at = ? WHERE id = ?").bind(verId, now, p.id),
    ]);
    return json({ answer: await answerById(db, p.id) }, 201);
  }
  if ((p = route("POST", "/answers/:id/current"))) {
    const b = await readJson(request);
    const v = await db.prepare("SELECT id FROM answer_versions WHERE id = ? AND answer_id = ?").bind(str(b.version_id, "version_id"), p.id).first();
    if (!v) throw notFound("Version");
    await db.prepare("UPDATE answers SET current_version_id = ?, updated_at = ? WHERE id = ?").bind(v.id, now, p.id).run();
    return json({ answer: await answerById(db, p.id) });
  }
  if ((p = route("DELETE", "/answers/:id"))) {
    const r = await db.prepare("DELETE FROM answers WHERE id = ?").bind(p.id).run();
    if (!r.meta.changes) throw notFound("Answer");
    return json({ ok: true });
  }

  // ------------------------------------------------------------ backup
  if ((p = route("GET", "/export"))) {
    const out = {};
    for (const t of ["cvs", "jobs", "analyses", "documents", "document_versions", "answers", "answer_versions", "question_links", "decisions"]) {
      out[t] = (await db.prepare(`SELECT * FROM ${t}`).all()).results;
    }
    return json({ exported_at: now, ...out }, 200, { "content-disposition": `attachment; filename="resume-pipeline-${now.slice(0, 10)}.json"` });
  }

  throw new HttpError(404, "No such API route");
}

const rating = (r) => {
  if (r === undefined || r === null || r === "") return null;
  const n = Number(r);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw bad("rating must be 1 to 5");
  return n;
};

async function answersWithBodies(db) {
  return (await db.prepare(
    `SELECT a.id, a.question, a.tags, a.use_as_evidence, a.current_version_id, a.created_at, a.updated_at,
            v.body, v.version_no, v.rating, (SELECT COUNT(*) FROM answer_versions x WHERE x.answer_id = a.id) AS versions
       FROM answers a LEFT JOIN answer_versions v ON v.id = a.current_version_id ORDER BY a.updated_at DESC`).all()).results;
}
const answerById = async (db, id) => (await answersWithBodies(db)).find((a) => a.id === id) || null;

async function evidenceText(db) {
  const { results } = await db.prepare(
    "SELECT a.question, v.body FROM answers a JOIN answer_versions v ON v.id = a.current_version_id WHERE a.use_as_evidence = 1").all();
  return results.map((r) => `Q: ${r.question}\nA: ${r.body}`).join("\n\n");
}

async function sourcesFor(db, doc) {
  const cv = doc.cv_id ? await db.prepare("SELECT body FROM cvs WHERE id = ?").bind(doc.cv_id).first() : null;
  return `${cv?.body || ""}\n${await evidenceText(db)}`;
}

async function addVersion(db, doc, body, origin, note, now) {
  const next = await db.prepare("SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM document_versions WHERE document_id = ?").bind(doc.id).first("n");
  const flags = factCheck(body, await sourcesFor(db, doc), doc.job_description);
  const id = newId("ver");
  await db.batch([
    db.prepare("INSERT INTO document_versions(id, document_id, version_no, origin, body, note, fact_flags_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, doc.id, next, origin, body, note, JSON.stringify(flags), now),
    db.prepare("UPDATE documents SET current_version_id = ?, updated_at = ? WHERE id = ?").bind(id, now, doc.id),
  ]);
  return { id, version_no: next, origin, body, note, fact_flags: flags, created_at: now };
}
