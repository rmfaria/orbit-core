# Security Policy

## Reporting a vulnerability

Please report security issues privately.

## Secrets

Do **not** commit:
- `.env`
- credentials (BasicAuth, Postgres passwords, API keys)
- internal hostnames/IPs that should not be public

Use environment variables and `.env.example`.

## Production

Production deployments should sit behind a reverse proxy (TLS + auth) and the API should enforce sane limits (query limits, cardinality controls).
