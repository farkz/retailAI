import { Pool } from 'pg';
import { config } from '../config/env';

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

export const dbClient = {
  async query<T = any>(text: string, params: any[] = []): Promise<T[]> {
    const client = await pool.connect();
    try {
      const result = await client.query(text, params);
      return result.rows as T[];
    } finally {
      client.release();
    }
  },

  async verifyFranchise(franchiseId: string) {
    const rows = await this.query(
      `SELECT * FROM retail.franchise WHERE id = $1 AND deleted = false`,
      [franchiseId]
    );

    if (rows.length === 0) throw new Error(`Franchise ${franchiseId} not found in DB`);
    console.log(`✅ Franchise verified in Database`);
    return rows[0];
  },

  async verifyCostCenter(costCenterId: string) {
    const rows = await this.query(
      `SELECT * FROM retail.cost_center WHERE id = $1 AND deleted = false`,
      [costCenterId]
    );

    if (rows.length === 0) throw new Error(`Cost Center ${costCenterId} not found in DB`);
    console.log(`✅ Cost Center verified in Database`);
    return rows[0];
  }
};

export default dbClient;