# Contributing

## Dev setup

- Node 22+
- pnpm

```bash
pnpm install
pnpm dev
```

## Ordem de build

O pacote `core-contracts` deve ser compilado **antes** de `api` e `ui`, pois ambos
dependem dos tipos gerados em `dist/`.

```bash
pnpm --filter @orbit/core-contracts build
pnpm --filter @orbit/api build
pnpm --filter @orbit/ui build
```

O `deploy.sh` garante essa ordem automaticamente.

## Convenções do repositório

- **Conectores / schedulers:** sem IA, determinísticos (shell/python + cron).
  Nunca use LLMs em conectores — eles precisam ser seguros para cron 24/7.
- **Commits:** seguir conventional commits (`feat:`, `fix:`, `docs:`, `chore:`).
- **Secrets:** nunca committar `.env`, chaves, senhas ou IPs internos. Use `.env.example`.
- **PRs pequenos e revisáveis** — preferível a PRs grandes.

## Migrations

Migrations SQL ficam em `packages/storage-pg/migrations/`.

- **Add-only** — nunca editar uma migration já publicada
- Prefixo numérico: `000X_*.sql` (ex: `0009_nova_feature.sql`)
- Usar `IF NOT EXISTS` / `IF EXISTS` para tornar idempotentes
- Migrations são aplicadas em ordem alfabética pelo `deploy.sh`

## Conectores

Ver [docs/connectors.md](docs/connectors.md) e os arquivos `README.md` / `INSTALL.md`
em cada pasta `connectors/<fonte>/`.

Padrões obrigatórios:
1. Determinístico / sem IA
2. State file com `fcntl.flock` (byte-offset ou ISO timestamp)
3. Batch ingest via `POST /api/v1/ingest/events`
4. Fingerprint para deduplicação
5. Autenticação via `ORBIT_API_KEY` (header `X-Api-Key`)
6. `BATCH_SIZE` ≤ 100 para eventos com payload grande (ex: Wazuh)

## Testes

```bash
pnpm test          # todos os pacotes
pnpm --filter @orbit/api test
```
