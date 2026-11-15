# resume_pipeline

A personal job pipeline: find the day's best-matching roles across several
professional profiles, tailor a CV for each without inventing skills, and
record an explicit apply/skip decision with a rationale for every role.

A web app on Cloudflare (one Worker + a D1 database) at
`https://covlescu.com/project/resume_pipeline`:

- **Jobs and CVs in D1.** Paste a job, keep base CVs per profile (Lead Data
  Analytics, Data Scientist, Product Builder, Manager DS&A), LinkedIn text and notes.
- **Role vs CV.** For each job and CV: the main points of the role, strengths with
  quotes from your CV, a gap analysis (must-have vs nice to have, language levels,
  "X or Y" alternatives), and 10-14 likely interview questions.
- **Proposed CV and motivation letter, edited online.** Both are proposed from
  your own facts only. Edit them in the browser, or paste your own version; every
  save is a new version, the proposal is kept, and any version can be restored.
  Copy, Markdown preview and download are built in.
- **Fact check.** Any skill in a proposal or edit that is not in your sources is
  flagged, never silently kept.
- **Answer bank.** Save answers to expected questions, refine them into new
  versions with a rating, and see your best previous answers matched to each new
  job's questions. Answers you mark as *evidence* count as sources for CVs.
- **Decisions.** Apply / later / skip with a rationale, kept per job.

Two engines: Claude (`claude-opus-5-5`, when the `ANTHROPIC_API_KEY` secret is
set) or a built-in engine that needs no key. Both go through the same fact check.

```
Browser ──► covlescu.com/project/resume_pipeline/*
              ├─ /        web UI (public/project/resume_pipeline, served free by Cloudflare)
              └─ /api/*   Worker (src/) ──► D1 "resume-pipeline"
                                       └──► Claude API (optional)
```

## Deploy

The D1 databases already exist (`resume-pipeline` and `resume-pipeline-preview`,
Western Europe, created 2026-11-15) and their ids are in `wrangler.jsonc`. The
schema is applied; the Worker would also create it on first use.

1. **Connect the repo to a Worker.** Cloudflare dashboard → *Workers & Pages →
   Create → Import a repository* → `resume_pipeline`. Worker name
   `resume-pipeline` (must equal `name` in `wrangler.jsonc`), build command empty,
   deploy command `npx wrangler deploy`. Every push to `main` then deploys; other
   branches deploy as previews on the preview database.
2. **Set your password.** Worker → *Settings → Variables and Secrets* → secret
   `APP_PASSWORD` (long and random). Without it the API refuses every request.
3. **Optional: turn on Claude.** Add the secret `ANTHROPIC_API_KEY`. Model and
   effort are the `CLAUDE_MODEL` / `CLAUDE_EFFORT` vars. Without a key the
   built-in engine runs, at no cost.
4. Open `https://covlescu.com/project/resume_pipeline/`, sign in, add your CV
   under *CVs & sources*, then paste a job.

`covlescu.com` must be proxied (orange cloud). The route only takes this path.

## Run locally

```bash
npm install
npm test                       # API, analysis and security tests (node:test, in-memory SQLite)
npm run preview -- --demo      # http://localhost:8788/project/resume_pipeline/ with sample data, no sign-in
npx wrangler dev               # Cloudflare's simulator; put APP_PASSWORD in .dev.vars
```

## Code map

| Path | What |
|---|---|
| `src/schema.js` | D1 schema (versioned; `npm run gen:sql` writes `migrations/0001_init.sql`) |
| `src/api.js` | JSON API: CVs, jobs, analyses, documents + versions, answers + versions, decisions, export |
| `src/analysis.js` | built-in engine, fact check, answer matching (TF-IDF + shared skills) |
| `src/skills.js` | skill vocabulary and aliases (extend it for your field) |
| `src/llm.js` | Claude engine with structured JSON output |
| `src/auth.js` | single-owner sign-in, hashed session cookie, lockout |
| `public/project/resume_pipeline/` | web UI (plain JS, no build) |

Your data stays in your D1 database. *Jobs → Download backup* exports everything as JSON.

## Design notes
- [docs/pipeline-design.md](docs/pipeline-design.md): flow, skills ledger,
  profiles, daily top 10, decision log.
- [docs/reference-repos.md](docs/reference-repos.md): the five public repos we
  learn from and what to take from each.
- [docs/pages/pipeline-mockup.html](docs/pages/pipeline-mockup.html): the first
  clickable mockup (sample data).

## Reference repos
The repos are kept as context, not vendored. To read them locally:

```bash
./scripts/fetch_references.sh   # clones into references/vendor/ (gitignored)
```

Pinned commits, upstream URLs and our forks are in
[references/repos.tsv](references/repos.tsv). The script clones from the fork
when there is one and adds upstream as a second remote.

## Support
resume_pipeline is free to use and stays free. If it helped you, you can leave
a tip. Tips are voluntary, there is no paid tier, and tipping unlocks nothing.

<!-- tip-link: replace with the real tip page, and set the same URL in
.github/FUNDING.yml and data-tip-url in docs/pages/pipeline-mockup.html -->
Tip link coming soon. Setup steps: [docs/tips-setup.md](docs/tips-setup.md).
