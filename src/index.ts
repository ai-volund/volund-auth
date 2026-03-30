import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serve } from "@hono/node-server";
import { auth } from "./auth.js";
import { env } from "./env.js";

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
