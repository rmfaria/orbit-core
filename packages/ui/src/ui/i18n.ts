/**
 * orbit-core — i18n
 *
 * Centralised string catalog.  All user-visible strings live here so adding a
 * new locale is a single file change: implement the `Translations` type and
 * register it in `catalog`.
 *
 * Usage
 *   import { t } from './i18n';
 *   <button>{t('save')}</button>
 *
 * Adding a locale
 *   1. Add the locale key to `LOCALES`.
 *   2. Add a full `Translations` object (TypeScript will error on missing keys).
 *   3. Optionally persist it with: localStorage.setItem('orbit_locale', 'pt-BR')
 */

// ─── Locale list ──────────────────────────────────────────────────────────────

export const LOCALES = ['en', 'pt-BR'] as const;
export type Locale = (typeof LOCALES)[number];

// ─── String catalog type ──────────────────────────────────────────────────────
// Mapped to `string` so locale overrides can use different string literals.

type Translations = { [K in keyof typeof en]: string };

// ─── English (default) ────────────────────────────────────────────────────────

const en = {

  // ── Navigation ──────────────────────────────────────────────────────────────
  nav_home:         'Home',
  nav_system:       '⬡ System',
  nav_sources:      'Sources',
  nav_events:       'Events',
  nav_metrics:      'Metrics',
  nav_correlations: 'Correlations',
  nav_alerts:       '🔔 Alerts',
  nav_connectors:   '🔌 Connectors',
  nav_dashboards:   '⊞ Dashboards',
  nav_admin:        '⚙ Administration',

  // ── Common actions ───────────────────────────────────────────────────────────
  save:          'Save',
  saving:        'Saving…',
  saved:         'Saved ✓',
  cancel:        'Cancel',
  delete:        'Delete',
  edit:          '✎ Edit',
  open:          'Open',
  search:        'Search',
  test:          'Test',
  add:           'Add',
  remove:        'Remove',
  enable:        'Enable',
  disable:       'Disable',
  reload:        'Reload',
  optional:      'Optional',
  loading:       'Loading…',
  all:           '— all —',

  // ── Common labels ────────────────────────────────────────────────────────────
  name:          'Name',
  type:          'Type',
  mode:          'Mode',
  status:        'Status',
  title:         'Title',
  description:   'Description',
  namespace:     'Namespace',
  metric:        'Metric',
  metrics_csv:   'Metrics (comma-separated)',
  asset:         'Asset',
  severity:      'Severity',
  operator:      'Operator',
  value:         'Value',
  interval:      'Interval',
  duration:      'Duration',
  error:         'Error',
  actions:       'Actions',
  channels:      'Channels',
  created_at:    'Created at',
  id_slug:       'ID (slug)',
  url:           'URL',
  bot_token:     'Bot Token',
  chat_id:       'Chat ID',
  headers_json:  'Headers (JSON, optional)',

  // ── Auth ──────────────────────────────────────────────────────────────────────
  auth_admin:    'admin',
  auth_no_auth:  'no auth',
  auth_settings: 'Settings',

  // ── System tab ───────────────────────────────────────────────────────────────
  sys_title:         'Infrastructure',
  sys_loading:       'Loading system…',
  sys_refresh_hint:  'updates every 5s',
  sys_cpu:           'CPU',
  sys_memory:        'Memory',
  sys_process:       'Process',
  sys_network:       'Network',
  sys_db_pool:       'PostgreSQL Pool',
  sys_workers:       'Workers',
  sys_load_1m:       'load avg 1m',
  sys_vcpu:          'vCPU',
  sys_free:          'free',
  sys_heap:          'heap',
  sys_pid:           'PID',
  sys_node:          'Node',
  sys_started:       'started',
  sys_connected:     'Connected',
  sys_disconnected:  'Disconnected',
  sys_total:         'total',
  sys_idle:          'idle',
  sys_waiting:       'waiting',
  sys_alive:         'OK',
  sys_stale:         'STALE',
  sys_beats:         'beats',
  sys_errors:        'errors',
  sys_last:          'last',
  sys_proc_unavail:  '/proc/net/dev not available in this environment',
  sys_no_proc:       'Reading /proc not available in this environment',

  // ── Home tab ──────────────────────────────────────────────────────────────────
  home_subtitle:      'Spatial dashboard • continuous metrics (Nagios/Wazuh) • ',
  home_subtitle_link: 'sources',
  home_charts_count:  '{n}/6 charts',
  home_add_chart:     '+ chart',
  home_restore:       '↺ restore ({n})',
  home_add_eps:       '+ EPS',
  home_live_feed:     'Live Feed',
  home_no_events:     'No events in the period',
  home_suri_hint:     'last 5 min',
  chart_remove:       'Remove chart',

  // ── Events / Feed ─────────────────────────────────────────────────────────────
  events_eps_title:       'EPS — Events per second',
  events_loading:         ' · loading…',
  events_no_data:         'No data in the period',
  events_col_timestamp:   'Timestamp',
  events_col_asset:       'Asset',
  events_col_namespace:   'Namespace',
  events_col_kind:        'Kind',
  events_col_severity:    'Severity',
  events_col_title:       'Title',
  events_col_message:     'Message',
  events_see_log:         '▶ view log',
  events_close:           '▲ close',

  // ── Nagios tab ────────────────────────────────────────────────────────────────
  nagios_col_state:        'State',
  nagios_col_host:         'Host',
  nagios_col_service:      'Service',
  nagios_col_severity:     'Severity',
  nagios_col_last_change:  'Last change',
  nagios_col_output:       'Output',
  nagios_no_services:      'No Nagios services found in the period',
  nagios_services_count:   '{n} services',

  // ── Correlations tab ──────────────────────────────────────────────────────────
  corr_title:       'Event × Metric Correlations',
  corr_desc1:       'Metric anomalies automatically detected around medium/high/critical events.',
  corr_desc2:       'z-score ≥ 2σ or relative change ≥ 50%.',
  corr_count:       '{n} correlations',
  corr_no_data:       'No correlations found. Worker runs every 5 min and requires metrics in the same namespace as the event\'s asset.',
  corr_col_event:     'Event (ts)',
  corr_col_asset:     'Asset',
  corr_col_metric:    'Metric',
  corr_col_base:      'Baseline avg',
  corr_col_peak:      'Peak',
  corr_col_base_peak: 'Baseline → Peak',
  corr_col_anomaly:   'Anomaly',
  corr_col_zscore:    'z-score',
  corr_col_rel:       'Δ rel',
  corr_col_det:       'Detected at',

  // ── Metrics tab ───────────────────────────────────────────────────────────────
  metrics_no_asset:  'Select asset / namespace / metric',

  // ── Sources tab ───────────────────────────────────────────────────────────────
  sources_select:        'Select a configured source to open the workspace.',
  sources_nagios_desc:   'Services, events and metrics (perfdata)',
  sources_wazuh_desc:    'Security alerts, rules and audit logs via passive connector',
  sources_view_events:   'View Events',
  sources_manual:        '📄 Manual',

  // ── Alerts tab ────────────────────────────────────────────────────────────────
  alerts_no_api_key:       'Configure the Anthropic API Key in Admin → AI Agent before using.',
  alerts_confirm_delete:   'Delete this rule?',
  alerts_rules_count:      '{n} rule(s)',
  alerts_new_rule:         '+ New Rule',
  alerts_cancel_rule:      '✕ Cancel',
  alerts_form_title:       'New Alert Rule',
  alerts_name_ph:          'Ex: High CPU',
  alerts_asset_ph:         'host:portn8n (empty=all)',
  alerts_ns_ph:            'nagios (empty=all)',
  alerts_metric_ph:        'cpu (empty=all)',
  alerts_cond_type:        'Condition type',
  alerts_cond_threshold:   'Threshold (value)',
  alerts_cond_nodata:      'No data',
  alerts_aggregation:      'Aggregation',
  alerts_window_min:       'Window (min)',
  alerts_save_rule:        'Save Rule',
  alerts_no_channels:      'No channels configured',
  alerts_col_name:         'Name',
  alerts_col_target:       'Target',
  alerts_col_condition:    'Condition',
  alerts_col_sev:          'Sev',
  alerts_col_state:        'State',
  alerts_col_last_val:     'Last value',
  alerts_col_channels:     'Channels',
  alerts_col_actions:      'Actions',
  alerts_no_rules:         'No rules configured. Create the first one above.',
  alerts_btn_toggle_off:   'Deactivate',
  alerts_btn_toggle_on:    'Activate',
  alerts_btn_silence:      'Silence 1h',
  alerts_btn_remove:       'Remove',
  alerts_channels_count:   '{n} channel(s)',
  alerts_new_channel:      '+ New Channel',
  alerts_cancel_channel:   '✕ Cancel',
  alerts_channel_title:    'New Notification Channel',
  alerts_id_ph:            'telegram-ops',
  alerts_channel_name_ph:  'Telegram NOC',
  alerts_save_channel:     'Save Channel',
  alerts_notif_col_time:   'Time',
  alerts_notif_col_rule:   'Rule',
  alerts_notif_col_ch:     'Channel',
  alerts_notif_col_event:  'Event',
  alerts_notif_col_status: 'Status',
  alerts_notif_col_error:  'Error',
  alerts_no_notifs:        'No notifications sent yet.',
  alerts_notif_ok:         '✓ Notification sent successfully',

  // ── Connectors tab ────────────────────────────────────────────────────────────
  conn_title:          '📋 Connectors',
  conn_confirm_delete: 'Remove connector "{id}"?',
  conn_btn_disable:    '⊘ Disable',
  conn_btn_push:       '📤 Push',
  conn_btn_test:       '⚡ Test',
  conn_btn_remove:     '🗑',
  conn_btn_disable_tt: 'Disable',
  conn_btn_push_tt:    'Send payload',
  conn_btn_test_tt:    'Test',
  conn_btn_remove_tt:  'Remove',
  conn_runs_start:     'Start',
  conn_runs_status:    'Status',
  conn_runs_ingested:  'Ingested',
  conn_runs_raw:       'Raw size',
  conn_runs_duration:  'Duration',
  conn_runs_error:     'Error',
  conn_push_title:     '📤 Push — live ingest',
  conn_pull_url:       'Pull URL',
  conn_pull_interval:  'Pull interval (minutes)',
  conn_spec_dsl:       'Spec DSL (JSON)',
  conn_save_draft:     'Save as Draft',
  conn_desc_opt:       'Description (optional)',

  // ── Dashboards tab ────────────────────────────────────────────────────────────
  dash_title:        '⊞ Dashboards',
  dash_desc:         'Custom dashboards with any data source.',
  dash_confirm_del:  'Delete this dashboard?',
  dash_btn_open:     'Open',
  dash_btn_edit:     '✎ Edit',
  dash_btn_delete:   '× Delete',
  dash_widgets:      'Widgets ({n})',
  dash_valid:        '✓ valid: {n}',
  dash_invalid:      '✗ invalid: {n}',
  dash_source:       'source: {s}',
  dash_type:         'type: {t}',
  dash_ai_loading:   'Querying Claude…',
  dash_span_half:    '1 — half',
  dash_span_full:    '2 — full',
  dash_event_type:   'Event type',
  dash_all_assets:   '— all assets —',
  dash_all_ns:       '— all namespaces —',
  dash_all_sev:      '— all severities —',

  // ── Admin tab ─────────────────────────────────────────────────────────────────
  admin_title:              'Administration',
  admin_configure_conn:     'Configure connectors',
  admin_key_ph:             'your-key-here',
  admin_reload_hint:        '# Reload and restart:',
  admin_ai_title:           'AI Agent — Dashboard Builder',
  admin_api_desc:           'Security settings and API access.',
  admin_checking:           'Checking…',
  admin_api_check_err:      'Could not verify API status.',
  admin_api_protected:      'API protected',
  admin_api_server_key:     '— ORBIT_API_KEY configured on the server',
  admin_api_open:           'API open',
  admin_api_no_auth:        '— no authentication',
  admin_api_protect_hint:   'To protect, set ',
  admin_api_protect_hint2:  'on the orbit-core server and restart the service.',

  // ── Sources tab (extra) ───────────────────────────────────────────────────────
  sources_active:      'ACTIVE',
  sources_n8n_desc:    'Failed and stuck workflow runs (Error Trigger + polling)',
  sources_connector:   '⚙ Connector',

  // ── Alerts extra ─────────────────────────────────────────────────────────────
  alerts_state_disabled:   'DISAB.',
  alerts_state_silenced:   'SILENC.',
  alerts_subtab_rules:     '📋 Rules',
  alerts_subtab_channels:  '📡 Channels',
  alerts_subtab_history:   '📜 History',
  alerts_no_channels_list: 'No channels configured. Create the first one above.',
  alerts_history_count:    'Last {n} notification(s)',
  alerts_no_rules_list:    'No rules configured. Create the first one above.',

  // ── Connectors extra ──────────────────────────────────────────────────────────
  conn_runs_history:   'Run History',
  conn_no_runs:        'No runs recorded.',
  conn_push_copied:    '✓ Copied',
  conn_push_copy_curl: '📋 Copy curl',
  conn_push_sending:   '⏳ Sending…',
  conn_push_send:      '📤 Send and Ingest',
  conn_test_dry_run:   '⚡ Test Dry-Run',
  conn_test_testing:   '⏳ Testing…',
  conn_test_run_btn:   '⚡ Run Test',
  conn_new_title:      'New Connector',
  conn_ai_title:       '✨ Generate Connector with AI',
  conn_ai_model:       'Model',
  conn_ai_generating:  '⏳ Generating…',
  conn_ai_generate:    '✨ Generate Spec',
  conn_approve:        '✓ Approve',

  // ── Dashboards extra ──────────────────────────────────────────────────────────
  dash_name_required:   'Dashboard name is required.',
  dash_widget_required: 'Add at least 1 widget.',

  // ── Error states ─────────────────────────────────────────────────────────────
  err_prefix:         'Error: ',
  err_api_key:        'API protected by key. Configure the ',
  err_api_key_mid:    ' in',
  err_api_key_suffix: 'to load data.',

  // ── Error boundary ────────────────────────────────────────────────────────────
  err_boundary_reload: 'Reload',

} as const;

