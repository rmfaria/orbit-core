import type { Pool } from 'pg';

export type ConditionResult = { firing: boolean; value: number | null };

type AbsenceCondition  = { kind: 'absence';   window_min: number };
type ThresholdCondition = { kind: 'threshold'; agg?: 'avg' | 'max'; window_min: number; op: '>' | '>=' | '<' | '<='; value: number };
export type AlertCondition = AbsenceCondition | ThresholdCondition;

export async function evaluate(pool: Pool, rule: {
  asset_id:  string | null;
  namespace: string | null;
  metric:    string | null;
  condition: AlertCondition;
}): Promise<ConditionResult> {
  const { condition, asset_id, namespace, metric } = rule;

  if (condition.kind === 'absence') {
    // Firing when no metric point received in the last window_min minutes
    const { rows } = await pool.query(
      `SELECT 1 FROM metric_points
       WHERE ($1::text IS NULL OR asset_id = $1)
         AND ($2::text IS NULL OR namespace = $2)
         AND ($3::text IS NULL OR metric    = $3)
         AND ts > now() - make_interval(mins => $4)
       LIMIT 1`,
      [asset_id ?? null, namespace ?? null, metric ?? null, condition.window_min]
    );
    return { firing: rows.length === 0, value: null };
  }

  if (condition.kind === 'threshold') {
    const agg = condition.agg === 'max' ? 'MAX' : 'AVG';
    const { rows } = await pool.query(
      `SELECT ${agg}(value)::float8 AS v
       FROM metric_points
       WHERE ($1::text IS NULL OR asset_id = $1)
         AND ($2::text IS NULL OR namespace = $2)
         AND ($3::text IS NULL OR metric    = $3)
         AND ts > now() - make_interval(mins => $4)`,
      [asset_id ?? null, namespace ?? null, metric ?? null, condition.window_min]
    );
    const v: number | null = rows[0]?.v ?? null;
    if (v === null) return { firing: false, value: null };

    const ops: Record<string, (a: number, b: number) => boolean> = {
      '>':  (a, b) => a > b,
      '>=': (a, b) => a >= b,
      '<':  (a, b) => a < b,
      '<=': (a, b) => a <= b,
    };
    const test = ops[condition.op] ?? (() => false);
    return { firing: test(v, condition.value), value: v };
  }

  return { firing: false, value: null };
}
