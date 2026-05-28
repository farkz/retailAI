import { expect } from 'chai';
import { request } from '@playwright/test';
import { ApiClient } from '../../helpers/apiClient';
import dbClient from '../../helpers/dbClient';
import { BingoCache } from '../../helpers/bingoCache';
import { perTerminalBingoFlow, TerminalBingoResult } from '../../helpers/bingoPayinHelper';
import { config } from '../../config/env';
import { generateFingerprint } from '../../helpers/utils';
import * as fs from 'fs';
import * as path from 'path';

interface Phase4TerminalReport {
  terminalId: string;
  locationId: string;
  roundId: string;
  roundNumber: number;
  tickets: Array<{
    betType: string;
    betContent: string;
    amount: number;
    actionId: string;
    payinMode: string;
    status: 'confirmed' | 'failed' | 'timeout';
    failReason: string | null;
    pollingAttempts: number;
  }>;
}

interface Phase4Report {
  runAt: string;
  franchiseId: string;
  bingoOfferGroupId: string;
  currency: string;
  minPayin: number;
  ticketsPerTerminal: number;
  summary: {
    terminalsProcessed: number;
    totalTicketsAttempted: number;
    totalTicketsConfirmed: number;
    totalTicketsFailed: number;
    totalPayinAmount: number;
  };
  terminals: Phase4TerminalReport[];
  steps: Array<{ step: number; label: string; status: 'pending' | 'pass' | 'fail' }>;
}

