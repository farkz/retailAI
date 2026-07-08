# RetailAI Phase 2 - Terminal Virtual Race Payin
## Complete Technical Specification

---

# 1. PROJECT OVERVIEW

Phase 2 extends the franchise infrastructure created in Phase 1 by executing an end-to-end **terminal-based virtual race betting flow**. For each terminal created in Phase 1, the test:

1. **Authenticates as the terminal** (adds login PIN, performs terminal login)
2. **Funds the terminal wallet** (cash deposit + optional credit ticket conversion)
3. **Places a virtual race bet** (fetches available races, picks random runners, executes payin)
4. **Verifies the ticket** (queries ticket overview to confirm creation)

## 1.1 Architecture

| Part | Technology | Purpose |
|------|-----------|---------|
| **Test Suite** | Playwright Test + TypeScript | Reuses Phase 1 infrastructure; executes full betting flow per terminal |
| **Data Source** | Phase 1 Report (`phase1-report.json`) | Imports terminal IDs, franchise ID, offer group IDs from Phase 1 |

## 1.2 API Base URLs (Phase 2 adds one)

All URLs point to the same staging environment as Phase 1.

| Env Var | Default | Service | Used In |
|---------|---------|---------|---------|
| `BASE_URL` | `https://retailapi.stage-xtreme.com` | Main retail API | Terminal auth, deposits, credit tickets |
| `USER_API_URL` | `https://userapi.stage-xtreme.com` | User/Auth API | (Phase 1 login) |
| `VIRTUAL_RACE_API_URL` | `https://virtualraceintegrationapi.stage-xtreme.com` | Virtual Race Integration | OfferGroup/GetAll, Ticket/Payin, Ticket/GetTicketsOverview |
| `VIRTUAL_BINGO_API_URL` | `https://virtualbingointegrationapi.stage-xtreme.com` | Virtual Bingo Integration | (Phase 1 only) |
| `VIRTUAL_RACE_DATA_PROVIDER_URL` | `https://virtualracedataproviderapi-volcano.stage-xtreme.com` | Virtual Race Data Provider | FetchConfigurationAuthorized |

> **Note:** `VIRTUAL_RACE_DATA_PROVIDER_URL` is a **new** base URL needed for Phase 2. It is a separate microservice from the integration API.

## 1.3 Database (additional schemas)

In addition to the `retail` schema used in Phase 1, Phase 2 queries:

| Schema | Table | Purpose |
|--------|-------|---------|
| `configuration` | `configuration_group` | Resolves terminal configuration group (currency settings) |
| `virtualrace` | `offer_group` | Verifies active offer group for the franchise |
| `virtualrace` | `round` | Fetches next unprocessed round + pick details for betting |

The same `dbClient` from Phase 1 connects via `pg` Pool with `ssl: { rejectUnauthorized: false }`.

## 1.4 Report Output

Phase 2 writes `test-results/phase2-report.json` containing:
- `runAt` timestamp
- `franchiseId` (from Phase 1)
- Per-terminal results array: terminal ID, login status, deposit amounts, credit ticket ID, offer group used, round ID, bet picks, payin ticket ID, verification status
- Step statuses for the overall flow

---

# 2. DIRECTORY STRUCTURE (Phase 2 additions)

```
retailAI/
  helpers/
    apiClient.ts           # Extended: terminal auth, deposit, credit ticket, race payin methods
    dbClient.ts            # Extended: virtualrace round/offer_group queries
    dataFactory.ts         # Extended: fingerprint generator, UUIDv7 generator, random bet picker
    testContext.ts         # Extended: Phase 2 data (terminalTokens, ticketIds, etc.)
    racePayinHelper.ts     # NEW: orchestrates the full per-terminal flow
  tests/
    phase2-race-payin/
      phase2-complete.spec.ts   # NEW: main orchestration test
  test-results/
    phase1-report.json     # Input: imported at start of Phase 2
    phase2-report.json     # Output: written in afterAll
```

---

# 3. ENVIRONMENT CONFIGURATION

## 3.1 config/env.ts additions

```typescript
export const config = {
  // ... existing Phase 1 config ...

  // NEW for Phase 2
  virtualRaceDataProviderUrl:
    process.env.VIRTUAL_RACE_DATA_PROVIDER_URL ||
    'https://virtualracedataproviderapi-volcano.stage-xtreme.com',

  terminal: {
    depositAmount1: 100,    // First deposit (before credit ticket)
    depositAmount2: 1000,   // Second deposit (before race payin)
    currency: 'EUR',        // Currency for all transactions
  },
};
```

