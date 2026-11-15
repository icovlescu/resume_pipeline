import { test } from "node:test";
import assert from "node:assert/strict";
import { analyseHeuristic, factCheck, matchAnswers, splitJob } from "../src/analysis.js";
import { findSkills } from "../src/skills.js";
import { DEMO_CV, DEMO_JOB } from "./helpers/demo.mjs";

test("skills: aliases, word boundaries, case-sensitive R", () => {
  const s = findSkills("Python, Postgres and R; R&D budget. A/B testing; lead a team; Power BI");
  assert.deepEqual([...s.keys()].sort(), ["R", "experimentation", "power bi", "python", "sql", "team leadership"].sort());
  assert.ok(!findSkills("our R&D team").has("R"));
  assert.ok(!findSkills("dbtx").has("dbt"));
});

test("job split keeps '8+ years' and detects sections", () => {
  const { requirements, responsibilities } = splitJob(DEMO_JOB.description);
  assert.ok(requirements.some((l) => l.startsWith("8+ years")));
  assert.ok(responsibilities.some((l) => /Lead and grow/.test(l)));
});

test("gaps: language level, alternatives and nice-to-haves", () => {
  const a = analyseHeuristic(DEMO_JOB, { cv: DEMO_CV, evidence: "" });
  const g = Object.fromEntries(a.gaps.map((x) => [x.skill, x.severity]));
  assert.equal(g["dutch (fluent)"], "must");
  assert.equal(g.bigquery, "nice", "BigQuery OR Snowflake, and Snowflake is in the CV");
  assert.equal(g.looker, "nice");
  assert.equal(g["causal inference"], "must");
  assert.ok(!a.strengths.some((s) => s.skill === "dutch"));
});

test("fact check flags only skills missing from sources", () => {
  const flags = factCheck("Python, Tableau and causal inference", "I use Python daily", "Tableau wanted");
  assert.deepEqual(flags.map((f) => f.skill).sort(), ["causal inference", "tableau"]);
  assert.match(flags.find((f) => f.skill === "tableau").reason, /Named in the job/);
});

test("answer matching ranks the relevant answer first", () => {
  const answers = [
    { id: "a", question: "Why do you want to work here?", tags: "motivation", body: "Mission" },
    { id: "b", question: "How do you handle a difficult stakeholder?", tags: "stakeholder management", body: "I listen first, then agree on the decision owner." },
  ];
  const r = matchAnswers("Tell me about a time you had to push back on a senior stakeholder.", answers);
  assert.equal(r[0].answer_id, "b");
  assert.ok(!r.some((x) => x.answer_id === "a"));
});
