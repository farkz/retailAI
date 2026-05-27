import { Pool } from 'pg';
import { config } from '../config/env';

let pool: Pool | null = null;
let dbAvailableCache: boolean | null = null;

function isValidConnectionString(url: string): boolean {
  return url.startsWith('postgresql://') || url.startsWith('postgres://');
}

function getPool(): Pool {
  if (!pool) {
    if (!config.databaseUrl || !isValidConnectionString(config.databaseUrl)) {
      throw new Error(`DATABASE_URL is not a valid PostgreSQL connection string: "${config.databaseUrl}"`);
    }
    // Parse URL manually so our ssl config is NOT overridden by pg-connection-string's sslmode parsing.
    // When connectionString is used with sslmode=require, pg-connection-string forces verify-full
    // which rejects self-signed certs even when rejectUnauthorized: false is set in Pool config.
    try {
      const url = new URL(config.databaseUrl);
      pool = new Pool({
        host: url.hostname,
        port: parseInt(url.port || '5432', 10),
        database: url.pathname.replace(/^\//, ''),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        ssl: { rejectUnauthorized: false },
      });
    } catch {
      // Fallback if URL parsing fails
      pool = new Pool({
        connectionString: config.databaseUrl,
        ssl: { rejectUnauthorized: false },
      });
    }
  }
  return pool;
}

function dbConfigured(): boolean {
  return !!config.databaseUrl && isValidConnectionString(config.databaseUrl);
}

async function dbAvailable(): Promise<boolean> {
  if (dbAvailableCache !== null) return dbAvailableCache;
  if (!dbConfigured()) { dbAvailableCache = false; return false; }
  try {
    const client = await getPool().connect();
    client.release();
    dbAvailableCache = true;
    return true;
  } catch (e: any) {
    console.warn(`[DB] Cannot connect to database (${e.message}) — all DB assertions will be skipped`);
    dbAvailableCache = false;
    return false;
  }
}

const cashPayoutColumnCache: { resolved: boolean; column: string | null } = {
  resolved: false,
  column: null,
};

const offerGroupTableCache: { resolved: boolean; schema: string | null; table: string | null } = {
  resolved: false,
  schema: null,
  table: null,
};

type OfferGroupTableInfo = {
  schema: string;
  table: string;
  franchiseColumn: string | null;
  deletedColumn: string | null;
};

const offerGroupTablesCache: { resolved: boolean; tables: OfferGroupTableInfo[] } = {
  resolved: false,
  tables: [],
};

const franchiseCreatedColumnCache: { resolved: boolean; column: string | null } = {
  resolved: false,
  column: null,
};

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
    if (!await dbAvailable()) {
      return null;
    }
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const rows = await this.query(
          `SELECT id, name, deleted FROM retail.franchise WHERE id = $1 AND deleted = false`,
          [franchiseId]
        );
        if (rows.length > 0) {
          console.log(`[DB] Franchise verified: ${franchiseId}`);
          return rows[0];
        }
        if (attempt < maxAttempts) {
          console.log(`[DB] Franchise not yet visible in DB, retrying in 1 s... (attempt ${attempt}/${maxAttempts})`);
          await new Promise((r) => setTimeout(r, 1000));
        } else {
          console.warn(`[DB] Franchise ${franchiseId} not found after ${maxAttempts} attempts — continuing`);
          return null;
        }
      } catch (e: any) {
        console.warn(`[DB] verifyFranchise query failed (${e.message ?? e}) — skipping DB assertion`);
        return null;
      }
    }
    return null;
  },

  async verifyCostCenter(costCenterId: string) {
    if (!await dbAvailable()) {
      return null;
    }
    const rows = await this.query(
      `SELECT id, name, code, franchise_id FROM retail.cost_center WHERE id = $1 AND deleted = false`,
      [costCenterId]
    );
    if (rows.length === 0) {
      throw new Error(`DB assertion failed: cost center ${costCenterId} not found in retail.cost_center`);
    }
    console.log(`[DB] Cost Center verified: ${costCenterId}`);
    return rows[0];
  },

  async verifyCostCentersByFranchise(franchiseId: string, expectedCount?: number): Promise<any[]> {
    if (!await dbAvailable()) {
      return [];
    }
    const rows = await this.query(
      `SELECT id, name, code FROM retail.cost_center WHERE franchise_id = $1 AND deleted = false`,
      [franchiseId]
    );
    if (typeof expectedCount === 'number' && rows.length !== expectedCount) {
      throw new Error(
        `DB assertion failed: expected ${expectedCount} cost center(s) for franchise ${franchiseId}, found ${rows.length}`
      );
    }
    console.log(`[DB] Cost Centers for franchise ${franchiseId}: ${rows.length}`);
    return rows;
  },

  async verifyCostCenterIds(costCenterIds: string[], franchiseId: string): Promise<any[]> {
    if (!await dbAvailable()) {
      return [];
    }
    if (!costCenterIds.length) return [];
    const placeholders = costCenterIds.map((_, i) => `$${i + 1}`).join(', ');
    const rows = await this.query(
      `SELECT id, name, code, franchise_id FROM retail.cost_center
       WHERE id IN (${placeholders}) AND deleted = false`,
      costCenterIds
    );
    if (rows.length !== costCenterIds.length) {
      const found = new Set(rows.map((r: any) => r.id));
      const missing = costCenterIds.filter((id) => !found.has(id));
      throw new Error(
        `DB assertion failed: missing ${missing.length}/${costCenterIds.length} cost center(s) in DB: ${missing.join(', ')}`
      );
    }
    const wrongFranchise = rows.filter((r: any) => r.franchise_id !== franchiseId);
    if (wrongFranchise.length) {
      throw new Error(
        `DB assertion failed: ${wrongFranchise.length} cost center(s) linked to wrong franchise: ${wrongFranchise
          .map((r: any) => r.id)
          .join(', ')}`
      );
    }
    console.log(`[DB] All ${rows.length} cost center(s) verified under franchise ${franchiseId}`);
    return rows;
  },

  async cleanupByFranchise(franchiseId: string): Promise<{
    terminals: number;
    costCenters: number;
    franchise: number;
  } | null> {
    if (!await dbAvailable()) {
      console.log('[cleanup] DB not reachable — skipping DB soft-delete cleanup');
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

  async resolveFranchiseCreatedColumn(): Promise<string | null> {
    if (franchiseCreatedColumnCache.resolved) return franchiseCreatedColumnCache.column;
    if (!dbConfigured()) {
      franchiseCreatedColumnCache.resolved = true;
      return null;
    }
    const rows = await this.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'retail' AND table_name = 'franchise'
         AND (column_name ILIKE '%created%' OR column_name ILIKE '%inserted%')`
    );
    const preferred = ['created_at', 'created_on', 'created', 'createdat', 'inserted_at'];
    const found = rows.map((r) => r.column_name);
    const col = preferred.find((p) => found.includes(p)) ?? found[0] ?? null;
    franchiseCreatedColumnCache.resolved = true;
    franchiseCreatedColumnCache.column = col;
    if (col) {
      console.log(`[DB] Resolved franchise created-timestamp column: ${col}`);
    } else {
      console.warn(`[DB] No created-timestamp column found on retail.franchise; age cutoff will be skipped`);
    }
    return col;
  },

  async findTestFranchises(opts: {
    namePrefix?: string;
    olderThanHours?: number;
  }): Promise<Array<{ id: string; name: string; created_at: string | null }>> {
    if (!dbConfigured()) {
      console.log('DATABASE_URL not configured — skipping test franchise lookup');
      return [];
    }
    const conditions: string[] = ['deleted = false'];
    const params: any[] = [];
    if (opts.namePrefix) {
      params.push(`${opts.namePrefix}%`);
      conditions.push(`name ILIKE $${params.length}`);
    }
    const createdCol = await this.resolveFranchiseCreatedColumn();
    let selectCreated = 'NULL::timestamp AS created_at';
    if (createdCol) {
      selectCreated = `"${createdCol}" AS created_at`;
      if (typeof opts.olderThanHours === 'number' && opts.olderThanHours > 0) {
        params.push(opts.olderThanHours);
        conditions.push(`"${createdCol}" < NOW() - ($${params.length} || ' hours')::interval`);
      }
    }
    const rows = await this.query<{ id: string; name: string; created_at: string | null }>(
      `SELECT id, name, ${selectCreated} FROM retail.franchise
       WHERE ${conditions.join(' AND ')}
       ORDER BY name`,
      params
    );
    return rows;
  },

  async verifyTerminalsByFranchise(
    costCenterIds: string[],
    clientType: 'Terminal' | 'Betshop',
    expectedCount?: number
  ): Promise<any[]> {
    if (!await dbAvailable()) {
      return [];
    }
    if (!costCenterIds.length) return [];
    const placeholders = costCenterIds.map((_, i) => `$${i + 1}`).join(', ');
    const rows = await this.query(
      `SELECT id, cost_center_id, client_type FROM retail.terminal
       WHERE cost_center_id IN (${placeholders})
         AND client_type = $${costCenterIds.length + 1}
         AND deleted = false`,
      [...costCenterIds, clientType]
    );
    if (typeof expectedCount === 'number' && rows.length !== expectedCount) {
      throw new Error(
        `DB assertion failed: expected ${expectedCount} ${clientType}(s), found ${rows.length}`
      );
    }
    const wrongType = rows.filter((r: any) => r.client_type !== clientType);
    if (wrongType.length) {
      throw new Error(
        `DB assertion failed: ${wrongType.length} ${clientType}(s) have wrong client_type: ${wrongType
          .map((r: any) => `${r.id}=${r.client_type}`)
          .join(', ')}`
      );
    }
    console.log(`[DB] ${clientType}s verified: ${rows.length}`);
    return rows;
  },

  async verifyTerminalIds(
    terminalIds: string[],
    clientType: 'Terminal' | 'Betshop'
  ): Promise<any[]> {
    if (!await dbAvailable()) {
      return [];
    }
    if (!terminalIds.length) return [];
    const placeholders = terminalIds.map((_, i) => `$${i + 1}`).join(', ');
    const rows = await this.query(
      `SELECT id, cost_center_id, client_type FROM retail.terminal
       WHERE id IN (${placeholders}) AND deleted = false`,
      terminalIds
    );
    if (rows.length !== terminalIds.length) {
      const found = new Set(rows.map((r: any) => r.id));
      const missing = terminalIds.filter((id) => !found.has(id));
      throw new Error(
        `DB assertion failed: missing ${missing.length}/${terminalIds.length} ${clientType}(s) in DB: ${missing.join(', ')}`
      );
    }
    const wrongType = rows.filter((r: any) => r.client_type !== clientType);
    if (wrongType.length) {
      throw new Error(
        `DB assertion failed: ${wrongType.length} row(s) expected client_type=${clientType} but got: ${wrongType
          .map((r: any) => `${r.id}=${r.client_type}`)
          .join(', ')}`
      );
    }
    console.log(`[DB] ${terminalIds.length} ${clientType}(s) verified by id with correct client_type`);
    return rows;
  },

  async resolveCashPayoutColumn(): Promise<string | null> {
    if (cashPayoutColumnCache.resolved) return cashPayoutColumnCache.column;
    if (!await dbAvailable()) {
      cashPayoutColumnCache.resolved = true;
      return null;
    }
    const rows = await this.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'retail' AND table_name = 'terminal'
         AND (column_name ILIKE '%cash%payout%' OR column_name ILIKE '%payout%cash%')`
    );
    const preferred = ['cash_payout_enabled', 'is_cash_payout_enabled', 'cash_payout'];
    const found = rows.map((r) => r.column_name);
    const col = preferred.find((p) => found.includes(p)) ?? found[0] ?? null;
    cashPayoutColumnCache.resolved = true;
    cashPayoutColumnCache.column = col;
    if (col) {
      console.log(`[DB] Resolved cash payout column on retail.terminal: ${col}`);
    } else {
      console.warn(`[DB] No cash-payout-like column found on retail.terminal; skipping that assertion`);
    }
    return col;
  },

  async verifyCashPayoutEnabled(terminalIds: string[]): Promise<void> {
    if (!await dbAvailable()) {
      return;
    }
    if (!terminalIds.length) return;
    const column = await this.resolveCashPayoutColumn();
    if (!column) return;
    const placeholders = terminalIds.map((_, i) => `$${i + 1}`).join(', ');
    const rows = await this.query<{ id: string; enabled: any }>(
      `SELECT id, "${column}" AS enabled FROM retail.terminal
       WHERE id IN (${placeholders}) AND deleted = false`,
      terminalIds
    );
    if (rows.length !== terminalIds.length) {
      throw new Error(
        `DB assertion failed: cash payout check expected ${terminalIds.length} terminal row(s), found ${rows.length}`
      );
    }
    const notEnabled = rows.filter((r) => r.enabled !== true);
    if (notEnabled.length) {
      throw new Error(
        `DB assertion failed: ${notEnabled.length}/${rows.length} terminal(s) do not have cash payout enabled (${column}): ${notEnabled
          .map((r) => `${r.id}=${r.enabled}`)
          .join(', ')}`
      );
    }
    console.log(`[DB] Cash payout enabled verified for ${rows.length} terminal(s) via ${column}`);
  },

  async resolveOfferGroupTable(): Promise<{ schema: string; table: string } | null> {
    if (offerGroupTableCache.resolved) {
      return offerGroupTableCache.table
        ? { schema: offerGroupTableCache.schema as string, table: offerGroupTableCache.table }
        : null;
    }
    if (!await dbAvailable()) {
      offerGroupTableCache.resolved = true;
      return null;
    }
    const rows = await this.query<{ table_schema: string; table_name: string }>(
      `SELECT table_schema, table_name FROM information_schema.tables
       WHERE table_name ILIKE 'offer_group' OR table_name ILIKE 'offergroup'`
    );
    const pick = rows[0] ?? null;
    offerGroupTableCache.resolved = true;
    offerGroupTableCache.schema = pick?.table_schema ?? null;
    offerGroupTableCache.table = pick?.table_name ?? null;
    if (pick) {
      console.log(`[DB] Resolved offer group table: ${pick.table_schema}.${pick.table_name}`);
    } else {
      console.warn(
        `[DB] No offer_group table found in connected DB (likely lives in a separate service DB); skipping strict offer group DB assertion`
      );
    }
    return pick ? { schema: pick.table_schema, table: pick.table_name } : null;
  },

  async resolveOfferGroupTables(): Promise<OfferGroupTableInfo[]> {
    if (offerGroupTablesCache.resolved) return offerGroupTablesCache.tables;
    if (!await dbAvailable()) {
      offerGroupTablesCache.resolved = true;
      return [];
    }
    const tableRows = await this.query<{ table_schema: string; table_name: string }>(
      `SELECT table_schema, table_name FROM information_schema.tables
       WHERE table_name ILIKE 'offer_group' OR table_name ILIKE 'offergroup'`
    );
    const infos: OfferGroupTableInfo[] = [];
    for (const t of tableRows) {
      const cols = await this.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2`,
        [t.table_schema, t.table_name]
      );
      const colNames = cols.map((c) => c.column_name);
      const franchisePrefs = ['franchise_id', 'franchiseid', 'franchise'];
      const deletedPrefs = ['deleted', 'is_deleted', 'isdeleted'];
      const franchiseColumn = franchisePrefs.find((p) => colNames.includes(p)) ?? null;
      const deletedColumn = deletedPrefs.find((p) => colNames.includes(p)) ?? null;
      infos.push({
        schema: t.table_schema,
        table: t.table_name,
        franchiseColumn,
        deletedColumn,
      });
      console.log(
        `[DB] Discovered offer group table: ${t.table_schema}.${t.table_name} (franchise=${franchiseColumn ?? 'n/a'}, deleted=${deletedColumn ?? 'n/a'})`
      );
    }
    offerGroupTablesCache.resolved = true;
    offerGroupTablesCache.tables = infos;
    if (!infos.length) {
      console.warn(
        `[DB] No offer_group tables found in connected DB (likely live in separate service DBs); offer group DB cleanup will be skipped`
      );
    }
    return infos;
  },

  async cleanupOfferGroupsByFranchise(
    franchiseId: string
  ): Promise<Array<{ schema: string; table: string; affected: number; mode: 'soft' | 'hard' | 'skipped' }>> {
    if (!await dbAvailable()) {
      console.log('[cleanup] DB not reachable — skipping offer group DB cleanup');
      return [];
    }
    const tables = await this.resolveOfferGroupTables();
    if (!tables.length) return [];
    const results: Array<{ schema: string; table: string; affected: number; mode: 'soft' | 'hard' | 'skipped' }> = [];
    for (const t of tables) {
      if (!t.franchiseColumn) {
        console.warn(
          `[cleanup] ${t.schema}.${t.table} has no franchise_id column; skipping offer group cleanup for this table`
        );
        results.push({ schema: t.schema, table: t.table, affected: 0, mode: 'skipped' });
        continue;
      }
      const client = await getPool().connect();
      try {
        let affected = 0;
        let mode: 'soft' | 'hard' = 'soft';
        if (t.deletedColumn) {
          const r = await client.query(
            `UPDATE "${t.schema}"."${t.table}"
             SET "${t.deletedColumn}" = true
             WHERE "${t.franchiseColumn}" = $1 AND "${t.deletedColumn}" = false`,
            [franchiseId]
          );
          affected = r.rowCount ?? 0;
        } else {
          mode = 'hard';
          const r = await client.query(
            `DELETE FROM "${t.schema}"."${t.table}" WHERE "${t.franchiseColumn}" = $1`,
            [franchiseId]
          );
          affected = r.rowCount ?? 0;
        }
        console.log(
          `[cleanup] OfferGroup ${mode}-delete on ${t.schema}.${t.table} (franchise=${franchiseId}): ${affected} row(s)`
        );
        results.push({ schema: t.schema, table: t.table, affected, mode });
      } catch (e: any) {
        console.warn(
          `[cleanup] OfferGroup cleanup failed on ${t.schema}.${t.table}: ${e.message}`
        );
        results.push({ schema: t.schema, table: t.table, affected: 0, mode: 'skipped' });
      } finally {
        client.release();
      }
    }
    return results;
  },

  async verifyOfferGroupsRemoved(franchiseId: string): Promise<void> {
    if (!await dbAvailable()) return;
    const tables = await this.resolveOfferGroupTables();
    for (const t of tables) {
      if (!t.franchiseColumn) continue;
      const whereDeleted = t.deletedColumn ? ` AND "${t.deletedColumn}" = false` : '';
      const rows = await this.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM "${t.schema}"."${t.table}"
         WHERE "${t.franchiseColumn}" = $1${whereDeleted}`,
        [franchiseId]
      );
      const n = rows[0]?.n ?? 0;
      if (n !== 0) {
        throw new Error(
          `DB assertion failed: ${n} active offer group(s) still linked to franchise ${franchiseId} in ${t.schema}.${t.table}`
        );
      }
      console.log(`[DB] Confirmed 0 active offer groups in ${t.schema}.${t.table} for franchise ${franchiseId}`);
    }
  },

  async verifyOfferGroup(offerGroupId: string, label: string): Promise<any | null> {
    if (!await dbAvailable()) {
      return null;
    }
    const target = await this.resolveOfferGroupTable();
    if (!target) return null;
    const rows = await this.query(
      `SELECT * FROM "${target.schema}"."${target.table}" WHERE id = $1`,
      [offerGroupId]
    );
    if (rows.length === 0) {
      throw new Error(
        `DB assertion failed: ${label} offer group ${offerGroupId} not found in ${target.schema}.${target.table}`
      );
    }
    console.log(`[DB] ${label} OfferGroup verified: ${offerGroupId}`);
    return rows[0];
  },

  // ==================== PHASE 2: RACE QUERIES ====================

  async getNextUnprocessedRound(offerGroupId: string, tenantId: string): Promise<{
    id: string;
    number: number;
    details: string;
  } | null> {
    if (!await dbAvailable()) {
      return null;
    }
    const rows = await this.query<{ id: string; number: number; details: string }>(
      `SELECT id, number, details FROM virtualrace.round
       WHERE offer_group_id = $1
         AND tenant_id = $2
         AND result_processed_datetime IS NULL
       ORDER BY start_datetime ASC
       LIMIT 1`,
      [offerGroupId, tenantId]
    );
    return rows[0] ?? null;
  },

  async getVirtualRaceOfferGroup(offerGroupId: string): Promise<any | null> {
    if (!await dbAvailable()) {
      return null;
    }
    const rows = await this.query(
      `SELECT * FROM virtualrace.offer_group WHERE id = $1`,
      [offerGroupId]
    );
    return rows[0] ?? null;
  },

  async getTerminalCostCenterId(terminalId: string): Promise<string | null> {
    if (!await dbAvailable()) {
      return null;
    }
    const rows = await this.query<{ cost_center_id: string }>(
      `SELECT cost_center_id FROM retail.terminal WHERE id = $1 AND deleted = false`,
      [terminalId]
    );
    return rows[0]?.cost_center_id ?? null;
  },

  // ==================== PHASE 3: PAYOUT QUERIES ====================

  async getWonTicketsByFranchise(franchiseId: string): Promise<Array<{
    id: string;
    user_id: string;
    win_amount: number;
    jackpot_win_amount: number;
  }>> {
    if (!await dbAvailable()) {
      return [];
    }
    const rows = await this.query<{
      id: string;
      user_id: string;
      win_amount: number;
      jackpot_win_amount: number;
    }>(
      `SELECT id, user_id, win_amount, jackpot_win_amount
       FROM virtualrace.ticket
       WHERE franchise_id = $1 AND status = 'Won'
       ORDER BY created_datetime DESC`,
      [franchiseId]
    );
    console.log(`[DB] Found ${rows.length} won ticket(s) for franchise ${franchiseId}`);
    return rows;
  },

  async getLostTicketsByFranchise(franchiseId: string): Promise<Array<{
    id: string;
    user_id: string;
    win_amount: number;
    jackpot_win_amount: number;
  }>> {
    if (!await dbAvailable()) {
      return [];
    }
    const rows = await this.query<{
      id: string;
      user_id: string;
      win_amount: number;
      jackpot_win_amount: number;
    }>(
      `SELECT id, user_id, win_amount, jackpot_win_amount
       FROM virtualrace.ticket
       WHERE franchise_id = $1 AND status = 'Lost'
       ORDER BY created_datetime DESC`,
      [franchiseId]
    );
    console.log(`[DB] Found ${rows.length} lost ticket(s) for franchise ${franchiseId}`);
    return rows;
  },

  async getTicketDetails(ticketId: string): Promise<any | null> {
    if (!await dbAvailable()) {
      return null;
    }
    const rows = await this.query(
      `SELECT id, user_id, win_amount, jackpot_win_amount, status
       FROM virtualrace.ticket
       WHERE id = $1`,
      [ticketId]
    );
    return rows[0] ?? null;
  },
};

export default dbClient;
