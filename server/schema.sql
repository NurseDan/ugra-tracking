-- Guadalupe Sentinel server-side schema.
-- All tables use IF NOT EXISTS so this can run on every boot.

CREATE TABLE IF NOT EXISTS users (
  id            text primary key,
  email         text unique,
  first_name    text,
  last_name     text,
  profile_image_url text,
  provider      text not null default 'google',
  provider_id   text,
  plan          text not null default 'free',
  plan_expires_at timestamptz,
  default_email     text,
  default_min_level text not null default 'ORANGE',
  default_channels  jsonb not null default '["push"]'::jsonb,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
-- Safe migrations for existing deployments
ALTER TABLE users ADD COLUMN IF NOT EXISTS provider      text not null default 'google';
ALTER TABLE users ADD COLUMN IF NOT EXISTS provider_id   text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan          text not null default 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_expires_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_email     text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_min_level text not null default 'ORANGE';
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_channels  jsonb not null default '["push"]'::jsonb;

CREATE TABLE IF NOT EXISTS sessions (
  sid     varchar primary key,
  sess    jsonb     not null,
  expire  timestamptz not null
);
CREATE INDEX IF NOT EXISTS idx_session_expire ON sessions(expire);

-- Gauge time series. One row per (gauge, time).
CREATE TABLE IF NOT EXISTS gauge_readings (
  gauge_id    text not null,
  observed_at timestamptz not null,
  height_ft   double precision,
  flow_cfs    double precision,
  source      text,
  primary key (gauge_id, observed_at)
);
CREATE INDEX IF NOT EXISTS idx_gauge_readings_observed
  ON gauge_readings(gauge_id, observed_at desc);

-- Latest enriched snapshot per gauge for fast dashboard reads.
CREATE TABLE IF NOT EXISTS gauge_status (
  gauge_id    text primary key,
  height_ft   double precision,
  flow_cfs    double precision,
  observed_at timestamptz,
  alert_level text,
  rise_5m     double precision,
  rise_15m    double precision,
  rise_60m    double precision,
  is_stale    boolean,
  payload     jsonb,
  updated_at  timestamptz default now()
);

-- Alert escalation history.
CREATE TABLE IF NOT EXISTS incidents (
  id          uuid primary key default gen_random_uuid(),
  gauge_id    text not null,
  gauge_name  text,
  from_level  text,
  to_level    text,
  height_ft   double precision,
  flow_cfs    double precision,
  occurred_at timestamptz not null default now(),
  payload     jsonb
);
CREATE INDEX IF NOT EXISTS idx_incidents_occurred ON incidents(occurred_at desc);
CREATE INDEX IF NOT EXISTS idx_incidents_gauge ON incidents(gauge_id, occurred_at desc);

-- Per-source snapshot caches (latest payload only — fast dashboard reads).
CREATE TABLE IF NOT EXISTS source_cache (
  key         text primary key,           -- e.g. 'nws_alerts', 'ahps:HNTT2', 'nwm:3586192', 'canyon_lake', 'weather:08165500'
  fetched_at  timestamptz default now(),
  payload     jsonb not null
);

-- Tall append-only history table covering every upstream source the
-- poller touches (USGS readings live in their own table). Each row is
-- one fetched payload, retained for five years by the daily retention
-- sweep. (source, key, observed_at) is unique so re-fetching the same
-- snapshot is idempotent.
CREATE TABLE IF NOT EXISTS source_history (
  source      text not null,              -- 'nws_alerts' | 'ahps' | 'nwm' | 'weather' | 'canyon_lake'
  key         text not null default '',   -- '' for global sources, otherwise gauge id / lid / reach
  observed_at timestamptz not null,
  payload     jsonb not null,
  primary key (source, key, observed_at)
);
CREATE INDEX IF NOT EXISTS idx_source_history_observed
  ON source_history(source, observed_at desc);

-- User alert subscriptions.
-- A subscription can target either a gauge (gauge_id) or a NWS county/zone
-- (ugc_codes), or both. Channels jsonb lists the requested delivery methods.
CREATE TABLE IF NOT EXISTS alert_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         text references users(id) on delete cascade,
  gauge_id        text,                    -- null = all gauges (when not a county sub)
  ugc_codes       jsonb not null default '[]'::jsonb, -- e.g. ['TXC265','TXC031'] — NWS UGC county/zone codes
  nws_event_filter jsonb not null default '[]'::jsonb, -- restrict NWS dispatch to specific events; [] = all
  min_level       text not null default 'ORANGE',
  channels        jsonb not null default '[]'::jsonb,    -- ['push','email','sms','webhook']
  email           text,
  phone           text,
  webhook_url     text,
  webhook_secret  text,
  push_endpoint   text,
  push_p256dh     text,
  push_auth       text,
  enabled         boolean not null default true,
  created_at      timestamptz default now()
);
ALTER TABLE alert_subscriptions ADD COLUMN IF NOT EXISTS ugc_codes jsonb not null default '[]'::jsonb;
ALTER TABLE alert_subscriptions ADD COLUMN IF NOT EXISTS nws_event_filter jsonb not null default '[]'::jsonb;
CREATE INDEX IF NOT EXISTS idx_alert_subs_user ON alert_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_alert_subs_gauge ON alert_subscriptions(gauge_id);

-- Audit of every dispatch attempt (for dedup + diagnostics).
CREATE TABLE IF NOT EXISTS notifications_sent (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid references alert_subscriptions(id) on delete cascade,
  -- text rather than uuid: in addition to internal `incidents.id` (uuid)
  -- this column also stores opaque external IDs (e.g. NWS alert URIs)
  -- used for cross-tick dedup of source-driven (non-incident) dispatches.
  incident_id     text,
  channel         text not null,
  status          text not null,           -- 'sent' | 'failed' | 'dedup'
  error           text,
  sent_at         timestamptz default now()
);
-- Migrate older deployments that created the column as uuid.
ALTER TABLE notifications_sent
  ALTER COLUMN incident_id TYPE text USING incident_id::text;
CREATE INDEX IF NOT EXISTS idx_notifications_sent ON notifications_sent(sent_at desc);
CREATE INDEX IF NOT EXISTS idx_notifications_dedup ON notifications_sent(subscription_id, incident_id);
-- Hard idempotency guarantee for dispatch dedup: at most one
-- successfully-sent record per (subscription, incident, channel).
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_dedup_sent
  ON notifications_sent(subscription_id, incident_id, channel)
  WHERE status = 'sent';

-- Per-user AI usage counter (one row per user per calendar day).
CREATE TABLE IF NOT EXISTS ai_usage (
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date          date NOT NULL DEFAULT CURRENT_DATE,
  request_count int  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);

-- VAPID keypair (single row).
CREATE TABLE IF NOT EXISTS vapid_keys (
  id          int primary key default 1,
  public_key  text not null,
  private_key text not null,
  subject     text not null
);
