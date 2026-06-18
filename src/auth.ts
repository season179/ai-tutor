import { betterAuth } from "better-auth";

/**
 * Environment required to build a better-auth instance at runtime. The Worker
 * supplies the real D1 binding; the string fields come from wrangler
 * vars/secrets (see wrangler.jsonc).
 */
export type AuthEnv = {
  /** D1 binding. */
  DB: unknown;
  /** Base URL of the deployed app, e.g. https://ai-tutor.example.dev. */
  BETTER_AUTH_URL?: string;
  /** Secret used to sign session cookies. */
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

/**
 * Prefix for better-auth's own routes (sign-in, callback, sign-out, get-session).
 * Routed to {@link Auth.handler} before the ownership-gated API handler.
 */
export const authPathPrefix = "/api/auth/";

export function createAuth(env: AuthEnv) {
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    // better-auth (1.5+) accepts a D1Database binding natively. AuthEnv keeps DB
    // as `unknown` so this module avoids importing Cloudflare runtime types; the
    // cast preserves that boundary.
    database: env.DB as Parameters<typeof betterAuth>[0]["database"],
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID ?? "",
        clientSecret: env.GOOGLE_CLIENT_SECRET ?? ""
      }
    }
  });
}

export type Auth = ReturnType<typeof createAuth>;
