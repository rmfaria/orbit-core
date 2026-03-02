import type { Request, Response, NextFunction } from 'express';
import type { Pool } from 'pg';
import pino from 'pino';
import { verifyLicenseJwt, type LicenseClaims } from './verify.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }).child({ module: 'license' });

const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface LicenseState {
  status: 'valid' | 'grace' | 'expired' | 'unlicensed';
  claims?: LicenseClaims;
  graceRemaining?: number;
  message?: string;
}

// Module-level cache (avoids DB read on every request)
let cachedState: LicenseState | null = null;
let cacheTs = 0;
const CACHE_TTL = 60_000; // 60s

export async function loadLicenseState(pool: Pool): Promise<LicenseState> {
  const now = Date.now();
  if (cachedState && (now - cacheTs) < CACHE_TTL) return cachedState;

  const { rows } = await pool.query(
    `SELECT key, value FROM orbit_settings WHERE key IN ('license_key', 'first_boot_at')`,
  );
  const settings = Object.fromEntries(rows.map((r: any) => [r.key, r.value]));

  const licenseKey = settings.license_key || '';
  const firstBootAt = settings.first_boot_at ? new Date(settings.first_boot_at).getTime() : now;

  if (licenseKey) {
    const result = verifyLicenseJwt(licenseKey);
    if (result.valid) {
      cachedState = { status: 'valid', claims: result.claims };
    } else {
      cachedState = { status: 'expired', message: result.reason };
    }
  } else {
    const elapsed = now - firstBootAt;
    if (elapsed < GRACE_PERIOD_MS) {
      cachedState = {
        status: 'grace',
        graceRemaining: GRACE_PERIOD_MS - elapsed,
        message: `Trial period: ${Math.ceil((GRACE_PERIOD_MS - elapsed) / 86400000)} days remaining`,
      };
    } else {
      cachedState = { status: 'unlicensed', message: 'License required. Register at orbit-core.org' };
    }
  }

  cacheTs = now;
  return cachedState;
}

export function invalidateLicenseCache(): void {
  cachedState = null;
  cacheTs = 0;
}

export function makeLicenseMiddleware(pool: Pool | null) {
  if (!pool) return (_req: Request, _res: Response, next: NextFunction) => next();

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const state = await loadLicenseState(pool);

      if (state.status === 'valid' || state.status === 'grace') {
        (req as any).licenseState = state;
        return next();
      }

      return res.status(403).json({
        ok: false,
        error: 'license_required',
        message: state.message,
        register_url: 'https://orbit-core.org/register',
      });
    } catch (err) {
      logger.error({ err }, 'license check failed — allowing request');
      next();
    }
  };
}
