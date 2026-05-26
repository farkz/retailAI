import { APIRequestContext } from '@playwright/test';
import { config } from '../config/env';
import { testData, saveTestData } from './testContext';
import { generateFranchiseName, getBase64Logo } from './dataFactory';

export class ApiClient {
  private token: string | null = null;
  private boUserId: string | null = null;

  constructor(private request: APIRequestContext) {}

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
    console.log(`Login response body: ${rawText.substring(0, 500)}`);

    if (!response.ok()) {
      throw new Error(`Login failed: ${response.status()} - ${rawText.substring(0, 500)}`);
    }

    if (!rawText) {
      throw new Error(`Login failed: ${response.status()} - empty response body`);
    }

    let body: any;
    try {
      body = JSON.parse(rawText);
    } catch (e) {
      throw new Error(`Login failed: non-JSON response (${response.status()}): ${rawText.substring(0, 500)}`);
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

    const body = await response.json();
    if (!response.ok()) throw new Error(`Create Franchise failed: ${response.status()} ${JSON.stringify(body)}`);

    const franchiseId = body.id || body.data?.id;
    console.log(`Franchise created: ${name} (${franchiseId})`);

    return { franchiseId, franchiseName: name };
  }

  async verifyFranchise(franchiseId: string) {
    const response = await this.request.post('/api/public/Franchise/Get', {
      data: { id: franchiseId },
      headers: this.getAuthHeaders(),
    });

    const body = await response.json();
    if (!response.ok()) throw new Error(`Verify Franchise failed: ${response.status()}`);

    console.log(`Franchise verified via API`);
    return body.data || body;
  }

  // ==================== OFFER GROUP ====================
  async createOfferGroup(franchiseId: string, franchiseName: string, isBingo = false) {
    const uuid = this.generateUUID();

    const payload: Record<string, unknown> = {
      Id: uuid,
      FranchiseId: franchiseId,
      Name: isBingo ? `${franchiseName} Bingo` : franchiseName,
      Description: isBingo ? `${franchiseName} Virtual Bingo` : franchiseName,
      Active: true,
      PreferredSampling: false,
      WaitForNewRoundDuration: 60,
      DesiredHoldPercentage: 18,
      NumberOfPendingRounds: 5,
      RoundDuration: isBingo ? 45 : 42,
      IsGlobalJackpotActive: true,
      GlobalJackpotRangeFrom: 300,
      GlobalJackpotRangeTo: 2250,
      GlobalJackpotPercFromPayin: 50,
      GlobalJackpotStartAmountType: 'Fixed',
      GlobalJackpotStartAmount: 50,
      JackpotWinnerSkipCounter: 2,
      IsLocalJackpotActive: true,
      LocalJackpotStartAmountType: 'Fixed',
      LocalJackpotStartAmount: 10,
      LocalJackpotRangeFrom: 50,
      LocalJackpotRangeTo: 120,
      LocalJackpotPercFromPayin: 2,
    };

    if (isBingo) payload.GameType = 'VirtualBingo';
    else payload.RaceType = 'Dogs6';

    const response = await this.request.post(`${config.virtualRaceApiUrl}/api/public/OfferGroup/Save`, {
      data: payload,
      headers: this.getAuthHeaders(),
    });

    const ogBody = await response.text();
    if (!response.ok()) {
      console.log(`OfferGroup 400 response body: ${ogBody}`);
      throw new Error(`OfferGroup creation failed: ${response.status()} — ${ogBody}`);
    }

    console.log(`${isBingo ? 'Bingo' : 'Race'} OfferGroup created`);
    return uuid;
  }

  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
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

    const body = await response.json();
    if (!response.ok()) throw new Error(`Create Cost Center failed: ${response.status()} ${JSON.stringify(body)}`);

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

    const body = await response.json();
    if (!response.ok()) throw new Error(`Create Terminal failed: ${response.status()} ${JSON.stringify(body)}`);

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

    const body = await response.json();
    if (!response.ok()) throw new Error(`Create Betshop failed: ${response.status()} ${JSON.stringify(body)}`);

    return body.id || body.data?.id;
  }

  async setCashPayoutOption(terminalId: string) {
    await this.request.post('/api/public/Terminal/SetCashPayoutOption', {
      data: { terminalId, enabled: true },
      headers: this.getAuthHeaders(),
    });
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

      await new Promise((r) => setTimeout(r, 300));
    }

    saveTestData({ terminals, betshops, allTerminalIds: terminals, allBetshopIds: betshops });

    return { terminals, betshops };
  }
}
