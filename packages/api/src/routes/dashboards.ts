import { Router } from 'express';
import { z } from 'zod';
import type { DashboardSpec } from '@orbit/core-contracts';
import { DashboardSpecSchema } from '@orbit/core-contracts';

// MVP routes: validate proposals (no AI here; AI builder can live outside and call this)

export function dashboardsRouter(): Router {
  const r = Router();

  r.post('/dashboards/validate', (req, res) => {
    const parsed = DashboardSpecSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid DashboardSpec',
          details: parsed.error.issues,
        },
      });
    }

    const spec: DashboardSpec = parsed.data;

    // lightweight guardrails (server-side)
    const MAX_WIDGETS = 60;
    if (spec.widgets.length > MAX_WIDGETS) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Too many widgets (max ${MAX_WIDGETS})`,
        },
      });
    }

    return res.json({ ok: true, spec });
  });

  return r;
}
