import { test, expect } from '../../fixtures/api.fixture';

test.describe('Phase 1 - BackOffice Login', () => {
  test('should login as BO Admin and retrieve token', async ({ apiClient }) => {
    const token = apiClient.getToken();
    const boUserId = apiClient.getBoUserId();

    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');
    expect(boUserId).toBeTruthy();

    console.log('Token retrieved successfully');
  });
});
