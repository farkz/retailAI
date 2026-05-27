# RetailAI Phase 1 - Complete Technical Specification
## Sufficient to rebuild this project from scratch

---

# 1. PROJECT OVERVIEW

An **automated end-to-end test suite** for a retail betting/gaming platform. It creates a complete franchise infrastructure on a staging environment and produces a structured JSON report. A React admin panel visualises that report with copyable GUIDs.

## 1.1 Architecture (two parts)

| Part | Technology | Purpose |
|------|-----------|---------|
| **Test Suite** | Playwright Test + TypeScript | Automated API-driven setup: 1 franchise, 2 offer groups, 5 cost centers, linked locations, 1 terminal + 1 betshop per CC |
| **Admin Panel** | React 19 + Vite + Tailwind CSS v4 | Dashboard: import JSON report, display all created IDs with one-click copy-to-clipboard |

## 1.2 Four API Base URLs

All point to a staging environment. The test uses `BASE_URL` as the default `baseURL` for Playwright's request context, but the `ApiClient` makes explicit calls to different microservices.

| Env Var | Default | Service |
|---------|---------|---------|
| `BASE_URL` | `https://retailapi.stage-xtreme.com` | Main retail API (franchise, cost center, terminal creation) |
| `USER_API_URL` | `https://userapi.stage-xtreme.com` | Authentication (BO admin login) |
| `VIRTUAL_RACE_API_URL` | `https://virtualraceintegrationapi.stage-xtreme.com` | Virtual race offer groups |
| `VIRTUAL_BINGO_API_URL` | `https://virtualbingointegrationapi.stage-xtreme.com` | Virtual bingo offer groups |

## 1.3 Database

PostgreSQL staging DB with a self-signed certificate. The `dbClient` connects via `pg` Pool with `ssl: { rejectUnauthorized: false }`.

Schema assumed: `retail` (tables: `franchise`, `cost_center`, `terminal`). The `dbClient` uses introspection to discover column names (e.g. cash-payout column, franchise created timestamp column, offer group table name) so the test is resilient to schema drift.

## 1.4 Report Output

After every test run, `test-results/phase1-report.json` is written - even if the test fails mid-way. It contains all successfully-created IDs, franchise name, step statuses, and timestamps. This JSON is imported into the admin panel.

---

# 2. DIRECTORY STRUCTURE

```
retailAI/
  config/
    env.ts              # All env vars + BO admin credentials
    playwright.config.ts # Playwright runner config
  helpers/
    apiClient.ts        # Class: login, create franchise/OG/CC/terminal/betshop
    dbClient.ts         # Postgres queries: verify + cleanup
    dataFactory.ts      # generateFranchiseName(), getBase64Logo()
    testContext.ts      # Shared mutable TestData singleton
    utils.ts            # (empty in current version)
  fixtures/
    api.fixture.ts      # Playwright test fixture: auto-login ApiClient
    users.json          # (unused in current version)
  tests/
    phase1-setup/
      login.spec.ts     # Smoke test: verify login works
      phase1-complete.spec.ts # Full 5-step setup + report + cleanup
  scripts/
    cleanupStaging.ts   # Standalone CLI to soft-delete old test franchises
  test-results/         # Generated: phase1-report.json + playwright logs
  types/
    api.types.ts        # (empty in current version)
  artifacts/
    admin-panel/        # React Vite app (see Section 7)
      src/
        App.tsx
        main.tsx
        index.css
        lib/
          utils.ts
        hooks/
          use-toast.ts
          use-mobile.tsx
        pages/
          not-found.tsx
        components/ui/   # 40+ Radix-based UI components
      vite.config.ts
      tsconfig.json
      package.json
  package.json          # Root: Playwright + Mocha + pg + ts-node
  tsconfig.json         # Root: typecheck excludes artifacts/
  .env                  # (not in repo) BO_USERNAME, BO_PASSWORD, DATABASE_URL
```

---

# 3. ENVIRONMENT CONFIGURATION

## 3.1 config/env.ts

```typescript
import dotenv from 'dotenv';
dotenv.config();

export const config = {
  baseUrl: process.env.BASE_URL || 'https://retailapi.stage-xtreme.com',
  userApiUrl: process.env.USER_API_URL || 'https://userapi.stage-xtreme.com',
  virtualRaceApiUrl: process.env.VIRTUAL_RACE_API_URL || 'https://virtualraceintegrationapi.stage-xtreme.com',
  virtualBingoApiUrl: process.env.VIRTUAL_BINGO_API_URL || 'https://virtualbingointegrationapi.stage-xtreme.com',
  tenantId: process.env.TENANT_ID || 'your-tenant-id',
  databaseUrl: process.env.DATABASE_URL || '',

  boAdmin: {
    username: process.env.BO_USERNAME || 'ifarkasbo',
    password: process.env.BO_PASSWORD || '123123',
    clientId: '555f642c-6add-41e2-89ca-c02703b5078e',
    clientType: 'BackOfficeConsumer',
  },
};
```

