# resume_pipeline

A personal job pipeline: find the day's best-matching roles across several
professional profiles, tailor a CV for each without inventing skills, and
record an explicit apply/skip decision with a rationale for every role.

Status: research and design. No pipeline code yet.

- [docs/pipeline-design.md](docs/pipeline-design.md): flow, skills ledger,
  profiles, daily top 10, decision log.
- [docs/reference-repos.md](docs/reference-repos.md): the five public repos we
  learn from and what to take from each.

## Reference repos
The repos are kept as context, not vendored. To read them locally:

```bash
./scripts/fetch_references.sh   # clones into references/vendor/ (gitignored)
```

Pinned commits, upstream URLs and our forks are in
[references/repos.tsv](references/repos.tsv). The script clones from the fork
when there is one and adds upstream as a second remote.
