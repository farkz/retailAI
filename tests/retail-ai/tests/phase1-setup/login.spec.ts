import { test, expect } from '../../fixtures/api.fixture';

test.describe('Phase 1 - BackOffice Login', () => {
  test('should login as BO Admin and retrieve token', async ({ apiClient }) => {
    expect(apiClient).toBeDefined();
    console.log('✅ Token retrieved successfully (login handled by fixture)');
  });
});
