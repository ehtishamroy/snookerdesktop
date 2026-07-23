import "dotenv/config";

/**
 * Centralized, validated environment access. Fails fast at boot if a
 * required variable is missing rather than surfacing a confusing runtime
 * error later (e.g. jwt.sign() throwing on an undefined secret).
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
}

export const env = {
  DATABASE_URL: required("DATABASE_URL"),
  JWT_SECRET: required("JWT_SECRET"),
  JWT_EXPIRES_IN: optional("JWT_EXPIRES_IN", "12h"),
  PORT: Number(optional("PORT", "4000")),
  CORS_ORIGINS: optional("CORS_ORIGINS", "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  NISHANI_PURGE_CRON: optional("NISHANI_PURGE_CRON", "*/5 * * * *"),
  IDLE_ALERT_SCAN_CRON: optional("IDLE_ALERT_SCAN_CRON", "*/1 * * * *"),
  NODE_ENV: optional("NODE_ENV", "development"),
};
