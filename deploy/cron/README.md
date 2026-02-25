# Cron Templates

Templates dos arquivos `/etc/cron.d/` instalados no servidor de produção.

## Instalação

1. Copie o arquivo para `/etc/cron.d/`
2. Substitua os placeholders `<...>` pelos valores reais:
   - `<ORBIT_API_KEY>` → valor de `ORBIT_API_KEY` em `/etc/systemd/system/orbit-core-api.service`
   - `<N8N_API_KEY>` → chave gerada em **n8n → Settings → n8n API**
   - `<OPENSEARCH_PASS>` → senha do usuário `admin` no OpenSearch
3. Restrinja permissões: `chmod 0640 /etc/cron.d/<arquivo>`
4. Recarregue: `systemctl reload cron`

## Importante

Use `ORBIT_API=http://localhost:3000` (não a URL pública HTTPS).
O proxy reverso (Traefik/nginx) pode descartar silenciosamente requisições de ingestão,
resultando em `exit 0` sem dados sendo gravados no banco.

## Arquivos

| Arquivo | Frequência | Função |
|---|---|---|
| `openclaw-nagios-orbitcore-metrics` | 1 min | Perfdata Nagios → métricas |
| `openclaw-nagios-orbitcore-events` | 1 min | Eventos HARD Nagios → eventos |
| `orbit-n8n` | 1 min | Falhas n8n → eventos |
| `openclaw-wazuh-orbitcore` | 2 min | Alertas Wazuh/OpenSearch → eventos |
