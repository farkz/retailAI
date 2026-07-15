import { expect } from 'chai';
import { request } from '@playwright/test';
import { ApiClient } from '../../helpers/apiClient';
import dbClient from '../../helpers/dbClient';
import { perTerminalSportPayinFlow, TerminalSportPayinResult } from '../../helpers/sportPayinHelper';
import { perTerminalSportPayoutFlow, TerminalSportPayoutResult } from '../../helpers/sportPayoutHelper';
import { config } from '../../config/env';
import { getFromDate } from '../../helpers/utils';
import * as fs from 'fs';
import * as path from 'path';

interface Phase6TerminalPayinReport {
  terminalId: string;
  ticketCount: number;
  settledCount: number;
  tickets: Array<{
    actionId: string;
    betAmount: number;
    status: string;
    settled: boolean;
    error?: string;
  }>;
}

interface Phase6TerminalPayoutReport {
  terminalId: string;
  totalWon: number;
  paidOutCount: number;
  failedCount: number;
  payouts: Array<{
    ticketId: string;
    winAmount: number;
    success: boolean;
    error?: string;
  }>;
}

interface Phase6Summary {
  terminalsProcessed: number;
  totalTicketsPlaced: number;
  totalTicketsSettled: number;
  totalWonTickets: number;
  totalPaidOut: number;
  totalPayoutFailed: number;
}

interface Phase6Report {
  runAt: string;
  franchiseId: string;
  currency: string;
  ticketsPerTerminal: number;
  settleStatus: string;
  payin: Phase6TerminalPayinReport[];
  payout: Phase6TerminalPayoutReport[];
  summary: Phase6Summary;
  steps: Array<{ step: number; label: string; status: 'pending' | 'pass' | 'fail' }>;
}

