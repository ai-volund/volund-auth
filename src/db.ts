import pg from "pg";
import { env } from "./env.js";

const { Pool } = pg;

/** Shared PG pool — used by better-auth and by our custom hooks. */
export const pool = new Pool({ connectionString: env.databaseUrl });

/**
 * Look up a user's primary tenant membership from the existing Volund
 * `org_members` table. Returns { tenantId, role } or null.
 *
 * This bridges better-auth users to Volund's multi-tenant model.
 * When a better-auth user signs in, we query this table to populate
 * the JWT with tenant_id and role.
 */
export async function getTenantMembership(
  volundUserId: string
): Promise<{ tenantId: string; role: string } | null> {
  const result = await pool.query(
    `SELECT tenant_id, role FROM org_members WHERE user_id = $1 ORDER BY joined_at ASC LIMIT 1`,
    [volundUserId]
  );
  if (result.rows.length === 0) return null;
  return { tenantId: result.rows[0].tenant_id, role: result.rows[0].role };
}

/**
 * Create a Volund user + default tenant when someone signs up via better-auth.
 * This keeps the existing gateway tables in sync so all existing API handlers
 * continue to work unchanged.
 */
export async function createVolundUser(
  userId: string,
  email: string,
  name: string
): Promise<{ tenantId: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Insert into Volund's users table (or update if exists from OIDC).
    await client.query(
      `INSERT INTO users (id, email, display_name, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = NOW()`,
      [userId, email, name || email.split("@")[0]]
    );

    // Create a default tenant.
    const slug = email
      .split("@")[0]
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    const tenantResult = await client.query(
      `INSERT INTO tenants (name, slug, plan, created_at, updated_at)
       VALUES ($1, $2, 'free', NOW(), NOW())
       RETURNING id`,
      [`${name || slug}'s Org`, slug + "-" + userId.slice(0, 8)]
    );
    const tenantId = tenantResult.rows[0].id;

    // Add as owner.
    await client.query(
      `INSERT INTO org_members (tenant_id, user_id, role, joined_at)
       VALUES ($1, $2, 'owner', NOW())
       ON CONFLICT (tenant_id, user_id) DO NOTHING`,
      [tenantId, userId]
    );

    await client.query("COMMIT");
    return { tenantId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
