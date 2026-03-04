import type { Pool } from 'pg';

export type ConditionResult = { firing: boolean; value: number | null };

type AbsenceCondition  = { kind: 'absence';   window_min: number };
type ThresholdCondition = { kind: 'threshold'; agg?: 'avg' | 'max'; window_min: number; op: '>' | '>=' | '<' | '<='; value: number };
export type AlertCondition = AbsenceCondition | ThresholdCondition;

/** Build a dynamic WHERE clause using only non-null fields (allows index usage). */
function buildWhere(asset_id: string | null, namespace: string | null, metric: string | null, window_min: number) {
  const conds: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (asset_id)  { conds.push(`asset_id = $${i++}`);  params.push(asset_id); }
  if (namespace) { conds.push(`namespace = $${i++}`);  params.push(namespace); }
  if (metric)    { conds.push(`metric = $${i++}`);     params.push(metric); }
  conds.push(`ts > now() - make_interval(mins => $${i++})`);
  params.push(window_min);
  return { where: conds.join(' AND '), params };
}

export async function evaluate(pool: Pool, rule: {
  asset_id:  string | null;
  namespace: string | null;
  metric:    string | null;
  condition: AlertCondition;
}): Promise<ConditionResult> {
  const { condition, asset_id, namespace, metric } = rule;

  if (condition.kind === 'absence') {
    const { where, params } = buildWhere(asset_id, namespace, metric, condition.window_min);
    const { rows } = await pool.query(
      `SELECT 1 FROM metric_points WHERE ${where} LIMIT 1`,
      params
    );
    return { firing: rows.length === 0, value: null };
  }

  if (condition.kind === 'threshold') {
    const agg = condition.agg === 'max' ? 'MAX' : 'AVG';
    const { where, params } = buildWhere(asset_id, namespace, metric, condition.window_min);
    const { rows } = await pool.query(
      `SELECT ${agg}(value)::float8 AS v FROM metric_points WHERE ${where}`,
      params
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
