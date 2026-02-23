# Contributing

## Dev setup

- Node 22+
- pnpm

```bash
pnpm install
pnpm dev
```

## Repo conventions

- Keep **connectors / schedulers** no-AI (shell/python + cron), deterministic.
- Never commit secrets. Use `.env.example` only.
- Prefer small, reviewable PRs.

## Migrations

SQL migrations live in `packages/storage-pg/migrations/`.

- Add-only (never edit existing migrations once published)
- Use id prefix `000X_*.sql`
