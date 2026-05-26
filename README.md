# RETAIL — Phase 1 Setup Tests

TypeScript + Playwright + Mocha test suite for the retail back-office Phase 1
setup flow, plus standalone maintenance scripts for staging data.

## Setup

```bash
npm install
```

Environment variables are loaded from `.env` (see `config/env.ts` for all keys).
At minimum, `DATABASE_URL` must point at the staging PostgreSQL instance for any
DB-backed verification or cleanup to work.

## Test commands

| Command | Description |
| --- | --- |
| `npm run test:phase1` | Run the Phase 1 setup spec end-to-end |
| `npm run test:login` | Run only the login smoke spec |
| `npm test` | Run every `tests/**/*.spec.ts` |

## Maintenance scripts

### `cleanup:staging` — purge old staging test franchises

Soft-deletes test franchises (and their cost centers and terminals) left behind
on staging by previous Phase 1 runs. Reuses `helpers/dbClient.cleanupByFranchise`
so the cascade matches what the in-suite `afterAll` hook performs.

```bash
# Dry run — print what would be deleted, change nothing
npm run cleanup:staging -- --dry-run

# Default: name prefix "farkas", franchises older than 24h
npm run cleanup:staging

# Custom prefix + 72h cutoff, capped to 50 franchises per run
npm run cleanup:staging -- --prefix=farkas --hours=72 --limit=50

# Disable age cutoff (process every matching franchise regardless of age)
npm run cleanup:staging -- --hours=0
```

Flags:

- `--prefix=<str>` — franchise name prefix to match (default: `farkas`, which
  is the prefix produced by `helpers/dataFactory.generateFranchiseName`).
- `--hours=<n>` — only target franchises older than N hours (default: `24`).
  The script auto-detects a `created_at`-style column on `retail.franchise`; if
  no such column exists, the age cutoff is skipped with a warning.
- `--limit=<n>` — cap the number of franchises processed in one run.
- `--dry-run`, `-n` — list matches but do not write to the DB.
- `--help`, `-h` — show usage.

The script requires `DATABASE_URL` to be set and exits non-zero on failure. It
only ever soft-deletes (`UPDATE … SET deleted = true`) inside a transaction per
franchise, so a failed cascade for one franchise will not affect the others.