## 3.2 New Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VIRTUAL_RACE_DATA_PROVIDER_URL` | No | Virtual Race Data Provider API base URL |
| `SKIP_CREDIT_TICKET` | No | Set to `1` or `true` to skip the credit ticket flow (credit ticket steps are currently disabled in the SOAP flow) |
| `SKIP_PHASE2_CLEANUP` | No | Set to `1` or `true` to skip DB cleanup of race tickets after test |

---

# 4. SHARED STATE: testContext.ts additions

```typescript
export interface TestData {
  // ... existing Phase 1 fields ...

  // Phase 2 fields
  terminalTokens?: Record<string, { token: string; fingerprint: string }>;
  terminalBalances?: Record<string, number>;
  creditTicketIds?: Record<string, string>;
  racePayinTickets?: Array<{
    terminalId: string;
    offerGroupId: string;
    roundId: string;
    ticketId: string;
    amount: number;
    picks: Array<{ price: number; betType: string; betContent: string; roundId: string; roundNumber: number }>;
  }>;
}
```

---

# 5. DATA FACTORY additions

## 5.1 generateFingerprint()

Generates a 33-character alphanumeric string used as the terminal fingerprint.

```typescript
export const generateFingerprint = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 33; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};
```

## 5.2 generateUUIDv7()

Generates a UUIDv7 (time-ordered UUID) used for action IDs in the race payin.

Uses the same algorithm as Phase 1's `generateUUIDv7()` in `apiClient.ts`:

```typescript
const generateUUIDv7 = (): string => {
  const timestamp = BigInt(Date.now());
  const mostSigBits = ((timestamp << 16n) & 0xFFFFFFFFFFFF0000n) | (0x7n << 12n);
  const leastSigBits = (BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)) *
    BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER))) & 0xFFFFFFFFFFFF0FFFn;
  const toHex = (n: bigint, digits: number) => n.toString(16).padStart(digits, '0');
  const hi = toHex(mostSigBits, 16);
  const lo = toHex(leastSigBits, 16);
  return `${hi.slice(0, 8)}-${hi.slice(8, 12)}-${hi.slice(12, 16)}-${lo.slice(0, 4)}-${lo.slice(4, 16)}`;
};
```

## 5.3 formatDateTime()

Formats current UTC time as ISO 8601 for API payloads:

```typescript
export const formatDateTime = (): string => {
  const now = new Date();
  return now.toISOString();  // e.g. "2026-05-27T10:30:45.123Z"
};
```

---

# 6. API CLIENT EXTENSIONS: helpers/apiClient.ts

Phase 2 adds the following methods to the existing `ApiClient` class. All methods use the same `expectStatus` / `expectOkJson` helpers added in the Phase 1 refactor.

## 6.1 Terminal Authentication

### addTerminalLoginPin(terminalId: string)

**Endpoint:** `POST ${BASE_URL}/api/public/Terminal/AddTerminalLoginPin`  
**Auth:** `Authorization: Bearer <BO_ADMIN_TOKEN>` (backoffice token)  
**Expected Status:** 200 or 201

**Request body:**
```json
{
  "terminalId": "<terminal-id-from-phase1>",
  "clientType": "Terminal"
}
```

**Response shape:**
```json
{
  "loginPin": "1234",
  "...": "..."
}
```

**Behavior:**
- Posts terminal ID with backoffice auth
- Extracts `loginPin` from response
- Returns the PIN string

---

### terminalLogin(terminalId: string, fingerprint: string, loginPin: string)

**Endpoint:** `POST ${BASE_URL}/api/public/Terminal/LogIn`  
**Auth:** `Authorization: Bearer <BO_ADMIN_TOKEN>` (backoffice token)  
**Expected Status:** 200

**Request body:**
```json
{
  "fingerprint": "<33-char-alphanumeric>",
  "clientType": "Terminal",
  "loginPin": "<pin-from-addTerminalLoginPin>"
}
```

**Response shape:**
```json
{
  "token": "<JWT_TOKEN>",
  "...": "..."
}
```

**Behavior:**
- Authenticates the terminal using fingerprint + PIN
- Extracts `token` from response
- Returns terminal token string (used as `Bearer <token>` in subsequent calls)

---

## 6.2 Terminal Funding

### deposit(terminalToken: string, fingerprint: string, amount: number, idempotentKey: string)

**Endpoint:** `POST ${BASE_URL}/api/public/Transaction/Deposit`  
**Auth:** `Authorization: Bearer <TERMINAL_TOKEN>`, `Fingerprint: <fingerprint>`  
**Expected Status:** 200

**Request body:**
```json
{
  "amount": 100,
  "moneyType": "Bill",
  "currency3LetterId": "EUR",
  "idempotentKey": "<uuid>",
  "clientDateTimeCreatedUtc": "<iso-datetime>",
  "clientType": "TerminalConsumer"
}
```

