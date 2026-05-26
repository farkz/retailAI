#!/usr/bin/env ts-node
import { dbClient } from '../helpers/dbClient';
import { config } from '../config/env';

interface CliOptions {
  namePrefix: string;
  olderThanHours: number;
  dryRun: boolean;
  limit: number | null;
  help: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    namePrefix: 'farkas',
    olderThanHours: 24,
    dryRun: false,
    limit: null,
    help: false,
  };
  for (const raw of argv) {
    if (raw === '--dry-run' || raw === '-n') {
      opts.dryRun = true;
      continue;
    }
    if (raw === '--help' || raw === '-h') {
      opts.help = true;
      continue;
    }
    const eq = raw.indexOf('=');
    if (eq === -1) continue;
    const key = raw.slice(0, eq);
    const value = raw.slice(eq + 1);
    switch (key) {
      case '--prefix':
        opts.namePrefix = value;
        break;
      case '--hours':
        opts.olderThanHours = Number(value);
        if (!Number.isFinite(opts.olderThanHours) || opts.olderThanHours < 0) {
          throw new Error(`--hours must be a non-negative number, got "${value}"`);
        }
        break;
      case '--limit':
        opts.limit = Number(value);
        if (!Number.isInteger(opts.limit) || opts.limit <= 0) {
          throw new Error(`--limit must be a positive integer, got "${value}"`);
        }
        break;
      default:
        throw new Error(`Unknown argument: ${key}`);
    }
  }
  return opts;
}

function printUsage(): void {
  console.log(`Usage: pnpm cleanup:staging [options]

Soft-deletes old test franchises (and their cost centers / terminals) from the
staging DB pointed to by DATABASE_URL, using helpers/dbClient.cleanupByFranchise.

Options:
  --prefix=<str>   Franchise name prefix to match (default: farkas)
  --hours=<n>      Only delete franchises older than N hours (default: 24)
                   Set to 0 to disable the age cutoff.
  --limit=<n>      Cap the number of franchises processed in one run
  --dry-run, -n    Print what would be deleted without modifying the DB
  --help, -h       Show this message
`);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printUsage();
    return;
  }

  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is not set — cannot run staging cleanup');
  }

  console.log(`[cleanup:staging] DB target: ${config.databaseUrl.replace(/:[^:@/]+@/, ':***@')}`);
  console.log(
    `[cleanup:staging] Filter: name ILIKE "${opts.namePrefix}%"` +
      (opts.olderThanHours > 0 ? `, older than ${opts.olderThanHours}h` : ', no age cutoff') +
      (opts.limit ? `, limit ${opts.limit}` : '') +
      (opts.dryRun ? ' [DRY RUN]' : '')
  );

  const found = await dbClient.findTestFranchises({
    namePrefix: opts.namePrefix,
    olderThanHours: opts.olderThanHours,
  });

  if (found.length === 0) {
    console.log('[cleanup:staging] No matching franchises found — nothing to do');
    return;
  }

  const targets = opts.limit ? found.slice(0, opts.limit) : found;
  console.log(`[cleanup:staging] Matched ${found.length} franchise(s)` +
    (targets.length !== found.length ? `, processing first ${targets.length}` : ''));

  for (const f of targets) {
    console.log(`  - ${f.id}  ${f.name}  (created: ${f.created_at ?? 'unknown'})`);
  }

  if (opts.dryRun) {
    console.log('[cleanup:staging] Dry run — no changes made');
    return;
  }

  const totals = { franchises: 0, costCenters: 0, terminals: 0, failures: 0 };
  for (const f of targets) {
    const res = await dbClient.cleanupByFranchise(f.id);
    if (!res) {
      totals.failures += 1;
      continue;
    }
    totals.franchises += res.franchise;
    totals.costCenters += res.costCenters;
    totals.terminals += res.terminals;
  }

  console.log(
    `[cleanup:staging] Done. franchises=${totals.franchises}, costCenters=${totals.costCenters}, terminals=${totals.terminals}, failures=${totals.failures}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`[cleanup:staging] FAILED: ${err?.stack || err?.message || err}`);
    process.exit(1);
  });
