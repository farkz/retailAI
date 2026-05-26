import { test } from '../../fixtures/api.fixture';
import { saveTestData } from '../../helpers/testContext';
import { generateFranchiseName } from '../../helpers/dataFactory';
import dbClient from '../../helpers/dbClient';

type CostCenter = {
  costCenterId: string;
  name: string;
  code: string;
};

test.describe('Phase 1 - Complete Setup', () => {

  test('should execute full Phase 1 setup successfully', async ({ apiClient }) => {
    console.log('Starting Phase 1 Complete Setup...');

    // 1. Create Franchise
    const franchiseName = generateFranchiseName();
    const { franchiseId } = await apiClient.createFranchise(franchiseName);

    await apiClient.verifyFranchise(franchiseId);
    if (process.env.DATABASE_URL) {
      await dbClient.verifyFranchise(franchiseId);
    }

    saveTestData({ franchiseId, franchiseName });

    // 2. Offer Groups
    await apiClient.createOfferGroup(franchiseId, franchiseName, false); // Race
    await apiClient.createOfferGroup(franchiseId, franchiseName, true);  // Bingo

    // 3. Cost Centers
    const costCenters: CostCenter[] = await apiClient.createMultipleCostCenters(franchiseId, franchiseName, 5);

    saveTestData({
      costCenters,
      costCenterIds: costCenters.map((cc) => cc.costCenterId),
      costCenterNames: costCenters.map((cc) => cc.name),
    });

    // 4. Terminals + Betshops
    const { terminals, betshops } = await apiClient.createTerminalsAndBetshops();

    console.log('PHASE 1 COMPLETED SUCCESSFULLY!');
    console.log(`Franchise: ${franchiseName}`);
    console.log(`Cost Centers: ${costCenters.length} | Terminals: ${terminals.length} | Betshops: ${betshops.length}`);
  });
});
