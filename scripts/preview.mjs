// Local preview without Cloudflare: the real Worker code on an in-memory SQLite that behaves like D1.
//   node scripts/preview.mjs [--port 8788] [--demo]
// Sign-in is off (OPEN_ACCESS) unless you pass --password <pw>. --demo loads a sample CV, job and answers.
// Cloudflare's own simulator is `npx wrangler dev` (put APP_PASSWORD in .dev.vars); use that when you can.
import http from "node:http";
import worker from "../src/worker.js";
import { createD1, createAssets } from "../test/helpers/d1-shim.mjs";
import { seedDemo } from "../test/helpers/demo.mjs";

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const port = Number(opt("--port", 8788));
const password = opt("--password", "");
const env = {
  DB: createD1(),
  ASSETS: createAssets(new URL("../public", import.meta.url).pathname),
  BASE_PATH: "/project/resume_pipeline",
  APP_PASSWORD: password, OPEN_ACCESS: password ? "false" : "true",
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
};
if (args.includes("--demo")) { await seedDemo(worker, env); console.log("Demo data loaded."); }

http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await worker.fetch(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body }), env);
    const headers = Object.fromEntries(r.headers);
    if (r.headers.getSetCookie) { const sc = r.headers.getSetCookie(); if (sc.length) headers["set-cookie"] = sc; }
    res.writeHead(r.status, headers);
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    console.error(e); res.writeHead(500); res.end("preview error");
  }
}).listen(port, () => console.log(`Preview: http://localhost:${port}/project/resume_pipeline/`));
