// The built-in engine: works with no API key. It extracts requirements and skills from the job, compares them
// with the CV (and answers marked as evidence), proposes a tailored CV and letter that only reuse facts already
// in your sources, lists likely interview questions, and matches them with saved answers.
// When ANTHROPIC_API_KEY is set, src/llm.js does the same with Claude; the fact check below runs on both.
import { findSkills, skillGroup, displayName, titleName } from "./skills.js";

const MUST = /\b(must|required|requirement|essential|you have|you bring|you will need|minimum|proven|strong|solid|at least|\d+\+?\s*years?)\b/i;
const NICE = /\b(nice to have|bonus|plus|preferred|ideally|desirable|advantage)\b/i;
const HEADING_REQ = /(requirements|what you bring|who you are|your profile|qualifications|what we('re| are) looking for|you have|must have|skills)/i;
const HEADING_RESP = /(responsibilities|what you('ll| will) do|the role|your role|your impact|in this role|key tasks)/i;

const clean = (l) => l.replace(/^\s*(?:[-*•·●▪◦–—>]+|\d{1,2}[.)](?=\s))\s*/, "").replace(/\s+/g, " ").trim();

/** Split a job description into responsibility and requirement lines. */
export function splitJob(description) {
  const lines = String(description || "").split(/\r?\n|(?<=[.;])\s+(?=[A-Z])/).map((l) => l.trim()).filter(Boolean);
  const req = [], resp = [], other = [];
  let section = null;
  for (const raw of lines) {
    const line = clean(raw);
    if (!line) continue;
    if (line.length < 60 && /:?$/.test(line) && (HEADING_REQ.test(line) || HEADING_RESP.test(line)) && !/[.!?]$/.test(line)) {
      section = HEADING_REQ.test(line) ? "req" : "resp";
      continue;
    }
    if (line.length < 12) continue;
    if (section === "req" || MUST.test(line) || NICE.test(line)) req.push(line);
    else if (section === "resp") resp.push(line);
    else other.push(line);
  }
  return { requirements: req, responsibilities: resp, other };
}

const yearsIn = (text) => {
  const m = [...String(text).matchAll(/(\d{1,2})\s*\+?\s*(?:years?|yrs)/gi)].map((x) => Number(x[1])).filter((n) => n > 0 && n < 40);
  return m.length ? Math.max(...m) : null;
};

const seniorityOf = (title) => {
  const t = title.toLowerCase();
  if (/\b(head|director|vp|chief)\b/.test(t)) return "head";
  if (/\b(manager|lead|principal|staff)\b/.test(t)) return "lead";
  if (/\bsenior|sr\.?\b/.test(t)) return "senior";
  if (/\b(junior|graduate|intern)\b/.test(t)) return "junior";
  return "mid";
};

/** Sentences of `text` that mention `skill` (for evidence quotes). */
export function evidenceFor(text, skill, max = 2) {
  const m = findSkills;
  const out = [];
  for (const s of String(text).split(/\r?\n|(?<=[.!?])\s+/)) {
    const line = clean(s);
    if (line.length < 15 || line.length > 400) continue;
    if (m(line).has(skill)) out.push(line);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Role vs CV analysis.
 * @param job {title, company, description}
 * @param sources {cv: string, evidence: string}  evidence = answers marked "use as evidence"
 */
export function analyseHeuristic(job, sources) {
  const { requirements, responsibilities, other } = splitJob(job.description);
  const jobSkills = findSkills(`${job.title}\n${job.description}`);
  const cvText = sources.cv || "";
  const cvSkills = findSkills(cvText);
  const evSkills = findSkills(sources.evidence || "");

  const severityOf = (skill) => {
    const inReq = requirements.filter((l) => findSkills(l).has(skill));
    if (!inReq.length) return "nice";
    return inReq.some((l) => NICE.test(l) && !MUST.test(l)) ? "nice" : "must";
  };

  // "BigQuery or Snowflake": when one alternative is backed, the other is not a must-have gap.
  const alternativeBacked = (skill) => requirements.some((l) => {
    const inLine = findSkills(l);
    if (!inLine.has(skill) || !/\bor\b/i.test(l)) return false;
    return [...inLine.keys()].some((o) => o !== skill && skillGroup(o) === skillGroup(skill) && (cvSkills.has(o) || evSkills.has(o)));
  });
  // "Dutch fluently" vs "Dutch (B1)": the language is named in both, but the level is a gap.
  const levelGap = (skill) => {
    if (skillGroup(skill) !== "language") return null;
    const wantsFluent = requirements.some((l) => findSkills(l).has(skill) && /\b(fluent|fluently|native|c1|c2|proficient|business level)\b/i.test(l));
    if (!wantsFluent) return null;
    const m = cvText.match(new RegExp(`${skill}[^\\n]{0,25}?\\b(A1|A2|B1|B2|basic|intermediate|learning)\\b`, "i"));
    return m ? m[1] : null;
  };

  const strengths = [], gaps = [];
  let total = 0, got = 0;
  for (const [skill, count] of [...jobSkills.entries()].sort((a, b) => b[1] - a[1])) {
    let severity = severityOf(skill);
    const lvl = levelGap(skill);
    if (lvl) {
      total += 2 * Math.min(count, 3);
      gaps.push({ skill: `${skill} (fluent)`, group: "language", severity, mitigation: `The role asks for fluent ${displayName(skill)}; your CV says ${lvl}. Say where you are and how fast you are improving; do not overstate it.` });
      continue;
    }
    const alt = severity === "must" && !cvSkills.has(skill) && !evSkills.has(skill) && alternativeBacked(skill);
    if (alt) severity = "nice";
    const w = (severity === "must" ? 2 : 1) * Math.min(count, 3);
    total += w;
    if (cvSkills.has(skill)) {
      got += w;
      strengths.push({ skill, group: skillGroup(skill), severity, evidence: evidenceFor(cvText, skill) });
    } else if (evSkills.has(skill)) {
      got += w * 0.8;
      strengths.push({ skill, group: skillGroup(skill), severity, evidence: evidenceFor(sources.evidence, skill), source: "answer bank" });
    } else {
      gaps.push({
        skill, group: skillGroup(skill), severity,
        mitigation: alt
          ? `Listed as an alternative to something you have. Say so, and that ${displayName(skill)} would be quick to pick up.`
          : severity === "must"
          ? `Not in your CV. If you have done this, add a story to the answer bank and mark it as evidence; otherwise prepare how you would ramp up on ${displayName(skill)}.`
          : `Nice to have. Mention a related strength or how you would learn ${displayName(skill)}; do not claim it.`,
      });
    }
  }

  const wantYears = yearsIn(requirements.join(" "));
  const haveYears = yearsIn(cvText);
  if (wantYears && haveYears !== null && haveYears < wantYears) {
    gaps.unshift({ skill: `${wantYears}+ years experience`, group: "experience", severity: "must", mitigation: `Your CV states about ${haveYears} years. Lead with scope and impact rather than tenure.` });
  }
  let score = total ? got / total : 0.5;
  if (wantYears && haveYears !== null && haveYears < wantYears) score *= 0.9;
  score = Math.round(score * 100);

  const mainPoints = [...responsibilities.slice(0, 4), ...requirements.slice(0, 6)];
  if (mainPoints.length < 4) mainPoints.push(...other.slice(0, 6 - mainPoints.length));

  const musts = gaps.filter((g) => g.severity === "must").map((g) => g.skill);
  const summary = `${score}% match for ${job.title}${job.company ? ` at ${job.company}` : ""}. ` +
    `${strengths.length} of ${jobSkills.size} skills named in the role are backed by your sources` +
    (musts.length ? `; must-have gaps: ${musts.slice(0, 4).join(", ")}.` : "; no must-have gaps found.");

  return {
    engine: "heuristic",
    match_score: score,
    summary,
    main_points: mainPoints.slice(0, 10),
    strengths,
    gaps,
    questions: questionsFor(job, strengths, gaps),
  };
}

/** Likely interview questions from the role, strengths and gaps. */
export function questionsFor(job, strengths, gaps) {
  const q = [];
  const company = job.company || "us";
  const add = (question, type, why) => { if (!q.some((x) => x.question === question)) q.push({ question, type, why }); };
  add(`Why do you want this ${job.title} role at ${company}?`, "motivation", "Asked in almost every first interview.");
  add("Walk me through your background and how it fits this role.", "intro", "Your opening story.");
  const ranked = strengths.filter((s) => s.severity === "must").concat(strengths.filter((s) => s.severity !== "must"));
  const techGroups = new Set(["tool", "cloud", "bi"]);
  const tech = ranked.filter((s) => techGroups.has(s.group)).slice(0, 3).map((s) => displayName(s.skill));
  if (tech.length) add(`Walk me through a project where you used ${listJoin(tech)}. What was your part and what was the impact?`, "technical", "Hands-on check of the tools the role names.");
  for (const s of ranked.filter((s) => !techGroups.has(s.group) && s.group !== "language").slice(0, 3)) {
    add(s.group === "leadership"
      ? `Tell me about a time you showed ${displayName(s.skill)}. What was the situation and what changed because of you?`
      : `Describe a project where you used ${displayName(s.skill)}. What was the impact, and what would you do differently?`,
    "experience", `The role asks for ${displayName(s.skill)}; your CV shows it.`);
  }
  const orderedGaps = gaps.filter((g) => g.severity === "must").concat(gaps.filter((g) => g.severity !== "must"));
  for (const g of orderedGaps.slice(0, 4)) {
    add(g.group === "language"
      ? `This role needs ${displayName(g.skill.replace(/ \(fluent\)$/, ""))} at a fluent level. Could you work in it from day one?`
      : `This role needs ${displayName(g.skill)}. What is your experience with it, and how would you close the gap?`,
    "gap", g.severity === "must" ? "Must-have not backed by your CV." : "Nice to have not in your CV.");
  }
  const lvl = seniorityOf(job.title);
  if (lvl === "lead" || lvl === "head") {
    add("How do you build, grow and keep a strong data team?", "leadership", "Lead-level role.");
    add("How do you decide what the team works on when every stakeholder says theirs is urgent?", "leadership", "Prioritisation at lead level.");
    add("Tell me about a time you had to deliver bad news or push back on a senior stakeholder.", "behavioural", "Influence without authority.");
  }
  add("Tell me about a project that failed or did not go as planned. What did you learn?", "behavioural", "Standard behavioural question.");
  add("How do you explain a complex analysis to a non-technical audience?", "behavioural", "Communication is checked for most data roles.");
  add(`What would you focus on in your first 90 days as ${job.title}?`, "role", "Shows you understood the role.");
  return q.slice(0, 14);
}

const listJoin = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

// ------------------------------------------------------------------ proposed documents

const titleCase = titleName;

/** Tailored CV: a targeted summary and key skills on top of the base CV. Only skills found in sources. */
export function proposeCv(job, analysis, cv) {
  const backed = analysis.strengths.filter((s) => s.source !== "answer bank").map((s) => s.skill);
  const top = backed.slice(0, 8);
  const head = [
    `## Profile for ${job.title}${job.company ? `, ${job.company}` : ""}`,
    "",
    top.length
      ? `Data professional with hands-on experience in ${top.slice(0, 4).map(titleCase).join(", ")}${top.length > 4 ? `, plus ${top.slice(4).map(titleCase).join(", ")}` : ""}. ` +
        `Focused on ${job.title.toLowerCase().includes("lead") || job.title.toLowerCase().includes("manager") || job.title.toLowerCase().includes("head") ? "leading teams and turning data into decisions" : "turning data into decisions"}.`
      : "Edit this summary to match the role.",
    "",
    "## Key skills for this role",
    "",
    ...(top.length ? top.map((s) => `- ${titleCase(s)}`) : ["- (no overlapping skills found; edit by hand)"]),
    "",
    "---",
    "",
  ];
  return head.join("\n") + String(cv || "").trim() + "\n";
}

export function proposeLetter(job, analysis, cv) {
  const strengths = analysis.strengths.filter((s) => s.source !== "answer bank").slice(0, 3);
  const company = job.company || "your company";
  const paras = [
    job.company ? `Dear ${job.company} team,` : "Dear Sir or Madam,",
    "",
    `I am applying for the ${job.title} role. ${analysis.main_points[0] ? `The chance to ${lowerFirst(analysis.main_points[0]).replace(/^you will /, "").replace(/\bour\b/g, "your").replace(/\bus\b/g, "you").replace(/\.$/, "")} is exactly the kind of work I want to do next.` : ""}`.trim(),
    "",
  ];
  if (strengths.length) {
    paras.push("What I would bring:", "");
    for (const s of strengths) {
      const ev = s.evidence[0];
      paras.push(`- ${titleCase(s.skill)}${ev ? `: ${ev.replace(/\.$/, "")}.` : "."}`);
    }
    paras.push("");
  }
  paras.push(
    `I would welcome the chance to discuss how I can contribute to ${company}.`,
    "",
    "Kind regards,",
    firstLine(cv) || "[Your name]",
  );
  return paras.join("\n") + "\n";
}

const lowerFirst = (t) => t.charAt(0).toLowerCase() + t.slice(1);
const firstLine = (cv) => {
  const l = String(cv || "").split(/\r?\n/).map((x) => x.replace(/^#+\s*/, "").trim()).find(Boolean) || "";
  return l.length <= 60 && !/[.:]/.test(l) ? l : "";
};

// ------------------------------------------------------------------ fact check

/** Skills mentioned in `text` that appear in none of the sources. These are flagged, never silently kept. */
export function factCheck(text, sourcesText, jobText = "") {
  const inDoc = findSkills(text);
  const inSrc = findSkills(sourcesText);
  const inJob = findSkills(jobText);
  const flags = [];
  for (const skill of inDoc.keys()) {
    if (!inSrc.has(skill)) flags.push({ skill, reason: inJob.has(skill) ? "Named in the job but not in your CV or evidence answers" : "Not in your CV or evidence answers" });
  }
  return flags;
}

// ------------------------------------------------------------------ answer matching

const STOP = new Set("a an and are as at be by can do does for from has have how i in is it its me my of on or our tell that the their them this time to us was we were what when where which who why will with would you your about describe give example walk through".split(" "));
export const tokens = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9+#/ ]+/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w))
  .map((w) => w.replace(/(ing|ed|es|s)$/, "") || w);

/**
 * Rank saved answers for a question: TF-IDF cosine on question + tags (weight 2) and answer text (weight 1),
 * plus a bonus for shared skills. Returns [{answer_id, score}] sorted, score in 0..1.
 */
export function matchAnswers(question, answers, { limit = 3, min = 0.12 } = {}) {
  if (!answers.length) return [];
  const docs = answers.map((a) => {
    const tf = new Map();
    const addT = (text, w) => { for (const t of tokens(text)) tf.set(t, (tf.get(t) || 0) + w); };
    addT(a.question, 2); addT(a.tags, 2); addT(a.body, 1);
    return { a, tf, skills: findSkills(`${a.question} ${a.tags} ${a.body}`) };
  });
  const df = new Map();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const idf = (t) => Math.log(1 + (docs.length + 1) / ((df.get(t) || 0) + 1));
  const qtf = new Map();
  for (const t of tokens(question)) qtf.set(t, (qtf.get(t) || 0) + 1);
  const qSkills = findSkills(question);
  const vecNorm = (tf) => Math.sqrt([...tf].reduce((s, [t, c]) => s + (c * idf(t)) ** 2, 0)) || 1;
  const qn = vecNorm(qtf);
  return docs.map((d) => {
    let dot = 0;
    for (const [t, c] of qtf) if (d.tf.has(t)) dot += c * idf(t) * d.tf.get(t) * idf(t);
    let score = dot / (qn * vecNorm(d.tf));
    const shared = [...qSkills.keys()].filter((s) => d.skills.has(s)).length;
    if (shared) score = Math.min(1, score + 0.15 * shared);
    return { answer_id: d.a.id, score: Math.round(score * 100) / 100 };
  }).filter((x) => x.score >= min).sort((x, y) => y.score - x.score).slice(0, limit);
}