**Behavior:**
- Deposits cash into the terminal wallet
- Uses terminal token (not backoffice token)
- Amount is typically `100` (first deposit) or `1000` (second deposit)

---

### getTerminalState(terminalToken: string, fingerprint: string)

**Endpoint:** `POST ${BASE_URL}/api/public/Terminal/GetState`  
**Auth:** `Authorization: Bearer <TERMINAL_TOKEN>`, `Fingerprint: <fingerprint>`  
**Expected Status:** 200

**Request body:** empty

**Response shape:**
```json
{
  "balance": {
    "accounts": [
      {
        "creditType": "VirtualMoney",
        "spendableAmount": 100.00
      }
    ]
  }
}
```

**Behavior:**
- Returns terminal state including balance
- Extracts `spendableAmount` from the account with `creditType === "VirtualMoney"`

---

### createCreditTicketReservation(terminalToken, fingerprint, amount, idempotentKey, currency, datetime)

**Endpoint:** `POST ${BASE_URL}/api/public/CreditTicket/CreateReservation`  
**Auth:** Terminal token + fingerprint  
**Expected Status:** 200 or 201

**Request body:**
```json
{
  "idempotentKey": "<uuid>",
  "amount": 50.00,
  "currency3LetterId": "EUR",
  "clientDateTimeCreatedUtc": "<iso-datetime>"
}
```

**Behavior:**
- Creates a credit ticket reservation for the specified amount
- Returns reservation ID (used in confirmation)

---

### createCreditTicketConfirmation(terminalToken, fingerprint, idempotentKey)

**Endpoint:** `POST ${BASE_URL}/api/public/CreditTicket/CreateConfirmation`  
**Auth:** Terminal token + fingerprint  
**Expected Status:** 200

**Request body:**
```json
{
  "idempotentKey": "<uuid>"
}
```

**Behavior:**
- Confirms the credit ticket reservation
- Finalizes conversion of wallet balance to credit ticket

> **Note:** Credit ticket steps are currently disabled in the original SOAP flow. They can be enabled by setting `SKIP_CREDIT_TICKET=false`.

---

## 6.3 Race Ticket Flow

### getOfferGroups(franchiseId: string, boToken: string)

**Endpoint:** `POST ${VIRTUAL_RACE_API_URL}/api/public/OfferGroup/GetAll`  
**Auth:** `Authorization: Bearer <BO_ADMIN_TOKEN>`  
**Expected Status:** 200

**Request body:**
```json
{
  "Skip": 0,
  "Take": 100,
  "FranchiseId": "<franchise-id>",
  "TenantId": null
}
```

**Response shape:**
```json
[
  {
    "Id": "<guid>",
    "Active": true,
    "Name": "..."
  }
]
```

**Behavior:**
- Returns all offer groups for the franchise
- Filters for the first `Active === true` entry
- Returns the active offer group ID

---

### fetchConfigurationAuthorized(terminalToken: string)

**Endpoint:** `POST ${VIRTUAL_RACE_DATA_PROVIDER_URL}/api/public/Ticket/FetchConfigurationAuthorized`  
**Auth:** `Authorization: Bearer <TERMINAL_TOKEN>`  
**Expected Status:** 200

**Request body:** empty

**Response shape:**
```json
{
  "currency": "EUR",
  "...": "..."
}
```

**Behavior:**
- Fetches race configuration authorized for the terminal
- Extracts currency settings

---

### payin(terminalToken, fingerprint, payload)

**Endpoint:** `POST ${VIRTUAL_RACE_API_URL}/api/public/Ticket/Payin`  
**Auth:** Terminal token + fingerprint  
**Expected Status:** 200

**Request body:**
```json
{
  "OfferGroupId": "<offer-group-id>",
  "Amount": 12.50,
  "CurrencyId": "EUR",
  "ActionIds": ["<uuidv7>", "<uuidv7>"],
  "ActionCreatedDatetime": "<iso-datetime>",
  "TicketBets": [
    {
      "Price": 2.50,
      "BetType": "Winner",
      "BetContent": "1",
      "RoundId": "<round-id>",
      "RoundNumber": 42
    }
  ],
  "PayinType": "None",
  "PayinMode": "Standard"
}
```

**Behavior:**
- Places the actual race bet
- `PayinMode` is either `"Standard"` (1 bet) or `"PerBet"` (multiple bets, each with its own action ID)
- `TicketBets` array contains one entry per bet (1-10 bets depending on random selection)
- Returns ticket/payin response

---

### getTicketsOverview(boToken, costCenterId, userId, fromDate, toDate)

