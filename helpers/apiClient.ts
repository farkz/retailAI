import { APIRequestContext, APIResponse } from '@playwright/test';
import { config } from '../config/env';
import { testData, saveTestData } from './testContext';
import { generateFranchiseName, getBase64Logo } from './dataFactory';

export class ApiClient {
  private token: string | null = null;
  private boUserId: string | null = null;

  constructor(private request: APIRequestContext) {}

  // ==================== STATUS ASSERTION HELPERS ====================

  private async expectStatus(response: APIResponse, expected: number | number[], bodyPreview?: string): Promise<void> {
    const actual = response.status();
    const allowed = Array.isArray(expected) ? expected : [expected];
    if (!allowed.includes(actual)) {
      const preview = bodyPreview ?? (await response.text()).substring(0, 500);
      throw new Error(`Expected HTTP ${allowed.join('|')}, got ${actual}: ${preview}`);
    }
  }

  private async expectOkJson<T>(response: APIResponse, expectedStatus: number | number[]): Promise<T> {
    const text = await response.text();
    await this.expectStatus(response, expectedStatus, text.substring(0, 500));
    return JSON.parse(text) as T;
  }

  private async expectOkOrNoContent<T>(response: APIResponse, expectedStatus: number | number[]): Promise<T | null> {
    const text = await response.text();
    await this.expectStatus(response, expectedStatus, text.substring(0, 500));
    if (!text || text.trim() === '') return null;
    return JSON.parse(text) as T;
  }

  // ==================== AUTH ====================

  async login(): Promise<void> {
    const loginUrl = `${config.userApiUrl}/api/public/Users/Login`;
    const loginPayload = {
      clientType: config.boAdmin.clientType,
      clientId: config.boAdmin.clientId,
      username: config.boAdmin.username,
      tenantId: config.tenantId,
      password: config.boAdmin.password,
    };
    console.log(`Calling login URL: ${loginUrl}`);
    console.log(`Login username: [${loginPayload.username}] tenantId: [${loginPayload.tenantId}] clientId: [${loginPayload.clientId}]`);

    const response = await this.request.post(loginUrl, {
      data: loginPayload,
      headers: { 'Content-Type': 'application/json' },
    });

    const rawText = await response.text();
    console.log(`Login response status: ${response.status()}`);
    await this.expectStatus(response, [200, 201], rawText.substring(0, 500));

    if (!rawText) {
      throw new Error(`Login failed: empty response body (HTTP ${response.status()})`);
    }

    let body: any;
    try {
      body = JSON.parse(rawText);
    } catch (e) {
      throw new Error(`Login failed: non-JSON response (HTTP ${response.status()}): ${rawText.substring(0, 500)}`);
    }

    this.token = body.token;
    this.boUserId = body.id;
    console.log('BO Admin Login Successful');
  }

  getToken(): string | null {
    return this.token;
  }

  getBoUserId(): string | null {
    return this.boUserId;
  }

