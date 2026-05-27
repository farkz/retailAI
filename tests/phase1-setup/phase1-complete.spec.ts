import { expect } from 'chai';
import { request as pwRequest } from '@playwright/test';
import { ApiClient } from '../../helpers/apiClient';
import { saveTestData } from '../../helpers/testContext';
import { generateFranchiseName } from '../../helpers/dataFactory';
import dbClient from '../../helpers/dbClient';
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

describe('Phase 1 - Complete Setup', () => {
  const skipCleanup = process.env.SKIP_PHASE1_CLEANUP === '1' || process.env.SKIP_PHASE1_CLEANUP === 'true';

  let apiClient: ApiClient;
  let requestContext: any;

  const run: RunData = {
    steps: [
      { step: 1, label: 'Franchise created',               status: 'pending' },
      { step: 2, label: 'Offer Groups created',             status: 'pending' },
      { step: 3, label: 'Group Configurations saved',       status: 'pending' },
      { step: 4, label: 'Cost Centers created (5)',         status: 'pending' },
      { step: 5, label: 'Locations linked to Offer Groups', status: 'pending' },
      { step: 6, label: 'Terminals & Betshops created',     status: 'pending' },
    ],
  };

  before(async () => {
    requestContext = await pwRequest.newContext({ baseURL: config.baseUrl });
    apiClient = new ApiClient(requestContext);
    await apiClient.login();
    expect(apiClient.getToken(), 'Login must return a non-empty token').to.be.ok;
    expect(apiClient.getBoUserId(), 'Login must return a non-empty user id').to.be.ok;
  });

  after(async () => {
    writeReport(run);

    if (skipCleanup) {
      console.log('\n[cleanup] SKIP_PHASE1_CLEANUP set \u2014 leaving staging records intact');
    } else if (!run.franchiseId) {
      console.log('\n[cleanup] No franchise was created \u2014 nothing to clean up');
    } else {
      console.log('\n========== PHASE 1 CLEANUP ==========');
      console.log(`[cleanup] Tearing down franchise ${run.franchiseId}`);

      try {
        const context = await pwRequest.newContext({ baseURL: config.baseUrl });
        const client = new ApiClient(context);
        await client.login();
        if (run.raceOfferGroupId) await client.deleteOfferGroup(run.raceOfferGroupId, false);
        if (run.bingoOfferGroupId) await client.deleteOfferGroup(run.bingoOfferGroupId, true);
        await context.dispose();
      } catch (e: any) {
        console.warn(`[cleanup] OfferGroup API teardown skipped: ${e?.message ?? e}`);
      }

      await dbClient.cleanupOfferGroupsByFranchise(run.franchiseId);
      await dbClient.verifyOfferGroupsRemoved(run.franchiseId);
      await dbClient.cleanupByFranchise(run.franchiseId);
      console.log('========== CLEANUP COMPLETE ==========\n');
    }

    if (requestContext) await requestContext.dispose();
  });

  it('should execute full Phase 1 setup successfully', async () => {
    console.log('\n========== PHASE 1 SETUP ==========');

    // ── 1. FRANCHISE ─────────────────────────────────────────────────────
    const franchiseName = generateFranchiseName();
    const { franchiseId } = await apiClient.createFranchise(franchiseName);
    expect(franchiseId, 'Franchise creation must return a non-empty id').to.be.ok;
    run.franchiseId = franchiseId;
    run.franchiseName = franchiseName;
    await apiClient.verifyFranchise(franchiseId);
    await dbClient.verifyFranchise(franchiseId);
    saveTestData({ franchiseId, franchiseName });
    run.steps[0].status = 'pass';
    console.log(`\n[1] Franchise: ${franchiseName} (${franchiseId})`);

    // ── 2. OFFER GROUPS ─────────────────────────────────────────────
    console.log('\n[2] Creating Offer Groups...');
    const raceOg = await apiClient.createOfferGroup(franchiseId, franchiseName, false);
    expect(raceOg.id, 'Race OfferGroup creation must return a non-empty id').to.be.ok;
    const raceOfferGroupId = raceOg.id;
    run.raceOfferGroupId = raceOfferGroupId;
    const bingoOg = await apiClient.createOfferGroup(franchiseId, franchiseName, true);
    expect(bingoOg.id, 'Bingo OfferGroup creation must return a non-empty id').to.be.ok;
    const bingoOfferGroupId = bingoOg.id;
    expect(raceOfferGroupId, 'Race and Bingo OfferGroup ids must differ').to.not.equal(bingoOfferGroupId);
    run.bingoOfferGroupId = bingoOfferGroupId;
    saveTestData({ raceOfferGroupId, bingoOfferGroupId });
    await dbClient.verifyOfferGroup(raceOfferGroupId, 'Race');
    await dbClient.verifyOfferGroup(bingoOfferGroupId, 'Bingo');
    run.steps[1].status = 'pass';
    console.log(`    Race  OfferGroup: ${raceOfferGroupId} (numericId=${raceOg.numericId ?? 'unknown'})`);
    console.log(`    Bingo OfferGroup: ${bingoOfferGroupId} (numericId=${bingoOg.numericId ?? 'unknown'})`);

    // ── 3. GROUP CONFIGURATIONS ────────────────────────────────────
    console.log('\n[3] Saving Group Configurations (win tax, payin limits)...');
    await apiClient.saveGroupConfigurations(raceOfferGroupId,  raceOg.numericId,  franchiseId, false);
    await apiClient.saveGroupConfigurations(bingoOfferGroupId, bingoOg.numericId, franchiseId, true);
    run.steps[2].status = 'pass';
    console.log('    Race  configuration saved');
    console.log('    Bingo configuration saved');

    // ── 4. COST CENTERS ───────────────────────────────────────────────
    console.log('\n[4] Creating 5 Cost Centers...');
    const costCenters: CostCenter[] = await apiClient.createMultipleCostCenters(franchiseId, franchiseName, 5);
    expect(costCenters, 'Must create exactly 5 cost centers').to.have.lengthOf(5);
    costCenters.forEach((cc, i) => {
      expect(cc.costCenterId, `CostCenter [${i + 1}] must have a non-empty id`).to.be.ok;
    });
    run.costCenters = costCenters;
    saveTestData({
      costCenters,
      costCenterIds: costCenters.map((cc) => cc.costCenterId),
      costCenterNames: costCenters.map((cc) => cc.name),
    });
    await dbClient.verifyCostCenterIds(costCenters.map((cc) => cc.costCenterId), franchiseId);
    await dbClient.verifyCostCentersByFranchise(franchiseId, costCenters.length);
    run.steps[3].status = 'pass';
    costCenters.forEach((cc, i) => {
      console.log(`    [CC${i + 1}] ${cc.name} (${cc.costCenterId})`);
    });

    // ── 5. ADD LOCATIONS TO OFFER GROUPS ───────────────────────────
    console.log('\n[5] Linking Cost Centers \u2192 Offer Groups...');
    for (const cc of costCenters) {
      await apiClient.addLocationToOfferGroup(raceOfferGroupId, cc.costCenterId, cc.name, false);
      await apiClient.addLocationToOfferGroup(bingoOfferGroupId, cc.costCenterId, cc.name, true);
    }
    run.steps[4].status = 'pass';
    console.log(`    ${costCenters.length * 2} locations linked (${costCenters.length} race + ${costCenters.length} bingo)`);

    // ── 6. TERMINALS & BETSHOPS ───────────────────────────────────────
    console.log('\n[6] Creating Terminals & Betshops (1 each per CC)...');
    const terminals: string[] = [];
    const betshops: string[] = [];

    for (const cc of costCenters) {
      const terminalId = await apiClient.createTerminal(cc.costCenterId);
      expect(terminalId, `Terminal for CC ${cc.costCenterId} must have a non-empty id`).to.be.ok;
      await apiClient.setCashPayoutOption(terminalId);
      terminals.push(terminalId);

      const betshopId = await apiClient.createBetshop(cc.costCenterId);
      expect(betshopId, `Betshop for CC ${cc.costCenterId} must have a non-empty id`).to.be.ok;
      expect(terminalId, `Terminal and Betshop ids for CC ${cc.costCenterId} must differ`).to.not.equal(betshopId);
      await apiClient.setCashPayoutOption(betshopId);
      betshops.push(betshopId);

      await new Promise((r) => setTimeout(r, 200));
    }

    expect(terminals, 'Must create exactly 5 terminals').to.have.lengthOf(5);
    expect(betshops, 'Must create exactly 5 betshops').to.have.lengthOf(5);
    run.terminals = terminals;
    run.betshops = betshops;
    saveTestData({ terminals, betshops });

    const ccIds = costCenters.map((cc) => cc.costCenterId);
    await dbClient.verifyTerminalIds(terminals, 'Terminal');
    await dbClient.verifyTerminalIds(betshops, 'Betshop');
    const dbTerminals = await dbClient.verifyTerminalsByFranchise(ccIds, 'Terminal', terminals.length);
    const dbBetshops = await dbClient.verifyTerminalsByFranchise(ccIds, 'Betshop', betshops.length);
    await dbClient.verifyCashPayoutEnabled([...terminals, ...betshops]);
    run.steps[5].status = 'pass';

    terminals.forEach((id, i) => console.log(`    Terminal [${i + 1}]: ${id}`));
    betshops.forEach((id, i) => console.log(`    Betshop  [${i + 1}]: ${id}`));

    // ── SUMMARY ───────────────────────────────────────────────────────────
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
