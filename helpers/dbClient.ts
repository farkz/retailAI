import { Pool } from 'pg';
import { config } from '../config/env';

let pool: Pool | null = null;

function isValidConnectionString(url: string): boolean {
  return url.startsWith('postgresql://') || url.startsWith('postgres://');
}

function getPool(): Pool {
  if (!pool) {
    if (!config.databaseUrl || !isValidConnectionString(config.databaseUrl)) {
      throw new Error(`DATABASE_URL is not a valid PostgreSQL connection string: "${config.databaseUrl}"`);
    }
    const requireSsl = config.databaseUrl.includes('sslmode=require');
    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: requireSsl ? { rejectUnauthorized: false } : false,
    });
  }
  return pool;
}

export const dbClient = {
  async query<T = any>(text: string, params: any[] = []): Promise<T[]> {
    const client = await getPool().connect();
    try {
      const result = await client.query(text, params);
      return result.rows as T[];
    } finally {
      client.release();
    }
  },

  async verifyFranchise(franchiseId: string) {
    if (!config.databaseUrl || !isValidConnectionString(config.databaseUrl)) {
      console.log('DATABASE_URL not configured — skipping DB franchise verification');
      return null;
    }
    try {
      const rows = await this.query(
        `SELECT * FROM retail.franchise WHERE id = $1 AND deleted = false`,
        [franchiseId]
      );
      if (rows.length === 0) throw new Error(`Franchise ${franchiseId} not found in DB`);
      console.log(`Franchise verified in Database`);
      return rows[0];
    } catch (e: any) {
      console.warn(`DB verification skipped: ${e.message}`);
      return null;
    }
  },

  async verifyCostCenter(costCenterId: string) {
    if (!config.databaseUrl || !isValidConnectionString(config.databaseUrl)) {
      console.log('DATABASE_URL not configured — skipping DB cost center verification');
      return null;
    }
    try {
      const rows = await this.query(
        `SELECT * FROM retail.cost_center WHERE id = $1 AND deleted = false`,
        [costCenterId]
      );
      if (rows.length === 0) throw new Error(`Cost Center ${costCenterId} not found in DB`);
      console.log(`Cost Center verified in Database`);
      return rows[0];
    } catch (e: any) {
      console.warn(`DB verification skipped: ${e.message}`);
      return null;
    }
  },

  async verifyCostCentersByFranchise(franchiseId: string): Promise<any[]> {
    if (!config.databaseUrl || !isValidConnectionString(config.databaseUrl)) {
      console.log('DATABASE_URL not configured — skipping DB cost centers verification');
      return [];
    }
    try {
      const rows = await this.query(
        `SELECT id, name, code FROM retail.cost_center WHERE franchise_id = $1 AND deleted = false`,
        [franchiseId]
      );
      console.log(`Found ${rows.length} cost center(s) in DB for franchise ${franchiseId}`);
      return rows;
    } catch (e: any) {
      console.warn(`DB cost center verification skipped: ${e.message}`);
      return [];
    }
  },

  async verifyTerminalsByFranchise(costCenterIds: string[], clientType: 'Terminal' | 'Betshop'): Promise<any[]> {
    if (!config.databaseUrl || !isValidConnectionString(config.databaseUrl)) {
      console.log(`DATABASE_URL not configured — skipping DB ${clientType} verification`);
      return [];
    }
    if (!costCenterIds.length) return [];
    try {
      const placeholders = costCenterIds.map((_, i) => `$${i + 1}`).join(', ');
      const rows = await this.query(
        `SELECT id, cost_center_id, client_type FROM retail.terminal WHERE cost_center_id IN (${placeholders}) AND client_type = $${costCenterIds.length + 1}`,
        [...costCenterIds, clientType]
      );
      console.log(`Found ${rows.length} ${clientType}(s) in DB`);
      return rows;
    } catch (e: any) {
      console.warn(`DB ${clientType} verification skipped: ${e.message}`);
      return [];
    }
  },
};

export default dbClient;
