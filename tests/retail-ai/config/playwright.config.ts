import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config();

export default defineConfig({
  testDir: '../tests',
  timeout: 180_000,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.BASE_URL || 'https://your-api-domain.com',
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
  },
});
