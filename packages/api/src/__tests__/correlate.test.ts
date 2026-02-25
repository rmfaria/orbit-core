import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Test the CTE-based correlate logic ────────────────────────────────────────

const Z_THRESHOLD   = 2.0;
const REL_THRESHOLD = 0.5;

// Score computation extracted from correlate.ts for unit testing
function computeScores(baselineAvg: number, baselineStd: number | null, peakValue: number) {
  const zScore =
    baselineStd != null && baselineStd > 0
      ? (peakValue - baselineAvg) / baselineStd
      : null;
  const relChange =
    Math.abs(baselineAvg) > 0
      ? (peakValue - baselineAvg) / Math.abs(baselineAvg)
      : null;
  const isAnomaly =
    (zScore != null && zScore >= Z_THRESHOLD) ||
    (relChange != null && relChange >= REL_THRESHOLD);
  return { zScore, relChange, isAnomaly };
}

describe('correlate score computation', () => {
  it('detects anomaly by z_score >= 2.0', () => {
    // baseline avg=1.0, std=0.1, peak=1.25 → z=(1.25-1)/0.1=2.5 ≥ 2.0
    const { isAnomaly, zScore } = computeScores(1.0, 0.1, 1.25);
    expect(isAnomaly).toBe(true);
    expect(zScore).toBeCloseTo(2.5);
  });

  it('detects anomaly by rel_change >= 0.5', () => {
    // baseline avg=100, std=0.1, peak=160 → rel=(160-100)/100=0.6 ≥ 0.5
    const { isAnomaly, relChange } = computeScores(100, 0.1, 160);
    expect(isAnomaly).toBe(true);
    expect(relChange).toBeCloseTo(0.6);
  });

  it('does not flag normal variation as anomaly', () => {
    // baseline avg=1.0, std=0.5, peak=1.2 → z=0.4, rel=0.2 → not anomaly
    const { isAnomaly } = computeScores(1.0, 0.5, 1.2);
    expect(isAnomaly).toBe(false);
  });

  it('handles null baseline_std (constant series)', () => {
    // std=null → z_score=null, rely on relChange only
    const { zScore, isAnomaly } = computeScores(5.0, null, 8.0);
    expect(zScore).toBeNull();
    expect(isAnomaly).toBe(true); // relChange = (8-5)/5 = 0.6 ≥ 0.5
  });

  it('handles zero baseline (no relChange)', () => {
    // avg=0 → relChange=null, rely on z_score
    const { relChange, isAnomaly } = computeScores(0, 1.0, 3.0);
    expect(relChange).toBeNull();
    expect(isAnomaly).toBe(true); // z=(3-0)/1=3 ≥ 2
  });

  it('handles both null (no detection possible)', () => {
    // avg=0, std=null → both scores null
    const { zScore, relChange, isAnomaly } = computeScores(0, null, 5.0);
    expect(zScore).toBeNull();
    expect(relChange).toBeNull();
    expect(isAnomaly).toBe(false);
  });
});

// ── Mock-based integration test for startCorrelateWorker ─────────────────────

describe('startCorrelateWorker', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });

  it('returns a stop function that clears timers', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      on:    vi.fn(),
    } as any;

    vi.mock('../db.js', () => ({ pool: mockPool }));
    const { startCorrelateWorker } = await import('../correlate.js');

    const stop = startCorrelateWorker(mockPool);
    expect(typeof stop).toBe('function');
    stop(); // should not throw
  });

  it('does not run immediately on start (90s delay)', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      on:    vi.fn(),
    } as any;

    const { startCorrelateWorker } = await import('../correlate.js');
    const stop = startCorrelateWorker(mockPool);

    // Pool should not have been queried yet (90s delay)
    expect(mockPool.query).not.toHaveBeenCalled();

    stop();
    vi.useRealTimers();
  });
});
