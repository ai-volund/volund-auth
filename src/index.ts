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

  // Trigger table creation by attempting a sign-up.
  // better-auth's Kysely adapter auto-creates tables on first write operation.
  try {
    await auth.api.signUpEmail({
      body: { email: `migrate-${Date.now()}@init.local`, password: "migration-init-00", name: "init" },
    });
  } catch {
    // Table creation happens as side effect even if sign-up fails for other reasons.
  }
  // Clean up the dummy user.
  try {
    await pool.query(`DELETE FROM account WHERE "userId" IN (SELECT id FROM "user" WHERE email LIKE '%@init.local')`);
    await pool.query(`DELETE FROM session WHERE "userId" IN (SELECT id FROM "user" WHERE email LIKE '%@init.local')`);
    await pool.query(`DELETE FROM "user" WHERE email LIKE '%@init.local'`);
  } catch { /* tables might not exist yet if adapter doesn't auto-create */ }
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
