import { z } from "zod";

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function optional(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

const configSchema = z.object({
  PORT: z.string(),
  NODE_ENV: z.string(),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string(),
  R2_ACCOUNT_ID: z.string(),
  R2_ACCESS_KEY_ID: z.string(),
  R2_SECRET_ACCESS_KEY: z.string(),
  R2_BUCKET_NAME: z.string(),
  R2_ENDPOINT: z.string(),
  API_KEY_SECRET: z.string(),
  QDRANT_URL: z.string(),
  QDRANT_API_KEY: z.string(),
  QDRANT_COLLECTION: z.string(),
  VOYAGE_API_KEY: z.string(),
  ANTHROPIC_API_URL: z.string(),
  ENRICH_WINDOW_SECONDS: z.string(),
});

export const config = configSchema.parse({
  PORT: required("PORT"),
  NODE_ENV: required("NODE_ENV"),
  DATABASE_URL: required("DATABASE_URL"),
  REDIS_URL: required("REDIS_URL"),
  R2_ACCOUNT_ID: required("R2_ACCOUNT_ID"),
  R2_ACCESS_KEY_ID: required("R2_ACCESS_KEY_ID"),
  R2_SECRET_ACCESS_KEY: required("R2_SECRET_ACCESS_KEY"),
  R2_BUCKET_NAME: required("R2_BUCKET_NAME"),
  R2_ENDPOINT: required("R2_ENDPOINT"),
  API_KEY_SECRET: required("API_KEY_SECRET"),
  QDRANT_URL: optional("QDRANT_URL", ""),
  QDRANT_API_KEY: optional("QDRANT_API_KEY", ""),
  QDRANT_COLLECTION: optional("QDRANT_COLLECTION", "kontex_snapshots"),
  VOYAGE_API_KEY: optional("VOYAGE_API_KEY", ""),
  ANTHROPIC_API_URL: optional("ANTHROPIC_API_URL", "https://api.anthropic.com"),
  ENRICH_WINDOW_SECONDS: optional("ENRICH_WINDOW_SECONDS", "60"),
});

export type Config = typeof config;
