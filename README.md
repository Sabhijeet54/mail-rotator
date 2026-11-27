# Mail Rotator

Next.js (App Router) + Postgres + Nodemailer. Sends email through your **own** SMTP mailboxes
(Gmail / Outlook / iCloud / Yahoo / Zoho / custom), rotating recipients round-robin across them and
never exceeding a mailbox's daily cap. No custom server or socket.io, so it deploys to Vercel as-is.

## Run locally

```bash
npm install
createdb mail_rotator            # any Postgres 13+
cp .env.example .env.local       # then fill in the values
npm run db:migrate
npm run dev                      # http://localhost:3000
```

## Deploy to Vercel

1. Create a Postgres database (Vercel Storage → Neon, or neon.tech / Supabase). Copy its **pooled** connection string.
2. Import the repo in Vercel. Under Settings → Environment Variables add:
   - `DATABASE_URL` — the pooled connection string
   - `ENCRYPTION_KEY` — long random string (`openssl rand -hex 32`). Never change it later: stored SMTP passwords are encrypted with it.
   - `CRON_SECRET` — random string; Vercel Cron sends it to `/api/cron/process-queue`.
   - `BACKGROUND_WORKER` is not needed: on Vercel the in-server worker is skipped automatically.
3. Deploy. `npm run build` applies `db/schema.sql` automatically before building.
4. Sending on Vercel: serverless functions can't run a background loop, and the Hobby plan allows only a
   daily Vercel Cron. Create a free cron-job.org job that calls
   `https://<your-site>/api/cron/process-queue?key=<CRON_SECRET>` every minute. While the Campaigns
   page is open it also triggers sending every 15 s.

## Render free plan: SMTP relay

Render's free plan blocks outbound SMTP ports 25/465/587, so mailbox tests time out there. To keep the app on
Render, let a Vercel deployment of this same repo do the SMTP part:

- On Vercel: set `SMTP_RELAY_SECRET` (long random string). This enables `/api/smtp-relay`.
- On Render: set the same `SMTP_RELAY_SECRET` and `SMTP_RELAY_URL=https://<vercel-site>`.

Render then sends every mailbox test and email over HTTPS to the relay. Vercel limits a request body to
about 4.5 MB, so large attachments will fail through the relay.

## How sending works

- Starting a send writes one row per recipient to `outbound_messages`, with `scheduled_at` spaced by the gap.
- `instrumentation.js` starts a background sender (`lib/worker.js`) when the server boots. Every few seconds it
  sends what is due, starts scheduled campaigns, resets daily caps and checks replies. No browser needs to be open.
- The Campaigns page only polls `/api/campaigns/:id/progress` for the live log.
- On Render's free plan the server sleeps after ~15 min without visits; queued mail continues when it wakes.
  Optional keep-awake: a cron-job.org job hitting `/api/cron/process-queue?secret=<CRON_SECRET>` every 5 minutes.
- If the assigned mailbox is paused or at its cap, another mailbox of the same send is used; if all are full
  the message waits an hour and retries (caps reset daily).
- Addresses in the `suppressions` table are skipped automatically.

## Structure

```
app/                   pages (sidebar layout) + app/api/* route handlers
components/            Sidebar, Drawer (right slide-over), shared UI
db/schema.sql          all tables: mailboxes, contacts, campaigns, sequences, inbox, templates,
                       suppressions, events, scheduled_jobs, activity_logs, settings
lib/mailboxes.js       add / import / test / update / remove mailboxes
lib/queue.js           enqueue, round-robin, daily caps, send loop
middleware.js          login gate (sessions); admin account is fixed in lib/auth.js
app/admin              admin panel: create user logins with a validity period
```

All sidebar modules are built:

- **Contacts** — upload CSV / Excel (.xlsx) with `first_name, last_name, email` (+ company, tags, any extra column),
  search, tag, edit, export. Names are auto-capitalised.
- **Campaigns** — recipients from an uploaded file, saved Contacts (by tag) or a pasted list; placeholders
  `{first_name} {last_name} {name} {email} {company}` and `{{any_column}}`, fallback `{first_name|there}`.
  Send now, after N minutes/hours/days, or at a date & time. Pause / resume / stop.
- **Subject rotation** — upload 50–150 subjects (CSV / Excel / TXT, column `subject`). Each mailbox walks the shuffled
  list from its own offset, so a mailbox never repeats a subject back-to-back and mailboxes don't send the same one at once.
- **Templates** — saved subject lists and message templates, usable from Campaigns.
- **Sequences** — follow-ups N days later, same mailbox, same thread ("Re:"), stopped automatically on reply.
- **Unified Inbox** — replies pulled over IMAP every 5 min (same app password; Gmail needs IMAP enabled), matched to the
  campaign + person, auto-labelled (interested / meeting / not interested / out of office / unsubscribe), 1–5 star rating,
  star, reply in-thread. "Unsubscribe" replies and bounces go to the Suppression List.
- **Scheduled Jobs, Analytics, Suppression List, Account Health, Settings, Activity Logs.**

### Background sending

While any page is open, the app ticks `/api/queue/tick` every 20 s (sends due mail, starts scheduled sends, queues
follow-ups, checks replies every 5 min). For scheduled sends with the browser closed, create a free cron at
cron-job.org that calls `https://<your-site>/api/cron/process-queue?key=<CRON_SECRET>` every minute.

## Notes

- Use **app passwords**. Gmail / iCloud / Yahoo need 2-step verification first. Outlook may have SMTP basic-auth disabled.
- Attachments are limited to 3 MB total (Vercel request body limit is 4.5 MB).
- Only send to people who expect your mail and include a way to opt out. Rotation doesn't stop providers from blocking
  accounts that send unsolicited bulk mail.

## Logins and admin panel

- Everyone signs in at `/login`. The admin account is fixed in `lib/auth.js` (email + scrypt hash);
  it is not stored in the database and cannot be changed from the app. Change it only by editing that file.
- The admin only gets the **Admin Panel** (`/admin`): create licence accounts (email + password),
  set the access period (from date to date), and delete accounts. The admin cannot open the mail features.
- Users get every mail feature but not the Admin Panel. Outside their access period every page and API call
  sends them to `/access-expired`.
