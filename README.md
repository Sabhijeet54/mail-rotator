# Mail Rotator (demo)

Next.js + Socket.IO + Nodemailer. Sends email through the user's **own** Gmail / Outlook /
iCloud / Yahoo / Zoho / custom-SMTP accounts, rotating one email per account with a delay
between sends so each account gets rest time.

## Run

```bash
npm install
npm run dev
# open http://localhost:3000
```

Demo login: `admin` / `admin123` (change it in `app/page.js`).

## How it works

1. **Add accounts** — pick a provider, enter the email + **app password**. The server does a real
   SMTP `verify()` before saving, so a bad login is rejected immediately. Add as many as you want.
2. **Compose** — subject, message, optional attachments.
3. **Recipients** — paste any text; emails are auto-extracted and de-duplicated.
4. **Gap** — set a min/max seconds gap (e.g. 10–30). A random gap is used between each send.
5. **Start** — recipient #1 goes from account #1, #2 from account #2, and so on; after the last
   account it loops back to the first. Live status shows each send in real time.

Per-account "daily limit" is optional (0 = no limit). When an account hits its limit the rotation
skips it.

## App passwords (quick links)

- Gmail: myaccount.google.com → Security → App passwords (needs 2-step verification)
- iCloud: appleid.apple.com → Sign-In and Security → App-Specific Passwords
- Yahoo: account security → Generate app password
- Outlook: Microsoft is disabling basic-auth SMTP on many accounts; if it fails, that account needs
  the Graph/OAuth route instead.

## Notes

- Accounts are kept in memory only; restarting the server clears them.
- Only send to people who expect your mail, from your own accounts, and include a way to opt out.
  Bulk unsolicited mail will get the accounts (and the app) blocked regardless of rotation.
