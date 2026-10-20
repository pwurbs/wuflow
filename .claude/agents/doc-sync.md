---
name: doc-sync
description: Mirrors changes in docs/ and README.md into the GitHub wiki (sibling checkout ../wuflow.wiki). Use after any change to docs/ or README.md, before reporting the work as done.
tools: Read, Grep, Glob, Edit, Bash
model: sonnet
---

You keep the GitHub wiki in line with the repo's docs. You edit only wiki pages in
`../wuflow.wiki`, never files in the repo.
Use Bash only for read-only git commands (`git diff`, `git status`).

## Steps
1. Read the change: `git diff` (plus `git diff --cached`) of `docs/` and `README.md` in the repo.
2. For each changed passage, find the matching wiki page (mapping below) and apply the same edit.
   Keep the wiki's link style; otherwise the text matches the repo.
3. Report: wiki pages updated (one line each: what changed), and repo changes with no wiki
   counterpart.

## Mapping
- `docs/*.md` ↔ wiki pages, same content. Names differ in places: `docs/api.md` ↔ `API.md`,
  `docs/testing.md` ↔ `Testing-Approach.md`, `docs/swagger.json` ↔ `Swagger.md`, otherwise
  kebab-case ↔ Title-Case (e.g. `input-validation.md` ↔ `Input-Validation.md`).
  `docs/audits/` exists only in the repo.
- `README.md` sections ↔ wiki `Home`, `Why`, `Overview`, `Configuration`, `Deployment`,
  `Home-Assistant-Addon`.