function loadPhase1Report(): any {
  const reportPath = path.resolve(__dirname, '../../test-results/phase1-report.json');
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Phase 1 report not found at ${reportPath}. Run Phase 1 tests first.`);
  }
  return JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
}

function writeReport(data: Phase6Report) {
  try {
    const reportDir = path.resolve(__dirname, '../../test-results');
    fs.mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, 'phase6-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(data, null, 2));
    console.log(`\n[report] Written to ${reportPath}`);
  } catch (e: any) {
    console.warn(`[report] Failed to write JSON report: ${e?.message ?? e}`);
  }
}

describe('Phase 6 - Terminal Sport Payin + Payout', () => {
  const skipCleanup = config.phase6.skipCleanup;
  const ticketCount = config.phase6.ticketsPerTerminal;
  let apiClient: ApiClient;
  let requestContext: any;

  const report: Phase6Report = {
    runAt: new Date().toISOString(),
    franchiseId: '',
    currency: 'EUR',
    ticketsPerTerminal: ticketCount,
    settleStatus: config.phase6.settleStatus,
    payin: [],
    payout: [],
    summary: {
      terminalsProcessed: 0,
      totalTicketsPlaced: 0,
      totalTicketsSettled: 0,
      totalWonTickets: 0,
      totalPaidOut: 0,
      totalPayoutFailed: 0,
    },
    steps: [
      { step: 1, label: 'Load Phase 1 report',          status: 'pending' },
      { step: 2, label: 'Fetch sport configuration',    status: 'pending' },
      { step: 3, label: 'Sport payin — all terminals',  status: 'pending' },
      { step: 4, label: 'Sport payout — won tickets',   status: 'pending' },
      { step: 5, label: 'Verify results',               status: 'pending' },
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
      console.log('\n[cleanup] SKIP_PHASE6_CLEANUP set — leaving sport tickets intact');
    }

    if (requestContext) {
      await requestContext.dispose();
    }
  });

  it('should execute full Phase 6 sport payin + payout flow', async () => {
    console.log('\n========== PHASE 6 SPORT PAYIN + PAYOUT ==========');
    console.log(`Tickets per terminal : ${ticketCount}`);
    console.log(`Settle status        : ${config.phase6.settleStatus}`);
    console.log(`Sport integration    : ${config.sportIntegrationApiUrl}`);
    console.log(`Sport data provider  : ${config.sportDataProviderUrl}`);

    // ── 1. LOAD PHASE 1 REPORT ────────────────────────────────────────
    const phase1 = loadPhase1Report();
    report.franchiseId = phase1.franchise?.id ?? '';
    expect(report.franchiseId, 'Phase 1 report must contain franchiseId').to.be.ok;

    const terminalIds: string[] = (phase1.costCenters ?? []).map((cc: any) => cc.terminal).filter(Boolean);
    expect(terminalIds.length, 'Phase 1 report must contain at least 1 terminal').to.be.above(0);
    report.steps[0].status = 'pass';
    console.log(`\n[1] Loaded Phase 1 report: ${terminalIds.length} terminals, franchise=${report.franchiseId}`);

    // ── 2. FETCH SPORT CONFIGURATION (currency) ───────────────────────
    const firstTerminalId = terminalIds[0];
    try {
      const { generateFingerprint } = await import('../../helpers/utils');
      const loginPin = await apiClient.addTerminalLoginPin(firstTerminalId);
      const fp = generateFingerprint();
      const firstToken = await apiClient.terminalLogin(firstTerminalId, fp, loginPin);
      const sportCfg = await apiClient.fetchSportConfigurationAuthorized(firstToken, fp);
      if (sportCfg?.currency) report.currency = sportCfg.currency;
    } catch (e: any) {
      console.warn(`[2] fetchSportConfiguration failed (using EUR): ${e?.message ?? e}`);
    }
    report.steps[1].status = 'pass';
    console.log(`[2] Currency: ${report.currency}`);

    // ── 3. SPORT PAYIN — ALL TERMINALS ────────────────────────────────
    for (let i = 0; i < terminalIds.length; i++) {
      const terminalId = terminalIds[i];
      console.log(`\n[3.${i + 1}] Terminal ${terminalId} — placing ${ticketCount} sport ticket(s)`);

      const result: TerminalSportPayinResult = await perTerminalSportPayinFlow(
        apiClient, terminalId, report.currency, ticketCount
      );

      const settledCount = result.tickets.filter(t => t.settled).length;
      report.payin.push({
        terminalId,
        ticketCount: result.tickets.length,
        settledCount,
        tickets: result.tickets.map(t => ({
          actionId:   t.actionId,
          betAmount:  t.betAmount,
          status:     t.status,
          settled:    t.settled,
          error:      t.error,
        })),
      });
      console.log(`     Placed ${result.tickets.length}, settled ${settledCount}`);
    }

    report.summary.terminalsProcessed  = terminalIds.length;
    report.summary.totalTicketsPlaced  = report.payin.reduce((s, t) => s + t.ticketCount, 0);
    report.summary.totalTicketsSettled = report.payin.reduce((s, t) => s + t.settledCount, 0);
    report.steps[2].status = 'pass';

    console.log(`\n[3] Payin done — placed=${report.summary.totalTicketsPlaced} settled=${report.summary.totalTicketsSettled}`);

    // ── 4. SPORT PAYOUT — WON TICKETS ────────────────────────────────
    if (config.phase6.settleStatus !== 'Win') {
      console.log('\n[4] settleStatus != Win — skipping payout phase');
      report.steps[3].status = 'pass';
    } else {
      await new Promise(r => setTimeout(r, 3000));

      const wonTickets = await dbClient.getWonSportTicketsByFranchise(report.franchiseId);
      report.summary.totalWonTickets = wonTickets.length;
      console.log(`\n[4] Found ${wonTickets.length} won sport ticket(s) to pay out`);

      const ticketsByUser: Map<string, typeof wonTickets> = new Map();
      for (const t of wonTickets) {
        const key = t.user_id;
        if (!ticketsByUser.has(key)) ticketsByUser.set(key, []);
        ticketsByUser.get(key)!.push(t);
      }

      const terminalToWon = new Map<string, typeof wonTickets>();
      for (const terminalId of terminalIds) {
        const userTickets = ticketsByUser.get(terminalId) ?? [];
        if (userTickets.length > 0) terminalToWon.set(terminalId, userTickets);
      }

      if (terminalToWon.size === 0 && wonTickets.length > 0) {
        const chunkSize = Math.ceil(wonTickets.length / terminalIds.length);
        terminalIds.forEach((tid, idx) => {
          const slice = wonTickets.slice(idx * chunkSize, (idx + 1) * chunkSize);
          if (slice.length > 0) terminalToWon.set(tid, slice);
        });
      }

      for (const [terminalId, tickets] of terminalToWon.entries()) {
        console.log(`\n[4.x] Terminal ${terminalId} — paying out ${tickets.length} won ticket(s)`);
        const payoutResult: TerminalSportPayoutResult = await perTerminalSportPayoutFlow(
          apiClient, terminalId, tickets
        );

        const paidOut = payoutResult.payouts.filter(p => p.success).length;
        const failed  = payoutResult.payouts.filter(p => !p.success).length;
        report.payout.push({
          terminalId,
          totalWon:    tickets.length,
          paidOutCount: paidOut,
          failedCount:  failed,
          payouts: payoutResult.payouts.map(p => ({
            ticketId:  p.ticketId,
            winAmount: p.winAmount,
            success:   p.success,
            error:     p.error,
          })),
        });
        report.summary.totalPaidOut       += paidOut;
        report.summary.totalPayoutFailed  += failed;
        console.log(`     Paid out ${paidOut}, failed ${failed}`);
      }

      report.steps[3].status = 'pass';
    }

    // ── 5. VERIFY ─────────────────────────────────────────────────────
    expect(report.summary.totalTicketsPlaced, 'At least one sport ticket must have been placed').to.be.above(0);

    if (config.phase6.settleStatus === 'Win' && report.summary.totalWonTickets > 0) {
      expect(report.summary.totalPaidOut, 'At least one won ticket must have been paid out').to.be.above(0);
    }

    report.steps[4].status = 'pass';

    console.log('\n========== PHASE 6 COMPLETE ==========');
    console.log(`Terminals processed  : ${report.summary.terminalsProcessed}`);
    console.log(`Tickets placed       : ${report.summary.totalTicketsPlaced}`);
    console.log(`Tickets settled      : ${report.summary.totalTicketsSettled}`);
    console.log(`Won tickets found    : ${report.summary.totalWonTickets}`);
    console.log(`Paid out             : ${report.summary.totalPaidOut}`);
    console.log(`Payout failed        : ${report.summary.totalPayoutFailed}`);
    console.log('======================================\n');
  });
});
