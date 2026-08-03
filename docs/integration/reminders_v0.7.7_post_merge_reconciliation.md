# Klinip v0.7.7 - Post-merge fixture reconciliation

Date: 2026-08-03
Status: repository hygiene only; no functional changes.

PR #30 was merged first into Cloud through merge commit
`651408108beabde71d5a5a1b222dd7dc189d85f8`. The initial remote `main`
observed for this reconciliation was
`23c04b90269841c9de840fc8939a7cfa4a3eb7db`.

That later commit, `docs: record v0.7.7 PR A / PR F merge closure`, was a
direct administrative documentation commit on top of the functional merge.
It is preserved as part of the real repository history. See
`docs/integration/klinip_v0.7.7_pr_a_pr_f_merge_closure.md` for the existing
closure summary.

## Fixture normalization

The canonical fixture is
`docs/contracts/fixtures/reminders_v0.7.7.json`. Its canonical LF byte hash is:

`9c695379956b5d4414dd11a941bf2c2fd2f20c2cfd41e3adee4c0529a6308575`

On Windows, the global `core.autocrlf=true` setting materialized the file with
CRLF endings and produced a different worktree-only hash. The Git blob remained
unchanged and correct. The repository now declares the narrow rule
`docs/contracts/fixtures/*.json text eol=lf` so clean Windows checkouts preserve
the canonical bytes.

This reconciliation changes no reminder model, migration, constraint, API,
scheduler, worker, frontend behavior, Railway configuration, or production
PostgreSQL state. It performs no deployment. Cloud PR B was not started, and
Klinip One was not modified.
