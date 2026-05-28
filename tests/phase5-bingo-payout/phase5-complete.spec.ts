import { expect } from 'chai';
import { request } from '@playwright/test';
import { ApiClient } from '../../helpers/apiClient';
import dbClient from '../../helpers/dbClient';
import { perTerminalBingoPayoutFlow } from '../../helpers/bingoPayoutHelper';
import { calcTax, round2 } from '../../helpers/taxUtils';
import { config } from '../../config/env';
import * as fs from 'fs';
import * as path from 'path';

// ─── File paths (mirror Phase 3 convention) ───────────────────────────────────

const PHASE1_REPORT_PATH = path.resolve(__dirname, '../../test-results/phase1-report.json');
const PHASE5_REPORT_DIR  = path.resolve(__dirname, '../../test-results');
const PHASE5_REPORT_PATH = path.join(PHASE5_REPORT_DIR, 'phase5-report.json');

// ─── Report types ────────────────────────────────────────────────────────────

interface PayoutTicketEntry {
  ticketId: string;
  userId: string;
  payinAmount: number;
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
  lostTickets: { count: number };
  payouts: PayoutTicketEntry[];
  lostTicketIds: string[];
}

interface Phase5Summary {
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

interface WinTaxCategory {
  amount: number;
  percentage: number;
}

interface Phase5Report {
  runAt: string;
  franchiseId: string;
  winTaxCategories: WinTaxCategory[];
  summary: Phase5Summary;
  terminals: TerminalSummary[];
  steps: Array<{ step: number; label: string; status: 'pending' | 'pass' | 'fail' }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadPhase1Report(): any {
  if (!fs.existsSync(PHASE1_REPORT_PATH)) {
    throw new Error(
      `Phase 1 report not found at ${PHASE1_REPORT_PATH}. Run Phase 1 tests first: npm run test:phase1`
    );
  }
  const raw = JSON.parse(fs.readFileSync(PHASE1_REPORT_PATH, 'utf-8'));
  console.log(`[Phase5] Loaded Phase 1 report from: ${PHASE1_REPORT_PATH}`);
  return raw;
}

function writeReport(report: Phase5Report): void {
  try {
    fs.mkdirSync(PHASE5_REPORT_DIR, { recursive: true });
    fs.writeFileSync(PHASE5_REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`\n[report] Written to ${PHASE5_REPORT_PATH}`);
  } catch (e: any) {
    console.error(`[report] Failed to write report: ${e?.message ?? e}`);
  }
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TAX_CATEGORIES: WinTaxCategory[] = config.phase3.winTaxCategories;
const IS_DEDUCTIBLE = config.phase3.isWinTaxPayinDeductible;

// ─── Test suite ──────────────────────────────────────────────────────────────

describe('Phase 5 – Terminal Virtual Bingo Payout', function () {
  this.timeout(600_000);

  let requestContext: any;
  let apiClient: ApiClient;

  const report: Phase5Report = {
    runAt: new Date().toISOString(),
    franchiseId: '',
    winTaxCategories: TAX_CATEGORIES,
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
      { step: 1, label: 'Load Phase 1 report',          status: 'pending' },
      { step: 2, label: 'BO login',                     status: 'pending' },
      { step: 3, label: 'Query bingo tickets from DB',  status: 'pending' },
      { step: 4, label: 'Per-terminal bingo payout',    status: 'pending' },
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

  it('should execute full Phase 5 bingo payout flow for all terminals', async function () {
    console.log('\n========== PHASE 5 BINGO PAYOUT ==========');
    console.log(`Win tax (progressive): ${TAX_CATEGORIES.map(c => `${c.percentage}% above ${c.amount} €`).join(', ')}`);
    console.log(`Tax base: ${IS_DEDUCTIBLE ? 'win − payin (net win)' : 'gross win'}`);

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
    console.log('[2] BO login OK');

    // ── 3. QUERY BINGO TICKETS FROM DB ───────────────────────────
    const [wonTickets, lostTickets] = await Promise.all([
      dbClient.getWonBingoTicketsByFranchise(franchiseId),
      dbClient.getLostBingoTicketsByFranchise(franchiseId),
    ]);

    report.summary.wonTicketsTotal  = wonTickets.length;
    report.summary.lostTicketsTotal = lostTickets.length;
    report.steps[2].status = 'pass';
    console.log(`[3] Won bingo tickets: ${wonTickets.length}  |  Lost: ${lostTickets.length}`);

    if (wonTickets.length === 0) {
      console.log('[3] No won bingo tickets to pay out — Phase 5 complete (nothing to do)');
      report.steps[3].status = 'pass';
      buildLostOnlyTerminals(terminalIds, lostTickets, report);
      buildSummary(report);
      return;
    }

    // ── 4. PER-TERMINAL BINGO PAYOUT FLOW ────────────────────────
    const wonChunkSize  = Math.ceil(wonTickets.length / terminalIds.length);
    const lostChunkSize = lostTickets.length > 0
      ? Math.ceil(lostTickets.length / terminalIds.length)
      : 0;

    for (let i = 0; i < terminalIds.length; i++) {
      const terminalId = terminalIds[i];
      const myWon      = wonTickets.slice(i * wonChunkSize,  (i + 1) * wonChunkSize);
      const myLost     = lostChunkSize > 0
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
        const result = await perTerminalBingoPayoutFlow(apiClient, terminalId, myWon);

        for (const p of result.payouts) {
          const rawTicket    = myWon.find(t => t.id === p.ticketId);
          const effectiveWin = p.winAmount;
          const payinAmount  = p.payinAmount;
          const winTax       = calcTax(effectiveWin, payinAmount, TAX_CATEGORIES, IS_DEDUCTIBLE);
          const taxable      = winTax > 0;

          const entry: PayoutTicketEntry = {
            ticketId: p.ticketId,
            userId: p.userId,
            payinAmount,
            winAmount:           rawTicket?.win_amount ?? effectiveWin,
            jackpotWinAmount:    rawTicket?.jackpot_win_amount ?? 0,
            effectiveWinAmount:  effectiveWin,
            taxable,
            winTax:   p.success ? winTax : 0,
            pin:      p.pin,
            taxNumber: p.taxNumber,
            actionId: p.actionId,
            success:  p.success,
            error:    p.error,
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

        const ok    = termSummary.wonTickets.paidOutCount;
        const total = myWon.length;
        console.log(`     Paid out: ${ok}/${total}  |  Tax-liable: ${termSummary.wonTickets.taxableCount}  |  Total tax: ${termSummary.wonTickets.totalWinTax} €`);
      }

      report.terminals.push(termSummary);
    }

    buildSummary(report);
    report.steps[3].status = 'pass';

    console.log('\n══════════════ PHASE 5 SUMMARY ══════════════');
    console.log(`  Won bingo tickets  : ${report.summary.wonTicketsTotal}`);
    console.log(`  Paid out           : ${report.summary.paidOutCount}  (${report.summary.paidOutAmount} €)`);
    console.log(`  Failed payout      : ${report.summary.failedPayoutCount}  (${report.summary.failedPayoutAmount} €)`);
    console.log(`  Taxable tickets    : ${report.summary.taxableTicketCount}`);
    console.log(`  Total win tax      : ${report.summary.totalWinTax} €`);
    console.log(`  Lost tickets total : ${report.summary.lostTicketsTotal}`);
    console.log('═════════════════════════════════════════════');

    expect(report.steps.every(s => s.status === 'pass')).to.equal(true,
      `Not all Phase 5 steps passed: ${JSON.stringify(report.steps.filter(s => s.status !== 'pass'))}`
    );

    if (report.summary.wonTicketsTotal > 0) {
      expect(report.summary.paidOutCount).to.be.above(0,
        `Won tickets were found (${report.summary.wonTicketsTotal}) but zero payouts succeeded. Check Bingo payout API connectivity.`
      );
    }
  });
});

// ─── Utilities ────────────────────────────────────────────────────────────────

function buildSummary(report: Phase5Report): void {
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
  report: Phase5Report
): void {
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
