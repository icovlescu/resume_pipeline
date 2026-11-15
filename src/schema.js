// Single source of truth for the D1 schema. The Worker applies it on first use (every statement is idempotent),
// so a fresh database needs no manual step. `npm run gen:sql` writes the same SQL to migrations/0001_init.sql
// for `wrangler d1 migrations apply`. New versions are appended to VERSIONS, never edited in place.

const V1 = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,

  // Owner sign-in. Only the SHA-256 of the cookie token is stored.
  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash TEXT PRIMARY KEY,
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS login_failures (at TEXT NOT NULL)`,

  // Source documents: base CVs per profile, a LinkedIn export, free notes. These are the only facts the
  // tailoring step may use (plus answers marked as evidence).
  `CREATE TABLE IF NOT EXISTS cvs (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     profile TEXT NOT NULL DEFAULT '',
     kind TEXT NOT NULL DEFAULT 'cv' CHECK (kind IN ('cv','linkedin','notes')),
     body TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS jobs (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     company TEXT NOT NULL DEFAULT '',
     url TEXT NOT NULL DEFAULT '',
     location TEXT NOT NULL DEFAULT '',
     source TEXT NOT NULL DEFAULT 'pasted',
     description TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','analysed','apply','applied','later','skip','interview','offer','rejected')),
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_updated ON jobs(updated_at)`,

  // Role vs CV: main points, strengths, gaps and expected interview questions.
  `CREATE TABLE IF NOT EXISTS analyses (
     id TEXT PRIMARY KEY,
     job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
     cv_id TEXT REFERENCES cvs(id) ON DELETE SET NULL,
     engine TEXT NOT NULL,
     match_score REAL NOT NULL,
     summary TEXT NOT NULL DEFAULT '',
     main_points_json TEXT NOT NULL,
     strengths_json TEXT NOT NULL,
     gaps_json TEXT NOT NULL,
     questions_json TEXT NOT NULL,
     created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_analyses_job ON analyses(job_id, created_at)`,

  // A tailored CV or motivation letter for one job. Every save is a new row in document_versions,
  // so the proposed text is never lost and any version can be restored.
  `CREATE TABLE IF NOT EXISTS documents (
     id TEXT PRIMARY KEY,
     job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
     cv_id TEXT REFERENCES cvs(id) ON DELETE SET NULL,
     analysis_id TEXT REFERENCES analyses(id) ON DELETE SET NULL,
     kind TEXT NOT NULL CHECK (kind IN ('cv','letter')),
     title TEXT NOT NULL,
     current_version_id TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_documents_job ON documents(job_id, kind)`,
  `CREATE TABLE IF NOT EXISTS document_versions (
     id TEXT PRIMARY KEY,
     document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
     version_no INTEGER NOT NULL,
     origin TEXT NOT NULL CHECK (origin IN ('proposed','edited','pasted','restored')),
     body TEXT NOT NULL,
     note TEXT NOT NULL DEFAULT '',
     fact_flags_json TEXT NOT NULL DEFAULT '[]',
     created_at TEXT NOT NULL,
     UNIQUE (document_id, version_no)
   )`,

  // Answer bank: one row per story/answer, refined over time in answer_versions.
  `CREATE TABLE IF NOT EXISTS answers (
     id TEXT PRIMARY KEY,
     question TEXT NOT NULL,
     tags TEXT NOT NULL DEFAULT '',
     use_as_evidence INTEGER NOT NULL DEFAULT 0,
     current_version_id TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS answer_versions (
     id TEXT PRIMARY KEY,
     answer_id TEXT NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
     version_no INTEGER NOT NULL,
     body TEXT NOT NULL,
     note TEXT NOT NULL DEFAULT '',
     rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
     created_at TEXT NOT NULL,
     UNIQUE (answer_id, version_no)
   )`,
  // Which saved answer you chose for an expected question of an analysis.
  `CREATE TABLE IF NOT EXISTS question_links (
     analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
     question_index INTEGER NOT NULL,
     answer_id TEXT NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
     created_at TEXT NOT NULL,
     PRIMARY KEY (analysis_id, question_index)
   )`,

  // Explicit apply / skip / later decision per role, with the rationale (append-only).
  `CREATE TABLE IF NOT EXISTS decisions (
     id TEXT PRIMARY KEY,
     job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
     cv_id TEXT REFERENCES cvs(id) ON DELETE SET NULL,
     document_version_id TEXT,
     decision TEXT NOT NULL CHECK (decision IN ('apply','skip','later')),
     rationale TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_decisions_job ON decisions(job_id, created_at)`,
];

export const VERSIONS = [V1];
export const SCHEMA_VERSION = VERSIONS.length;

let ready = new WeakMap();

export async function ensureSchema(db) {
  if (ready.get(db)) return;
  let current = 0;
  try {
    const row = await db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").first();
    current = row ? Number(row.value) : 0;
  } catch { current = 0; }
  for (let v = current; v < VERSIONS.length; v++) {
    await db.batch([
      ...VERSIONS[v].map((sql) => db.prepare(sql)),
      db.prepare("INSERT INTO meta(key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(v + 1)),
    ]);
  }
  ready.set(db, true);
}

export function allSql() {
  return VERSIONS.flat().map((s) => s.replace(/\n {5}/g, "\n  ") + ";").join("\n\n") +
    `\n\nINSERT INTO meta(key, value) VALUES ('schema_version', '${SCHEMA_VERSION}') ON CONFLICT(key) DO UPDATE SET value = excluded.value;\n`;
}
