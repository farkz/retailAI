import { expect } from 'chai';
import { test } from '../fixtures/api.fixture'; // We'll create this next

test.describe('Phase 1 - BackOffice Login', () => {
  test('should login as BO Admin and retrieve token', async ({ apiClient }) => {
    const { token, boUserId } = await apiClient.login();

    expect(token).to.be.a('string').and.to.have.length.greaterThan(10);
    expect(boUserId).to.be.a('string').and.not.empty;

    console.log('Token retrieved successfully');
  });
});