## 3.2 config/playwright.config.ts

```typescript
import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';
dotenv.config();

export default defineConfig({
  testDir: '../tests',
  testMatch: '**/*.spec.ts',
  timeout: 180000,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.BASE_URL || 'https://retailapi.stage-xtreme.com',
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
    },
  },
});
```

**Important note:** The `testDir` is `'../tests'` because this config lives inside `config/`. If you move it to root, change to `'./tests'`.

## 3.3 Root package.json

```json
{
  "name": "RETAIL",
  "version": "1.0.0",
  "description": "Phase 1 Setup Tests (TypeScript + Playwright)",
  "scripts": {
    "test:phase1": "mocha tests/phase1-setup/phase1-complete.spec.ts --require ts-node/register --timeout 180000",
    "test": "mocha tests/**/*.spec.ts --require ts-node/register --timeout 120000",
    "test:login": "mocha tests/phase1-setup/login.spec.ts --require ts-node/register",
    "clean": "rimraf node_modules package-lock.json && npm install",
    "build": "tsc",
    "cleanup:staging": "ts-node scripts/cleanupStaging.ts"
  },
  "dependencies": {
    "@playwright/test": "^1.60.0",
    "chai": "^5.3.3",
    "dotenv": "^16.6.1",
    "pg": "^8.21.0",
    "playwright": "^1.60.0"
  },
  "devDependencies": {
    "@types/chai": "^5.2.3",
    "@types/mocha": "^10.0.10",
    "@types/node": "^22.19.19",
    "@types/pg": "^8.20.0",
    "mocha": "^10.8.2",
    "rimraf": "^6.1.3",
    "ts-node": "^10.9.2",
    "typescript": "^5.9.3"
  },
  "mocha": {
    "extension": ["ts"],
    "require": ["ts-node/register"],
    "timeout": 180000
  }
}
```

> **Note:** Although Mocha scripts exist, the tests are actually run with `npx playwright test`. The Mocha scripts are legacy.

## 3.4 Root tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "moduleResolution": "node"
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "dist", "artifacts"]
}
```

The `"exclude": ["artifacts"]` is critical - it prevents the root TypeScript from type-checking the admin-panel Vite app, which uses different module resolution (esnext / bundler).

---

# 4. SHARED STATE: testContext.ts

A simple mutable singleton used to pass data between `ApiClient` helper calls within a single test run.

```typescript
export interface TestData {
  franchiseId?: string;
  franchiseName?: string;
  costCenters?: Array<{ costCenterId: string; name: string; code: string }>;
  costCenterIds?: string[];
  costCenterNames?: string[];
  terminals?: string[];
  betshops?: string[];
  allTerminalIds?: string[];
  allBetshopIds?: string[];
  bingoOfferGroupId?: string;
  raceOfferGroupId?: string;
}

export let testData: TestData = {};

export const saveTestData = (data: Partial<TestData>): void => {
  Object.assign(testData, data);
  console.log('Test data updated:', Object.keys(data));
};
```

This is NOT thread-safe. It works because Playwright Test runs tests sequentially by default (no parallelism configured).

---

# 5. DATA FACTORY: dataFactory.ts

```typescript
export const generateFranchiseName = (): string => {
  const randomNum = Math.floor(Math.random() * 90000) + 10000;
  return `farkas${randomNum}`;
};

export const getBase64Logo = () => "data:image/png;base64,...";
// NOTE: The actual getBase64Logo() contains a large base64-encoded PNG string
// used as the franchise logo payload in API requests.
```

---

# 6. API CLIENT: helpers/apiClient.ts

This is the core orchestrator. It manages authentication state (`token`, `boUserId`) and exposes methods to create every entity in the staging environment.

## 6.1 Class Definition & Constructor

```typescript
import { APIRequestContext, request } from '@playwright/test';
import { config } from '../config/env';
import { saveTestData, testData } from './testContext';
import { getBase64Logo } from './dataFactory';

export class ApiClient {
  private token: string | null = null;
  private boUserId: string | null = null;
  private context: APIRequestContext | null = null;

  getToken(): string | null { return this.token; }
  getBoUserId(): string | null { return this.boUserId; }

