import { expect } from 'chai';
import { request } from '@playwright/test';
import { ApiClient } from '../../helpers/apiClient';
import dbClient from '../../helpers/dbClient';
import { RaceCache } from '../../helpers/raceCache';
import { perTerminalMultiTicketFlow, TerminalPayinResult } from '../../helpers/racePayinHelper';
import { config } from '../../config/env';
import { getFromDate } from '../../helpers/utils';
import * as fs from 'fs';
import * as path from 'path';

interface Phase2TerminalReport {
  terminalId: string;
  ticketCount: number;
  tickets: Array<{
    roundId: string;
    roundNumber: number;
    payinMode: string;
    betCount: number;
    payinAmount: number;
    actionIds: string[];
  }>;
}

interface Phase2Report {
  runAt: string;
  franchiseId: string;
  offerGroupId: string;
  currency: string;
  ticketsPerTerminal: number;
  terminals: Phase2TerminalReport[];
  steps: Array<{ step: number; label: string; status: 'pending' | 'pass' | 'fail' }>;
}

function loadPhase1Report(): any {
  const reportPath = path.resolve(__dirname, '../../test-results/phase1-report.json');
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Phase 1 report not found at ${reportPath}. Run Phase 1 tests first.`);
  }
  const content = fs.readFileSync(reportPath, 'utf-8');
  return JSON.parse(content);
}

function writeReport(data: Phase2Report) {
  try {
    const reportDir = path.resolve(__dirname, '../../test-results');
    fs.mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, 'phase2-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(data, null, 2));
    console.log(`\n[report] Written to ${reportPath}`);
  } catch (e: any) {
    console.warn(`[report] Failed to write JSON report: ${e?.message ?? e}`);
  }
}

describe('Phase 2 - Terminal Virtual Race Payin', () => {
  const skipCleanup = config.phase2.skipCleanup;
  const ticketCount = config.phase2.ticketsPerTerminal;
  let apiClient: ApiClient;
  let requestContext: any;

  const report: Phase2Report = {
    runAt: new Date().toISOString(),
    franchiseId: '',
    offerGroupId: '',
    currency: 'EUR',
    ticketsPerTerminal: ticketCount,
    terminals: [],
    steps: [
      { step: 1, label: 'Load Phase 1 report', status: 'pending' },
      { step: 2, label: 'Init RaceCache', status: 'pending' },
      { step: 3, label: 'Fetch currency from first terminal', status: 'pending' },
      { step: 4, label: 'Process all terminals', status: 'pending' },
      { step: 5, label: 'Verify tickets', status: 'pending' },
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
    writeReport(report);

    if (skipCleanup) {
      console.log('\n[cleanup] SKIP_PHASE2_CLEANUP set \u2014 leaving tickets intact');
    } else {
      console.log('\n========== PHASE 2 CLEANUP ==========');
      console.log('[cleanup] Phase 2 cleanup would go here (ticket cancellation/etc)');
      console.log('======================================\n');
    }

    if (requestContext) {
      await requestContext.dispose();
    }
  });

  it('should execute full Phase 2 flow for all terminals', async () => {
    console.log('\n========== PHASE 2 RACE PAYIN ==========');
    console.log(`Tickets per terminal: ${ticketCount}`);
    console.log(`Skip credit ticket: ${config.phase2.skipCreditTicket}`);

    // ── 1. LOAD PHASE 1 REPORT ────────────────────────────────────────
    const phase1 = loadPhase1Report();
    report.franchiseId = phase1.franchise?.id ?? '';
    expect(report.franchiseId, 'Phase 1 report must contain franchiseId').to.be.ok;

    const terminalIds: string[] = (phase1.costCenters ?? []).map((cc: any) => cc.terminal).filter(Boolean);
    expect(terminalIds.length, 'Phase 1 report must contain at least 1 terminal').to.be.above(0);
    report.steps[0].status = 'pass';
    console.log(`\n[1] Loaded Phase 1 report: ${terminalIds.length} terminals`);

    // ── 2. INIT RACECACHE ─────────────────────────────────────────────
    const raceCache = new RaceCache(apiClient, report.franchiseId, apiClient.getToken()!);
    await raceCache.init();
    const raceData = raceCache.getCurrentRound();
    report.offerGroupId = raceData.offerGroupId;
    expect(report.offerGroupId, 'RaceCache must resolve an offerGroupId').to.be.ok;
    report.steps[1].status = 'pass';
    console.log(`[2] RaceCache init: offerGroup=${raceData.offerGroupId}, round=${raceData.roundId}`);

    // ── 3. FETCH CURRENCY FROM FIRST TERMINAL ─────────────────────────
    const firstTerminalId = terminalIds[0];
    const loginPin = await apiClient.addTerminalLoginPin(firstTerminalId);
    const { generateFingerprint } = await import('../../helpers/utils');
    const fingerprint = generateFingerprint();
    const firstToken = await apiClient.terminalLogin(firstTerminalId, fingerprint, loginPin);
    const configAuth = await apiClient.fetchConfigurationAuthorized(firstToken);
    report.currency = configAuth.currency;
    report.steps[2].status = 'pass';
    console.log(`[3] Currency: ${report.currency}`);

    // ── 4. PROCESS EACH TERMINAL ──────────────────────────────────────
    for (let i = 0; i < terminalIds.length; i++) {
      const terminalId = terminalIds[i];
      console.log(`\n[4.${i + 1}] Terminal ${terminalId}`);

      const result = await perTerminalMultiTicketFlow(
        apiClient, terminalId, raceCache, report.currency, ticketCount, configAuth.payinMode
      );

      report.terminals.push({
        terminalId,
        ticketCount: result.tickets.length,
        tickets: result.tickets.map(t => ({
          roundId: t.roundId,
          roundNumber: t.roundNumber,
          payinMode: t.payinMode,
          betCount: t.betCount,
          payinAmount: t.payinAmount,
          actionIds: t.actionIds,
        })),
      });

      console.log(`     Created ${result.tickets.length} tickets`);
    }
    report.steps[3].status = 'pass';

    // ── 5. VERIFY TICKETS ────────────────────────────────────────
    const fromDate = getFromDate(1);
    const toDate = new Date().toISOString();
    let totalVerified = 0;

    for (const t of report.terminals) {
      const costCenterId = await dbClient.getTerminalCostCenterId(t.terminalId);
      if (!costCenterId) {
        console.warn(`[verify] Could not resolve costCenterId for ${t.terminalId}`);
        continue;
      }
      const ticketsOverview = await apiClient.getTicketsOverview(
        apiClient.getToken()!,
        costCenterId,
        t.terminalId,
        fromDate,
        toDate
      );
      expect(ticketsOverview.Tickets.length, `Terminal ${t.terminalId} should have tickets`).to.be.above(0);
      totalVerified += ticketsOverview.Tickets.length;
    }
    report.steps[4].status = 'pass';

    console.log('\n========== PHASE 2 COMPLETE ==========');
    console.log(`Terminals processed: ${terminalIds.length}`);
    console.log(`Total tickets created: ${report.terminals.reduce((sum, t) => sum + t.ticketCount, 0)}`);
    console.log(`Total tickets verified: ${totalVerified}`);
    console.log('======================================\n');
  });
});
