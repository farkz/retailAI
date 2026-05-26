# RetailAI Test Suite

Automated API + DB test suite for the retail betting/gaming backoffice system. Covers Phase 1 setup: franchise creation, offer groups, cost centers, terminals, and betshops.

## Run & Operate

- `pnpm --filter @workspace/retail-ai run test` — run all tests
- `pnpm --filter @workspace/retail-ai run test:phase1` — run Phase 1 complete setup test
- `pnpm --filter @workspace/retail-ai run test:login` — run login test only
- `pnpm run typecheck` — full typecheck across all packages

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Test runner: Playwright Test (`@playwright/test`)
- DB verification: PostgreSQL (`pg`)
- API server: Express 5 (shared, in `artifacts/api-server`)

## Where things live

- `tests/retail-ai/` — the main test package (`@workspace/retail-ai`)
  - `config/env.ts` — environment config (reads from `.env`)
  - `config/playwright.config.ts` — Playwright test runner config
  - `fixtures/api.fixture.ts` — Playwright fixture that creates and logs in an `ApiClient`
  - `helpers/apiClient.ts` — all API calls (franchise, cost center, terminal, betshop, offer group)
  - `helpers/dbClient.ts` — PostgreSQL verification queries
  - `helpers/testContext.ts` — shared in-memory state across test steps
  - `helpers/dataFactory.ts` — test data generators
  - `tests/phase1-setup/` — Phase 1 test specs

## Architecture decisions

- Uses `@playwright/test` as the test runner (not Mocha) — test files use `test.describe` / Playwright fixture syntax
- `ApiClient` is injected via a Playwright fixture so login happens once per test, automatically
- Shared `testData` module carries state (franchise ID, cost center IDs, etc.) between sequential steps within a test
- DB verification runs against `retail.franchise` / `retail.cost_center` tables via direct SQL queries

## Product

Phase 1 test flow:
1. Login as BO Admin
2. Create a Franchise + verify via API and DB
3. Create Race and Bingo OfferGroups
4. Create 5 Cost Centers
5. Create Terminals and Betshops for each Cost Center

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Copy `.env.example` → `.env` and fill in `BASE_URL`, `TENANT_ID`, `BO_USERNAME`, `BO_PASSWORD`, `DATABASE_URL` before running tests
- `testData` is module-level state — it persists across `test()` calls within the same process, which is intentional for sequential setup steps
- The `login.spec.ts` login test verifies the fixture (login happens in the fixture itself, not inside the test body)

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
