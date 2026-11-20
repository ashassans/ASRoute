import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { db } from "../db/index.ts";
import * as schema from "../db/schema.ts";
import { getAuthSecret } from "./crypto.ts";

const appUrl = process.env.APP_URL?.trim() || "http://localhost:3000";
const isHttps = appUrl.startsWith("https://");

const baseTrustedOrigins = Array.from(
  new Set(
    [
      appUrl,
      process.env.BETTER_AUTH_URL?.trim(),
      "https://*.run.app",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ].filter((origin): origin is string => Boolean(origin))
  )
);

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  secret: getAuthSecret(),
  baseURL: process.env.BETTER_AUTH_URL?.trim() || appUrl,
  trustedOrigins: (request) => {
    const reqOrigin = request?.headers.get("origin");
    if (reqOrigin) {
      return [...baseTrustedOrigins, reqOrigin];
    }
    return baseTrustedOrigins;
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 6,
  },
  socialProviders:
    process.env.GOOGLE_CLIENT_ID?.trim() &&
    process.env.GOOGLE_CLIENT_SECRET?.trim()
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID.trim(),
            clientSecret: process.env.GOOGLE_CLIENT_SECRET.trim(),
          },
        }
      : undefined,
  advanced: {
    useSecureCookies: isHttps,
    defaultCookieAttributes: isHttps
      ? {
          sameSite: "none",
          secure: true,
          httpOnly: true,
          path: "/",
        }
      : {
          sameSite: "lax",
          httpOnly: true,
          path: "/",
        },
  },
});
