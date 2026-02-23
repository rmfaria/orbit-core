# @orbit/api

Express API for Orbit Core.

## Endpoints

- `GET /api/v1/health`
- `POST /api/v1/query` (placeholder)

## Dev

```bash
pnpm --filter @orbit/api dev
```

Env:

- `PORT` (default 3000)
- `DATABASE_URL` (used later when query route executes plans)
