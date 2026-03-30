import "dotenv/config";

export const env = {
  port: parseInt(process.env.PORT || "3456", 10),
  databaseUrl:
    process.env.DATABASE_URL ||
    "postgres://volund:volund@localhost:5432/volund?sslmode=disable",
  trustedOrigins: (
    process.env.TRUSTED_ORIGINS ||
    "http://localhost:5173,http://localhost:5174,http://localhost:8080"
  ).split(","),
  authBaseUrl: process.env.AUTH_BASE_URL || "http://localhost:3456",
  jwtIssuer: process.env.JWT_ISSUER || "volund",
  // OIDC providers — JSON array of GenericOAuthConfig objects
  // Example: [{"providerId":"google","clientId":"...","clientSecret":"...","discoveryUrl":"https://accounts.google.com/.well-known/openid-configuration"}]
  oidcProviders: process.env.OIDC_PROVIDERS || "[]",
} as const;
