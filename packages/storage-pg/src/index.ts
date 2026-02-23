import pg from 'pg';
import type { QueryPlan } from '@orbit/engine';

export interface PgStorageConfig {
  databaseUrl: string;
}

export function createPool(config: PgStorageConfig) {
  return new pg.Pool({ connectionString: config.databaseUrl });
}

export async function runPlan(pool: pg.Pool, plan: QueryPlan) {
  // MVP: plan.statement is SQL; params are positional.
  const res = await pool.query(plan.statement, plan.params as any[]);
  return res;
}
