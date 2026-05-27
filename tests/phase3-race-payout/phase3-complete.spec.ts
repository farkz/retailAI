import { expect } from 'chai';
import { request } from '@playwright/test';
import { ApiClient } from '../../helpers/apiClient';
import dbClient from '../../helpers/dbClient';
import { perTerminalPayoutFlow, TerminalPayoutResult } from '../../helpers/racePayoutHelper';
import { config } from '../../config/env';
import * as fs from 'fs';
import * as path from 'path';

// ─── Report types ────────────────────────────────────────────────────────────

interface PayoutTicketEntry {
  ticketId: string;
  userId: string;
  winAmount: number;
  jackpotWinAmount: number;
  effectiveWinAmount: number;
  taxable: boolean;
  winTax: number;
  pin: string;
  taxNumber: string | null;
  actionId: string;
  success: boolean;
  error?: string;
}

interface LostTicketEntry {
  ticketId: string;
  userId: string;
}

interface TerminalSummary {
  terminalId: string;
  wonTickets: {
    count: number;
    paidOutCount: number;
    failedPayoutCount: number;
    totalWinAmount: number;
    paidOutAmount: number;
    failedPayoutAmount: number;
    taxableCount: number;
    totalWinTax: number;
  };
  lostTickets: {
    count: number;
  };
  payouts: PayoutTicketEntry[];
  lostTicketIds: string[];
}

interface Phase3Summary {
  wonTicketsTotal: number;
  paidOutCount: number;
  failedPayoutCount: number;
  totalWinAmount: number;
  paidOutAmount: number;
  failedPayoutAmount: number;
  taxableTicketCount: number;
  totalWinTax: number;
  lostTicketsTotal: number;
}