  async init(): Promise<void> {
    this.context = await request.newContext({
      baseURL: config.baseUrl,
      extraHTTPHeaders: { 'Content-Type': 'application/json' },
    });
  }

  async dispose(): Promise<void> {
    if (this.context) { await this.context.dispose(); this.context = null; }
  }

  private getContext(): APIRequestContext {
    if (!this.context) throw new Error('ApiClient not initialized - call init() first');
    return this.context;
  }

  private async getTokenInternal(): Promise<string> {
    if (this.token) return this.token;
    // ... login logic, see 6.2
  }
}
```

## 6.2 Authentication: `loginAsBoAdmin()`

**Endpoint:** `POST ${config.userApiUrl}/connect/token`  
**Content-Type:** `application/x-www-form-urlencoded`

**Request body (URL-encoded):**
```
grant_type=password
username=${config.boAdmin.username}
password=${config.boAdmin.password}
client_id=${config.boAdmin.clientId}
client_type=${config.boAdmin.clientType}
```

**Success response:**
```json
{
  "access_token": "<JWT_TOKEN>",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```

**Behavior:**
- Sends form data via `this.getContext().post()`
- Extracts `access_token` and stores it in `this.token`
- Sets default header `Authorization: Bearer <token>` on the context via `this.context!.get()` is NOT used; instead subsequent requests manually include the header
- Returns the token string

## 6.3 Create Franchise: `createFranchise()`

**Endpoint:** `POST ${config.baseUrl}/api/franchise/createfranchise`  
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`

**Request body:**
```typescript
{
  Name: string,              // from generateFranchiseName()
  Logo: getBase64Logo(),     // base64 PNG string
  TenantId: config.tenantId,
}
```

**Success response shape:**
```json
{
  "success": true,
  "id": "<GUID>",
  "name": "farkas12345"
}
```

**Behavior:**
- Calls `getTokenInternal()` to ensure authenticated
- Generates name via `generateFranchiseName()`
- Posts to `/api/franchise/createfranchise`
- If response is not OK, logs response text and throws
- Saves `{ franchiseId: id, franchiseName: name }` to `testData`
- Returns the franchise ID string

## 6.4 Create Offer Groups: `createOfferGroup(type: 'race' | 'bingo')`

**Endpoints:**
- Race: `POST ${config.virtualRaceApiUrl}/api/offergroup`
- Bingo: `POST ${config.virtualBingoApiUrl}/api/offergroup`

**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`

**Request body:**
```typescript
{
  Name: `${franchiseName} - ${type === 'race' ? 'Race' : 'Bingo'}`,
  FranchiseId: franchiseId,
  TenantId: config.tenantId,
  Type: type === 'race' ? 'VirtualRace' : 'VirtualBingo',
}
```

**Success response shape:**
```json
{
  "success": true,
  "id": "<GUID>",
  "name": "farkas12345 - Race"
}
```

**Behavior:**
- Reads `franchiseId` and `franchiseName` from `testData`
- Determines base URL from `type` (race vs bingo API)
- Posts to `/api/offergroup`
- Saves `raceOfferGroupId` or `bingoOfferGroupId` to `testData`
- Returns the offer group ID string

## 6.5 Create Cost Center: `createCostCenter(index: number)`

**Endpoint:** `POST ${config.baseUrl}/api/costcenter`  
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`

**Request body:**
```typescript
{
  Name: `${franchiseName} - Cost Center ${index + 1}`,
  FranchiseId: franchiseId,
  TenantId: config.tenantId,
  Code: `CC${index + 1}`,
}
```

**Success response shape:**
```json
{
  "success": true,
  "id": "<GUID>",
  "name": "farkas12345 - Cost Center 1"
}
```

**Behavior:**
- Creates a single cost center linked to the franchise
- Saves to `testData.costCenters` array (accumulative)
- Returns the cost center ID string

## 6.6 Link Cost Center to Offer Groups: `linkCostCenterToOfferGroups(costCenterId: string)`

**Endpoint:** `POST ${config.baseUrl}/api/costcenter/${costCenterId}/offergroups`  
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`

**Request body:**
```typescript
{
  OfferGroupIds: [
    testData.raceOfferGroupId,
    testData.bingoOfferGroupId,
  ],
}
```

**Behavior:**
- Reads both offer group IDs from `testData`
- Associates the given cost center with both Race and Bingo offer groups
- Returns `true` on success, throws on failure

## 6.7 Create Terminal: `createTerminal(costCenterId: string, index: number)`

**Endpoint:** `POST ${config.baseUrl}/api/terminal`  
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`

**Request body:**
```typescript
{
  Name: `${franchiseName} - Terminal ${index + 1}`,
  CostCenterId: costCenterId,
  TenantId: config.tenantId,
  Code: `T${index + 1}`,
  Type: 'Terminal',
}
```

**Success response shape:**
```json
{
  "success": true,
  "id": "<GUID>",
  "name": "farkas12345 - Terminal 1"
}
```

**Behavior:**
- Creates a terminal under the given cost center
- Saves to `testData.terminals` array
- Returns the terminal ID string

## 6.8 Create Betshop: `createBetshop(costCenterId: string, index: number)`

**Endpoint:** `POST ${config.baseUrl}/api/betshop`  
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`

**Request body:**
```typescript
{
  Name: `${franchiseName} - Betshop ${index + 1}`,
  CostCenterId: costCenterId,
  TenantId: config.tenantId,
  Code: `B${index + 1}`,
  Type: 'Betshop',
  CashPayoutEnabled: true,  // Critical: enables cash payout
}
```

**Success response shape:**
```json
{
  "success": true,
  "id": "<GUID>",
  "name": "farkas12345 - Betshop 1"
}
```

**Behavior:**
- Creates a betshop under the given cost center
- Explicitly sets `CashPayoutEnabled: true`
- Saves to `testData.betshops` array
- Returns the betshop ID string

## 6.9 Enable Cash Payout on Terminal: `enableCashPayout(terminalId: string)`

**Endpoint:** `PUT ${config.baseUrl}/api/terminal/${terminalId}/cashpayout`  
**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`

**Request body:**
```typescript
{
  CashPayoutEnabled: true,
}
```

**Behavior:**
- Enables cash payout on an existing terminal
- Used as a verification step or remediation if the initial creation didn't set it

---

# 7. DATABASE CLIENT: helpers/dbClient.ts

Connects to PostgreSQL staging DB with self-signed cert handling.

## 7.1 Connection Setup

```typescript
import { Pool } from 'pg';
import { config } from '../config/env';

let pool: Pool | null = null;
let dbAvailableCache: boolean | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: { rejectUnauthorized: false },  // STAGING ONLY: self-signed cert
    });
  }
  return pool;
}

export async function dbAvailable(): Promise<boolean> {
  if (dbAvailableCache !== null) return dbAvailableCache;
  if (!config.databaseUrl) { dbAvailableCache = false; return false; }
  try {
    const client = await getPool().connect();
    await client.query('SELECT 1');
    client.release();
    dbAvailableCache = true;
    return true;
  } catch (err) {
    console.warn('[dbClient] DB probe failed:', (err as Error).message);
    dbAvailableCache = false;
    return false;
  }
}
```

**Key design:** `dbAvailableCache` ensures the SSL probe runs only once. If the DB is unreachable, all DB assertions gracefully skip instead of crashing.

## 7.2 Introspection Methods

These query PostgreSQL `information_schema` to discover actual column/table names at runtime.

```typescript
export async function getCashPayoutColumnName(): Promise<string | null>
// Queries information_schema.columns for a column matching 'cash' AND 'payout'
// in the 'terminal' table. Returns the exact column name or null.

export async function getFranchiseCreatedColumn(): Promise<string | null>
// Queries information_schema.columns for a timestamp column in 'franchise'
// matching 'created'. Returns the exact column name or null.

export async function getOfferGroupTableName(): Promise<string | null>
// Queries information_schema.tables for a table name matching 'offer_group'
// or 'offergroup'. Returns the exact table name or null.
```

## 7.3 Verification Methods

All verification methods call `await dbAvailable()` first and return `null` / empty / skip if DB is unreachable.

```typescript
export async function verifyFranchise(franchiseId: string): Promise<boolean>
// SELECT 1 FROM retail.franchise WHERE id = $1

export async function verifyCostCenter(costCenterId: string): Promise<boolean>
// SELECT 1 FROM retail.cost_center WHERE id = $1

export async function verifyTerminal(terminalId: string): Promise<{ id: string; cashPayoutEnabled: boolean } | null>
// SELECT id, <cashPayoutColumn> FROM retail.terminal WHERE id = $1
// Returns null if DB unavailable or column not found

export async function verifyBetshop(betshopId: string): Promise<boolean>
// SELECT 1 FROM retail.betshop WHERE id = $1

export async function verifyOfferGroup(offerGroupId: string): Promise<boolean>
// SELECT 1 FROM retail.<offerGroupTable> WHERE id = $1
```

## 7.4 Cleanup Methods

```typescript
export async function cleanupByFranchise(franchiseId: string): Promise<boolean>
// Soft-deletes (or hard-deletes, depending on schema) all child entities:
// 1. Delete terminals WHERE cost_center_id IN (SELECT id FROM cost_center WHERE franchise_id = $1)
// 2. Delete betshops with same subquery
// 3. Delete cost centers WHERE franchise_id = $1
// 4. Delete franchise WHERE id = $1
// Returns true if any deletions occurred.

export async function findTestFranchises(options: { namePrefix: string; olderThanHours: number }): Promise<Array<{ id: string; name: string; created_at?: Date }>>
// SELECT id, name, <createdColumn> FROM retail.franchise
// WHERE name ILIKE $1 AND (<createdColumn> IS NULL OR <createdColumn> < NOW() - INTERVAL '$2 hours')
// Uses introspection to find the created timestamp column.
// Returns array of matching franchises.
```

---

# 8. FIXTURES: fixtures/api.fixture.ts

This Playwright test fixture automatically provides a logged-in `ApiClient` to every test.

```typescript
import { test as base } from '@playwright/test';
import { ApiClient } from '../helpers/apiClient';

export const test = base.extend<{
  apiClient: ApiClient;
}>({
  apiClient: async ({}, use) => {
    const client = new ApiClient();
    await client.init();
    await client.loginAsBoAdmin();
    await use(client);
    await client.dispose();
  },
});
```

**Usage in tests:**
```typescript
import { test, expect } from '../../fixtures/api.fixture';

test('should create franchise', async ({ apiClient }) => {
  const franchiseId = await apiClient.createFranchise();
  expect(franchiseId).toBeTruthy();
});
```

---

# 9. TEST SPECIFICATIONS

## 9.1 tests/phase1-setup/login.spec.ts

**Purpose:** Smoke test to verify BO admin login works.

```typescript
import { test, expect } from '../../fixtures/api.fixture';

test.describe('Phase 1 - BackOffice Login', () => {
  test('should login as BO Admin and retrieve token', async ({ apiClient }) => {
    const token = apiClient.getToken();
    const boUserId = apiClient.getBoUserId();

    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');
    expect(boUserId).toBeTruthy();

    console.log('Token retrieved successfully');
  });
});
```

## 9.2 tests/phase1-setup/phase1-complete.spec.ts

This is the main orchestration test. It creates the full Phase 1 infrastructure and writes a report.

### Data structures

```typescript
interface StepStatus {
  step: number;
  label: string;
  status: 'pending' | 'pass' | 'fail';
}

interface RunData {
  runAt: string;
  franchise: { id: string; name: string };
  offerGroups: {
    race: { id: string; name: string };
    bingo: { id: string; name: string };
  };
  costCenters: Array<{
    id: string;
    name: string;
    code: string;
    terminal: string;
    betshop: string;
  }>;
  steps: StepStatus[];
}
```

### Test flow (5 steps)

```typescript
const run: RunData = {
  runAt: new Date().toISOString(),
  franchise: { id: '', name: '' },
  offerGroups: { race: { id: '', name: '' }, bingo: { id: '', name: '' } },
  costCenters: [],
  steps: [
    { step: 1, label: 'Franchise created', status: 'pending' },
    { step: 2, label: 'Offer Groups created', status: 'pending' },
    { step: 3, label: 'Cost Centers created (5)', status: 'pending' },
    { step: 4, label: 'Locations linked to Offer Groups', status: 'pending' },
    { step: 5, label: 'Terminals & Betshops created', status: 'pending' },
  ],
};

async function writeReport(): Promise<void> {
  const fs = await import('fs');
  const path = await import('path');
  const dir = path.join(process.cwd(), 'test-results');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'phase1-report.json'),
    JSON.stringify(run, null, 2)
  );
  console.log('Report written to test-results/phase1-report.json');
}
```

### Step 1: Create Franchise
```typescript
const franchiseId = await apiClient.createFranchise();
run.franchise.id = franchiseId;
run.franchise.name = testData.franchiseName || '';
run.steps[0].status = 'pass';
```

### Step 2: Create Offer Groups
```typescript
const [raceId, bingoId] = await Promise.all([
  apiClient.createOfferGroup('race'),
  apiClient.createOfferGroup('bingo'),
]);
run.offerGroups.race = { id: raceId, name: `${run.franchise.name} - Race` };
run.offerGroups.bingo = { id: bingoId, name: `${run.franchise.name} - Bingo` };
run.steps[1].status = 'pass';
```

### Step 3: Create 5 Cost Centers
```typescript
for (let i = 0; i < 5; i++) {
  const ccId = await apiClient.createCostCenter(i);
  run.costCenters.push({
    id: ccId,
    name: `${run.franchise.name} - Cost Center ${i + 1}`,
    code: `CC${i + 1}`,
    terminal: '',
    betshop: '',
  });
}
run.steps[2].status = 'pass';
```

### Step 4: Link Cost Centers to Offer Groups
```typescript
for (const cc of run.costCenters) {
  await apiClient.linkCostCenterToOfferGroups(cc.id);
}
run.steps[3].status = 'pass';
```

### Step 5: Create 1 Terminal + 1 Betshop per Cost Center
```typescript
for (let i = 0; i < run.costCenters.length; i++) {
  const cc = run.costCenters[i];
  const [terminalId, betshopId] = await Promise.all([
    apiClient.createTerminal(cc.id, i),
    apiClient.createBetshop(cc.id, i),
  ]);
  cc.terminal = terminalId;
  cc.betshop = betshopId;
}
run.steps[4].status = 'pass';
```

### afterAll hook
```typescript
test.afterAll(async () => {
  await writeReport();
  // Optional: cleanup old test franchises
  // await dbClient.cleanupByFranchise(run.franchise.id);
});
```

**Critical behavior:** `writeReport()` is called in `afterAll` so it fires **even if the test fails mid-way**. The `run` object accumulates all successfully-created IDs up to the failure point.

---

# 10. CLEANUP SCRIPT: scripts/cleanupStaging.ts

A standalone CLI to soft-delete old test franchises from the staging DB.

## 10.1 CLI Arguments

| Flag | Default | Description |
|------|---------|-------------|
| `--prefix=<str>` | `farkas` | Franchise name prefix to match |
| `--hours=<n>` | `24` | Only delete franchises older than N hours (0 = no cutoff) |
| `--limit=<n>` | none | Cap number of franchises processed |
| `--dry-run`, `-n` | false | Print what would be deleted without modifying DB |
| `--help`, `-h` | false | Show usage |

## 10.2 Example Commands

```bash
# Dry run - see what would be deleted
pnpm cleanup:staging --prefix=farkas --hours=24 --dry-run

# Actually delete franchises older than 1 hour
pnpm cleanup:staging --prefix=farkas --hours=1

# Delete all farkas franchises (no age cutoff), max 10
pnpm cleanup:staging --prefix=farkas --hours=0 --limit=10
```

## 10.3 Logic Flow

1. Parse CLI args via `parseArgs(process.argv.slice(2))`
2. Validate `DATABASE_URL` is set
3. Call `dbClient.findTestFranchises({ namePrefix, olderThanHours })`
4. Print matched franchises
5. If `--dry-run`, exit without changes
6. For each matched franchise, call `dbClient.cleanupByFranchise(id)`
7. Print totals: `franchises=X, costCenters=Y, terminals=Z, failures=W`

---

# 11. ADMIN PANEL: artifacts/admin-panel/

## 11.1 Technology Stack

| Package | Version | Purpose |
|---------|---------|---------|
| React | ^19.0.0 | UI framework |
| Vite | ^6.0.0 | Build tool |
| Tailwind CSS | ^4.0.0 | Styling |
| shadcn/ui | latest | Component library (Radix-based) |
| framer-motion | ^11.0.0 | Animations |
| lucide-react | ^0.460.0 | Icons |
| wouter | ^3.0.0 | Router |
| @tanstack/react-query | ^5.0.0 | Data fetching (minimal usage) |

## 11.2 Package.json (admin-panel)

```json
{
  "name": "@workspace/admin-panel",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "dev:local": "vite --mode local",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@radix-ui/react-slot": "^1.1.0",
    "@radix-ui/react-toast": "^1.2.2",
    "@radix-ui/react-tooltip": "^1.1.4",
    "@tanstack/react-query": "^5.62.7",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "framer-motion": "^11.15.0",
    "lucide-react": "^0.460.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwind-merge": "^2.6.0",
    "tailwindcss-animate": "^1.0.7",
    "wouter": "^3.3.5"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.2",
    "vite": "^6.0.0"
  }
}
```

## 11.3 Vite Config

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'local' ? '/' : (process.env.BASE_PATH || '/'),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
}));
```

**Key points:**
- No monorepo-specific plugins (removed Replit-only plugins for local compatibility)
- `base` is optional - defaults to `/` if `BASE_PATH` is not set
- `dev:local` script forces `mode === 'local'` for local development

## 11.4 App.tsx Structure

The app is a single-page dashboard with two modes: `view` and `import`.

### State

```typescript
interface Phase1Report {
  runAt: string;
  franchise: { id: string; name: string };
  offerGroups: {
    race: { id: string; name: string };
    bingo: { id: string; name: string };
  };
  costCenters: Array<{
    id: string;
    name: string;
    code: string;
    terminal: string;
    betshop: string;
  }>;
  steps: Array<{
    step: number;
    label: string;
    status: 'pass' | 'fail' | 'pending';
  }>;
}
```

### Components

| Component | Purpose |
|-----------|---------|
| `CopyButton` | Icon button that copies text to clipboard, shows checkmark for 2s |
| `truncate(id)` | Truncates GUID to first 8 chars + `...` |
| `CopyableId` | Displays truncated ID with label + CopyButton |
| `StatusBadge` | Shows PASS (green), FAIL (red), or PENDING (gray) badge |
| `Dashboard` | Main view: empty state, import panel, or report view |

### Dashboard Layout

1. **Header** (sticky, backdrop-blur)
   - Left: Database icon + "Phase 1 Setup Report" title
   - Center: Overall status badge + timestamp
   - Right: "Copy All IDs" button + "Import JSON" button

2. **Empty State** (when no report loaded)
   - Database icon in circle
   - "No Test Data Loaded" heading
   - Instructions to find `test-results/phase1-report.json`
   - "Import JSON Report" button

3. **Import Panel**
   - Textarea for pasting JSON
   - "Load Example Data" button (populates MOCK_DATA)
   - "Load Report" button

4. **Report View** (3-column grid on desktop)
   - **Column 1 (wide):**
     - Franchise card: name + full ID with copy button
     - Offer Groups: 2 cards side-by-side (Race / Bingo) with IDs
     - Cost Centers table: 5 rows with CC ID, Terminal ID, Betshop ID - all copyable
   - **Column 2 (narrow, sticky):**
     - Execution Steps timeline: 5 steps with pass/fail/pending icons and connecting line

### Persistence

```typescript
// On mount:
const saved = localStorage.getItem("phase1_report");
if (saved) setReport(JSON.parse(saved));

