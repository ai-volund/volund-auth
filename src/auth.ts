import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins/jwt";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { admin } from "better-auth/plugins/admin";
import { bearer } from "better-auth/plugins/bearer";
import { env } from "./env.js";
import { pool, getTenantMembership, createVolundUser } from "./db.js";
import type { GenericOAuthConfig } from "better-auth/plugins/generic-oauth";

// Parse OIDC providers from env — each entry is a GenericOAuthConfig.
function parseOIDCProviders(): GenericOAuthConfig[] {
  try {
    const providers = JSON.parse(env.oidcProviders);
    if (!Array.isArray(providers) || providers.length === 0) return [];
    return providers.map((p: Record<string, unknown>) => ({
      ...p,
      providerId: p.providerId as string,
      clientId: p.clientId as string,
      clientSecret: p.clientSecret as string | undefined,
      redirectURI:
        (p.redirectURI as string) ||
        `${env.authBaseUrl}/api/auth/callback/${p.providerId}`,
    }));
  } catch {
    return [];
  }
}

const oidcConfig = parseOIDCProviders();

export const auth = betterAuth({
  database: pool,
  baseURL: env.authBaseUrl,
  basePath: "/api/auth",
  trustedOrigins: env.trustedOrigins,

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },

  session: {
    expiresIn: 30 * 24 * 60 * 60, // 30 days
    updateAge: 24 * 60 * 60, // refresh session every 24h
  },

  user: {
    additionalFields: {
      displayName: {
        type: "string",
        required: false,
        defaultValue: "",
        input: true,
      },
    },
  },

  plugins: [
    // JWT — issues asymmetric (EdDSA) JWTs with gateway-compatible claims.
    // The gateway fetches /api/auth/jwks to validate.
    jwt({
      jwt: {
        issuer: env.jwtIssuer,
        expirationTime: "15m",
        definePayload: async ({ user }) => {
          const membership = await getTenantMembership(user.id);
          return {
            email: user.email,
            name: user.name,
            tenant_id: membership?.tenantId ?? "",
            role: membership?.role ?? "member",
          };
        },
      },
    }),

    // Bearer — allows Authorization: Bearer <jwt> in addition to session cookies.
    bearer(),

    // Generic OAuth — supports any OIDC/OAuth2 provider configured via env.
    ...(oidcConfig.length > 0
      ? [genericOAuth({ config: oidcConfig })]
      : []),

    // Admin plugin — user listing, ban, impersonation for platform admins.
    admin(),
  ],

  // Database hooks: when better-auth creates a user, also populate
  // Volund's existing users + tenants + org_members tables.
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          try {
            await createVolundUser(
              user.id,
              user.email,
              user.name || ""
            );
            console.log(`Volund user created for ${user.email} (${user.id})`);
          } catch (err) {
            console.error("Failed to create Volund user:", err);
          }
        },
      },
    },
  },
});

export type Auth = typeof auth;
