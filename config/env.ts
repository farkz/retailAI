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
    ticketsPerTerminal: parseInt(process.env.TICKETS_PER_TERMINAL || '100', 10),
    payinMode: process.env.PAYIN_MODE || 'Standard',
    skipCreditTicket: process.env.SKIP_CREDIT_TICKET !== 'false' && process.env.SKIP_CREDIT_TICKET !== '0',
    skipCleanup: process.env.SKIP_PHASE2_CLEANUP === '1' || process.env.SKIP_PHASE2_CLEANUP === 'true',
  },

  phase3: {
    winTaxThreshold: parseFloat(process.env.WIN_TAX_THRESHOLD || '100.01'),
    winTaxRate: parseFloat(process.env.WIN_TAX_RATE || '0.15'),
  },
};