**Endpoint:** `POST ${VIRTUAL_RACE_API_URL}/api/public/Ticket/GetTicketsOverview`  
**Auth:** `Authorization: Bearer <BO_ADMIN_TOKEN>`  
**Expected Status:** 200

**Request body:**
```json
{
  "queryType": "CostCenter",
  "costCenterId": "<cc-id>",
  "userId": "<terminal-id>",
  "fromDate": "2026-05-10T18:35:00.000Z",
  "toDate": "2026-05-11T18:35:38.000Z",
  "roundNumber": null,
  "clientType": null,
  "ticketType": null,
  "ticketStatuses": ["Won"],
  "jackpot": null,
  "skip": 0,
  "take": 200,
  "totalCount": 200
}
```

**Behavior:**
- Queries ticket overview to verify the ticket was created
- Returns list of ticket IDs

---

# 7. DATABASE CLIENT EXTENSIONS

## 7.1 New Queries

### resolveCurrencyFromConfigurationGroup(terminalId: string)

```sql
SELECT * FROM configuration.configuration_group
WHERE name = 'Terminal'
  AND tenant_id = '<tenant-id>'
  AND franchise_id = '<franchise-id>'
  AND context = 'Sport'
LIMIT 10
```

**Purpose:** Resolves the terminal's sport configuration group to extract currency settings.

---

### getVirtualRaceOfferGroup(offerGroupId: string)

```sql
SELECT * FROM virtualrace.offer_group
WHERE id = '<offer-group-id>'
ORDER BY created_datetime DESC
```

**Purpose:** Verifies the offer group exists and is active in the virtual race schema.

---

### getNextUnprocessedRound(offerGroupId: string, tenantId: string)

```sql
SELECT * FROM virtualrace.round
WHERE offer_group_id = '<offer-group-id>'
  AND tenant_id = '<tenant-id>'
  AND result_processed_datetime IS NULL
ORDER BY start_datetime ASC
LIMIT 1
```

**Purpose:** Fetches the next available race round that hasn't been processed yet.  
**Critical columns:** `id`, `number`, `details` (JSON containing `Picks` array)

---

### getTerminalCostCenterId(terminalId: string)

```sql
SELECT cost_center_id FROM retail.terminal
WHERE id = '<terminal-id>'
```

**Purpose:** Resolves which cost center a terminal belongs to (needed for ticket overview query).

---

## 7.2 Round Details JSON Structure

The `details` column in `virtualrace.round` is a JSON object containing:

```json
{
  "Picks": [
    {
      "Price": 2.50,
      "PickType": "Winner",
      "Result": "1"
    },
    {
      "Price": 3.20,
      "PickType": "Place",
      "Result": "2"
    }
  ]
}
```

**Pick fields:**
| Field | Type | Description |
|-------|------|-------------|
| `Price` | number | Odds multiplier |
| `PickType` | string | Bet type (Winner, Place, etc.) |
| `Result` | string | Runner number/content |

---

# 8. RACE PAYIN HELPER: helpers/racePayinHelper.ts

Orchestrates the full per-terminal flow. **Optimized for load testing** by pre-fetching shared data (offer group + round details) **once** at the start, then reusing cached values for every terminal.

## 8.0 Race Cache Manager (helpers/raceCache.ts)

**Problem:** Rounds rotate every `WaitForNewRoundDuration` seconds. Caching a round once at test-start would cause stale-round payin failures for later terminals.

**Solution:** Cache the **offer group** permanently (it never changes for a franchise), but keep the **round** in a live cache with a background refresh timer based on `WaitForNewRoundDuration` from the offer group.

