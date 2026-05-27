import { test, expect } from '../../fixtures/api.fixture';
import { saveTestData } from '../../helpers/testContext';
import { generateFranchiseName } from '../../helpers/dataFactory';
import dbClient from '../../helpers/dbClient';
import { ApiClient } from '../../helpers/apiClient';
import { request as pwRequest } from '@playwright/test';
import { config } from '../../config/env';
import * as fs from 'fs';
import * as path from 'path';

type CostCenter = {
  costCenterId: string;
  name: string;
  code: string;
};

type StepStatus = 'pass' | 'fail' | 'pending';

type RunData = {
  franchiseId?: string;
  franchiseName?: string;
  raceOfferGroupId?: string;
  bingoOfferGroupId?: string;
  costCenters?: CostCenter[];
  terminals?: string[];
  betshops?: string[];
  steps: { step: number; label: string; status: StepStatus }[];
};

function writeReport(data: RunData) {
  if (!data.franchiseId) return;
  try {
    const report = {
      runAt: new Date().toISOString(),
      franchise: { id: data.franchiseId, name: data.franchiseName ?? '' },
      offerGroups: {
        race: { id: data.raceOfferGroupId ?? '', name: `${data.franchiseName ?? ''} Race` },
        bingo: { id: data.bingoOfferGroupId ?? '', name: `${data.franchiseName ?? ''} Bingo` },
      },
      costCenters: (data.costCenters ?? []).map((cc, i) => ({
        id: cc.costCenterId,
        name: cc.name,
        code: cc.code,
        terminal: data.terminals?.[i] ?? '',
        betshop: data.betshops?.[i] ?? '',
      })),
      steps: data.steps,
    };
    const reportDir = path.resolve(__dirname, '../../test-results');
    fs.mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, 'phase1-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n[report] Written to ${reportPath}`);
  } catch (e: any) {
    console.warn(`[report] Failed to write JSON report: ${e?.message ?? e}`);
  }
}

