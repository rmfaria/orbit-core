/**
 * orbit-core — Admin authentication routes (first-access password setup + login)
 *
 * All endpoints are PUBLIC (registered before the auth middleware).
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from 'crypto';
import { invalidateApiKeyCache } from '../auth.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const SCRYPT_KEYLEN = 64;

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

async function getSetting(pool: Pool, key: string): Promise<string> {
  const { rows } = await pool.query(
    `SELECT value FROM orbit_settings WHERE key = $1`,
    [key],
  );
  return rows[0]?.value ?? '';
}

async function setSetting(pool: Pool, key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO orbit_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
    [key, value],
  );
}

// ── Router ─────────────────────────────────────────────────────────────────────

export function authRouter(pool: Pool): Router {
  const router = Router();

  // GET /api/v1/auth/status — is first-access setup needed?
  router.get('/auth/status', async (_req: Request, res: Response) => {
    try {
      const hash = await getSetting(pool, 'admin_password_hash');
      res.json({ ok: true, setup_complete: hash.length > 0 });
    } catch {
      res.status(500).json({ ok: false, error: 'Failed to check auth status' });
    }
  });

  // POST /api/v1/auth/setup — one-time admin password creation
  router.post('/auth/setup', async (req: Request, res: Response) => {
    try {
      const { password } = req.body;
      if (!password || typeof password !== 'string' || password.length < 6) {
        return res.status(400).json({ ok: false, error: 'Password must be at least 6 characters' });
      }

      // Prevent re-setup if password already exists
      const existing = await getSetting(pool, 'admin_password_hash');
      if (existing.length > 0) {
        return res.status(409).json({ ok: false, error: 'Admin password already configured. Use /auth/login instead.' });
      }

      // Hash and store password
      const hashed = hashPassword(password);
      await setSetting(pool, 'admin_password_hash', hashed);

      // Resolve API key: env var takes precedence, otherwise auto-generate
      let apiKey = process.env.ORBIT_API_KEY || '';
      if (!apiKey) {
        apiKey = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
        await setSetting(pool, 'admin_api_key', apiKey);
        invalidateApiKeyCache();
      }

      res.json({ ok: true, api_key: apiKey });
    } catch {
      res.status(500).json({ ok: false, error: 'Setup failed' });
    }
  });

  // POST /api/v1/auth/login — validate password and return API key
  router.post('/auth/login', async (req: Request, res: Response) => {
    try {
      const { password } = req.body;
      if (!password || typeof password !== 'string') {
        return res.status(400).json({ ok: false, error: 'Password is required' });
      }

      const hash = await getSetting(pool, 'admin_password_hash');
      if (!hash) {
        return res.status(400).json({ ok: false, error: 'Admin password not configured. Use /auth/setup first.' });
      }

      if (!verifyPassword(password, hash)) {
        return res.status(401).json({ ok: false, error: 'Invalid password' });
      }

      // Return the API key
      const apiKey = process.env.ORBIT_API_KEY || await getSetting(pool, 'admin_api_key');
      res.json({ ok: true, api_key: apiKey });
    } catch {
      res.status(500).json({ ok: false, error: 'Login failed' });
    }
  });

  return router;
}
