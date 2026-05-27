import { expect } from 'chai';
import { request } from '@playwright/test';
import { ApiClient } from '../../helpers/apiClient';
import { config } from '../../config/env';

describe('Phase 1 - BackOffice Login', () => {
  let apiClient: ApiClient;
  let requestContext: any;

  before(async () => {
    requestContext = await request.newContext({ baseURL: config.baseUrl });
    apiClient = new ApiClient(requestContext);
    await apiClient.login();
  });

  after(async () => {
    if (requestContext) await requestContext.dispose();
  });

  it('should login as BO Admin and retrieve token', async () => {
    const token = apiClient.getToken();
    const boUserId = apiClient.getBoUserId();

    expect(token).to.be.ok;
    expect(typeof token).to.equal('string');
    expect(boUserId).to.be.ok;

    console.log('Token retrieved successfully');
  });
});
