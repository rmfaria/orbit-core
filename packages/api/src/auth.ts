import type { Request, Response, NextFunction } from 'express';
import type { Pool } from 'pg';
import type { Env } from './env.js';

let _cachedDbKey: string | null = null;
let _cacheTs = 0;
const CACHE_TTL = 60_000; // 60s

async function getDbApiKey(pool: Pool): Promise<string> {
  const now = Date.now();
  if (_cachedDbKey !== null && now - _cacheTs < CACHE_TTL) return _cachedDbKey;
  try {
    const { rows } = await pool.query(
      `SELECT value FROM orbit_settings WHERE key = 'admin_api_key'`,
    );
    _cachedDbKey = rows[0]?.value ?? '';
    _cacheTs = now;
  } catch {
    _cachedDbKey = '';
    _cacheTs = now;
  }
  return _cachedDbKey ?? '';
}

/** Clear cached DB key (called after setup generates a new key). */
export function invalidateApiKeyCache(): void {
  _cachedDbKey = null;
  _cacheTs = 0;
}

// Middleware factory. Checks API key from env var OR from orbit_settings DB.
// If neither is configured the middleware is a no-op (setup mode).
export function makeAuthMiddleware(env: Env, pool?: Pool | null) {
  const envKey = env.ORBIT_API_KEY;

  // If env key is set, use simple fast-path (no DB lookup)
  if (envKey) {
    return (req: Request, res: Response, next: NextFunction) => {
      const fromHeader = req.headers['x-api-key'];
      const authHeader = req.headers['authorization'];
      const fromBearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
      const supplied = fromHeader ?? fromBearer;

      if (supplied === envKey) return next();
      res.status(401).json({ ok: false, error: 'unauthorized' });
    };
  }

  // No env key — check DB for auto-generated key
  if (!pool) return (_req: Request, _res: Response, next: NextFunction) => next();

  return async (req: Request, res: Response, next: NextFunction) => {
    const dbKey = await getDbApiKey(pool);

    // No key configured yet (setup mode) — allow all requests
    if (!dbKey) return next();

    const fromHeader = req.headers['x-api-key'];
    const authHeader = req.headers['authorization'];
    const fromBearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const supplied = fromHeader ?? fromBearer;

    if (supplied === dbKey) return next();
    res.status(401).json({ ok: false, error: 'unauthorized' });
  };
}