```typescript
class RaceCache {
  private offerGroupId: string | null = null;
  private roundId: string | null = null;
  private roundNumber: number = 0;
  private picks: Array<{ Price: number; PickType: string; Result: string }> = [];
  private refreshTimer: NodeJS.Timeout | null = null;
  private waitForNewRoundDurationMs: number = 60000; // default 60s

  constructor(
    private apiClient: ApiClient,
    private dbClient: typeof dbClient,
    private franchiseId: string,
    private tenantId: string,
    private boToken: string
  ) {}

  async init(): Promise<void> {
    // 1. Fetch offer group once (never changes)
    this.offerGroupId = await this.apiClient.getOfferGroups(this.franchiseId, this.boToken);

    // 2. Resolve WaitForNewRoundDuration from offer group config
    const og = await this.dbClient.getVirtualRaceOfferGroup(this.offerGroupId);
    this.waitForNewRoundDurationMs = (og?.waitForNewRoundDuration ?? 60) * 1000;

    // 3. Fetch first round immediately
    await this.refreshRound();

    // 4. Start background refresh (refresh 5s before expiry, min 10s interval)
    const intervalMs = Math.max(this.waitForNewRoundDurationMs - 5000, 10000);
    this.refreshTimer = setInterval(() => this.refreshRound(), intervalMs);
  }

  private async refreshRound(): Promise<void> {
    try {
      const round = await this.dbClient.getNextUnprocessedRound(
        this.offerGroupId!,
        this.tenantId
      );
      if (round && round.id !== this.roundId) {
        this.roundId = round.id;
        this.roundNumber = round.number;
        this.picks = JSON.parse(round.details).Picks;
        console.log(`[RaceCache] New round: ${this.roundId} (#${this.roundNumber})`);
      }
    } catch (e) {
      console.warn('[RaceCache] Round refresh failed:', e);
    }
  }

  getCurrentRound(): {
    offerGroupId: string;
    roundId: string;
    roundNumber: number;
    picks: Array<{ Price: number; PickType: string; Result: string }>;
  } {
    if (!this.offerGroupId || !this.roundId) {
      throw new Error('RaceCache not initialized - call init() first');
    }
    return {
      offerGroupId: this.offerGroupId,
      roundId: this.roundId,
      roundNumber: this.roundNumber,
      picks: this.picks,
    };
  }

  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}
```

**Load-testing impact:**
- Original SOAP flow: N terminals * (2 DB queries + 1 API call) = heavy DB load
- Optimized flow: 1 DB query at init + 1 lightweight round refresh every ~55s = negligible load
- Terminals read from in-memory cache, zero DB hits per payin

---

## 8.1 perTerminalFlow(terminalId, franchiseId, raceCache)

```typescript
async function perTerminalFlow(
  apiClient: ApiClient,
  terminalId: string,
  franchiseId: string,
  raceCache: RaceCache,
  currency: string
): Promise<{
  terminalId: string;
  loginSuccess: boolean;
  fingerprint: string;
  deposit1Amount: number;
  deposit2Amount: number;
  balanceAfterDeposit: number;
  creditTicketId?: string;
  roundId: string;
  payinMode: 'Standard' | 'PerBet';
  betCount: number;
  picks: Array<{ price: number; betType: string; betContent: string }>;
  payinAmount: number;
  actionIds: string[];
  linkedId: string | null;
  ticketId: string;
  verified: boolean;
}>
```

### Per-Terminal Flow (13 steps, zero DB queries)

```
1. ADD LOGIN PIN
   apiClient.addTerminalLoginPin(terminalId)
   -> returns loginPin

2. TERMINAL LOGIN
   fingerprint = generateFingerprint()
   apiClient.terminalLogin(terminalId, fingerprint, loginPin)
   -> returns terminalToken

3. [FIRST TERMINAL ONLY] FETCH CONFIGURATION
   // Cache currency from first terminal's config
   config = apiClient.fetchConfigurationAuthorized(terminalToken)
   currency = config.currency  // e.g. "EUR"

4. FIRST DEPOSIT (100)
   idempotentKey1 = crypto.randomUUID()
   datetime1 = formatDateTime()
   apiClient.deposit(terminalToken, fingerprint, 100, idempotentKey1, datetime1)

5. GET STATE / CHECK BALANCE
   state = apiClient.getTerminalState(terminalToken, fingerprint)
   balance = state.balance.accounts.find(a => a.creditType === "VirtualMoney").spendableAmount

6. [OPTIONAL] CREDIT TICKET
   if (!SKIP_CREDIT_TICKET):
     idempotentKeyCT = crypto.randomUUID()
     datetimeCT = formatDateTime()
     apiClient.createCreditTicketReservation(terminalToken, fingerprint, balance, idempotentKeyCT, currency, datetimeCT)
     apiClient.createCreditTicketConfirmation(terminalToken, fingerprint, idempotentKeyCT)

7. SECOND DEPOSIT (1000)
   idempotentKey2 = crypto.randomUUID()
   datetime2 = formatDateTime()
   apiClient.deposit(terminalToken, fingerprint, 1000, idempotentKey2, datetime2)

8. GET CURRENT ROUND FROM CACHE (no DB hit)
   raceData = raceCache.getCurrentRound()
   // Contains live roundId, roundNumber, picks

9. BUILD RANDOM PICKS (from raceData.picks)
   payinMode = random(['Standard', 'PerBet'])
   betCount = random(1-10)
   if (payinMode === 'PerBet' && betCount < 2) betCount = 2
   if (payinMode === 'Standard' && betCount > 1) betCount = 1

   selectedPicks = []
   for (i = 0; i < betCount; i++):
     randomIndex = random(0, raceData.picks.length - 1)
     pick = raceData.picks[randomIndex]
     selectedPicks.push({
       Price: pick.Price,
       BetType: pick.PickType,
       BetContent: pick.Result,
       RoundId: raceData.roundId,
       RoundNumber: raceData.roundNumber
     })

