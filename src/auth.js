// Single-owner sign-in. The password is the Worker secret APP_PASSWORD (wrangler secret put APP_PASSWORD).
// A successful sign-in sets a random session cookie (HttpOnly, SameSite=Strict, Secure on https, 30 days);
// only its SHA-256 is stored in D1. Five wrong passwords in 15 minutes lock sign-in for 15 minutes.
// With no APP_PASSWORD set the API refuses everything, unless OPEN_ACCESS is "true" (local preview only).
import { HttpError } from "./errors.js";
import { randomToken, sha256Hex, timingSafeEqual, nowIso, addMs } from "./util.js";

const COOKIE = "rp_session";
const DAY = 86_400_000;
const LOCK_WINDOW = 15 * 60_000;
const MAX_FAILS = 5;

const cookieOf = (request) => {
  const m = (request.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? m[1] : null;
};

export const openAccess = (env) => env.OPEN_ACCESS === "true";
export const configured = (env) => Boolean(env.APP_PASSWORD) || openAccess(env);

export async function isAuthed(request, env) {
  if (openAccess(env)) return true;
  if (!env.APP_PASSWORD) return false;
  const token = cookieOf(request);
  if (!token) return false;
  const row = await env.DB.prepare("SELECT expires_at FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).first();
  return Boolean(row && row.expires_at > nowIso(env));
}

export async function requireAuth(request, env) {
  if (!configured(env)) throw new HttpError(503, "Set the APP_PASSWORD secret on the Worker first (see README).");
  if (!(await isAuthed(request, env))) throw new HttpError(401, "Sign in first");
}

function cookie(request, value, maxAgeS) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeS}${secure}`;
}

export async function login(request, env, password) {
  if (!env.APP_PASSWORD) throw new HttpError(503, "Set the APP_PASSWORD secret on the Worker first (see README).");
  const now = nowIso(env);
  const since = addMs(now, -LOCK_WINDOW);
  const fails = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_failures WHERE at > ?").bind(since).first("n");
  if (fails >= MAX_FAILS) throw new HttpError(429, "Too many wrong passwords. Try again in 15 minutes.");
  const ok = timingSafeEqual(await sha256Hex(String(password ?? "")), await sha256Hex(env.APP_PASSWORD));
  if (!ok) {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO login_failures(at) VALUES (?)").bind(now),
      env.DB.prepare("DELETE FROM login_failures WHERE at < ?").bind(addMs(now, -DAY)),
    ]);
    throw new HttpError(401, "Wrong password");
  }
  const token = randomToken(32);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO sessions(token_hash, created_at, expires_at) VALUES (?, ?, ?)").bind(await sha256Hex(token), now, addMs(now, 30 * DAY)),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM login_failures"),
  ]);
  return cookie(request, token, 30 * 86400);
}

export async function logout(request, env) {
  const token = cookieOf(request);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
  return cookie(request, "", 0);
}
