// Optional Claude engine. Used when the secret ANTHROPIC_API_KEY is set (wrangler secret put ANTHROPIC_API_KEY);
// otherwise the built-in engine in src/analysis.js runs. The model sees only your CV text, answers you marked as
// evidence, and the job description, and is told never to add skills, employers or numbers that are not there.
// Its output then goes through the same fact check as the built-in engine.
import Anthropic from "@anthropic-ai/sdk";
import { HttpError } from "./errors.js";

export const DEFAULT_MODEL = "claude-opus-5-5";

export const llmEnabled = (env) => Boolean(env.__anthropic || env.ANTHROPIC_API_KEY);

function client(env) {
  if (env.__anthropic) return env.__anthropic; // tests inject a fake
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 120_000 });
}

const obj = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const strArr = { type: "array", items: { type: "string" } };

const ANALYSIS_SCHEMA = obj({
  match_score: { type: "integer", description: "0-100: how well the sources cover what the role asks for" },
  summary: { type: "string" },
  main_points: { ...strArr, description: "The 5-10 things this role is really about, in plain words" },
  strengths: { type: "array", items: obj({ skill: { type: "string" }, severity: { type: "string", enum: ["must", "nice"] }, evidence: strArr }) },
  gaps: { type: "array", items: obj({ skill: { type: "string" }, severity: { type: "string", enum: ["must", "nice"] }, mitigation: { type: "string" } }) },
  questions: { type: "array", items: obj({ question: { type: "string" }, type: { type: "string", enum: ["motivation", "intro", "experience", "gap", "leadership", "behavioural", "role", "technical"] }, why: { type: "string" } }) },
});

const DOCS_SCHEMA = obj({
  cv_markdown: { type: "string", description: "The full tailored CV in Markdown" },
  letter_markdown: { type: "string", description: "The motivation letter in Markdown, under 350 words" },
});

const SYSTEM = `You help one person apply for jobs. You work only from the SOURCES they give you: their CV, \
LinkedIn text, notes, and interview answers they marked as evidence.
Hard rules:
- Never invent or imply a skill, tool, employer, title, date, degree, certification or number that is not in the SOURCES.
- A skill the job wants but the SOURCES do not show is a gap. Report it as a gap; never put it in a CV or letter.
- Rephrasing, reordering, and choosing what to emphasise is fine. Keep the person's own voice.
- Write in the language of the job description unless the SOURCES are clearly in another language and the job is in English.`;

async function call(env, user, schema, maxTokens = 16000) {
  const res = await client(env).beta.messages.create({
    model: env.CLAUDE_MODEL || DEFAULT_MODEL,
    max_tokens: maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: env.CLAUDE_EFFORT || "medium", format: { type: "json_schema", schema } },
    system: SYSTEM,
    messages: [{ role: "user", content: user }],
  });
  if (res.stop_reason === "refusal") throw new HttpError(502, "Claude declined this request; try the built-in engine.");
  if (res.stop_reason === "max_tokens") throw new HttpError(502, "Claude's answer was cut off; try again.");
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(502, "Claude returned an unreadable answer; try again or use the built-in engine.");
  }
}

const block = (tag, text) => `<${tag}>\n${text}\n</${tag}>`;

export async function analyseWithClaude(env, job, sources) {
  const user = [
    block("job", `Title: ${job.title}\nCompany: ${job.company}\nLocation: ${job.location}\n\n${job.description}`),
    block("sources", `${sources.cv}\n\n${sources.evidence ? "EVIDENCE ANSWERS:\n" + sources.evidence : ""}`),
    "Compare the role with the SOURCES. Give the main points of the role, strengths (each with short quotes from the SOURCES as evidence), " +
      "gaps (what the role asks that the SOURCES do not show, with an honest way to handle it in an interview), " +
      "and 10-14 interview questions this person is likely to get for this role, including questions that probe the gaps.",
  ].join("\n\n");
  const r = await call(env, user, ANALYSIS_SCHEMA, 12000);
  return { engine: "claude", ...r, match_score: Math.max(0, Math.min(100, Math.round(r.match_score))) };
}

export async function documentsWithClaude(env, job, sources, analysis) {
  const user = [
    block("job", `Title: ${job.title}\nCompany: ${job.company}\n\n${job.description}`),
    block("sources", `${sources.cv}\n\n${sources.evidence ? "EVIDENCE ANSWERS:\n" + sources.evidence : ""}`),
    block("analysis", JSON.stringify({ main_points: analysis.main_points, strengths: analysis.strengths, gaps: analysis.gaps })),
    "Write (1) a tailored CV in Markdown that keeps every role, date and employer from the CV, reorders and rephrases bullets to lead with what this job values, " +
      "and starts with a 2-3 line profile for this role; and (2) a motivation letter in Markdown, under 350 words, specific to this company and role. " +
      "Use only facts from the SOURCES. Do not mention the gaps as skills you have.",
  ].join("\n\n");
  return call(env, user, DOCS_SCHEMA, 16000);
}
