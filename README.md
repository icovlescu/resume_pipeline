# resume_pipeline

A personal job pipeline: find the day's best-matching roles across several
professional profiles, tailor a CV for each without inventing skills, and
record an explicit apply/skip decision with a rationale for every role.

Status: research and design. No pipeline code yet.

- [docs/pipeline-design.md](docs/pipeline-design.md): flow, skills ledger,
  profiles, daily top 10, decision log.
- [docs/reference-repos.md](docs/reference-repos.md): the five public repos we
  learn from and what to take from each.
- [docs/pages/pipeline-mockup.html](docs/pages/pipeline-mockup.html): clickable
  mockup of the daily top 10, evidence-backed tailoring and per-role decisions
  (sample data). Open it in a browser.
- [docs/pages/reference-repos.html](docs/pages/reference-repos.html): the repo
  comparison as a page.

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
Tip link coming soon.
