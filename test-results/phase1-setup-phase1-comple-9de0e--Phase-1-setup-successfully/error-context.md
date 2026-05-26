# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: phase1-setup/phase1-complete.spec.ts >> Phase 1 - Complete Setup >> should execute full Phase 1 setup successfully
- Location: tests/phase1-setup/phase1-complete.spec.ts:14:7

# Error details

```
SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON
```

# Test source

```ts
  1   | import { APIRequestContext } from '@playwright/test';
  2   | import { config } from '../config/env';
  3   | import { testData, saveTestData } from './testContext';
  4   | import { generateFranchiseName, getBase64Logo } from './dataFactory';
  5   | 
  6   | export class ApiClient {
  7   |   private token: string | null = null;
  8   |   private boUserId: string | null = null;
  9   | 
  10  |   constructor(private request: APIRequestContext) {}
  11  | 
  12  |   async login(): Promise<void> {
  13  |     const response = await this.request.post('/api/public/Users/Login', {
  14  |       data: {
  15  |         clientType: config.boAdmin.clientType,
  16  |         clientId: config.boAdmin.clientId,
  17  |         username: config.boAdmin.username,
  18  |         tenantId: config.tenantId,
  19  |         password: config.boAdmin.password,
  20  |       },
  21  |       headers: { 'Content-Type': 'application/json' },
  22  |     });
  23  | 
> 24  |     const body = await response.json();
      |                  ^ SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON
  25  | 
  26  |     if (!response.ok()) {
  27  |       throw new Error(`Login failed: ${response.status()} ${JSON.stringify(body)}`);
  28  |     }
  29  | 
  30  |     this.token = body.token;
  31  |     this.boUserId = body.id;
  32  |     console.log('BO Admin Login Successful');
  33  |   }
  34  | 
  35  |   getToken(): string | null {
  36  |     return this.token;
  37  |   }
  38  | 
  39  |   getBoUserId(): string | null {
  40  |     return this.boUserId;
  41  |   }
  42  | 
  43  |   getAuthHeaders() {
  44  |     if (!this.token) throw new Error('No authentication token available. Call login() first.');
  45  |     return {
  46  |       Authorization: `Bearer ${this.token}`,
  47  |       'Content-Type': 'application/json',
  48  |     };
  49  |   }
  50  | 
  51  |   // ==================== FRANCHISE ====================
  52  |   async createFranchise(customName?: string) {
  53  |     const name = customName || generateFranchiseName();
  54  | 
  55  |     const payload = {
  56  |       name,
  57  |       companyName: name,
  58  |       city: name,
  59  |       address: name,
  60  |       isTest: true,
  61  |       logo: getBase64Logo(),
  62  |       alternateLogo: getBase64Logo(),
  63  |       shortCode: name.substring(0, 8).toUpperCase(),
  64  |     };
  65  | 
  66  |     const response = await this.request.post('/api/public/Franchise/Create', {
  67  |       data: payload,
  68  |       headers: this.getAuthHeaders(),
  69  |     });
  70  | 
  71  |     const body = await response.json();
  72  |     if (!response.ok()) throw new Error(`Create Franchise failed: ${response.status()} ${JSON.stringify(body)}`);
  73  | 
  74  |     const franchiseId = body.id || body.data?.id;
  75  |     console.log(`Franchise created: ${name} (${franchiseId})`);
  76  | 
  77  |     return { franchiseId, franchiseName: name };
  78  |   }
  79  | 
  80  |   async verifyFranchise(franchiseId: string) {
  81  |     const response = await this.request.post('/api/public/Franchise/Get', {
  82  |       data: { id: franchiseId },
  83  |       headers: this.getAuthHeaders(),
  84  |     });
  85  | 
  86  |     const body = await response.json();
  87  |     if (!response.ok()) throw new Error(`Verify Franchise failed: ${response.status()}`);
  88  | 
  89  |     console.log(`Franchise verified via API`);
  90  |     return body.data || body;
  91  |   }
  92  | 
  93  |   // ==================== OFFER GROUP ====================
  94  |   async createOfferGroup(franchiseId: string, franchiseName: string, isBingo = false) {
  95  |     const uuid = this.generateUUID();
  96  | 
  97  |     const payload: Record<string, unknown> = {
  98  |       Id: uuid,
  99  |       FranchiseId: franchiseId,
  100 |       Name: isBingo ? `${franchiseName} Bingo` : franchiseName,
  101 |       Description: isBingo ? `${franchiseName} Virtual Bingo` : franchiseName,
  102 |       Active: true,
  103 |       PreferredSampling: false,
  104 |       WaitForNewRoundDuration: 60,
  105 |       DesiredHoldPercentage: 18,
  106 |       NumberOfPendingRounds: 5,
  107 |       RoundDuration: isBingo ? 45 : 42,
  108 |       IsGlobalJackpotActive: true,
  109 |       GlobalJackpotRangeFrom: 300,
  110 |       GlobalJackpotRangeTo: 2250,
  111 |       GlobalJackpotPercFromPayin: 50,
  112 |       GlobalJackpotStartAmountType: 'Fixed',
  113 |       GlobalJackpotStartAmount: 50,
  114 |       JackpotWinnerSkipCounter: 2,
  115 |       IsLocalJackpotActive: true,
  116 |       LocalJackpotStartAmountType: 'Fixed',
  117 |       LocalJackpotStartAmount: 10,
  118 |       LocalJackpotRangeFrom: 50,
  119 |       LocalJackpotRangeTo: 120,
  120 |       LocalJackpotPercFromPayin: 2,
  121 |     };
  122 | 
  123 |     if (isBingo) payload.GameType = 'VirtualBingo';
  124 |     else payload.RaceType = 'Dogs6';
```