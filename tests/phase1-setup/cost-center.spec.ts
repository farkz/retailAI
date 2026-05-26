import { test, expect } from '../../fixtures/api.fixture';
import { generateFranchiseName } from '../../helpers/dataFactory';
import dbClient from '../../helpers/dbClient';

test.describe('Phase 1 - Cost Centers', () => {

  test('should create 5 cost centers for a franchise', async ({ apiClient }) => {
    console.log('--- Cost Center Setup ---');

    // Prerequisites: franchise
    const franchiseName = generateFranchiseName();
    const { franchiseId } = await apiClient.createFranchise(franchiseName);
    console.log(`Franchise ready: ${franchiseName} (${franchiseId})`);

    // Create 5 cost centers
    const costCenters = await apiClient.createMultipleCostCenters(franchiseId, franchiseName, 5);

    expect(costCenters).toHaveLength(5);
    for (const cc of costCenters) {
      expect(cc.costCenterId).toBeTruthy();
      expect(cc.name).toContain(franchiseName);
      expect(cc.code).toBeTruthy();
    }

    console.log('Cost Centers created:');
    costCenters.forEach((cc, i) => {
      console.log(`  [${i + 1}] ${cc.name} | id: ${cc.costCenterId} | code: ${cc.code}`);
    });

    // DB verification
    const dbRows = await dbClient.verifyCostCentersByFranchise(franchiseId);
    if (dbRows.length > 0) {
      expect(dbRows.length).toBe(5);
      console.log('DB verification passed — 5 cost centers found');
    }

    console.log('Cost Center test PASSED');
  });

  test('should reject cost center with duplicate code', async ({ apiClient }) => {
    const franchiseName = generateFranchiseName();
    const { franchiseId } = await apiClient.createFranchise(franchiseName);

    // Create first cost center and capture its code
    const first = await apiClient.createCostCenter(franchiseId, franchiseName);
    console.log(`First CC created with code: ${first.code}`);

    // Attempt to create a second one with the same code — expect API to reject
    let errorThrown = false;
    try {
      await apiClient.createCostCenterWithCode(franchiseId, franchiseName, first.code);
    } catch (e: any) {
      errorThrown = true;
      console.log(`Duplicate code correctly rejected: ${e.message}`);
    }

    expect(errorThrown).toBe(true);
  });

});