// On successful import:
localStorage.setItem("phase1_report", JSON.stringify(data));
```

### Dark Mode

```typescript
useEffect(() => {
  document.documentElement.classList.add("dark");
}, []);
```

The app is **always in dark mode**. No toggle.

### Theme Colors (Tailwind v4 CSS variables)

| Token | Light | Dark |
|-------|-------|------|
| `--background` | white | `222 47% 8%` (near-black navy) |
| `--foreground` | `222 47% 11%` | `210 40% 98%` (off-white) |
| `--primary` | `188 86% 53%` | `188 86% 53%` (cyan) |
| `--card` | white | `222 47% 11%` |
| `--border` | `214.3 31.8% 91.4%` | `217 32% 17%` |

---

# 12. RUNNING THE TESTS

## 12.1 Environment Setup

Create `.env` in project root:
```
BO_USERNAME=ifarkasbo
BO_PASSWORD=123123
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require
```

## 12.2 Install Dependencies

```bash
npm install
# or
pnpm install
```

## 12.3 Run Tests

```bash
# Run the full Phase 1 test
npx playwright test tests/phase1-setup/phase1-complete.spec.ts

# Run with UI mode (for debugging)
npx playwright test tests/phase1-setup/phase1-complete.spec.ts --ui

# Run login smoke test only
npx playwright test tests/phase1-setup/login.spec.ts

