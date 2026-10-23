# Reference repos

Five public repos that already solve parts of this pipeline, ranked by GitHub
stars (checked 2026-10-23). They are kept as context, not copied: the pinned
commits live in [`references/repos.tsv`](../references/repos.tsv) and
`scripts/fetch_references.sh` clones them into the gitignored
`references/vendor/` folder for reading.

| # | Repo | Stars | License | Stack | Covers |
|---|------|------:|---------|-------|--------|
| 1 | [career-ops-hq/career-ops](https://github.com/career-ops-hq/career-ops) | 76.7k | MIT | Node, Markdown prompts, agent CLI | Scan, score 1-5, archetypes, tailor, fact gates, tracker |
| 2 | [ai-job-search-dev/ai-job-search](https://github.com/ai-job-search-dev/ai-job-search) | 63.7k | MIT | Python, Claude Code skills, LaTeX | Profile from CV + LinkedIn, scrape, drafter-reviewer, outcomes |
| 3 | [srbhr/Resume-Matcher](https://github.com/srbhr/Resume-Matcher) | 28.8k | Apache-2.0 | FastAPI, Next.js, SQLite | Master resume, JD tailoring, skill verification, ATS check |
| 4 | [speedyapply/JobSpy](https://github.com/speedyapply/JobSpy) | 4.5k | MIT | Python library + MCP | Scraping LinkedIn, Indeed, Glassdoor, ZipRecruiter and more |
| 5 | [DaKheera47/job-ops](https://github.com/DaKheera47/job-ops) | 4.1k | Commons Clause | TypeScript, Docker | Self-hosted search, 0-100 score, tailor, Gmail tracking |

## What to take from each

### 1. career-ops
The closest match to what we want. It never submits for you, and it has the
strongest "don't invent things" machinery.
- `modes/_shared.md`: archetype detection driven by the user's own target-role
  table in `modes/_profile.md`. This is the same idea as our profiles
  (Data Analytics Lead, Data Scientist, Product Builder, ...).
- `jd-skill-gap.mjs`: classifies each JD skill as `existing`,
  `supportedByResume` or `gap`, and never adds anything automatically.
- `verify-cv-facts.mjs` and `story-provenance-check.mjs`: check every claim in a
  generated CV back to user-authored sources. Use the same idea as a hard gate.
- `rank-pipeline.mjs`: annotates rows with a score **and a reason**, never hides
  rows. Good model for the daily top 10.
- `DATA_CONTRACT.md`: strict split between system files and user data, with
  files as the source of truth and SQLite as a derived index.

### 2. ai-job-search
- `documents/` layout: CV, LinkedIn export, projects, references and past
  applications with an `outcome.md` each. Maps directly to our evidence inputs.
- `/setup` builds the candidate profile from those documents and merges without
  overwriting.
- `application-reviewer` agent: a second pass that critiques the drafted CV
  before you see it.
- `/outcome` feeds results back, which is our "past feedback" loop.
- Job portal skills target Danish boards, so swap them for JobSpy.

### 3. Resume-Matcher
- Master resume plus per-job tailored copies. Tailoring prompts forbid adding
  skills, tools, employers or metrics not in the master.
- Skill verification split (the origin of career-ops' three buckets).
- ATS score and parse check are plain code (`apps/backend/app/services/ats.py`,
  `services/ats_parse/`), no LLM.
- MCP server so Claude Code can drive tailoring while the app stores and
  renders.

### 4. JobSpy
- Use as a dependency, not a fork: `pip install python-jobspy`, then
  `scrape_jobs(site_name=[...], search_term=..., hours_old=24)` returns a
  DataFrame. Also ships a CLI and an MCP server.
- One search term per profile, run daily, gives the raw pool we rank.
- LinkedIn rate-limits quickly; plan for proxies or fewer results per run.

### 5. job-ops
- Reference for the product shape: search, score, tailor, export, track in one
  self-hosted UI, with deliberate "no auto-apply".
- Pluggable extractors per job board and Gmail-based status tracking.
- **License note:** Commons Clause forbids selling the software. Read it for
  ideas; don't fork it as our base.

## Also looked at
- [reactive-resume](https://github.com/reactive-resume/reactive-resume) (44.7k):
  a resume builder and renderer, no job matching. Useful as a PDF export target.
- [rendercv](https://github.com/rendercv/rendercv) (17.8k): YAML to PDF
  rendering, a good fit for per-profile CV variants.
- [ApplyPilot](https://github.com/Pickle-Pixel/ApplyPilot) (1.7k): auto-applies,
  which conflicts with our explicit per-role approval.

## Recommendation
Don't fork any of these wholesale. Build our own small pipeline and borrow:
JobSpy for sourcing, career-ops' archetype and fact-gate ideas for profiles and
truthfulness, Resume-Matcher's master-resume tailoring rules, and
ai-job-search's document layout and outcome loop.
