# volund-auth

Authentication service for the VOLUND platform, powered by [better-auth](https://www.better-auth.com/).

## What It Does

- **Email/password** authentication with sign-up, sign-in, session management
- **Generic OIDC/OAuth2** — any provider (Google, GitHub, Okta, Keycloak) via env config
- **JWT issuance** — EdDSA-signed JWTs with gateway-compatible claims (`sub`, `tenant_id`, `role`)
- **JWKS endpoint** — `/api/auth/jwks` for gateway token validation
- **Tenant bridge** — on sign-up, creates Volund user + tenant + org membership

## Architecture

```
Client (Admin UI / Desktop App)
    │
    ├── POST /api/auth/sign-up/email
    ├── POST /api/auth/sign-in/email
    ├── GET  /api/auth/get-session
    ├── GET  /api/auth/token          → returns JWT
    ├── GET  /api/auth/jwks           → public keys
    └── POST /api/auth/sign-in/social → OIDC redirect
    │
    ▼
volund-auth (Hono + better-auth)
    │
    ├── better-auth tables: user, session, account, verification, jwks
    └── hooks → Volund tables: users, tenants, org_members, ba_user_map
```

The gateway validates JWTs by fetching the JWKS endpoint (`VOLUND_AUTH_JWKS_URL`).

## Local Development

```bash
npm install
npm run dev          # starts on :3456 with tsx watch
```

Requires PostgreSQL on `localhost:5432` (port-forwarded from cluster or local).

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3456` | Server port |
| `DATABASE_URL` | `postgres://volund:volund@localhost:5432/volund` | PostgreSQL connection |
| `BETTER_AUTH_SECRET` | (dev default) | Secret for session signing + JWKS encryption |
| `AUTH_BASE_URL` | `http://localhost:3456` | Public URL of this service |
| `TRUSTED_ORIGINS` | `localhost:5173,5174,8080` | CORS allowed origins |
| `JWT_ISSUER` | `volund` | JWT `iss` claim |
| `OIDC_PROVIDERS` | `[]` | JSON array of OIDC provider configs |

## OIDC Provider Config

Set `OIDC_PROVIDERS` env var with a JSON array:

```json
[
  {
    "providerId": "google",
    "clientId": "...",
    "clientSecret": "...",
    "discoveryUrl": "https://accounts.google.com/.well-known/openid-configuration"
  }
]
```

## Database Tables

better-auth manages: `user`, `session`, `account`, `verification`, `jwks`

Bridge table: `ba_user_map` (maps better-auth nanoid IDs → Volund UUIDs)

Run migrations: `npx @better-auth/cli migrate -y`
