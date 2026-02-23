import type { Request, Response, NextFunction } from 'express';
import type { Env } from './env.js';

// Middleware factory. If ORBIT_API_KEY is not set the middleware is a no-op
// (dev/local mode). When set, every request must supply the key via:
//   X-Api-Key: <key>
//   Authorization: Bearer <key>
export function makeAuthMiddleware(env: Env) {
  const key = env.ORBIT_API_KEY;
  if (!key) return (_req: Request, _res: Response, next: NextFunction) => next();

  return (req: Request, res: Response, next: NextFunction) => {
    const fromHeader = req.headers['x-api-key'];
    const authHeader = req.headers['authorization'];
    const fromBearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const supplied = fromHeader ?? fromBearer;

    if (supplied === key) return next();
    res.status(401).json({ ok: false, error: 'unauthorized' });
  };
}
