import { test as base, request } from '@playwright/test';
import { ApiClient } from '../helpers/apiClient';
import { config } from '../config/env';

type Fixtures = {
  apiClient: ApiClient;
};

export const test = base.extend<Fixtures>({
  apiClient: async ({}, use) => {
    const requestContext = await request.newContext({
      baseURL: config.baseUrl,
    });
    const client = new ApiClient(requestContext);
    await client.login();
    await use(client);
    await requestContext.dispose();
  },
});

export { expect } from '@playwright/test';
