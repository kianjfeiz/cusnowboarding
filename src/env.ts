import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * Integration keys are optional in development and required in production, so
 * the app boots on a bare database locally while a production build still
 * fails if a key is missing.
 */
const requiredInProd = (schema: z.ZodString) =>
  process.env.NODE_ENV === "production" ? schema : schema.optional();

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    // Pooled connection; everything the app does at runtime goes through it.
    DATABASE_URL: z.string().min(1),
    // Unpooled connection for migrations and seeding only.
    DIRECT_DATABASE_URL: z.string().min(1).optional(),

    // Signs the csc_member cookie. Rotating this invalidates every member's
    // claim credential, so treat it as long-lived.
    MEMBER_JWT_SECRET: z.string().min(32),

    AUTH_SECRET: requiredInProd(z.string().min(32)),
    AUTH_GOOGLE_ID: requiredInProd(z.string().min(1)),
    AUTH_GOOGLE_SECRET: requiredInProd(z.string().min(1)),

    RESEND_API_KEY: requiredInProd(z.string().min(1)),
    EMAIL_FROM: z.string().default("CU Snowboarding <noreply@localhost>"),

    // Guards the Vercel cron endpoints.
    CRON_SECRET: requiredInProd(z.string().min(16)),

    // Optional even in production: without R2 the galleries show a "not
    // configured" notice instead of breaking.
    R2_ACCOUNT_ID: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    R2_BUCKET: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_BASE_URL: z.string().min(1),
    // Club-wide fallback payment link for trips with no payment_url of their own.
    NEXT_PUBLIC_PAYMENT_URL: z.string().optional(),
  },
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    // DATABASE_URL_UNPOOLED is the name Neon's Vercel integration injects.
    DIRECT_DATABASE_URL: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED,
    MEMBER_JWT_SECRET: process.env.MEMBER_JWT_SECRET,
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID,
    AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    CRON_SECRET: process.env.CRON_SECRET,
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET: process.env.R2_BUCKET,
    NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
    NEXT_PUBLIC_PAYMENT_URL: process.env.NEXT_PUBLIC_PAYMENT_URL,
  },
  emptyStringAsUndefined: true,
  // Race tests talk to the database directly and do not need the full env.
  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
});
