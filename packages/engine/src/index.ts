/**
 * orbit-core
 *
 * Created by Rodrigo Menchio <rodrigomenchio@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { QueryRequest } from '@orbit/core-contracts';

/**
 * Engine is responsible for:
 * - parsing/validating queries
 * - compiling into storage-specific plans (Postgres, ClickHouse)
 * - applying authorization + tenancy filters
 *
 * MVP: define stubs and a very small plan shape.
 */

export type StorageTarget = 'postgres' | 'clickhouse';

export interface QueryPlan {
  target: StorageTarget;
  statement: string;
  params: unknown[];
}

export interface CompileOptions {
  target: StorageTarget;
}

export function compileQuery(req: QueryRequest, opts: CompileOptions): QueryPlan {
  // MVP placeholder:
  // - if language=sql, trust-but-verify (in future: allowlisted SQL)
  // - if language=orbitql, compile to SQL
  const statement = req.query;
  return {
    target: opts.target,
    statement,
    params: []
  };
}
