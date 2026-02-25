# Contributing

**Creator:** Rodrigo Menchio <rodrigomenchio@gmail.com>

## Dev setup

- Node 22+
- pnpm

```bash
pnpm install
pnpm dev
```

## Build order

The `core-contracts` package must be built **before** `api` and `ui`, because both
depend on the generated types in `dist/`.

```bash
pnpm --filter @orbit/core-contracts build
pnpm --filter @orbit/api build
pnpm --filter @orbit/ui build
```

`deploy.sh` enforces this order automatically.

## Repository conventions

- **Connectors / schedulers:** no AI, deterministic (shell/python + cron).
  Do not use LLMs in connectors — they must be safe for 24/7 cron execution.
- **Commits:** use Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`).
- **Secrets:** never commit `.env`, keys, passwords, or internal IPs. Use `.env.example`.
- Prefer **small, reviewable PRs**.

## Migrations

SQL migrations live in `packages/storage-pg/migrations/`.

- **Add-only** — never edit a migration that has been published
- Numeric prefix: `000X_*.sql` (e.g. `0009_new_feature.sql`)
- Use `IF NOT EXISTS` / `IF EXISTS` to keep migrations idempotent
- Migrations are applied in lexicographic order by `deploy.sh`

## Connectors

See [`docs/connectors.md`](docs/connectors.md) and the `README.md` / `INSTALL.md` files
in each `connectors/<source>/` directory.

Required standards:
1. Deterministic / no AI
2. State file with `fcntl.flock` (byte-offset or ISO timestamp cursor)
3. Batch ingest via `POST /api/v1/ingest/events`
4. Fingerprint-based deduplication
5. Auth via `ORBIT_API_KEY` (`X-Api-Key` header)
6. Keep `BATCH_SIZE` ≤ 100 for large payload events (e.g. Wazuh)

## Testes

```bash
pnpm test          # todos os pacotes
pnpm --filter @orbit/api test
```