function loadPhase1Report(): any {
  const reportPath = path.resolve(__dirname, '../../test-results/phase1-report.json');
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Phase 1 report not found at ${reportPath}. Run Phase 1 tests first.`);
  }
  return JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
}

function writeReport(data: Phase4Report) {
  try {
    const reportDir = path.resolve(__dirname, '../../test-results');
    fs.mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, 'phase4-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(data, null, 2));
    console.log(`\n[report] Written to ${reportPath}`);
  } catch (e: any) {
    console.warn(`[report] Failed to write JSON report: ${e?.message ?? e}`);
  }
}

describe('Phase 4 - Terminal Virtual Bingo Payin', () => {
  const ticketCount = config.phase4.ticketsPerTerminal;
  const skipCleanup = config.phase4.skipCleanup;

  let apiClient: ApiClient;
  let requestContext: any;

  const report: Phase4Report = {
    runAt: new Date().toISOString(),
    franchiseId: '',
    bingoOfferGroupId: '',
    currency: 'EUR',
    minPayin: 0.5,
    ticketsPerTerminal: ticketCount,
    summary: {
      terminalsProcessed: 0,
      totalTicketsAttempted: 0,
      totalTicketsConfirmed: 0,
      totalTicketsFailed: 0,
      totalPayinAmount: 0,
    },
    terminals: [],
    steps: [
      { step: 1, label: 'Load Phase 1 report',       status: 'pending' },
      { step: 2, label: 'Init BingoCache',            status: 'pending' },
      { step: 3, label: 'Fetch currency',             status: 'pending' },
      { step: 4, label: 'Get MinPayin from config',   status: 'pending' },
      { step: 5, label: 'Process all terminals',      status: 'pending' },
    ],
  };

  before(async () => {
    requestContext = await request.newContext({ baseURL: config.baseUrl });
    apiClient = new ApiClient(requestContext);
    await apiClient.login();
    expect(apiClient.getToken(), 'Login must return a non-empty token').to.be.ok;
    expect(apiClient.getBoUserId(), 'Login must return a non-empty user id').to.be.ok;
  });

  after(async () => {
    report.summary.terminalsProcessed = report.terminals.length;
    report.summary.totalTicketsAttempted = report.terminals.reduce(
      (s, t) => s + t.tickets.length, 0
    );
    report.summary.totalTicketsConfirmed = report.terminals.reduce(
      (s, t) => s + t.tickets.filter(tk => tk.status === 'confirmed').length, 0
    );
    report.summary.totalTicketsFailed = report.terminals.reduce(
      (s, t) => s + t.tickets.filter(tk => tk.status !== 'confirmed').length, 0
    );
    report.summary.totalPayinAmount = Math.round(
      report.terminals.reduce(
        (s, t) => s + t.tickets.filter(tk => tk.status === 'confirmed').reduce(
          (ts, tk) => ts + tk.amount, 0
        ), 0
      ) * 100
    ) / 100;

    writeReport(report);

    if (skipCleanup) {
      console.log('\n[cleanup] SKIP_PHASE4_CLEANUP set — leaving bingo tickets intact');
    }

    if (requestContext) {
      await requestContext.dispose();
    }
  });

  it('should execute full Phase 4 bingo payin flow for all terminals', async () => {
    console.log('\n========== PHASE 4 BINGO PAYIN ==========');
    console.log(`Tickets per terminal: ${ticketCount}`);
    console.log(`PayinMode: ${config.phase4.payinMode}`);

    // ── 1. LOAD PHASE 1 REPORT ─────────────────────────────────────────
    const phase1 = loadPhase1Report();
    report.franchiseId = phase1.franchise?.id ?? '';
    expect(report.franchiseId, 'Phase 1 report must contain franchiseId').to.be.ok;

    const phase1BingoOfferGroupId: string = phase1.offerGroups?.bingo?.id ?? '';
    expect(phase1BingoOfferGroupId, 'Phase 1 report must contain bingo offerGroupId').to.be.ok;

    const costCenterMap: Map<string, string> = new Map(
      (phase1.costCenters ?? []).map((cc: any) => [cc.terminal as string, cc.id as string])
    );
    const terminalIds: string[] = Array.from(costCenterMap.keys()).filter(Boolean);
    expect(terminalIds.length, 'Phase 1 report must contain at least 1 terminal').to.be.above(0);

    report.steps[0].status = 'pass';
    console.log(`\n[1] Loaded Phase 1 report: ${terminalIds.length} terminals, bingoOG=${phase1BingoOfferGroupId}`);

    // ── 2. INIT BINGOCACHE ─────────────────────────────────────────────
    const bingoCache = new BingoCache(apiClient, report.franchiseId, apiClient.getToken()!);
    await bingoCache.init();
    const bingoData = bingoCache.getCurrentRound();
    report.bingoOfferGroupId = bingoData.offerGroupId;

    expect(report.bingoOfferGroupId, 'BingoCache must resolve an offerGroupId').to.be.ok;
    expect(
      report.bingoOfferGroupId.toLowerCase(),
      'BingoCache offerGroupId must match Phase 1 bingo offerGroupId'
    ).to.equal(phase1BingoOfferGroupId.toLowerCase());

    report.steps[1].status = 'pass';
    console.log(`[2] BingoCache init: offerGroup=${bingoData.offerGroupId}, round=${bingoData.roundId} (#${bingoData.roundNumber})`);

    // ── 3. FETCH CURRENCY ──────────────────────────────────────────────
    const firstTerminalId = terminalIds[0];
    const loginPin = await apiClient.addTerminalLoginPin(firstTerminalId);
    const fingerprint = generateFingerprint();
    const firstToken = await apiClient.terminalLogin(firstTerminalId, fingerprint, loginPin);
    const configAuth = await apiClient.fetchConfigurationAuthorized(firstToken);
    report.currency = configAuth.currency || 'EUR';

    report.steps[2].status = 'pass';
    console.log(`[3] Currency: ${report.currency}`);

    // ── 4. GET MINPAYIN ────────────────────────────────────────────────
    let minPayin = 0.5;
    try {
      const configGroupId = await dbClient.getConfigurationGroupId(report.franchiseId, true);
      if (configGroupId !== null) {
        minPayin = await apiClient.getBingoMinPayin(configGroupId, apiClient.getToken()!);
        console.log(`[4] MinPayin from GetGroupConfigurations: ${minPayin}`);
      } else {
        console.warn(`[4] Could not resolve bingo config group id — using default MinPayin=${minPayin}`);
      }
    } catch (e: any) {
      console.warn(`[4] MinPayin fetch failed (${e?.message ?? e}) — using default ${minPayin}`);
    }
    report.minPayin = minPayin;
    report.steps[3].status = 'pass';

    // ── 5. PROCESS EACH TERMINAL ───────────────────────────────────────
    for (let i = 0; i < terminalIds.length; i++) {
      const terminalId = terminalIds[i];
      const costCenterId = costCenterMap.get(terminalId)
        ?? await dbClient.getTerminalCostCenterId(terminalId)
        ?? '';

      if (!costCenterId) {
        console.warn(`[5.${i + 1}] Could not resolve costCenterId for terminal ${terminalId} — skipping`);
        continue;
      }

      console.log(`\n[5.${i + 1}] Terminal ${terminalId} (location=${costCenterId})`);

      let result: TerminalBingoResult;
      try {
        result = await perTerminalBingoFlow(
          apiClient,
          terminalId,
          costCenterId,
          bingoCache,
          report.currency,
          ticketCount,
          minPayin
        );
      } catch (e: any) {
        console.warn(`[5.${i + 1}] Terminal flow threw: ${e?.message ?? e}`);
        report.terminals.push({
          terminalId,
          locationId: costCenterId,
          roundId: bingoData.roundId,
          roundNumber: bingoData.roundNumber,
          tickets: [{
            betType: '',
            betContent: '',
            amount: 0,
            actionId: '',
            payinMode: config.phase4.payinMode,
            status: 'failed',
            failReason: e?.message ?? String(e),
            pollingAttempts: 0,
          }],
        });
        continue;
      }

      const confirmed = result.tickets.filter(t => t.status === 'confirmed').length;
      const failed = result.tickets.filter(t => t.status !== 'confirmed').length;
      console.log(`     Confirmed: ${confirmed}  Failed/Timeout: ${failed}`);

      report.terminals.push({
        terminalId,
        locationId: costCenterId,
        roundId: result.tickets[0]?.roundId ?? bingoData.roundId,
        roundNumber: result.tickets[0]?.roundNumber ?? bingoData.roundNumber,
        tickets: result.tickets.map(t => ({
          betType: t.betType,
          betContent: t.betContent,
          amount: t.amount,
          actionId: t.actionId,
          payinMode: t.payinMode,
          status: t.status,
          failReason: t.failReason,
          pollingAttempts: t.pollingAttempts,
        })),
      });
    }

    bingoCache.stop();
    report.steps[4].status = 'pass';

    const totalAttempted = report.terminals.reduce((s, t) => s + t.tickets.length, 0);
    const totalConfirmed = report.terminals.reduce(
      (s, t) => s + t.tickets.filter(tk => tk.status === 'confirmed').length, 0
    );

    console.log('\n========== PHASE 4 COMPLETE ==========');
    console.log(`Terminals processed : ${report.terminals.length}`);
    console.log(`Tickets attempted   : ${totalAttempted}`);
    console.log(`Tickets confirmed   : ${totalConfirmed}`);
    console.log(`Tickets failed      : ${totalAttempted - totalConfirmed}`);
    console.log('======================================\n');

    expect(report.terminals.length, 'At least one terminal must have been processed').to.be.above(0);
    expect(totalAttempted, 'At least one ticket must have been attempted').to.be.above(0);
    expect(
      totalConfirmed,
      'At least one ticket must be confirmed (BillingPending)'
    ).to.be.above(0);
  });
});