10. CALCULATE PAYIN AMOUNT
    minAmount = selectedPicks.length
    randomAmount = (Math.random() * 9) + 1  // 1.0 - 10.0
    if (minAmount > randomAmount) randomAmount = minAmount * randomAmount
    randomAmount = Math.round(randomAmount * 100) / 100  // 2 decimal places

11. GENERATE ACTION IDs
    actionIds = []
    for (i = 0; i < selectedPicks.length; i++):
      actionIds.push(generateUUIDv7())

12. GENERATE LINKED ID (for PerBet mode)
    linkedId = (payinMode === 'PerBet') ? crypto.randomUUID() : null

13. EXECUTE PAYIN
    datetimePayin = formatDateTime()
    apiClient.payin(terminalToken, fingerprint, {
      OfferGroupId: raceData.offerGroupId,
      Amount: randomAmount,
      CurrencyId: currency,
      ActionIds: actionIds,
      ActionCreatedDatetime: datetimePayin,
      TicketBets: selectedPicks,
      PayinType: 'None',
      PayinMode: payinMode
    })

14. VERIFY TICKET
    costCenterId = dbClient.getTerminalCostCenterId(terminalId)
    tickets = apiClient.getTicketsOverview(boToken, costCenterId, terminalId, fromDate, toDate)
    ticketIds = tickets.Tickets.map(t => t.Id)
```

**Key points:**
- Step 8 reads from `RaceCache` — no DB query, always returns the **current** round
- `RaceCache.refreshRound()` runs in the background, polling the DB every `WaitForNewRoundDuration - 5s`
- If a round expires mid-test, the next terminal automatically gets the new round from cache
- Offer group is fetched once and never changes

---

## 8.2 Load-Testing Execution Patterns

Two patterns for creating tickets across terminals. The `RaceCache` supports both since it always returns the **current** round on demand.

### Pattern A: Terminal-First (default)

Complete one terminal fully, then move to the next. Best for per-terminal stress testing.

```
FOR each terminal in phase1.terminals:
  1. login + deposit (setup)
  2. FOR i = 1 to TICKETS_PER_TERMINAL (default 1000):
       a. get current round from RaceCache
       b. build random picks
       c. execute payin
       d. store result
  3. logout / end terminal session
  4. move to next terminal
```

**Pros:**
- Authenticates each terminal once (reuses token for all 1000 payins)
- Simulates a single player placing many consecutive bets
- Simpler to debug (all tickets for one terminal together)

**Cons:**
- Round may change mid-terminal (tickets 1-500 on round X, 501-1000 on round Y)
- Later terminals start later, may hit different rounds entirely

**Config:** `TICKETS_PER_TERMINAL=1000` (env var)

---

### Pattern B: Round-Robin (interleaved)

Create one ticket per terminal, then loop back to terminal 1. Best for simulating simultaneous multi-terminal betting.

```
FOR i = 1 to TOTAL_TICKETS:
  terminal = phase1.terminals[i % terminalCount]
  
  // Each ticket gets fresh round from RaceCache
  1. get current round from RaceCache
  2. build random picks
  3. execute payin
  4. store result
