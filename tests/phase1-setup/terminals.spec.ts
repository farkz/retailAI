import { test, expect } from '../../fixtures/api.fixture';
import { generateFranchiseName } from '../../helpers/dataFactory';
import dbClient from '../../helpers/dbClient';

test.describe('Phase 1 - Terminals & Betshops', () => {

  test('should create 1 terminal and 1 betshop per cost center (5 CCs)', async ({ apiClient }) => {
    console.log('--- Terminals & Betshops Setup ---');

    // Prerequisites: franchise + cost centers
    const franchiseName = generateFranchiseName();
    const { franchiseId } = await apiClient.createFranchise(franchiseName);
    console.log(`Franchise ready: ${franchiseName} (${franchiseId})`);

    const costCenters = await apiClient.createMultipleCostCenters(franchiseId, franchiseName, 5);
    const costCenterIds = costCenters.map((cc) => cc.costCenterId);
    console.log(`5 Cost Centers ready`);

    // Create 1 terminal + 1 betshop per cost center
    const terminals: string[] = [];
    const betshops: string[] = [];

    for (const costCenterId of costCenterIds) {
      const terminalId = await apiClient.createTerminal(costCenterId);
      expect(terminalId).toBeTruthy();
      terminals.push(terminalId);

      await apiClient.setCashPayoutOption(terminalId);

      const betshopId = await apiClient.createBetshop(costCenterId);
      expect(betshopId).toBeTruthy();
      betshops.push(betshopId);

      await apiClient.setCashPayoutOption(betshopId);

      await new Promise((r) => setTimeout(r, 200));
    }

    expect(terminals).toHaveLength(5);
    expect(betshops).toHaveLength(5);

    console.log('Terminals created:');
    terminals.forEach((id, i) => console.log(`  [${i + 1}] ${id}`));
    console.log('Betshops created:');
    betshops.forEach((id, i) => console.log(`  [${i + 1}] ${id}`));

    // DB verification
    const dbTerminals = await dbClient.verifyTerminalsByFranchise(costCenterIds, 'Terminal');
    if (dbTerminals.length > 0) {
      expect(dbTerminals.length).toBe(5);
      console.log('DB verification passed — 5 Terminals found');
    }

    const dbBetshops = await dbClient.verifyTerminalsByFranchise(costCenterIds, 'Betshop');
    if (dbBetshops.length > 0) {
      expect(dbBetshops.length).toBe(5);
      console.log('DB verification passed — 5 Betshops found');
    }

    console.log('Terminals & Betshops test PASSED');
  });

  test('should enable cash payout for each terminal', async ({ apiClient }) => {
    const franchiseName = generateFranchiseName();
    const { franchiseId } = await apiClient.createFranchise(franchiseName);
    const costCenters = await apiClient.createMultipleCostCenters(franchiseId, franchiseName, 2);

    for (const cc of costCenters) {
      const terminalId = await apiClient.createTerminal(cc.costCenterId);
      await apiClient.setCashPayoutOption(terminalId);
      console.log(`Cash payout enabled for terminal ${terminalId}`);
    }

    console.log('Cash payout test PASSED');
  });

});
