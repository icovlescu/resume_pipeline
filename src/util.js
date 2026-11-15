import { HttpError, bad } from "./errors.js";

export const MAX_BODY = 256 * 1024;

export async function readJson(request, max = MAX_BODY) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > max) throw new HttpError(413, "Request too large");
  const text = await request.text();
  if (text.length > max) throw new HttpError(413, "Request too large");
  try {
    const v = JSON.parse(text || "{}");
    if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw bad("Body must be a JSON object");
  }
}

const enc = new TextEncoder();
export const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const randomToken = (bytes = 32) => b64u(crypto.getRandomValues(new Uint8Array(bytes)));
export const newId = (prefix) => `${prefix}_${randomToken(12)}`;
export const nowIso = (env) => (typeof env.__now === "function" ? env.__now() : new Date().toISOString());
export const addMs = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();

export async function sha256Hex(text) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a, b) {
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  if (x.length !== y.length) return false;
  let r = 0;
  for (let i = 0; i < x.length; i++) r |= x[i] ^ y[i];
  return r === 0;
}

/** Trimmed string or throw. */
export function str(v, name, { max = 200_000, required = true } = {}) {
  if (v === undefined || v === null || v === "") {
    if (required) throw bad(`${name} is required`);
    return "";
  }
  if (typeof v !== "string") throw bad(`${name} must be text`);
  const s = v.trim();
  if (required && !s) throw bad(`${name} is required`);
  if (s.length > max) throw bad(`${name} is too long (max ${max} characters)`);
  return s;
}

export function oneOf(v, name, allowed, dflt) {
  if (v === undefined || v === null || v === "") {
    if (dflt !== undefined) return dflt;
    throw bad(`${name} is required`);
  }
  if (!allowed.includes(v)) throw bad(`${name} must be one of: ${allowed.join(", ")}`);
  return v;
}

export const parseJson = (s, d = null) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