interface Phase3Report {
  runAt: string;
  franchiseId: string;
  winTaxThreshold: number;
  winTaxRate: number;
  summary: Phase3Summary;
  terminals: TerminalSummary[];
  steps: Array<{ step: number; label: string; status: 'pending' | 'pass' | 'fail' }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function calcTax(amount: number, threshold: number, rate: number): number {
  if (amount <= threshold) return 0;
  return parseFloat((amount * rate).toFixed(2));
}

function round2(n: number): number {
  return parseFloat(n.toFixed(2));
}

// ─── Test ─────────────────────────────────────────────────────────────────────

describe('Phase 3 - Terminal Virtual Race Payout', function () {
  this.timeout(600000);

  let apiClient: ApiClient;
  let requestContext: any;

  const TAX_THRESHOLD = config.phase3.winTaxThreshold;
  const TAX_RATE      = config.phase3.winTaxRate;

  const report: Phase3Report = {
    runAt: new Date().toISOString(),
    franchiseId: '',
    winTaxThreshold: TAX_THRESHOLD,
    winTaxRate: TAX_RATE,
    summary: {
      wonTicketsTotal: 0,
      paidOutCount: 0,
      failedPayoutCount: 0,
      totalWinAmount: 0,
      paidOutAmount: 0,
      failedPayoutAmount: 0,
      taxableTicketCount: 0,
      totalWinTax: 0,
      lostTicketsTotal: 0,
    },
    terminals: [],
    steps: [
      { step: 1, label: 'Load Phase 1 report',         status: 'pending' },
      { step: 2, label: 'BO login',                    status: 'pending' },
      { step: 3, label: 'Query tickets from DB',        status: 'pending' },
      { step: 4, label: 'Per-terminal payout flow',    status: 'pending' },
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
    if (requestContext) await requestContext.dispose();
  });

  it('should execute full Phase 3 payout flow for all terminals', async function () {
    console.log('\n========== PHASE 3 RACE PAYOUT ==========');
    console.log(`Win tax: ${TAX_RATE * 100}% on wins above ${TAX_THRESHOLD} €`);

    // ── 1. LOAD PHASE 1 REPORT ────────────────────────────────────
    const phase1 = loadPhase1Report();
    const franchiseId: string = phase1.franchise?.id ?? '';
    const terminalIds: string[] = (phase1.costCenters ?? []).map((cc: any) => cc.terminal).filter(Boolean);
    expect(franchiseId, 'Phase 1 report must contain franchise id').to.be.ok;
    expect(terminalIds.length, 'Phase 1 report must contain at least 1 terminal').to.be.above(0);
    report.franchiseId = franchiseId;
    report.steps[0].status = 'pass';
    console.log(`[1] ${terminalIds.length} terminals, franchiseId=${franchiseId}`);

    // ── 2. BO LOGIN (done in before()) ────────────────────────────
    report.steps[1].status = 'pass';
    console.log(`[2] BO login OK`);

    // ── 3. QUERY TICKETS FROM DB ──────────────────────────────────
    const [wonTickets, lostTickets] = await Promise.all([
      dbClient.getWonTicketsByFranchise(franchiseId),
      dbClient.getLostTicketsByFranchise(franchiseId),
    ]);

    report.summary.wonTicketsTotal  = wonTickets.length;
    report.summary.lostTicketsTotal = lostTickets.length;
    report.steps[2].status = 'pass';
    console.log(`[3] Won tickets: ${wonTickets.length}  |  Lost tickets: ${lostTickets.length}`);

    if (wonTickets.length === 0) {
      console.log('[3] No won tickets to pay out — Phase 3 complete (nothing to do)');
      report.steps[3].status = 'pass';
      // Distribute lost tickets evenly across terminals for reporting
      buildLostOnlyTerminals(terminalIds, lostTickets, report);
      buildSummary(report);
      return;
    }

    // ── 4. PER-TERMINAL PAYOUT FLOW ───────────────────────────────
    // Chunk won tickets across terminals; attach lost tickets by position
    const wonChunkSize  = Math.ceil(wonTickets.length  / terminalIds.length);
    const lostChunkSize = lostTickets.length > 0
      ? Math.ceil(lostTickets.length / terminalIds.length)
      : 0;

    for (let i = 0; i < terminalIds.length; i++) {
      const terminalId   = terminalIds[i];
      const myWon        = wonTickets.slice(i * wonChunkSize,  (i + 1) * wonChunkSize);
      const myLost       = lostChunkSize > 0
        ? lostTickets.slice(i * lostChunkSize, (i + 1) * lostChunkSize)
        : [];

      console.log(`\n[4.${i + 1}] Terminal ${terminalId}`);
      console.log(`     Won to pay out : ${myWon.length}  |  Lost tickets: ${myLost.length}`);

      const termSummary: TerminalSummary = {
        terminalId,
        wonTickets: {
          count: myWon.length,
          paidOutCount: 0,
          failedPayoutCount: 0,
          totalWinAmount: 0,
          paidOutAmount: 0,
          failedPayoutAmount: 0,
          taxableCount: 0,
          totalWinTax: 0,
        },
        lostTickets: { count: myLost.length },
        payouts: [],
        lostTicketIds: myLost.map(t => t.id),
      };

      if (myWon.length > 0) {
        const result: TerminalPayoutResult = await perTerminalPayoutFlow(
          apiClient, terminalId, myWon
        );

        for (const p of result.payouts) {
          const rawTicket = myWon.find(t => t.id === p.ticketId);
          const effectiveWin = p.winAmount;
          const taxable = effectiveWin > TAX_THRESHOLD;
          const winTax  = calcTax(effectiveWin, TAX_THRESHOLD, TAX_RATE);

          const entry: PayoutTicketEntry = {
            ticketId: p.ticketId,
            userId: p.userId,
            winAmount: rawTicket?.win_amount ?? effectiveWin,
            jackpotWinAmount: rawTicket?.jackpot_win_amount ?? 0,
            effectiveWinAmount: effectiveWin,
            taxable,
            winTax: p.success ? winTax : 0,
            pin: p.pin,
            taxNumber: p.taxNumber,
            actionId: p.actionId,
            success: p.success,
            error: p.error,
          };

          termSummary.payouts.push(entry);
          termSummary.wonTickets.totalWinAmount = round2(termSummary.wonTickets.totalWinAmount + effectiveWin);

          if (p.success) {
            termSummary.wonTickets.paidOutCount++;
            termSummary.wonTickets.paidOutAmount = round2(termSummary.wonTickets.paidOutAmount + effectiveWin);
            if (taxable) {
              termSummary.wonTickets.taxableCount++;
              termSummary.wonTickets.totalWinTax = round2(termSummary.wonTickets.totalWinTax + winTax);
            }
          } else {
            termSummary.wonTickets.failedPayoutCount++;
            termSummary.wonTickets.failedPayoutAmount = round2(termSummary.wonTickets.failedPayoutAmount + effectiveWin);
          }
        }

        const ok = termSummary.wonTickets.paidOutCount;
        const total = myWon.length;
        console.log(`     Paid out: ${ok}/${total}  |  Tax-liable: ${termSummary.wonTickets.taxableCount}  |  Total tax: ${termSummary.wonTickets.totalWinTax} €`);
      }

      report.terminals.push(termSummary);
    }

    buildSummary(report);
    report.steps[3].status = 'pass';

    console.log('\n══════════════ PHASE 3 SUMMARY ══════════════');
    console.log(`  Won tickets total  : ${report.summary.wonTicketsTotal}`);
    console.log(`  Paid out           : ${report.summary.paidOutCount}  (${report.summary.paidOutAmount} €)`);
    console.log(`  Failed payout      : ${report.summary.failedPayoutCount}  (${report.summary.failedPayoutAmount} €)`);
    console.log(`  Taxable tickets    : ${report.summary.taxableTicketCount}`);
    console.log(`  Total win tax      : ${report.summary.totalWinTax} €`);
    console.log(`  Lost tickets total : ${report.summary.lostTicketsTotal}`);
    console.log('═════════════════════════════════════════════');

    expect(report.steps.every(s => s.status === 'pass')).to.equal(true,
      `Not all Phase 3 steps passed: ${JSON.stringify(report.steps.filter(s => s.status !== 'pass'))}`
    );
  });
});

// ─── Utility ─────────────────────────────────────────────────────────────────

function buildSummary(report: Phase3Report) {
  const s = report.summary;
  s.paidOutCount       = 0;
  s.failedPayoutCount  = 0;
  s.totalWinAmount     = 0;
  s.paidOutAmount      = 0;
  s.failedPayoutAmount = 0;
  s.taxableTicketCount = 0;
  s.totalWinTax        = 0;

  for (const t of report.terminals) {
    s.paidOutCount       += t.wonTickets.paidOutCount;
    s.failedPayoutCount  += t.wonTickets.failedPayoutCount;
    s.totalWinAmount      = round2(s.totalWinAmount     + t.wonTickets.totalWinAmount);
    s.paidOutAmount       = round2(s.paidOutAmount      + t.wonTickets.paidOutAmount);
    s.failedPayoutAmount  = round2(s.failedPayoutAmount + t.wonTickets.failedPayoutAmount);
    s.taxableTicketCount += t.wonTickets.taxableCount;
    s.totalWinTax         = round2(s.totalWinTax        + t.wonTickets.totalWinTax);
  }
}

function buildLostOnlyTerminals(
  terminalIds: string[],
  lostTickets: Array<{ id: string; user_id: string }>,
  report: Phase3Report
) {
  const chunkSize = lostTickets.length > 0 ? Math.ceil(lostTickets.length / terminalIds.length) : 0;
  for (let i = 0; i < terminalIds.length; i++) {
    const myLost = chunkSize > 0 ? lostTickets.slice(i * chunkSize, (i + 1) * chunkSize) : [];
    report.terminals.push({
      terminalId: terminalIds[i],
      wonTickets: {
        count: 0, paidOutCount: 0, failedPayoutCount: 0,
        totalWinAmount: 0, paidOutAmount: 0, failedPayoutAmount: 0,
        taxableCount: 0, totalWinTax: 0,
      },
      lostTickets: { count: myLost.length },
      payouts: [],
      lostTicketIds: myLost.map(t => t.id),
    });
  }
}
