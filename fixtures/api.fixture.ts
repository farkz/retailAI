import { test as base, request } from '@playwright/test';
import { ApiClient } from '../helpers/apiClient';
import { config } from '../config/env';

type Fixtures = {
  apiClient: ApiClient;
};

export const test = base.extend<Fixtures>({
  apiClient: async ({}, use) => {
    const context = await request.newContext({ baseURL: config.baseUrl });
    const client = new ApiClient(context);
    await client.login();
    await use(client);
    await context.dispose();
  },
});

export { expect } from '@playwright/test';
