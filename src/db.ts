import pg from "pg";
import { env } from "./env.js";

const { Pool } = pg;

/** Shared PG pool — used by better-auth and by our custom hooks. */
export const pool = new Pool({ connectionString: env.databaseUrl });

/**
 * Look up a user's primary tenant membership from the existing Volund
 * `org_members` table. Returns { tenantId, role } or null.
 *
 * better-auth uses nanoid-style IDs, while Volund uses UUIDs.
 * We bridge via the `ba_user_map` table that maps better-auth user IDs
 * to Volund user UUIDs.
 */
export async function getTenantMembership(
  betterAuthUserId: string
): Promise<{ tenantId: string; role: string } | null> {
  const result = await pool.query(
    `SELECT om.tenant_id, om.role
     FROM ba_user_map m
     JOIN org_members om ON om.user_id = m.volund_user_id
     WHERE m.ba_user_id = $1
     ORDER BY om.joined_at ASC
     LIMIT 1`,
    [betterAuthUserId]
  );
  if (result.rows.length === 0) return null;
  return { tenantId: result.rows[0].tenant_id, role: result.rows[0].role };
}

/**
 * Create a Volund user + default tenant when someone signs up via better-auth.
 * This keeps the existing gateway tables in sync so all existing API handlers
 * continue to work unchanged.
 *
 * Also creates the ba_user_map bridge row.
 */
export async function createVolundUser(
  betterAuthUserId: string,
  email: string,
  name: string
): Promise<{ tenantId: string; volundUserId: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Ensure the mapping table exists.
    await client.query(`
      CREATE TABLE IF NOT EXISTS ba_user_map (
        ba_user_id     TEXT PRIMARY KEY,
        volund_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Check if mapping already exists.
    const existing = await client.query(
      `SELECT volund_user_id FROM ba_user_map WHERE ba_user_id = $1`,
      [betterAuthUserId]
    );
    if (existing.rows.length > 0) {
      // User already bridged — just look up their tenant.
      await client.query("COMMIT");
      const membership = await getTenantMembership(betterAuthUserId);
      return {
        tenantId: membership?.tenantId ?? "",
        volundUserId: existing.rows[0].volund_user_id,
      };
    }

    // Insert into Volund's users table with a real UUID.
    const userResult = await client.query(
      `INSERT INTO users (email, display_name, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = NOW()
       RETURNING id`,
      [email, name || email.split("@")[0]]
    );
    const volundUserId = userResult.rows[0].id;

    // Create the mapping.
    await client.query(
      `INSERT INTO ba_user_map (ba_user_id, volund_user_id) VALUES ($1, $2)
       ON CONFLICT (ba_user_id) DO NOTHING`,
      [betterAuthUserId, volundUserId]
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
      [
        `${name || slug}'s Org`,
        slug + "-" + volundUserId.toString().slice(0, 8),
      ]
    );
    const tenantId = tenantResult.rows[0].id;

    // Add as owner.
    await client.query(
      `INSERT INTO org_members (tenant_id, user_id, role, joined_at)
       VALUES ($1, $2, 'owner', NOW())
       ON CONFLICT (tenant_id, user_id) DO NOTHING`,
      [tenantId, volundUserId]
    );

    await client.query("COMMIT");
    return { tenantId, volundUserId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