```

**Pros:**
- All terminals bet on the same round (if loop is fast enough)
- Simulates real concurrent betting from multiple terminals
- Better load distribution across the system

**Cons:**
- Requires terminal tokens to stay alive across the full test (or re-auth per loop)
- More complex to track per-terminal results

**Config:** `TOTAL_TICKETS=500` (env var, e.g. 5 terminals × 100 tickets)

---

### Token Lifecycle Consideration

Both patterns assume terminal tokens do not expire during the test. If tokens expire:

- **Pattern A:** Re-authenticate at the start of each terminal block (already built into `perTerminalFlow`)
- **Pattern B:** Either keep tokens warm with periodic `GetState` calls, or re-authenticate when `401` is received

The implementation should support an optional `tokenRefresh` callback in `RaceCache` for Pattern B.

---

## 8.3 Multi-Ticket perTerminalFlow variant

When `Pattern A` is selected, the helper creates multiple tickets per terminal:

```typescript
async function perTerminalMultiTicketFlow(
  apiClient: ApiClient,
  terminalId: string,
  raceCache: RaceCache,
  currency: string,
  ticketCount: number = 1000
): Promise<TerminalPayinResult[]> {
  // 1. Login once
  const loginPin = await apiClient.addTerminalLoginPin(terminalId);
  const fingerprint = generateFingerprint();
  const terminalToken = await apiClient.terminalLogin(terminalId, fingerprint, loginPin);

  // 2. First deposit
  const idempotentKey1 = crypto.randomUUID();
  const datetime1 = formatDateTime();
  await apiClient.deposit(terminalToken, fingerprint, 100, idempotentKey1, datetime1);

  // 3. Get balance
  const state = await apiClient.getTerminalState(terminalToken, fingerprint);
  const balance = state.balance.accounts.find(a => a.creditType === "VirtualMoney")!.spendableAmount;

  // 4. Optional credit ticket
  if (!SKIP_CREDIT_TICKET) {
    const idempotentKeyCT = crypto.randomUUID();
    const datetimeCT = formatDateTime();
    await apiClient.createCreditTicketReservation(terminalToken, fingerprint, balance, idempotentKeyCT, currency, datetimeCT);
    await apiClient.createCreditTicketConfirmation(terminalToken, fingerprint, idempotentKeyCT);
  }

  // 5. Second deposit (funds all tickets)
  const idempotentKey2 = crypto.randomUUID();
  const datetime2 = formatDateTime();
  await apiClient.deposit(terminalToken, fingerprint, 1000, idempotentKey2, datetime2);

  // 6. Create N tickets
  const results: TerminalPayinResult[] = [];
  for (let i = 0; i < ticketCount; i++) {
    const raceData = raceCache.getCurrentRound(); // may return new round each call
    
    // Build picks, payin, etc. (same as single-ticket flow)
    const result = await createSingleTicket(
      apiClient, terminalToken, fingerprint, raceData, currency
    );
    results.push(result);
  }

  return results;
}
```

---

# 9. TEST SPECIFICATION

## 9.1 tests/phase2-race-payin/phase2-complete.spec.ts

### Data Structures

```typescript
interface TerminalPayinResult {
  terminalId: string;
  loginSuccess: boolean;
  fingerprint: string;
  deposit1Amount: number;
  deposit2Amount: number;
  balanceAfterDeposit: number;
  creditTicketId?: string;
  offerGroupId: string;
  roundId: string;
  roundNumber: number;
  payinMode: 'Standard' | 'PerBet';
  betCount: number;
  picks: Array<{
    price: number;
    betType: string;
    betContent: string;
    roundId: string;
    roundNumber: number;
  }>;
  payinAmount: number;
  actionIds: string[];
  linkedId: string | null;
  ticketId: string;
  verified: boolean;
}

