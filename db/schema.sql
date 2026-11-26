-- Mail Rotator schema (Postgres 13+). Idempotent: safe to run on every deploy.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============ Mailbox Accounts ============
CREATE TABLE IF NOT EXISTS mailboxes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            text NOT NULL,
  from_name        text NOT NULL DEFAULT '',
  provider         text NOT NULL DEFAULT 'custom',   -- gmail | outlook | icloud | yahoo | zoho | custom
  smtp_host        text NOT NULL,
  smtp_port        int  NOT NULL DEFAULT 587,
  smtp_secure      boolean NOT NULL DEFAULT false,
  smtp_user        text NOT NULL,
  smtp_pass_enc    text NOT NULL,                     -- AES-256-GCM, see lib/crypto.js
  imap_host        text,                              -- used later by Unified Inbox
  imap_port        int,
  group_name       text NOT NULL DEFAULT 'Default',
  connection       text NOT NULL DEFAULT 'untested'   -- connected | error | untested
                     CHECK (connection IN ('connected','error','untested')),
  paused           boolean NOT NULL DEFAULT false,    -- state: active / paused
  daily_cap        int  NOT NULL DEFAULT 500,         -- 0 = no cap
  sent_today       int  NOT NULL DEFAULT 0,
  sent_today_date  date NOT NULL DEFAULT CURRENT_DATE,
  last_error       text,
  last_sync_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mailboxes_email_uq ON mailboxes (lower(email));