  getAuthHeaders() {
    if (!this.token) throw new Error('No authentication token available. Call login() first.');
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  // ==================== FRANCHISE ====================

  async createFranchise(customName?: string) {
    const name = customName || generateFranchiseName();

    const payload = {
      name,
      companyName: name,
      city: name,
      address: name,
      isTest: true,
      logo: getBase64Logo(),
      alternateLogo: getBase64Logo(),
      shortCode: name.substring(0, 8).toUpperCase(),
    };

    const response = await this.request.post('/api/public/Franchise/Create', {
      data: payload,
      headers: this.getAuthHeaders(),
    });

    const body = await this.expectOkJson<any>(response, [200, 201]);
    const franchiseId = body.id || body.data?.id;
    console.log(`Franchise created: ${name} (${franchiseId})`);

    return { franchiseId, franchiseName: name };
  }

  async verifyFranchise(franchiseId: string) {
    const response = await this.request.post('/api/public/Franchise/Get', {
      data: { id: franchiseId },
      headers: this.getAuthHeaders(),
    });

    const body = await this.expectOkOrNoContent<any>(response, [200, 201, 204]);
    if (body === null) {
      console.log(`Franchise verified via API (204 No Content)`);
      return { id: franchiseId };
    }
    console.log(`Franchise verified via API`);
    return body.data || body;
  }

  // ==================== OFFER GROUP ====================

  async createOfferGroup(franchiseId: string, franchiseName: string, isBingo = false) {
    const uuid = this.generateUUIDv7();

    const basePayload = {
      Id: uuid,
      FranchiseId: franchiseId,
      Active: true,
      PreferredSampling: false,
      WaitForNewRoundDuration: 60,
      DesiredHoldPercentage: 18,
      NumberOfPendingRounds: 5,
      IsGlobalJackpotActive: true,
      GlobalJackpotRangeFrom: 300,
      GlobalJackpotRangeTo: 2250,
      GlobalJackpotPercFromPayin: 50,
      GlobalJackpotStartAmountType: 'Fixed',
      GlobalJackpotStartAmount: 50,
      IsLocalJackpotActive: true,
      LocalJackpotStartAmountType: 'Fixed',
      LocalJackpotStartAmount: 10,
      LocalJackpotRangeFrom: 50,
      LocalJackpotRangeTo: 120,
      LocalJackpotPercFromPayin: 2,
    };

    const payload: Record<string, unknown> = isBingo
      ? {
          ...basePayload,
          Name: `${franchiseName} Bingo`,
          Description: `${franchiseName} Virtual Bingo`,
          RoundDuration: 45,
        }
      : {
          ...basePayload,
          Name: franchiseName,
          Description: franchiseName,
          RoundDuration: 42,
          RaceType: 'Dogs6',
        };

    const offerGroupUrl = isBingo
      ? `${config.virtualBingoApiUrl}/api/public/OfferGroup/Save`
      : `${config.virtualRaceApiUrl}/api/public/OfferGroup/Save`;

    const response = await this.request.post(offerGroupUrl, {
      data: payload,
      headers: this.getAuthHeaders(),
    });

    const ogBody = await response.text();
    await this.expectStatus(response, [200, 201], ogBody.substring(0, 500));

    console.log(`${isBingo ? 'Bingo' : 'Race'} OfferGroup created: ${uuid}`);
    return uuid;
  }

  async addLocationToOfferGroup(
    offerGroupId: string,
    costCenterId: string,
    ccName: string,
    isBingo = false
  ) {
    const payload = {
      Id: costCenterId,
      Name: ccName,
      OfferGroupId: offerGroupId,
      GlobalJackpotParticipation: true,
    };

    const baseUrl = isBingo ? config.virtualBingoApiUrl : config.virtualRaceApiUrl;
    const response = await this.request.post(`${baseUrl}/api/public/OfferGroup/AddLocation`, {
      data: payload,
      headers: this.getAuthHeaders(),
    });

    const body = await response.text();
    console.log(`  AddLocation (${isBingo ? 'Bingo' : 'Race'}) response [${response.status()}]: ${body.substring(0, 500)}`);
    await this.expectStatus(response, [200, 201], body.substring(0, 500));

    // Some endpoints return HTTP 200 with an application-level error in the body
    if (body && body.trim().startsWith('{')) {
      let parsed: any;
      try { parsed = JSON.parse(body); } catch { /* non-JSON 200 body — treat as success */ }
      if (parsed) {
        const success = parsed.success ?? parsed.Success;
        const errorMsg = parsed.error ?? parsed.Error ?? parsed.message ?? parsed.Message;
        if (success === false || (errorMsg && success !== true)) {
          throw new Error(`AddLocation (${isBingo ? 'Bingo' : 'Race'}) for CC ${ccName} returned 200 but failed: ${JSON.stringify(parsed)}`);
        }
      }
    }

    console.log(`  Location linked to ${isBingo ? 'Bingo' : 'Race'} OfferGroup: ${ccName}`);
  }

  async deleteOfferGroup(offerGroupId: string, isBingo = false): Promise<boolean> {
    const baseUrl = isBingo ? config.virtualBingoApiUrl : config.virtualRaceApiUrl;
    const candidates = [
      { url: `${baseUrl}/api/public/OfferGroup/Delete`, data: { Id: offerGroupId } },
      { url: `${baseUrl}/api/public/OfferGroup/Delete`, data: { id: offerGroupId } },
    ];
    for (const c of candidates) {
      try {
        const response = await this.request.post(c.url, {
          data: c.data,
          headers: this.getAuthHeaders(),
        });
        if (response.status() === 200) {
          console.log(`${isBingo ? 'Bingo' : 'Race'} OfferGroup deleted: ${offerGroupId}`);
          return true;
        }
      } catch {
        // try next candidate
      }
    }
    console.warn(`Could not delete ${isBingo ? 'Bingo' : 'Race'} OfferGroup ${offerGroupId} via API (best-effort)`);
    return false;
  }

  private generateUUIDv7(): string {
    const timestamp = BigInt(Date.now());
    const mostSigBits = ((timestamp << 16n) & 0xFFFFFFFFFFFF0000n) | (0x7n << 12n);
    const leastSigBits = (BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)) * BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER))) & 0xFFFFFFFFFFFF0FFFn;
    const hi = mostSigBits;
    const lo = leastSigBits;
    const toHex = (n: bigint, digits: number) => n.toString(16).padStart(digits, '0');
    const hiStr = toHex(hi, 16);
    const loStr = toHex(lo, 16);
    return `${hiStr.slice(0,8)}-${hiStr.slice(8,12)}-${hiStr.slice(12,16)}-${loStr.slice(0,4)}-${loStr.slice(4,16)}`;
  }

  // ==================== COST CENTER ====================

  async createCostCenter(franchiseId: string, franchiseName: string) {
    const randomNum = Math.floor(Math.random() * 90000) + 10000;
    const name = `${franchiseName}_${randomNum}`;

    const payload = {
      name,
      address: '---',
      city: '---',
      postalCode: '10000',
      code: randomNum.toString(),
      franchiseId,
      workDates: [{ dateFrom: new Date(Date.now() - 28 * 60 * 60 * 1000).toISOString() }],
    };

    const response = await this.request.post('/api/public/CostCenter/Create', {
      data: payload,
      headers: this.getAuthHeaders(),
    });

    const body = await this.expectOkJson<any>(response, [200, 201]);
    const costCenterId = body.id || body.data?.id;
    console.log(`Cost Center created: ${name}`);

    return { costCenterId, name, code: payload.code };
  }

  async createMultipleCostCenters(franchiseId: string, franchiseName: string, count = 5) {
    const results = [];
    for (let i = 0; i < count; i++) {
      const cc = await this.createCostCenter(franchiseId, franchiseName);
      results.push(cc);
      await new Promise((r) => setTimeout(r, 500));
    }
    return results;
  }

  // ==================== TERMINAL & BETSHOP ====================

  async createTerminal(costCenterId: string) {
    const payload = {
      costCenterId,
      hideGameRules: true,
      depositToSsbt: true,
      clientType: 'Terminal',
      products: { sport: true, lotto: true, virtualRace: true, virtualBingo: true },
    };

    const response = await this.request.post('/api/public/Terminal/Create', {
      data: payload,
      headers: this.getAuthHeaders(),
    });

    const body = await this.expectOkJson<any>(response, [200, 201]);
    return body.id || body.data?.id;
  }

  async createBetshop(costCenterId: string) {
    const payload = {
      costCenterId,
      hideGameRules: true,
      depositToSsbt: true,
      clientType: 'Betshop',
      products: { sport: true, lotto: true, virtualRace: true, virtualBingo: true },
    };

    const response = await this.request.post('/api/public/Terminal/Create', {
      data: payload,
      headers: this.getAuthHeaders(),
    });

    const body = await this.expectOkJson<any>(response, [200, 201]);
    return body.id || body.data?.id;
  }

  async setCashPayoutOption(terminalId: string) {
    const response = await this.request.post('/api/public/Terminal/SetCashPayoutOption', {
      data: { terminalId, enabled: true },
      headers: this.getAuthHeaders(),
    });

    const body = await response.text();
    await this.expectStatus(response, [200, 201], body.substring(0, 500));
    console.log(`Cash Payout enabled for ${terminalId}`);
  }

  async createTerminalsAndBetshops() {
    if (!testData.costCenterIds?.length) throw new Error('No cost centers found in testData');

    const terminals: string[] = [];
    const betshops: string[] = [];

    for (const costCenterId of testData.costCenterIds) {
      const terminalId = await this.createTerminal(costCenterId);
      terminals.push(terminalId);
      await this.setCashPayoutOption(terminalId);

      const betshopId = await this.createBetshop(costCenterId);
      betshops.push(betshopId);
      await this.setCashPayoutOption(betshopId);

      await new Promise((r) => setTimeout(r, 300));
    }

    saveTestData({ terminals, betshops, allTerminalIds: terminals, allBetshopIds: betshops });

    return { terminals, betshops };
  }

  // ==================== PHASE 2: TERMINAL AUTH ====================

  async addTerminalLoginPin(terminalId: string): Promise<string> {
    const response = await this.request.post('/api/public/Terminal/AddTerminalLoginPin', {
      data: { terminalId, clientType: 'Terminal' },
      headers: this.getAuthHeaders(),
    });
    const body = await this.expectOkJson<any>(response, [200, 201]);
    // API may return bare string/number or an object with loginPin field
    const pin = (typeof body === 'string' || typeof body === 'number')
      ? String(body)
      : (body.loginPin ?? body.LoginPin ?? body.pin ?? body.Pin);
    if (!pin) throw new Error(`addTerminalLoginPin: no loginPin in response: ${JSON.stringify(body).substring(0, 300)}`);
    console.log(`[Terminal] Login PIN obtained for ${terminalId}: ${pin}`);
    return pin;
  }

  async terminalLogin(terminalId: string, fingerprint: string, loginPin: string): Promise<string> {
    const response = await this.request.post('/api/public/Terminal/LogIn', {
      data: { fingerprint, clientType: 'Terminal', loginPin },
      headers: this.getAuthHeaders(),
    });
    const body = await this.expectOkJson<any>(response, [200, 201]);
    // API may return bare string token or an object with token field
    const token = (typeof body === 'string')
      ? body
      : (body.token ?? body.Token);
    if (!token) throw new Error(`terminalLogin: no token in response: ${JSON.stringify(body).substring(0, 300)}`);
    return token;
  }

  // ==================== PHASE 2: TERMINAL FUNDING ====================

  async deposit(
    terminalToken: string,
    fingerprint: string,
    amount: number,
    idempotentKey: string,
    clientDateTimeCreatedUtc: string
  ): Promise<any> {
    const response = await this.request.post('/api/public/Transaction/Deposit', {
      data: {
        amount,
        moneyType: 'Bill',
        currency3LetterId: 'EUR',
        idempotentKey,
        clientDateTimeCreatedUtc,
        clientType: 'TerminalConsumer',
      },
      headers: {
        Authorization: `Bearer ${terminalToken}`,
        Fingerprint: fingerprint,
        'Content-Type': 'application/json',
      },
    });
    return this.expectOkJson<any>(response, [200, 201]);
  }

  async getTerminalState(terminalToken: string, fingerprint: string): Promise<any> {
    const response = await this.request.post('/api/public/Terminal/GetState', {
      data: {},
      headers: {
        Authorization: `Bearer ${terminalToken}`,
        Fingerprint: fingerprint,
        'Content-Type': 'application/json',
      },
    });
    return this.expectOkOrNoContent<any>(response, [200, 201, 204]) ?? {};
  }

  async createCreditTicketReservation(
    terminalToken: string,
    fingerprint: string,
    amount: number,
    idempotentKey: string,
    currency3LetterId: string,
    clientDateTimeCreatedUtc: string
  ): Promise<any> {
    const response = await this.request.post('/api/public/CreditTicket/CreateReservation', {
      data: { idempotentKey, amount, currency3LetterId, clientDateTimeCreatedUtc },
      headers: {
        Authorization: `Bearer ${terminalToken}`,
        Fingerprint: fingerprint,
        'Content-Type': 'application/json',
      },
    });
    return this.expectOkJson<any>(response, [200, 201]);
  }

  async createCreditTicketConfirmation(
    terminalToken: string,
    fingerprint: string,
    idempotentKey: string
  ): Promise<any> {
    const response = await this.request.post('/api/public/CreditTicket/CreateConfirmation', {
      data: { idempotentKey },
      headers: {
        Authorization: `Bearer ${terminalToken}`,
        Fingerprint: fingerprint,
        'Content-Type': 'application/json',
      },
    });
    return this.expectOkJson<any>(response, [200, 201]);
  }

  // ==================== PHASE 2: RACE TICKET FLOW ====================

  async getOfferGroups(franchiseId: string, boToken: string): Promise<string> {
    const response = await this.request.post(`${config.virtualRaceApiUrl}/api/public/OfferGroup/GetAll`, {
      data: { Skip: 0, Take: 50, FranchiseId: franchiseId, TenantId: config.tenantId },
      headers: {
        Authorization: `Bearer ${boToken}`,
        'Content-Type': 'application/json',
      },
    });
    const body = await this.expectOkOrNoContent<any>(response, [200, 201, 204]);
    if (!body) throw new Error(`No offer groups returned (204) for franchise ${franchiseId}`);
    const active = body.data?.find((og: any) => og.Active === true) ?? body.find((og: any) => og.Active === true);
    if (!active) throw new Error(`No active offer group found for franchise ${franchiseId}`);
    return active.Id ?? active.id;
  }

  async fetchConfigurationAuthorized(terminalToken: string): Promise<{ currency: string; payinModes: string[] }> {
    const response = await this.request.post(
      `${config.virtualRaceDataProviderUrl}/api/public/Ticket/FetchConfigurationAuthorized`,
      {
        data: {},
        headers: {
          Authorization: `Bearer ${terminalToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    const body = await this.expectOkOrNoContent<any>(response, [200, 201, 204]);
    console.log(`[FetchConfigurationAuthorized] Full response: ${JSON.stringify(body)}`);
    const payinModes: string[] =
      body?.payinModes ??
      body?.PayinModes ??
      body?.availablePayinModes ??
      body?.AvailablePayinModes ??
      body?.modes ??
      body?.Modes ??
      ['Standard', 'PerBet'];
    return { currency: body?.currency ?? body?.Currency ?? 'EUR', payinModes };
  }

  async payin(
    terminalToken: string,
    fingerprint: string,
    payload: {
      OfferGroupId: string;
      Amount: number;
      CurrencyId: string;
      ActionIds: string[];
      ActionCreatedDatetime: string;
      TicketBets: Array<{
        Price: number;
        BetType: string;
        BetContent: string;
        RoundId: string;
        RoundNumber: number;
      }>;
      PayinType: string;
      PayinMode: string;
    }
  ): Promise<any> {
    const response = await this.request.post(`${config.virtualRaceApiUrl}/api/public/Ticket/Payin`, {
      data: payload,
      headers: {
        Authorization: `Bearer ${terminalToken}`,
        Fingerprint: fingerprint,
        'Content-Type': 'application/json',
      },
    });
    return this.expectOkJson<any>(response, [200, 201]);
  }

  async getTicketsOverview(
    boToken: string,
    costCenterId: string,
    userId: string,
    fromDate: string,
    toDate: string
  ): Promise<{ Tickets: Array<{ Id: string }> }> {
    const response = await this.request.post(`${config.virtualRaceApiUrl}/api/public/Ticket/GetTicketsOverview`, {
      data: {
        queryType: 'CostCenter',
        costCenterId,
        userId,
        fromDate,
        toDate,
        roundNumber: null,
        clientType: null,
        ticketType: null,
        ticketStatuses: ['Won'],
        jackpot: null,
        skip: 0,
        take: 200,
        totalCount: 200,
      },
      headers: {
        Authorization: `Bearer ${boToken}`,
        'Content-Type': 'application/json',
      },
    });
    const body = await this.expectOkOrNoContent<any>(response, [200, 201, 204]);
    return { Tickets: body?.Tickets ?? body?.data?.Tickets ?? [] };
  }
}
