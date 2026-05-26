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

  async cleanupByFranchise(franchiseId: string): Promise<{
    terminals: number;
    costCenters: number;
    franchise: number;
  } | null> {
    if (!config.databaseUrl || !isValidConnectionString(config.databaseUrl)) {
      console.log('DATABASE_URL not configured — skipping DB cleanup');
      return null;
    }
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');

      const ccRows = await client.query(
        `SELECT id FROM retail.cost_center WHERE franchise_id = $1 AND deleted = false`,
        [franchiseId]
      );
      const ccIds: string[] = ccRows.rows.map((r: any) => r.id);

      let terminalCount = 0;
      if (ccIds.length) {
        const placeholders = ccIds.map((_, i) => `$${i + 1}`).join(', ');
        const tRes = await client.query(
          `UPDATE retail.terminal SET deleted = true WHERE cost_center_id IN (${placeholders}) AND deleted = false`,
          ccIds
        );
        terminalCount = tRes.rowCount ?? 0;
      }

      const ccRes = await client.query(
        `UPDATE retail.cost_center SET deleted = true WHERE franchise_id = $1 AND deleted = false`,
        [franchiseId]
      );
      const costCenterCount = ccRes.rowCount ?? 0;

      const fRes = await client.query(
        `UPDATE retail.franchise SET deleted = true WHERE id = $1 AND deleted = false`,
        [franchiseId]
      );
      const franchiseCount = fRes.rowCount ?? 0;

      await client.query('COMMIT');
      console.log(
        `DB cleanup for franchise ${franchiseId}: terminals=${terminalCount}, costCenters=${costCenterCount}, franchise=${franchiseCount}`
      );
      return { terminals: terminalCount, costCenters: costCenterCount, franchise: franchiseCount };
    } catch (e: any) {
      await client.query('ROLLBACK').catch(() => {});
      console.warn(`DB cleanup failed for franchise ${franchiseId}: ${e.message}`);
      return null;
    } finally {
      client.release();
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
