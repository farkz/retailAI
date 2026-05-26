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

type CreatedRunArtifacts = {
  franchiseId?: string;
  raceOfferGroupId?: string;
  bingoOfferGroupId?: string;
};

test.describe('Phase 1 - Complete Setup', () => {
  const created: CreatedRunArtifacts = {};
  const skipCleanup = process.env.SKIP_PHASE1_CLEANUP === '1' || process.env.SKIP_PHASE1_CLEANUP === 'true';

  test.afterAll(async () => {
    if (skipCleanup) {
      console.log('\n[cleanup] SKIP_PHASE1_CLEANUP set — leaving staging records intact');
      return;
    }
    if (!created.franchiseId) {
      console.log('\n[cleanup] No franchise was created — nothing to clean up');
      return;
    }

    console.log('\n========== PHASE 1 CLEANUP ==========');
    console.log(`[cleanup] Tearing down franchise ${created.franchiseId}`);

    // Best-effort API delete for offer groups (they live in separate services)
    try {
      const context = await pwRequest.newContext({ baseURL: config.baseUrl });
      const client = new ApiClient(context);
      await client.login();
      if (created.raceOfferGroupId) {
        await client.deleteOfferGroup(created.raceOfferGroupId, false);
      }
      if (created.bingoOfferGroupId) {
        await client.deleteOfferGroup(created.bingoOfferGroupId, true);
      }
      await context.dispose();
    } catch (e: any) {
      console.warn(`[cleanup] OfferGroup API teardown skipped: ${e?.message ?? e}`);
    }

    // Reliable DB soft-delete keyed by franchise id (terminals → cost centers → franchise)
    await dbClient.cleanupByFranchise(created.franchiseId);
    console.log('========== CLEANUP COMPLETE ==========\n');
  });

  test('should execute full Phase 1 setup successfully', async ({ apiClient }) => {
    console.log('\n========== PHASE 1 SETUP ==========');

    // ── 1. FRANCHISE ──────────────────────────────────────────────────
    const franchiseName = generateFranchiseName();
    const { franchiseId } = await apiClient.createFranchise(franchiseName);
    created.franchiseId = franchiseId;
    await apiClient.verifyFranchise(franchiseId);
    await dbClient.verifyFranchise(franchiseId);
    saveTestData({ franchiseId, franchiseName });
    console.log(`\n[1] Franchise: ${franchiseName} (${franchiseId})`);

    // ── 2. OFFER GROUPS ───────────────────────────────────────────────
    console.log('\n[2] Creating Offer Groups...');
    const raceOfferGroupId = await apiClient.createOfferGroup(franchiseId, franchiseName, false);
    created.raceOfferGroupId = raceOfferGroupId;
    const bingoOfferGroupId = await apiClient.createOfferGroup(franchiseId, franchiseName, true);
    created.bingoOfferGroupId = bingoOfferGroupId;
    saveTestData({ raceOfferGroupId, bingoOfferGroupId });
    console.log(`    Race  OfferGroup: ${raceOfferGroupId}`);
    console.log(`    Bingo OfferGroup: ${bingoOfferGroupId}`);

    // Best-effort DB verification (offer groups may live in a separate service DB).
    // If the table exists in the connected DB, the assertion is strict; otherwise it warns once and is skipped.
    await dbClient.verifyOfferGroup(raceOfferGroupId, 'Race');
    await dbClient.verifyOfferGroup(bingoOfferGroupId, 'Bingo');

    // ── 3. COST CENTERS ───────────────────────────────────────────────
    console.log('\n[3] Creating 5 Cost Centers...');
    const costCenters: CostCenter[] = await apiClient.createMultipleCostCenters(franchiseId, franchiseName, 5);
    expect(costCenters).toHaveLength(5);
    saveTestData({
      costCenters,
      costCenterIds: costCenters.map((cc) => cc.costCenterId),
      costCenterNames: costCenters.map((cc) => cc.name),
    });
    costCenters.forEach((cc, i) => {
      console.log(`    [CC${i + 1}] ${cc.name} (${cc.costCenterId})`);
    });

    // Strict DB cross-check: every CC must exist and be linked to this franchise
    await dbClient.verifyCostCenterIds(
      costCenters.map((cc) => cc.costCenterId),
      franchiseId
    );
    await dbClient.verifyCostCentersByFranchise(franchiseId, costCenters.length);

    // ── 4. ADD LOCATIONS TO OFFER GROUPS ──────────────────────────────
    console.log('\n[4] Linking Cost Centers → Offer Groups...');
    for (const cc of costCenters) {
      await apiClient.addLocationToOfferGroup(raceOfferGroupId, cc.costCenterId, cc.name, false);
      await apiClient.addLocationToOfferGroup(bingoOfferGroupId, cc.costCenterId, cc.name, true);
    }
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

    saveTestData({ terminals, betshops });

    // Strict DB cross-check: every created id exists with correct client_type,
    // counts per cost-center match, and the cash payout flag is enabled.
    const ccIds = costCenters.map((cc) => cc.costCenterId);
    await dbClient.verifyTerminalIds(terminals, 'Terminal');
    await dbClient.verifyTerminalIds(betshops, 'Betshop');
    const dbTerminals = await dbClient.verifyTerminalsByFranchise(ccIds, 'Terminal', terminals.length);
    const dbBetshops = await dbClient.verifyTerminalsByFranchise(ccIds, 'Betshop', betshops.length);
    await dbClient.verifyCashPayoutEnabled([...terminals, ...betshops]);

    terminals.forEach((id, i) => console.log(`    Terminal [${i + 1}]: ${id}`));
    betshops.forEach((id, i) => console.log(`    Betshop  [${i + 1}]: ${id}`));

    // ── JSON REPORT ───────────────────────────────────────────────────
    const report = {
      runAt: new Date().toISOString(),
      franchise: { id: franchiseId, name: franchiseName },
      offerGroups: {
        race: { id: raceOfferGroupId, name: `${franchiseName} Race` },
        bingo: { id: bingoOfferGroupId, name: `${franchiseName} Bingo` },
      },
      costCenters: costCenters.map((cc) => ({
        id: cc.costCenterId,
        name: cc.name,
        code: cc.code,
        terminal: terminals[costCenters.indexOf(cc)],
        betshop: betshops[costCenters.indexOf(cc)],
      })),
      steps: [
        { step: 1, label: 'Franchise created', status: 'pass' },
        { step: 2, label: 'Offer Groups created', status: 'pass' },
        { step: 3, label: 'Cost Centers created (5)', status: 'pass' },
        { step: 4, label: 'Locations linked to Offer Groups', status: 'pass' },
        { step: 5, label: 'Terminals & Betshops created', status: 'pass' },
      ],
    };
    const reportDir = path.resolve(__dirname, '../../test-results');
    fs.mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, 'phase1-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n[report] Written to ${reportPath}`);

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
