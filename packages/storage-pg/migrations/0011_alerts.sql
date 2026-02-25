-- Migration 0011: alert channels, rules and notification history

-- Notification channels (webhook or Telegram)
CREATE TABLE IF NOT EXISTS alert_channels (
  id         TEXT PRIMARY KEY,   -- slug: 'telegram-ops', 'webhook-pagerduty'
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL,      -- 'webhook' | 'telegram'
  config     JSONB NOT NULL,     -- webhook: { url, headers? } | telegram: { bot_token, chat_id }
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Alert rules with embedded state (avoids extra join on every worker tick)
CREATE TABLE IF NOT EXISTS alert_rules (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT    NOT NULL,
  enabled       BOOLEAN NOT NULL DEFAULT true,
  asset_id      TEXT,            -- NULL = match all assets
  namespace     TEXT,            -- NULL = match all namespaces
  metric        TEXT,            -- NULL = match all metrics
  condition     JSONB   NOT NULL,
  -- threshold: { kind:'threshold', op:'>'|'>='|'<'|'<=', value:number, window_min:int, agg:'avg'|'max' }
  -- absence:   { kind:'absence', window_min:int }
  severity      TEXT    NOT NULL DEFAULT 'medium',
  channels      TEXT[]  NOT NULL DEFAULT '{}',  -- array of alert_channels.id
  -- live state (updated by worker)
  state         TEXT    NOT NULL DEFAULT 'ok',  -- 'ok' | 'firing'
  fired_at      TIMESTAMPTZ,
  last_value    DOUBLE PRECISION,
  silence_until TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Notification history (keep last ~1000 per rule via retention in worker)
CREATE TABLE IF NOT EXISTS alert_notifications (
  id         BIGSERIAL PRIMARY KEY,
  rule_id    BIGINT REFERENCES alert_rules(id) ON DELETE CASCADE,
  channel_id TEXT    NOT NULL,
  event      TEXT    NOT NULL,   -- 'firing' | 'resolved'
  payload    JSONB,
  ok         BOOLEAN,
  error      TEXT,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled
  ON alert_rules (enabled) WHERE enabled = true;

CREATE INDEX IF NOT EXISTS idx_alert_notif_rule_sent
  ON alert_notifications (rule_id, sent_at DESC);
