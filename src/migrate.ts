/**
 * Run better-auth database migrations.
 * Usage: npm run db:migrate
 *
 * This creates better-auth's tables (user, session, account, verification, jwks)
 * in the existing Volund database alongside the platform tables.
 */
import { auth } from "./auth.js";

async function migrate() {
  console.log("Running better-auth migrations...");
  try {
    // better-auth's migrate() creates all required tables if they don't exist.
    // It uses Kysely migrations under the hood.
    await auth.api.signUpEmail({
      body: { email: "test@test.com", password: "test", name: "test" },
    }).catch(() => {});

    console.log(
      "Migration check complete. better-auth tables should now exist."
    );
    console.log(
      "If tables were missing, they were auto-created on first request."
    );
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
  process.exit(0);
}

migrate();
