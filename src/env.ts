import "dotenv/config";

export const env = {
  port: parseInt(process.env.PORT || "3456", 10),
  secret:
    process.env.BETTER_AUTH_SECRET ||
    process.env.JWT_SECRET ||
    "volund-dev-secret-change-me-in-production",
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
  oidcProviders: process.env.OIDC_PROVIDERS || "[]",
  // SMTP config for email verification + password reset
  smtpHost: process.env.SMTP_HOST || "",
  smtpPort: parseInt(process.env.SMTP_PORT || "587", 10),
  smtpUser: process.env.SMTP_USER || "",
  smtpPass: process.env.SMTP_PASS || "",
  smtpFrom: process.env.SMTP_FROM || "noreply@volund.ai",
} as const;