test.describe('Phase 1 - Complete Setup', () => {
  const skipCleanup = process.env.SKIP_PHASE1_CLEANUP === '1' || process.env.SKIP_PHASE1_CLEANUP === 'true';

  const run: RunData = {
    steps: [
      { step: 1, label: 'Franchise created',              status: 'pending' },
      { step: 2, label: 'Offer Groups created',            status: 'pending' },
      { step: 3, label: 'Cost Centers created (5)',        status: 'pending' },
      { step: 4, label: 'Locations linked to Offer Groups',status: 'pending' },
      { step: 5, label: 'Terminals & Betshops created',    status: 'pending' },
    ],
  };

  test.afterAll(async () => {
    // Always write the report first (captures whatever succeeded before any failure)
    writeReport(run);

    if (skipCleanup) {
      console.log('\n[cleanup] SKIP_PHASE1_CLEANUP set — leaving staging records intact');
      return;
    }
    if (!run.franchiseId) {
      console.log('\n[cleanup] No franchise was created — nothing to clean up');
      return;
    }

    console.log('\n========== PHASE 1 CLEANUP ==========');
    console.log(`[cleanup] Tearing down franchise ${run.franchiseId}`);

    try {
      const context = await pwRequest.newContext({ baseURL: config.baseUrl });
      const client = new ApiClient(context);
      await client.login();
      if (run.raceOfferGroupId) {
        await client.deleteOfferGroup(run.raceOfferGroupId, false);
      }
      if (run.bingoOfferGroupId) {
        await client.deleteOfferGroup(run.bingoOfferGroupId, true);
      }
      await context.dispose();
    } catch (e: any) {
      console.warn(`[cleanup] OfferGroup API teardown skipped: ${e?.message ?? e}`);
    }

    // Reliable DB-level cleanup of offer groups across discovered schemas (race + bingo).
    // Runs regardless of whether the best-effort API delete above succeeded, so a re-run of
    // Phase 1 leaves no orphan offer groups behind.
    await dbClient.cleanupOfferGroupsByFranchise(run.franchiseId);
    await dbClient.verifyOfferGroupsRemoved(run.franchiseId);

    // Reliable DB soft-delete keyed by franchise id (terminals → cost centers → franchise)
    await dbClient.cleanupByFranchise(run.franchiseId);
    console.log('========== CLEANUP COMPLETE ==========\n');
  });

  test('should execute full Phase 1 setup successfully', async ({ apiClient }) => {
    console.log('\n========== PHASE 1 SETUP ==========');

    // ── 1. FRANCHISE ──────────────────────────────────────────────────
    const franchiseName = generateFranchiseName();
    const { franchiseId } = await apiClient.createFranchise(franchiseName);
    run.franchiseId = franchiseId;
    run.franchiseName = franchiseName;
    await apiClient.verifyFranchise(franchiseId);
    await dbClient.verifyFranchise(franchiseId);
    saveTestData({ franchiseId, franchiseName });
    run.steps[0].status = 'pass';
    console.log(`\n[1] Franchise: ${franchiseName} (${franchiseId})`);

    // ── 2. OFFER GROUPS ───────────────────────────────────────────────
    console.log('\n[2] Creating Offer Groups...');
    const raceOfferGroupId = await apiClient.createOfferGroup(franchiseId, franchiseName, false);
    run.raceOfferGroupId = raceOfferGroupId;
    const bingoOfferGroupId = await apiClient.createOfferGroup(franchiseId, franchiseName, true);
    run.bingoOfferGroupId = bingoOfferGroupId;
    saveTestData({ raceOfferGroupId, bingoOfferGroupId });
    await dbClient.verifyOfferGroup(raceOfferGroupId, 'Race');
    await dbClient.verifyOfferGroup(bingoOfferGroupId, 'Bingo');
    run.steps[1].status = 'pass';
    console.log(`    Race  OfferGroup: ${raceOfferGroupId}`);
    console.log(`    Bingo OfferGroup: ${bingoOfferGroupId}`);

    // ── 3. COST CENTERS ───────────────────────────────────────────────
    console.log('\n[3] Creating 5 Cost Centers...');
    const costCenters: CostCenter[] = await apiClient.createMultipleCostCenters(franchiseId, franchiseName, 5);
    expect(costCenters).toHaveLength(5);
    run.costCenters = costCenters;
    saveTestData({
      costCenters,
      costCenterIds: costCenters.map((cc) => cc.costCenterId),
      costCenterNames: costCenters.map((cc) => cc.name),
    });
    await dbClient.verifyCostCenterIds(costCenters.map((cc) => cc.costCenterId), franchiseId);
    await dbClient.verifyCostCentersByFranchise(franchiseId, costCenters.length);
    run.steps[2].status = 'pass';
    costCenters.forEach((cc, i) => {
      console.log(`    [CC${i + 1}] ${cc.name} (${cc.costCenterId})`);
    });

    // ── 4. ADD LOCATIONS TO OFFER GROUPS ──────────────────────────────
    console.log('\n[4] Linking Cost Centers → Offer Groups...');
    for (const cc of costCenters) {
      await apiClient.addLocationToOfferGroup(raceOfferGroupId, cc.costCenterId, cc.name, false);
      await apiClient.addLocationToOfferGroup(bingoOfferGroupId, cc.costCenterId, cc.name, true);
    }
    run.steps[3].status = 'pass';
    console.log(`    ${costCenters.length * 2} locations linked (${costCenters.length} race + ${costCenters.length} bingo)`);

    // ── 5. TERMINALS & BETSHOPS ────────────────────────────────────────
    console.log('\n[5] Creating Terminals & Betshops (1 each per CC)...');
    const terminals: string[] = [];
    const betshops: string[] = [];

    for (const cc of costCenters) {
      const terminalId = await apiClient.createTerminal(cc.costCenterId);
      expect(terminalId).toBeTruthy();
      await apiClient.setCashPayoutOption(terminalId);
      terminals.push(terminalId);

      const betshopId = await apiClient.createBetshop(cc.costCenterId);
      expect(betshopId).toBeTruthy();
      await apiClient.setCashPayoutOption(betshopId);
      betshops.push(betshopId);

      await new Promise((r) => setTimeout(r, 200));
    }

    run.terminals = terminals;
    run.betshops = betshops;
    saveTestData({ terminals, betshops });

    const ccIds = costCenters.map((cc) => cc.costCenterId);
    await dbClient.verifyTerminalIds(terminals, 'Terminal');
    await dbClient.verifyTerminalIds(betshops, 'Betshop');
    const dbTerminals = await dbClient.verifyTerminalsByFranchise(ccIds, 'Terminal', terminals.length);
    const dbBetshops = await dbClient.verifyTerminalsByFranchise(ccIds, 'Betshop', betshops.length);
    await dbClient.verifyCashPayoutEnabled([...terminals, ...betshops]);
    run.steps[4].status = 'pass';

    terminals.forEach((id, i) => console.log(`    Terminal [${i + 1}]: ${id}`));
    betshops.forEach((id, i) => console.log(`    Betshop  [${i + 1}]: ${id}`));

    // ── SUMMARY ───────────────────────────────────────────────────────
    console.log('\n========== PHASE 1 COMPLETE ==========');
    console.log(`Franchise  : ${franchiseName}`);
    console.log(`Cost Centers: ${costCenters.length}`);
    console.log(`Terminals  : ${terminals.length} (DB: ${dbTerminals.length || 'skipped'})`);
    console.log(`Betshops   : ${betshops.length} (DB: ${dbBetshops.length || 'skipped'})`);
    console.log(`Race OG    : ${raceOfferGroupId}`);
    console.log(`Bingo OG   : ${bingoOfferGroupId}`);
    console.log('======================================\n');
  });

});
