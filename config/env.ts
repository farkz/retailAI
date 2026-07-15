import dotenv from 'dotenv';

dotenv.config();

export const config = {
  baseUrl: process.env.BASE_URL || 'https://retailapi.stage-xtreme.com',
  userApiUrl: process.env.USER_API_URL || 'https://userapi.stage-xtreme.com',
  virtualRaceApiUrl: process.env.VIRTUAL_RACE_API_URL || 'https://virtualraceintegrationapi.stage-xtreme.com',
  virtualBingoApiUrl: process.env.VIRTUAL_BINGO_API_URL || 'https://virtualbingointegrationapi.stage-xtreme.com',
  virtualRaceDataProviderUrl: process.env.VIRTUAL_RACE_DATA_PROVIDER_URL || 'https://virtualracedataproviderapi-volcano.stage-xtreme.com',
  tenantId: process.env.TENANT_ID || 'your-tenant-id',
  databaseUrl: process.env.DATABASE_URL || '',

  boAdmin: {
    username: process.env.BO_USERNAME || 'ifarkasbo',
    password: process.env.BO_PASSWORD || '123123',
    clientId: '555f642c-6add-41e2-89ca-c02703b5078e',
    clientType: 'BackOfficeConsumer',
  },

  phase2: {
    ticketsPerTerminal: parseInt(process.env.TICKETS_PER_TERMINAL || '1000', 10),
    payinMode: process.env.PAYIN_MODE || 'Standard',
    skipCreditTicket: process.env.SKIP_CREDIT_TICKET !== 'false' && process.env.SKIP_CREDIT_TICKET !== '0',
    skipCleanup: process.env.SKIP_PHASE2_CLEANUP === '1' || process.env.SKIP_PHASE2_CLEANUP === 'true',
  },

  phase3: {
    // Progressive win-tax tiers — matches SaveGroupConfigurations WinTaxCategories.
    // Each tier taxes only its own band (compound). Percentage applied to the band amount.
    winTaxCategories: [
      {
        amount: parseFloat(process.env.WIN_TAX_AMOUNT_1 || '50.01'),
        percentage: parseFloat(process.env.WIN_TAX_PCT_1  || '10'),
      },
      {
        amount: parseFloat(process.env.WIN_TAX_AMOUNT_2 || '1500.01'),
        percentage: parseFloat(process.env.WIN_TAX_PCT_2  || '12'),
      },
    ],
    // When true: tax base = win - payin (net win). When false: tax base = win.
    isWinTaxPayinDeductible: process.env.WIN_TAX_PAYIN_DEDUCTIBLE !== 'false',
  },

  phase4: {
    ticketsPerTerminal: parseInt(process.env.BINGO_TICKETS_PER_TERMINAL || '1000', 10),
    payinMode: process.env.BINGO_PAYIN_MODE || 'Standard',
    skipCleanup: process.env.SKIP_PHASE4_CLEANUP === '1' || process.env.SKIP_PHASE4_CLEANUP === 'true',
    pollTimeoutMs: parseInt(process.env.BINGO_POLL_TIMEOUT_MS || '30000', 10),
  },

  phase5: {
    skipCleanup: process.env.SKIP_PHASE5_CLEANUP === '1' || process.env.SKIP_PHASE5_CLEANUP === 'true',
  },

  phase6: {
    ticketsPerTerminal: parseInt(process.env.SPORT_TICKETS_PER_TERMINAL || '10', 10),
    minBetAmount: parseFloat(process.env.SPORT_MIN_BET || '5'),
    maxBetAmount: parseFloat(process.env.SPORT_MAX_BET || '50'),
    settleStatus: (process.env.SPORT_SETTLE_STATUS || 'Win') as 'Win' | 'Lost',
    defaultCnp: process.env.SPORT_DEFAULT_CNP || '1900921093293',
    pollTimeoutMs: parseInt(process.env.SPORT_POLL_TIMEOUT_MS || '30000', 10),
    pollIntervalMs: parseInt(process.env.SPORT_POLL_INTERVAL_MS || '2000', 10),
    skipCleanup: process.env.SKIP_PHASE6_CLEANUP === '1' || process.env.SKIP_PHASE6_CLEANUP === 'true',
  },

  sportIntegrationApiUrl: process.env.SPORT_INTEGRATION_API_URL || 'https://sportintegrationapi.stage-xtreme.com',
  sportDataProviderUrl: process.env.SPORT_DATA_PROVIDER_URL || 'https://sportdataprovider.dev-xtreme.com',
  sportRiskApiUrl: process.env.SPORT_RISK_API_URL || 'https://sportriskintegrationapi.stage-xtreme.com',
};
