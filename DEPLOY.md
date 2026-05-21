# Deployment Guide

Guadalupe Sentinel runs as a single Node.js process: Express serves the API and the built Vite SPA from `dist/`, backed by PostgreSQL through `DATABASE_URL`.

## Local development

```bash
npm install
cp .env.example .env
npm test
npm run build
npm run dev
```

Use `.env` only for local development. Never commit it.

## Generic production deployment

The app is intentionally host-agnostic:

- Install command: `npm ci` (or `npm install` if your host does not use lockfiles)
- Build command: `npm run build`
- Start command: `npm start`

Required environment variables:

```env
DATABASE_URL=postgres://user:password@host:5432/database
SESSION_SECRET=replace_with_a_long_random_secret
PUBLIC_URL=https://your-app.example
```

Optional environment variables:

```env
OPENAI_API_KEY=
ADMIN_EMAILS=
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
STRIPE_SECRET_KEY=
STRIPE_PRICE_ID=
STRIPE_WEBHOOK_SECRET=
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
```

Production secrets belong in the cloud host's environment-variable or secret-manager settings, not in committed files.

## Cloud portability notes

- Railway can keep using `railway.toml`.
- Google Cloud Run can run this as a Node service or container, with Cloud SQL/PostgreSQL and Secret Manager.
- AWS App Runner can run this as a Node service, with RDS PostgreSQL and Secrets Manager.
- Render and Fly.io can use the same build/start/environment-variable pattern.
- Avoid vendor-specific deployment code unless a platform truly requires it.

## Health checks

`GET /health` returns `{ "ok": true }` as a lightweight liveness probe for cloud platforms. It intentionally does not depend on database access.

## Database initialization

The schema runs automatically on startup and is designed to be idempotent, so safe `CREATE ... IF NOT EXISTS` and `ALTER ... ADD COLUMN IF NOT EXISTS` statements can run more than once without deleting user data. You can also run it manually:

```bash
psql "$DATABASE_URL" -f server/schema.sql
```

## Running locally after build

```bash
npm run build
npm start
```

The production server serves the built SPA from `dist/` on the same port as the API.