-- Every "Test connection" result (feeds Account Health).
CREATE TABLE IF NOT EXISTS mailbox_health_checks (
  id          bigserial PRIMARY KEY,
  mailbox_id  uuid NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  ok          boolean NOT NULL,
  latency_ms  int,
  error       text,
  checked_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mhc_mailbox_idx ON mailbox_health_checks (mailbox_id, checked_at DESC);

-- ============ Contacts ============
CREATE TABLE IF NOT EXISTS contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  first_name  text NOT NULL DEFAULT '',
  last_name   text NOT NULL DEFAULT '',
  company     text NOT NULL DEFAULT '',
  tags        text[] NOT NULL DEFAULT '{}',
  consent     text NOT NULL DEFAULT 'unknown' CHECK (consent IN ('opted_in','unknown','opted_out')),
  fields      jsonb NOT NULL DEFAULT '{}',            -- extra personalization fields
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_email_uq ON contacts (lower(email));
CREATE INDEX IF NOT EXISTS contacts_tags_idx ON contacts USING gin (tags);

-- ============ Suppression List ============
CREATE TABLE IF NOT EXISTS suppressions (
  email       text PRIMARY KEY,                       -- always stored lower-case
  reason      text NOT NULL DEFAULT 'manual',         -- manual | unsubscribe | bounce | complaint
  source      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ============ Templates ============
CREATE TABLE IF NOT EXISTS templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  subject     text NOT NULL DEFAULT '',
  body        text NOT NULL DEFAULT '',
  format      text NOT NULL DEFAULT 'html' CHECK (format IN ('html','text')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ============ Campaigns ============
CREATE TABLE IF NOT EXISTS campaigns (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  kind               text NOT NULL DEFAULT 'campaign' CHECK (kind IN ('campaign','quick')),
  status             text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','scheduled','running','paused','completed','stopped')),
  subject            text NOT NULL DEFAULT '',
  body               text NOT NULL DEFAULT '',
  format             text NOT NULL DEFAULT 'html' CHECK (format IN ('html','text')),
  send_as_bcc        boolean NOT NULL DEFAULT false,
  recipient_filter   jsonb NOT NULL DEFAULT '{}',     -- {search, tags[], consent[]}
  exclude_used       boolean NOT NULL DEFAULT false,  -- skip contacts used in another campaign
  delay_min_sec      int NOT NULL DEFAULT 10,
  delay_max_sec      int NOT NULL DEFAULT 30,
  stop_on_reply      boolean NOT NULL DEFAULT true,
  scheduled_at       timestamptz,
  started_at         timestamptz,
  completed_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaign_mailboxes (
  campaign_id  uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  mailbox_id   uuid NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  PRIMARY KEY (campaign_id, mailbox_id)
);

CREATE TABLE IF NOT EXISTS campaign_attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  filename      text NOT NULL,
  content_type  text,
  size_bytes    int NOT NULL DEFAULT 0,
  data          bytea NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ============ Sequences (follow-ups) ============
-- step_number 1 = first follow-up, sent delay_days after the previous step if no reply.
CREATE TABLE IF NOT EXISTS sequence_steps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  step_number  int  NOT NULL,
  delay_days   int  NOT NULL DEFAULT 3,
  subject      text NOT NULL DEFAULT '',                -- empty = "Re: <original subject>"
  body         text NOT NULL DEFAULT '',
  UNIQUE (campaign_id, step_number)
);

-- One row per person in a campaign. Also answers "already used in another campaign?".
CREATE TABLE IF NOT EXISTS campaign_recipients (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id    uuid REFERENCES contacts(id) ON DELETE SET NULL,
  email         text NOT NULL,
  vars          jsonb NOT NULL DEFAULT '{}',            -- snapshot of personalization fields
  mailbox_id    uuid REFERENCES mailboxes(id) ON DELETE SET NULL,  -- sticky sender (round-robin)
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','active','completed','replied','failed','suppressed','unsubscribed','bounced')),
  current_step  int  NOT NULL DEFAULT 0,
  next_step_at  timestamptz,
  replied_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, email)
);
CREATE INDEX IF NOT EXISTS cr_contact_idx ON campaign_recipients (contact_id);
CREATE INDEX IF NOT EXISTS cr_next_step_idx ON campaign_recipients (next_step_at) WHERE status = 'active';

-- ============ Outgoing queue (replaces the old socket.io loop) ============
CREATE TABLE IF NOT EXISTS outbound_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid REFERENCES campaigns(id) ON DELETE CASCADE,
  recipient_id  uuid REFERENCES campaign_recipients(id) ON DELETE CASCADE,
  mailbox_id    uuid REFERENCES mailboxes(id) ON DELETE SET NULL,
  step_number   int  NOT NULL DEFAULT 0,
  to_email      text NOT NULL,
  subject       text NOT NULL DEFAULT '',
  body          text NOT NULL DEFAULT '',
  format        text NOT NULL DEFAULT 'html',
  status        text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','sending','sent','failed','cancelled')),
  scheduled_at  timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz,
  message_id    text,                                   -- SMTP Message-ID, used to thread replies
  attempts      int  NOT NULL DEFAULT 0,
  locked_at     timestamptz,                            -- when a worker claimed it
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS om_due_idx ON outbound_messages (scheduled_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS om_mailbox_idx ON outbound_messages (mailbox_id, status);
CREATE INDEX IF NOT EXISTS om_campaign_idx ON outbound_messages (campaign_id, status);
CREATE INDEX IF NOT EXISTS om_message_id_idx ON outbound_messages (message_id);

-- ============ Unified Inbox ============
CREATE TABLE IF NOT EXISTS inbox_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox_id    uuid NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  campaign_id   uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  recipient_id  uuid REFERENCES campaign_recipients(id) ON DELETE SET NULL,
  outbound_id   uuid REFERENCES outbound_messages(id) ON DELETE SET NULL,
  message_id    text,
  in_reply_to   text,
  from_email    text NOT NULL,
  from_name     text NOT NULL DEFAULT '',
  subject       text NOT NULL DEFAULT '',
  snippet       text NOT NULL DEFAULT '',
  body          text NOT NULL DEFAULT '',
  category      text NOT NULL DEFAULT 'none'
                  CHECK (category IN ('none','interested','meeting','unsubscribe','not_interested','ooo')),
  is_read       boolean NOT NULL DEFAULT false,
  received_at   timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS inbox_msgid_uq ON inbox_messages (mailbox_id, message_id);
CREATE INDEX IF NOT EXISTS inbox_mailbox_idx ON inbox_messages (mailbox_id, received_at DESC);

-- ============ Analytics events ============
CREATE TABLE IF NOT EXISTS email_events (
  id           bigserial PRIMARY KEY,
  outbound_id  uuid REFERENCES outbound_messages(id) ON DELETE CASCADE,
  campaign_id  uuid REFERENCES campaigns(id) ON DELETE CASCADE,
  type         text NOT NULL CHECK (type IN ('sent','open','click','reply','bounce','unsubscribe')),
  meta         jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ev_campaign_idx ON email_events (campaign_id, type);

-- ============ Scheduled Jobs ============
CREATE TABLE IF NOT EXISTS scheduled_jobs (
  name          text PRIMARY KEY,                        -- process-queue | check-replies | send-followups | reset-daily-caps
  description   text NOT NULL DEFAULT '',
  enabled       boolean NOT NULL DEFAULT true,
  last_run_at   timestamptz,
  last_status   text,
  last_result   jsonb,
  last_duration_ms int
);
INSERT INTO scheduled_jobs (name, description) VALUES
  ('process-queue',    'Send due messages from the outbound queue'),
  ('send-followups',   'Queue the next sequence step for recipients who have not replied'),
  ('check-replies',    'Fetch replies from all connected mailboxes into the Unified Inbox'),
  ('reset-daily-caps', 'Reset sent_today counters at midnight')
ON CONFLICT (name) DO NOTHING;

-- ============ Activity Logs ============
CREATE TABLE IF NOT EXISTS activity_logs (
  id           bigserial PRIMARY KEY,
  level        text NOT NULL DEFAULT 'info' CHECK (level IN ('info','success','warn','error')),
  action       text NOT NULL,                            -- e.g. mailbox.added, message.sent
  entity_type  text,
  entity_id    text,
  message      text NOT NULL,
  meta         jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS logs_entity_idx ON activity_logs (entity_type, entity_id, id DESC);

-- ============ Settings ============
CREATE TABLE IF NOT EXISTS settings (
  key    text PRIMARY KEY,
  value  jsonb NOT NULL
);

-- ============ v0.3 additions ============
-- Saved subject lists (uploaded from CSV / Excel / text). Rotated per mailbox when sending.
CREATE TABLE IF NOT EXISTS subject_lists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  subjects    text[] NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Threading for follow-ups and replies sent from the Unified Inbox.
ALTER TABLE outbound_messages ADD COLUMN IF NOT EXISTS in_reply_to text;
ALTER TABLE outbound_messages ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'campaign';  -- campaign | followup | reply
ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS rating int;          -- 1..5, set by you
ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS starred boolean NOT NULL DEFAULT false;
ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS replied_by_me_at timestamptz;
ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS uid bigint;
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS imap_last_uid bigint;
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS imap_error text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS subject_list_id uuid REFERENCES subject_lists(id) ON DELETE SET NULL;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS total_recipients int NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS cr_email_idx ON campaign_recipients (lower(email));
CREATE INDEX IF NOT EXISTS om_recipient_idx ON outbound_messages (recipient_id, step_number);
CREATE INDEX IF NOT EXISTS logs_id_level_idx ON activity_logs (level, id DESC);
INSERT INTO scheduled_jobs (name, description) VALUES
  ('start-scheduled', 'Start campaigns whose scheduled time has arrived')
ON CONFLICT (name) DO NOTHING;

-- ============ v0.4: logins (admin panel) ============
-- The admin account is fixed in code (lib/auth.js) and is never stored here, so it can't be edited from the app.
CREATE TABLE IF NOT EXISTS app_users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL,
  name           text NOT NULL DEFAULT '',
  password_hash  text NOT NULL,
  valid_until    timestamptz NOT NULL,             -- login stops working after this
  disabled       boolean NOT NULL DEFAULT false,   -- admin can revoke access at any time
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_uq ON app_users (lower(email));

CREATE TABLE IF NOT EXISTS app_sessions (
  token_hash  text PRIMARY KEY,                    -- sha256 of the cookie value
  user_id     uuid REFERENCES app_users(id) ON DELETE CASCADE,   -- NULL = the fixed admin
  role        text NOT NULL CHECK (role IN ('admin','user')),
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_sessions_user_idx ON app_sessions (user_id);
