// Minimal Cloudflare D1 look-alike on node:sqlite, for tests and the local preview server.
// Implements the parts of the D1 API this project uses: prepare/bind/all/first/run/batch/exec.
import { DatabaseSync } from "node:sqlite";

const isRead = (sql) => /^\s*(select|with|pragma)\b/i.test(sql);
const clean = (params) => params.map((p) => (p === undefined ? null : p));

class Statement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.params = []; }
  bind(...params) { const s = new Statement(this.db, this.sql); s.params = clean(params); return s; }
  _exec() {
    const st = this.db.prepare(this.sql);
    if (isRead(this.sql)) return { success: true, results: st.all(...this.params).map((r) => ({ ...r })), meta: { changes: 0 } };
    const r = st.run(...this.params);
    return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  async all() { return this._exec(); }
  async run() { return this._exec(); }
  async first(col) {
    const r = this._exec().results[0] ?? null;
    return col && r ? r[col] : r;
  }
}

export function createD1() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  return {
    raw: db,
    prepare: (sql) => new Statement(db, sql),
    async exec(sql) { db.exec(sql); return { count: 1 }; },
    // D1 runs a batch as one transaction: all statements succeed or none do.
    async batch(stmts) {
      db.exec("BEGIN");
      try {
        const out = stmts.map((s) => s._exec());
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

/** Fake ASSETS binding that serves files from a directory. */
export function createAssets(dir) {
  return {
    async fetch(request) {
      const { readFile } = await import("node:fs/promises");
      const { extname, join, normalize } = await import("node:path");
      let p = new URL(request.url).pathname;
      if (p.endsWith("/")) p += "index.html";
      const file = normalize(join(dir, p));
      if (!file.startsWith(normalize(dir))) return new Response("Forbidden", { status: 403 });
      const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
      try {
        const body = await readFile(file);
        return new Response(body, { headers: { "content-type": types[extname(file)] || "application/octet-stream" } });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    },
  };
}
