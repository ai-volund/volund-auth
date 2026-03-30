import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serve } from "@hono/node-server";
import { auth } from "./auth.js";
import { env } from "./env.js";
import { pool } from "./db.js";

const app = new Hono();

// ── Middleware ─────────────────────────────────────────────────────────────────

app.use("*", logger());

app.use(
  "*",
  cors({
    origin: env.trustedOrigins,
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: ["set-auth-jwt"],
    maxAge: 86400,
  })
);

// ── Auto-migrate on startup ───────────────────────────────────────────────────

async function autoMigrate() {
  console.log("Running auto-migration...");

  // Create better-auth tables directly via SQL if they don't exist.
  // This mirrors what `npx @better-auth/cli migrate` does.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "user" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      "emailVerified" BOOLEAN NOT NULL DEFAULT false,
      image TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      role TEXT DEFAULT 'user',
      banned BOOLEAN DEFAULT false,
      "banReason" TEXT,
      "banExpires" TIMESTAMPTZ,
      "displayName" TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS session (
      id TEXT PRIMARY KEY,
      "expiresAt" TIMESTAMPTZ NOT NULL,
      token TEXT NOT NULL UNIQUE,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "ipAddress" TEXT,
      "userAgent" TEXT,
      "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      "impersonatedBy" TEXT
    );
    CREATE TABLE IF NOT EXISTS account (
      id TEXT PRIMARY KEY,
      "accountId" TEXT NOT NULL,
      "providerId" TEXT NOT NULL,
      "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      "accessToken" TEXT,
      "refreshToken" TEXT,
      "idToken" TEXT,
      "accessTokenExpiresAt" TIMESTAMPTZ,
      "refreshTokenExpiresAt" TIMESTAMPTZ,
      scope TEXT,
      password TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS verification (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      "expiresAt" TIMESTAMPTZ NOT NULL,
      "createdAt" TIMESTAMPTZ DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS jwks (
      id TEXT PRIMARY KEY,
      "publicKey" TEXT NOT NULL,
      "privateKey" TEXT NOT NULL,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "expiresAt" TIMESTAMPTZ
    );
  `);
  console.log("better-auth tables ready");

  // Ensure the ba_user_map bridge table exists.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ba_user_map (
      ba_user_id     TEXT PRIMARY KEY,
      volund_user_id UUID NOT NULL,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log("ba_user_map table ready");
}

await autoMigrate();

// ── Health check ──────────────────────────────────────────────────────────────

app.get("/healthz", (c) => c.json({ status: "ok" }));

// ── better-auth routes (/api/auth/**) ─────────────────────────────────────────

app.on(["POST", "GET"], "/api/auth/**", (c) => {
  return auth.handler(c.req.raw);
});

// ── Custom: list tenant memberships for the current user ──────────────────────

app.get("/api/user/tenants", async (c) => {
  // Get session from better-auth
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session?.user) {
    return c.json({ error: "not authenticated" }, 401);
  }

  const result = await pool.query(
    `SELECT t.id, t.name, t.slug, t.plan, om.role
     FROM ba_user_map m
     JOIN org_members om ON om.user_id = m.volund_user_id
     JOIN tenants t ON t.id = om.tenant_id
     WHERE m.ba_user_id = $1
     ORDER BY om.joined_at`,
    [session.user.id]
  );

  return c.json({
    tenants: result.rows.map((r: Record<string, unknown>) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      plan: r.plan,
      role: r.role,
    })),
  });
});

// ── Start server ──────────────────────────────────────────────────────────────

console.log(`volund-auth starting on :${env.port}`);
console.log(`  base URL:        ${env.authBaseUrl}`);
console.log(`  database:        ${env.databaseUrl.replace(/\/\/.*@/, "//*****@")}`);
console.log(`  trusted origins: ${env.trustedOrigins.join(", ")}`);
console.log(`  OIDC providers:  ${env.oidcProviders === "[]" ? "none" : env.oidcProviders}`);

serve({
  fetch: app.fetch,
  port: env.port,
});
