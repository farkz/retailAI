import dotenv from 'dotenv';

dotenv.config();

export const config = {
  baseUrl: process.env.BASE_URL || 'https://retailapi.stage-xtreme.com',
  userApiUrl: process.env.USER_API_URL || 'https://userapi.stage-xtreme.com',
  virtualRaceApiUrl: process.env.VIRTUAL_RACE_API_URL || 'https://virtualraceintegrationapi.stage-xtreme.com',
  virtualBingoApiUrl: process.env.VIRTUAL_BINGO_API_URL || 'https://virtualbingointegrationapi.stage-xtreme.com',
  tenantId: process.env.TENANT_ID || 'your-tenant-id',
  databaseUrl: process.env.DATABASE_URL || '',

  boAdmin: {
    username: process.env.BO_USERNAME || 'ifarkasbo',
    password: process.env.BO_PASSWORD || '123123',
    clientId: '555f642c-6add-41e2-89ca-c02703b5078e',
    clientType: 'BackOfficeConsumer',
  },
};