# Legacy Mocha runner (also works)
npm run test:phase1
```

## 12.4 View Report

After running tests:
```bash
# Start admin panel
pnpm --filter @workspace/admin-panel run dev

# Or locally without Replit workflow:
cd artifacts/admin-panel && pnpm run dev:local
```

Then import `test-results/phase1-report.json` into the web UI.

---

# 13. GITHUB PUSH COMMAND

```bash
git push "https://farkz:${GITHUB_PAT}@github.com/farkz/retailAI.git" test:test
```

Requires `GITHUB_PAT` environment variable.

---

# 14. COMPLETE FILE LIST

## Test Suite Files

| File | Lines | Purpose |
|------|-------|---------|
| `config/env.ts` | ~20 | Environment variables |
| `config/playwright.config.ts` | ~20 | Playwright runner config |
| `helpers/apiClient.ts` | ~400 | API client class |
| `helpers/dbClient.ts` | ~300 | PostgreSQL client |
| `helpers/dataFactory.ts` | ~20 | Name generator + base64 logo |
| `helpers/testContext.ts` | ~30 | Shared test state |
| `fixtures/api.fixture.ts` | ~20 | Playwright fixture |
| `tests/phase1-setup/login.spec.ts` | ~15 | Login smoke test |
| `tests/phase1-setup/phase1-complete.spec.ts` | ~200 | Main orchestration test |
| `scripts/cleanupStaging.ts` | ~140 | CLI cleanup tool |

## Admin Panel Files

| File | Lines | Purpose |
|------|-------|---------|
| `artifacts/admin-panel/src/App.tsx` | ~400 | Main dashboard component |
| `artifacts/admin-panel/src/main.tsx` | ~6 | React root |
| `artifacts/admin-panel/src/index.css` | ~300 | Tailwind v4 theme + utilities |
| `artifacts/admin-panel/src/lib/utils.ts` | ~7 | `cn()` helper |
| `artifacts/admin-panel/src/hooks/use-toast.ts` | ~190 | Toast notification system |
| `artifacts/admin-panel/src/hooks/use-mobile.tsx` | ~20 | Mobile breakpoint hook |
| `artifacts/admin-panel/src/pages/not-found.tsx` | ~22 | 404 page |
| `artifacts/admin-panel/src/components/ui/button.tsx` | ~66 | Button component |
| `artifacts/admin-panel/src/components/ui/card.tsx` | ~80 | Card component |
| `artifacts/admin-panel/src/components/ui/badge.tsx` | ~40 | Badge component |
| `artifacts/admin-panel/src/components/ui/table.tsx` | ~120 | Table component |
| `artifacts/admin-panel/src/components/ui/textarea.tsx` | ~25 | Textarea component |
| `artifacts/admin-panel/src/components/ui/toast.tsx` | ~128 | Toast primitive |
| `artifacts/admin-panel/src/components/ui/toaster.tsx` | ~40 | Toast container |
| `artifacts/admin-panel/src/components/ui/tooltip.tsx` | ~35 | Tooltip component |
| `artifacts/admin-panel/vite.config.ts` | ~20 | Vite config |
| `artifacts/admin-panel/tsconfig.json` | ~25 | TS config (esnext, bundler) |
| `artifacts/admin-panel/package.json` | ~50 | Dependencies |

---

# 15. API ENDPOINT SUMMARY

| Method | Endpoint | Service | Body Fields | Returns |
|--------|----------|---------|-------------|---------|
| POST | `/connect/token` | userapi | `grant_type=password&username&password&client_id&client_type` | `{access_token}` |
| POST | `/api/franchise/createfranchise` | retailapi | `Name, Logo, TenantId` | `{success, id, name}` |
| POST | `/api/offergroup` | race/bingo api | `Name, FranchiseId, TenantId, Type` | `{success, id, name}` |
| POST | `/api/costcenter` | retailapi | `Name, FranchiseId, TenantId, Code` | `{success, id, name}` |
| POST | `/api/costcenter/{id}/offergroups` | retailapi | `OfferGroupIds: string[]` | `{success}` |
| POST | `/api/terminal` | retailapi | `Name, CostCenterId, TenantId, Code, Type` | `{success, id, name}` |
| POST | `/api/betshop` | retailapi | `Name, CostCenterId, TenantId, Code, Type, CashPayoutEnabled` | `{success, id, name}` |
| PUT | `/api/terminal/{id}/cashpayout` | retailapi | `CashPayoutEnabled: true` | `{success}` |

---

# 16. KEY DESIGN DECISIONS

1. **DB SSL Handling:** Staging DB has self-signed cert. `ssl: { rejectUnauthorized: false }` is set unconditionally. The `dbAvailable()` probe with caching prevents repeated SSL error crashes.

2. **Report in afterAll:** The JSON report is written in `test.afterAll()` so partial success is captured even if the test fails at step 3, 4, or 5.

3. **Introspection:** `dbClient` queries `information_schema` to find actual column names (e.g. cash payout column, created timestamp column) instead of hardcoding them. This makes the test resilient to schema drift.

4. **localStorage Persistence:** The admin panel persists the imported report in `localStorage` so it survives page refreshes.

5. **Dark Mode Only:** The admin panel forces dark mode via `document.documentElement.classList.add("dark")` - no toggle, no light mode support.

6. **pnpm Catalog Dependencies Removed:** The admin panel originally used `catalog:` references for shared workspace deps. These were replaced with pinned versions so the app can run standalone without the monorepo catalog.

7. **Vite 6 (not 7):** Downgraded from Vite 7 to Vite 6 for Node 20.10 compatibility. The `import.meta.dirname` API used by Vite 7 requires Node 21+.

8. **Base64 Logo in Data Factory:** The franchise creation requires a logo payload. A large base64-encoded PNG is stored in `dataFactory.ts` to avoid file system dependencies.

---

*End of specification*