interface Phase2Report {
  runAt: string;
  franchiseId: string;
  offerGroupId: string;
  results: TerminalPayinResult[];
  steps: Array<{
    step: number;
    label: string;
    status: 'pending' | 'pass' | 'fail';
  }>;
}
```

### Test Flow

```typescript
test.describe('Phase 2 - Terminal Virtual Race Payin', () => {
  const run: Phase2Report = {
    runAt: new Date().toISOString(),
    franchiseId: '',
    offerGroupId: '',
    results: [],
    steps: [
      { step: 1, label: 'Load Phase 1 report', status: 'pending' },
      { step: 2, label: 'Get active offer group', status: 'pending' },
      { step: 3, label: 'Process all terminals', status: 'pending' },
      { step: 4, label: 'Verify all tickets', status: 'pending' },
    ],
  };

  test('should execute full Phase 2 flow for all terminals', async ({ apiClient }) => {
    // 1. LOAD PHASE 1 REPORT
    const phase1 = loadPhase1Report();
    run.franchiseId = phase1.franchise.id;
    expect(phase1.terminals.length).toBeGreaterThan(0);
    run.steps[0].status = 'pass';

    // 2. GET ACTIVE OFFER GROUP
    const offerGroupId = await apiClient.getOfferGroups(run.franchiseId);
    expect(offerGroupId).toBeTruthy();
    run.offerGroupId = offerGroupId;
    run.steps[1].status = 'pass';

    // 3. PROCESS EACH TERMINAL
    for (const terminal of phase1.terminals) {
      const result = await perTerminalFlow(apiClient, terminal.id, run.franchiseId, offerGroupId);
      run.results.push(result);
    }
    run.steps[2].status = 'pass';

    // 4. VERIFY TICKETS
    for (const result of run.results) {
      const tickets = await apiClient.getTicketsOverview(
        apiClient.getToken()!,
        result.costCenterId,
        result.terminalId,
        fromDate,
        toDate
      );
      expect(tickets.Tickets.length).toBeGreaterThan(0);
      result.verified = true;
    }
    run.steps[3].status = 'pass';
  });

  test.afterAll(async () => {
    writeReport(run);
    // Optional: cleanup race tickets
  });
});
```

---

# 10. API ENDPOINT SUMMARY (Phase 2)

| Method | Endpoint | Base URL | Auth | Body Fields | Returns |
|--------|----------|----------|------|-------------|---------|
| POST | `/api/public/Terminal/AddTerminalLoginPin` | `BASE_URL` | BO Token | `terminalId`, `clientType` | `{ loginPin }` |
| POST | `/api/public/Terminal/LogIn` | `BASE_URL` | BO Token | `fingerprint`, `clientType`, `loginPin` | `{ token }` |
| POST | `/api/public/Transaction/Deposit` | `BASE_URL` | Terminal Token + Fingerprint header | `amount`, `moneyType`, `currency3LetterId`, `idempotentKey`, `clientDateTimeCreatedUtc`, `clientType` | `{ ... }` |
| POST | `/api/public/Terminal/GetState` | `BASE_URL` | Terminal Token + Fingerprint header | empty | `{ balance: { accounts: [{ creditType, spendableAmount }] } }` |
| POST | `/api/public/CreditTicket/CreateReservation` | `BASE_URL` | Terminal Token + Fingerprint header | `idempotentKey`, `amount`, `currency3LetterId`, `clientDateTimeCreatedUtc` | `{ ... }` |
| POST | `/api/public/CreditTicket/CreateConfirmation` | `BASE_URL` | Terminal Token + Fingerprint header | `idempotentKey` | `{ ... }` |
| POST | `/api/public/OfferGroup/GetAll` | `VIRTUAL_RACE_API_URL` | BO Token | `Skip`, `Take`, `FranchiseId`, `TenantId` | Array of offer groups |
| POST | `/api/public/Ticket/FetchConfigurationAuthorized` | `VIRTUAL_RACE_DATA_PROVIDER_URL` | Terminal Token | empty | `{ currency, ... }` |
| POST | `/api/public/Ticket/Payin` | `VIRTUAL_RACE_API_URL` | Terminal Token + Fingerprint header | `OfferGroupId`, `Amount`, `CurrencyId`, `ActionIds`, `ActionCreatedDatetime`, `TicketBets`, `PayinType`, `PayinMode` | Payin result |
| POST | `/api/public/Ticket/GetTicketsOverview` | `VIRTUAL_RACE_API_URL` | BO Token | `queryType`, `costCenterId`, `userId`, `fromDate`, `toDate`, `ticketStatuses`, `skip`, `take` | `{ Tickets: [{ Id }] }` |

---

# 11. KEY DESIGN DECISIONS

1. **Fingerprint Header:** All terminal-authenticated calls (deposit, getState, payin) require both `Authorization: Bearer <terminalToken>` AND `Fingerprint: <33-char-string>` headers. The fingerprint is generated once per terminal and reused throughout the flow.

2. **Two Deposits:** The flow deposits `100` first (to check basic deposit works), optionally converts to credit ticket, then deposits `1000` (to ensure sufficient balance for race payin). The amounts are configurable via env vars.

3. **PayinMode Logic:**
   - `"Standard"` mode = exactly 1 bet per payin
   - `"PerBet"` mode = 2-10 bets per payin (each bet gets its own `ActionId`)
   - The mode is randomly selected per terminal to exercise both code paths

4. **Round Picking from DB:** Rather than calling an API to get available races, the test queries `virtualrace.round` directly for the next unprocessed round (`result_processed_datetime IS NULL`). This is more reliable than API race listings which may be empty or cached.

5. **Random Bet Selection:** From the round's `details.Picks` array, the test randomly selects 1-10 distinct picks (no duplicates within a single payin).

6. **Amount Calculation:** The payin amount is random (1.0-10.0) but must be >= the number of picks. If `betCount > randomAmount`, the amount is scaled: `amount = betCount * randomAmount`.

7. **UUIDv7 for ActionIds:** Action IDs use UUIDv7 (time-ordered) for better database indexing, matching the Phase 1 pattern.

8. **Terminal Loop:** The test iterates over ALL terminals from Phase 1 (typically 5). Each terminal gets its own independent fingerprint, token, and betting flow.

9. **Idempotent Keys:** Every deposit and credit ticket operation uses a unique `idempotentKey` (standard UUID). This prevents double-charging if a request is retried.

10. **Credit Ticket Optional:** The credit ticket flow (reservation + confirmation) is currently disabled in the SOAP source. It can be re-enabled by unsetting `SKIP_CREDIT_TICKET`. When enabled, it converts the terminal's virtual money balance into a credit ticket before the second deposit.

---

*End of Phase 2 specification*
