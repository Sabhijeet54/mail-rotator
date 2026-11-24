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
   - `APP_USER` / `APP_PASSWORD` — login for the site (HTTP Basic Auth). The app refuses to run in production without them.
   - `CRON_SECRET` — random string; Vercel Cron sends it to `/api/cron/process-queue`.
3. Deploy. `npm run build` applies `db/schema.sql` automatically before building.

## How sending works (no socket.io)

- Starting a send writes one row per recipient to `outbound_messages`, with `scheduled_at` spaced by the gap.
- While the Campaigns page is open it calls `POST /api/queue/tick` every 2 s; each tick sends what is due
  (up to ~20 s of work) and the page polls `/api/campaigns/:id/progress` for the live log.
- If the page is closed, messages stay queued in Postgres and continue when it's reopened, or when the
  cron runs. `vercel.json` runs the cron once a day (the Hobby plan limit); on Pro change the schedule to
  `* * * * *` for fully background sending.
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
middleware.js          password gate
```

Built so far: Mailbox Accounts (full), Quick send on Campaigns, Dashboard. Other sidebar modules are placeholders;
their tables already exist.

## Notes

- Use **app passwords**. Gmail / iCloud / Yahoo need 2-step verification first. Outlook may have SMTP basic-auth disabled.
- Attachments are limited to 3 MB total (Vercel request body limit is 4.5 MB).
- Only send to people who expect your mail and include a way to opt out. Rotation doesn't stop providers from blocking
  accounts that send unsolicited bulk mail.
