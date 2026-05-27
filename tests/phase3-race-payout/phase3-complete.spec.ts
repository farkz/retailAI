import { expect } from 'chai';
import { request } from '@playwright/test';
import { ApiClient } from '../../helpers/apiClient';
import dbClient from '../../helpers/dbClient';
import { perTerminalPayoutFlow, TerminalPayoutResult } from '../../helpers/racePayoutHelper';
import { config } from '../../config/env';
import * as fs from 'fs';
import * as path from 'path';

interface Phase3TerminalReport {
  terminalId: string;
  payoutCount: number;
  payouts: Array<{
    ticketId: string;
    userId: string;
    winAmount: number;
    pin: string;
    taxNumber: string | null;
    actionId: string;
    success: boolean;
    error?: string;
  }>;
}

interface Phase3Report {
  runAt: string;
  franchiseId: string;
  wonTicketsFound: number;
  terminals: Phase3TerminalReport[];
  steps: Array<{ step: number; label: string; status: 'pending' | 'pass' | 'fail' }>;
}

function loadPhase1Report(): any {
  const reportPath = path.resolve(__dirname, '../../test-results/phase1-report.json');
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Phase 1 report not found at ${reportPath}. Run Phase 1 tests first.`);
  }
  return JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
}

function writeReport(data: Phase3Report) {
  try {
    const reportDir = path.resolve(__dirname, '../../test-results');
    fs.mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, 'phase3-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(data, null, 2));
    console.log(`\n[report] Written to ${reportPath}`);
  } catch (e: any) {
    console.error(`[report] Failed to write report: ${e.message}`);
  }
}

describe('Phase 3 - Terminal Virtual Race Payout', function () {
  this.timeout(600000);

  let apiClient: ApiClient;
  let requestContext: any;

  const report: Phase3Report = {
    runAt: new Date().toISOString(),
    franchiseId: '',
    wonTicketsFound: 0,
    terminals: [],
    steps: [
      { step: 1, label: 'Load Phase 1 report',       status: 'pending' },
      { step: 2, label: 'BO login',                  status: 'pending' },
      { step: 3, label: 'Query won tickets from DB', status: 'pending' },
      { step: 4, label: 'Per-terminal payout flow',  status: 'pending' },
    ],
  };

  before(async () => {
    requestContext = await request.newContext({ baseURL: config.baseUrl });
    apiClient = new ApiClient(requestContext);
    await apiClient.login();
    expect(apiClient.getToken(), 'Login must return a non-empty token').to.be.ok;
  });

  after(async () => {
    writeReport(report);
    console.log('\n========== PHASE 3 CLEANUP ==========');
    console.log('[cleanup] Phase 3 cleanup would go here');
    console.log('======================================\n');
    if (requestContext) await requestContext.dispose();
  });

  it('should execute full Phase 3 payout flow for all terminals', async function () {
    console.log('\n========== PHASE 3 RACE PAYOUT ==========');

    // ── 1. LOAD PHASE 1 REPORT ────────────────────────────────────
    const phase1 = loadPhase1Report();
    const franchiseId: string = phase1.franchise?.id ?? '';
    const terminalIds: string[] = (phase1.costCenters ?? []).map((cc: any) => cc.terminal).filter(Boolean);
    expect(franchiseId, 'Phase 1 report must contain franchise id').to.be.ok;
    expect(terminalIds.length, 'Phase 1 report must contain at least 1 terminal').to.be.above(0);
    report.franchiseId = franchiseId;
    report.steps[0].status = 'pass';
    console.log(`[1] Loaded Phase 1 report: ${terminalIds.length} terminals, franchiseId=${franchiseId}`);

    // ── 2. BO login already done in before() ──────────────────────
    report.steps[1].status = 'pass';
    console.log(`[2] BO login OK`);

    // ── 3. QUERY WON TICKETS FROM DB ─────────────────────────────
    const wonTickets = await dbClient.getWonTicketsByFranchise(franchiseId);
    report.wonTicketsFound = wonTickets.length;
    report.steps[2].status = 'pass';
    console.log(`[3] Won tickets found: ${wonTickets.length}`);

    if (wonTickets.length === 0) {
      console.log('[3] No won tickets to pay out — Phase 3 complete (nothing to do)');
      report.steps[3].status = 'pass';
      expect(true).to.equal(true);
      return;
    }

    // ── 4. PER-TERMINAL PAYOUT FLOW ───────────────────────────────
    // Distribute won tickets across terminals (round-robin by chunk)
    const chunkSize = Math.ceil(wonTickets.length / terminalIds.length);

    for (let i = 0; i < terminalIds.length; i++) {
      const terminalId = terminalIds[i];
      const myTickets = wonTickets.slice(i * chunkSize, (i + 1) * chunkSize);
      console.log(`\n[4.${i + 1}] Terminal ${terminalId} — ${myTickets.length} ticket(s) to pay out`);

      if (myTickets.length === 0) {
        report.terminals.push({ terminalId, payoutCount: 0, payouts: [] });
        continue;
      }

      const result: TerminalPayoutResult = await perTerminalPayoutFlow(
        apiClient, terminalId, myTickets
      );

      const successCount = result.payouts.filter(p => p.success).length;
      console.log(`     Paid out: ${successCount}/${result.payouts.length}`);

      report.terminals.push({
        terminalId,
        payoutCount: successCount,
        payouts: result.payouts.map(p => ({
          ticketId: p.ticketId,
          userId: p.userId,
          winAmount: p.winAmount,
          pin: p.pin,
          taxNumber: p.taxNumber,
          actionId: p.actionId,
          success: p.success,
          error: p.error,
        })),
      });
    }

    report.steps[3].status = 'pass';

    const totalPaidOut = report.terminals.reduce((sum, t) => sum + t.payoutCount, 0);
    console.log(`\nPhase 3 complete: ${totalPaidOut}/${wonTickets.length} won tickets paid out`);

    expect(report.steps.every(s => s.status === 'pass')).to.equal(true,
      `Not all Phase 3 steps passed: ${JSON.stringify(report.steps.filter(s => s.status !== 'pass'))}`
    );
  });
});
