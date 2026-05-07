# Deployment Guide

Guadalupe Sentinel runs as a single Node.js process (Express API + Vite SPA) backed by PostgreSQL.

## Required environment variables

```env
# Google OAuth (https://console.cloud.google.com → Credentials → OAuth 2.0 Client IDs)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# Comma-separated list of domains the app is reachable at (used to scope OAuth callbacks)
ALLOWED_DOMAINS=yourdomain.com,www.yourdomain.com

# Session encryption key — any long random string
SESSION_SECRET=...

# PostgreSQL connection string
DATABASE_URL=postgres://user:pass@host:5432/dbname

# Public base URL (used in email alert links)
PUBLIC_URL=https://yourdomain.com

# OpenAI API key (optional — required for AI briefings)
OPENAI_API_KEY=sk-...

# SMTP for alert emails (optional — required for email channel)
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=apikey
SMTP_PASS=SG.xxxx
SMTP_FROM=alerts@yourdomain.com
```

## Google OAuth setup

1. Go to [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials.
2. Create an **OAuth 2.0 Client ID** (type: Web application).
3. Add `https://yourdomain.com/api/callback` as an authorised redirect URI.
4. Copy the client ID and secret into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

## Database migration

The schema is idempotent — run it on every boot or manually:

```bash
psql "$DATABASE_URL" -f server/schema.sql
```

## Running

```bash
# Development (API on :3001, Vite on :5000)
npm run dev

# Production — build SPA then start API server
npm run build
node server.js
```

The API server serves the built SPA from `dist/` in production (single-port deploy).

## Subscription tiers

| Plan  | Max subscriptions | Channels              | AI briefings/day |
|-------|-------------------|-----------------------|------------------|
| free  | 2                 | push                  | 0                |
| pro   | 10                | push, email, webhook  | 50               |
| admin | unlimited         | all                   | unlimited        |

Set a user's plan via SQL:

```sql
UPDATE users SET plan = 'pro' WHERE email = 'user@example.com';
```
