export interface TestData {
  franchiseId?: string;
  franchiseName?: string;
  costCenters?: Array<{ costCenterId: string; name: string; code: string }>;
  costCenterIds?: string[];
  costCenterNames?: string[];
  terminals?: string[];
  betshops?: string[];
  allTerminalIds?: string[];
  allBetshopIds?: string[];
  bingoOfferGroupId?: string;
}

export let testData: TestData = {};

export const saveTestData = (data: Partial<TestData>): void => {
  Object.assign(testData, data);
  console.log('💾 Test data updated:', Object.keys(data));
};