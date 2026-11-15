// Entry point. The Worker owns https://covlescu.com/project/resume_pipeline and everything below it:
//   <base>/api/*   JSON API backed by D1 (see src/api.js)
//   <base>/*       the web UI from ./public/<base>/ . In production Cloudflare serves these files without running
//                  this Worker (wrangler.jsonc: run_worker_first only for the api path). This branch is what the
//                  local preview and the tests use.
import { handleApi } from "./api.js";
import { HttpError, json } from "./errors.js";
import { CSP } from "./csp.js";

const DEFAULT_BASE = "/project/resume_pipeline";

function secure(res) {
  const h = new Headers(res.headers);
  h.set("content-security-policy", CSP);
  h.set("x-content-type-options", "nosniff");
  h.set("referrer-policy", "no-referrer");
  h.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  h.set("cross-origin-opener-policy", "same-origin");
  h.set("x-robots-tag", "noindex");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const base = (env.BASE_PATH ?? DEFAULT_BASE).replace(/\/+$/, "");
    if (url.pathname !== base && !url.pathname.startsWith(base + "/")) {
      return secure(new Response("Not found", { status: 404 }));
    }
    if (url.pathname === base) return Response.redirect(`${url.origin}${base}/${url.search}`, 308);
    const rel = url.pathname.slice(base.length) || "/";

    if (rel === "/api" || rel.startsWith("/api/")) {
      try {
        return secure(await handleApi(request, env, url, rel.slice(4) || "/"));
      } catch (e) {
        if (e instanceof HttpError) return secure(json({ error: e.message, ...(e.extra || {}) }, e.status));
        console.error("api error", e?.stack || e);
        return secure(json({ error: "Internal error" }, 500));
      }
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return secure(new Response("Method not allowed", { status: 405 }));
    }
    return secure(await env.ASSETS.fetch(request));
  },
};
