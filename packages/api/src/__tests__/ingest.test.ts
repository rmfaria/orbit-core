import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// ── Mock pool ─────────────────────────────────────────────────────────────────

const mockClient = {
  query:   vi.fn().mockResolvedValue({ rows: [] }),
  release: vi.fn(),
};
const mockPool = {
  query:   vi.fn().mockResolvedValue({ rows: [] }),
  connect: vi.fn().mockResolvedValue(mockClient),
  on:      vi.fn(),
};

vi.mock('../db.js', () => ({ pool: mockPool }));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json:   vi.fn().mockReturnThis(),
  } as unknown as Response;
}

function makeReq(body: unknown): Request {
  return { body } as unknown as Request;
}

const validMetric = {
  ts:        '2024-01-15T10:30:00Z',
  asset_id:  'host:server1',
  namespace: 'nagios',
  metric:    'load1',
  value:     1.5,
};

const validEvent = {
  ts:        '2024-01-15T10:30:00Z',
  asset_id:  'host:server1',
  namespace: 'wazuh',
  kind:      'alert',
  severity:  'high',
  title:     'Suspicious activity',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ingestMetricsHandler', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 400 for invalid payload (missing metric)', async () => {
    const { ingestMetricsHandler } = await import('../routes/ingest.js');
    const req = makeReq({ metrics: [{ ts: '2024-01-15T10:30:00Z', asset_id: 'a' }] });
    const res = makeRes();

    await expect(ingestMetricsHandler(req, res)).rejects.toThrow();
  });

  it('inserts metrics and returns ok:true', async () => {
    const { ingestMetricsHandler } = await import('../routes/ingest.js');
    const req = makeReq({ metrics: [validMetric] });
    const res = makeRes();

    await ingestMetricsHandler(req, res);

    expect(mockPool.connect).toHaveBeenCalled();
    expect(mockClient.query).toHaveBeenCalledWith('begin');
    expect(mockClient.query).toHaveBeenCalledWith('commit');
    expect(mockClient.release).toHaveBeenCalled();
    expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      ok: true, inserted: 1,
    });
  });

  it('rolls back and rethrows on DB error', async () => {
    mockClient.query
      .mockResolvedValueOnce({})  // begin
      .mockRejectedValueOnce(new Error('constraint violation'))  // insert
      .mockResolvedValueOnce({});  // rollback

    const { ingestMetricsHandler } = await import('../routes/ingest.js');
    const req = makeReq({ metrics: [validMetric] });
    const res = makeRes();

    await expect(ingestMetricsHandler(req, res)).rejects.toThrow('constraint violation');
    expect(mockClient.query).toHaveBeenCalledWith('rollback');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('rejects batch over 5000', async () => {
    const { ingestMetricsHandler } = await import('../routes/ingest.js');
    const req = makeReq({ metrics: Array(5001).fill(validMetric) });
    const res = makeRes();

    await expect(ingestMetricsHandler(req, res)).rejects.toThrow();
  });
});

describe('ingestEventsHandler', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('inserts events and returns ok:true', async () => {
    const { ingestEventsHandler } = await import('../routes/ingest.js');
    const req = makeReq({ events: [validEvent] });
    const res = makeRes();

    await ingestEventsHandler(req, res);

    expect(mockClient.query).toHaveBeenCalledWith('begin');
    expect(mockClient.query).toHaveBeenCalledWith('commit');
    expect((res.json as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      ok: true, inserted: 1,
    });
  });

  it('returns 400 for invalid severity', async () => {
    const { ingestEventsHandler } = await import('../routes/ingest.js');
    const req = makeReq({ events: [{ ...validEvent, severity: 'warning' }] });
    const res = makeRes();

    await expect(ingestEventsHandler(req, res)).rejects.toThrow();
  });

  it('accepts optional fingerprint and attributes', async () => {
    const { ingestEventsHandler } = await import('../routes/ingest.js');
    const req = makeReq({
      events: [{ ...validEvent, fingerprint: 'fp-001', attributes: { rule: '1234' } }],
    });
    const res = makeRes();

    await ingestEventsHandler(req, res);

    // Verify the INSERT call included the fingerprint
    const insertCall = mockClient.query.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('insert into orbit_events')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall?.[1]).toContain('fp-001');
  });
});
