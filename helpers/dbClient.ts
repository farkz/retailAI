import { Pool } from 'pg';
import { config } from '../config/env';

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    if (!config.databaseUrl) {
      throw new Error('DATABASE_URL is not set — skipping database verification');
    }
    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
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
    if (!config.databaseUrl) {
      console.log('DATABASE_URL not set — skipping DB franchise verification');
      return null;
    }
    const rows = await this.query(
      `SELECT * FROM retail.franchise WHERE id = $1 AND deleted = false`,
      [franchiseId]
    );
    if (rows.length === 0) throw new Error(`Franchise ${franchiseId} not found in DB`);
    console.log(`Franchise verified in Database`);
    return rows[0];
  },

  async verifyCostCenter(costCenterId: string) {
    if (!config.databaseUrl) {
      console.log('DATABASE_URL not set — skipping DB cost center verification');
      return null;
    }
    const rows = await this.query(
      `SELECT * FROM retail.cost_center WHERE id = $1 AND deleted = false`,
      [costCenterId]
    );
    if (rows.length === 0) throw new Error(`Cost Center ${costCenterId} not found in DB`);
    console.log(`Cost Center verified in Database`);
    return rows[0];
  },
};

export default dbClient;