// ─── Portuguese – Brazil (skeleton; extend as needed) ─────────────────────────

const ptBR: Partial<Translations> = {
  // nav
  nav_home:         'Home',
  nav_system:       '⬡ Sistema',
  nav_sources:      'Fontes',
  nav_events:       'Eventos',
  nav_metrics:      'Métricas',
  nav_correlations: 'Correlações',
  nav_alerts:       '🔔 Alertas',
  nav_connectors:   '🔌 Connectors',
  nav_dashboards:   '⊞ Dashboards',
  nav_admin:        '⚙ Administração',
};

// ─── Catalog ──────────────────────────────────────────────────────────────────

const catalog: Record<Locale, Translations> = {
  en,
  'pt-BR': { ...en, ...ptBR },
};

// ─── Active locale ────────────────────────────────────────────────────────────

function getInitialLocale(): Locale {
  const stored = localStorage.getItem('orbit_locale') as Locale | null;
  if (stored && (LOCALES as readonly string[]).includes(stored)) return stored;
  const browser = navigator.language;
  if (browser.startsWith('pt')) return 'pt-BR';
  return 'en';
}

let _locale: Locale = getInitialLocale();

export function setLocale(l: Locale): void {
  _locale = l;
  localStorage.setItem('orbit_locale', l);
}

export function getLocale(): Locale {
  return _locale;
}

// ─── Translation function ──────────────────────────────────────────────────────

export function t(key: keyof Translations): string {
  return catalog[_locale][key] as string;
}
