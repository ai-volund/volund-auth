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
