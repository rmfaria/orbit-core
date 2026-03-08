import type { Request, Response, NextFunction } from 'express';
import type { Pool } from 'pg';
import { timingSafeEqual } from 'crypto';
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
    // C2-fix: preserve last known good key on DB failure instead of clearing
    if (_cachedDbKey === null) _cachedDbKey = '';
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

      // H1-fix: timing-safe comparison
      if (typeof supplied === 'string' && supplied.length === envKey.length &&
          timingSafeEqual(Buffer.from(supplied), Buffer.from(envKey))) return next();
      res.status(401).json({ ok: false, error: 'unauthorized' });
    };
  }

  // C2-fix: deny all when no pool and no env key (no open setup mode)
  if (!pool) return (_req: Request, res: Response) => {
    res.status(503).json({ ok: false, error: 'database not configured' });
  };

  return async (req: Request, res: Response, next: NextFunction) => {
    const dbKey = await getDbApiKey(pool);

    // No key configured yet (setup mode) — allow all requests
    if (!dbKey) return next();

    const fromHeader = req.headers['x-api-key'];
    const authHeader = req.headers['authorization'];
    const fromBearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const supplied = fromHeader ?? fromBearer;

    // H1-fix: timing-safe comparison
    if (typeof supplied === 'string' && supplied.length === dbKey.length &&
        timingSafeEqual(Buffer.from(supplied), Buffer.from(dbKey))) return next();
    res.status(401).json({ ok: false, error: 'unauthorized' });
  };
}
