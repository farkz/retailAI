import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config();

export default defineConfig({
  testDir: '../tests',
  testMatch: '**/*.spec.ts',
  timeout: 180000,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.BASE_URL || 'https://retailapi.stage-xtreme.com',
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
    },
  },
});
