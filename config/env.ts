import dotenv from 'dotenv';

dotenv.config();

export const config = {
  baseUrl: process.env.BASE_URL || 'https://your-api-domain.com',
  tenantId: process.env.TENANT_ID || 'your-tenant-id',
  
  boAdmin: {
    username: process.env.BO_USERNAME || 'ifarkasbo',
    password: process.env.BO_PASSWORD || '123123',
    clientId: '555f642c-6add-41e2-89ca-c02703b5078e',
    clientType: 'BackOfficeConsumer',
  },
};