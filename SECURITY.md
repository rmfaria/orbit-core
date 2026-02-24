# Security Policy

## Reportando uma vulnerabilidade

Por favor, reporte problemas de segurança de forma privada via
[GitHub Security Advisories](https://github.com/rmfaria/orbit-core/security/advisories).
Não abra issues públicas para vulnerabilidades.

## Segredos — o que nunca commitar

- `.env` (qualquer arquivo de ambiente com valores reais)
- Senhas de banco de dados (`DATABASE_URL` com credenciais)
- Chaves de API (`ORBIT_API_KEY`, chaves Anthropic, n8n API keys)
- Hostnames / IPs internos de produção
- Certificados TLS / chaves privadas

Use `.env.example` com valores placeholder.

## Chave de autenticação da API

Configure `ORBIT_API_KEY` no ambiente do servidor. A API exige o header
`X-Api-Key: <chave>` em todos os endpoints (exceto `/api/v1/health`).

Em produção, nunca deixe a API exposta sem `ORBIT_API_KEY` definida.

## AI Agent — chave Anthropic

A chave Anthropic (`X-Ai-Key`) é enviada do **navegador do usuário** diretamente
para a API no header da requisição e repassada à Anthropic. Ela **nunca é armazenada
no servidor** — nem em banco, nem em variáveis de ambiente.

A chave fica no `localStorage` do navegador sob `ai_api_key`. Cada usuário gerencia
sua própria chave em Admin → AI Agent.

## Produção

- Coloque a API atrás de um reverse proxy com TLS (Traefik / Nginx)
- Defina `ORBIT_API_KEY` com uma chave forte (≥ 32 caracteres aleatórios)
- Restrinja acesso por IP ao banco Postgres (`pg_hba.conf`)
- Mantenha `BATCH_SIZE` ≤ 100 e `limit` ≤ 10.000 nas queries para evitar sobrecarga
- Monitore o endpoint `/api/v1/metrics/prom` com Prometheus / Grafana

## SQL Injection

Todas as queries passam pelo OrbitQL que compila para SQL parametrizado.
Nenhum SQL raw é exposto via API. O handler de SQL raw está desabilitado
(`sql language not enabled`).
