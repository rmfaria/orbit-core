import { Router, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import { verifyLicenseJwt } from './verify.js';
import { invalidateLicenseCache, loadLicenseState } from './middleware.js';

export function licenseRouter(pool: Pool): Router {
  const router = Router();

  // GET /api/v1/license/status — public (no auth required)
  router.get('/license/status', async (_req: Request, res: Response) => {
    try {
      const state = await loadLicenseState(pool);
      res.json({
        ok: true,
        license: {
          status: state.status,
          plan: state.claims?.plan ?? null,
          email: state.claims?.email ?? null,
          deployment_id: state.claims?.sub ?? null,
          grace_remaining_ms: state.graceRemaining ?? null,
          message: state.message ?? null,
        },
      });
    } catch (err: unknown) {
      res.status(500).json({ ok: false, error: 'Failed to load license state' });
    }
  });

  // POST /api/v1/license/activate — public (no auth required)
  router.post('/license/activate', async (req: Request, res: Response) => {
    const { license_key } = req.body;
    if (!license_key || typeof license_key !== 'string') {
      return res.status(400).json({ ok: false, error: 'license_key is required' });
    }

    const result = verifyLicenseJwt(license_key.trim());
    if (!result.valid) {
      return res.status(400).json({ ok: false, error: result.reason });
    }

    await pool.query(
      `INSERT INTO orbit_settings (key, value, updated_at) VALUES ('license_key', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
      [license_key.trim()],
    );

    invalidateLicenseCache();

    res.json({
      ok: true,
      plan: result.claims.plan,
      email: result.claims.email,
      deployment_id: result.claims.sub,
    });
  });

  // DELETE /api/v1/license — remove license key (requires auth)
  router.delete('/license', async (_req: Request, res: Response) => {
    await pool.query(
      `UPDATE orbit_settings SET value = '', updated_at = now() WHERE key = 'license_key'`,
    );
    invalidateLicenseCache();
    res.json({ ok: true });
  });

  return router;
}
