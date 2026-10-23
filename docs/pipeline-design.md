# Pipeline design (draft)

## Goals
1. Present the same person through several **profiles** (for example Data
   Analytics Lead, Data Scientist, Product Builder, Data Science & Analytics
   Manager).
2. Every day, surface the **top 10 matches** across those profiles.
3. Tailor a CV per match **without inventing skills**.
4. Allow extra skills only when **backed by evidence** (CV, LinkedIn, answered
   experience questions, or past feedback).
5. Ask explicitly for **each role and CV**, and store the decision and the
   rationale.

## Flow

```
sources ──► ingest ──► rank ──► top 10 ──► tailor ──► fact gate ──► approve? ──► decision log
(JobSpy,    (dedupe,   (per     (daily     (per       (every claim   (you: yes /
 pasted JD,  liveness)  profile, digest)    profile    traced to      no / later,
 uploaded            score +            CV)        evidence)      + rationale)
 requirements)       reason)
                                            ▲
                       skills ledger ───────┘
                       (CV, LinkedIn, Q&A, feedback)
```

## Skills ledger (source of truth)
Each skill is stored once, with where it came from. The tailoring step can only
use skills in the ledger with status `verified` or `supported`.

| field | meaning |
|-------|---------|
| `skill` | canonical name, e.g. `causal inference` |
| `status` | `verified` (in CV/LinkedIn), `supported` (from Q&A or feedback, you confirmed), `claimed_gap` (JD wants it, no evidence; never used) |
| `evidence` | list of `{source, quote, date}`; source is `cv`, `linkedin`, `qa`, `feedback` |
| `profiles` | which profiles may show it |
| `confirmed_by_user_at` | required for `supported` |

Rules:
- A skill moves from `claimed_gap` to `supported` only after you answer an
  experience question or point to feedback, **and** confirm it.
- The generator receives only the ledger, never free text from the JD, so it
  cannot copy JD skills into the CV.
- After generation, a fact gate (like career-ops' `verify-cv-facts.mjs`) rejects
  any skill, tool, employer or metric that is not in the ledger or source docs.

## Profiles
```yaml
- id: lead-data-analytics
  title: Lead, Data Analytics
  search_terms: ["head of data analytics", "analytics lead"]
  emphasis: [stakeholder management, BI strategy, team leadership]
- id: data-scientist
  title: Data Scientist
  search_terms: ["senior data scientist"]
  emphasis: [modelling, experimentation, python]
```

## Daily top 10
- Scrape per profile (JobSpy, `hours_old=24`), dedupe by company + title + URL.
- Score each job against each profile: required-skill coverage from the ledger,
  seniority fit, location and salary filters.
- Keep the best profile per job, then the best 10 overall. Each row carries a
  score **and** a one-line reason; nothing is hidden silently.

## Decision log
Every role gets an explicit decision before any CV is used.

```json
{
  "job_id": "linkedin:4021337",
  "profile_id": "lead-data-analytics",
  "cv_version": "cv/lead-data-analytics/2026-10-23-acme.pdf",
  "decision": "apply | skip | later",
  "rationale": "Strong fit on team leadership; salary below floor is acceptable for remote.",
  "skills_added_from_feedback": ["dbt"],
  "decided_at": "2026-10-23T08:15:00Z"
}
```
Stored append-only (`data/decisions.jsonl`), so past rationale can inform later
ranking.

## Open questions
- Storage: plain files (career-ops style) or SQLite from the start?
- Interface: CLI + Claude Code skills first, or a small web UI like the mockup?
- Which job boards and countries matter most?
