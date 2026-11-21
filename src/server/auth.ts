import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { emailOTP } from "better-auth/plugins";
import { db } from "../db/index.ts";
import * as schema from "../db/schema.ts";
import { getAuthSecret } from "./crypto.ts";
import {
  isGmailMailerConfigured,
  sendVerificationOtpEmail,
} from "./mailer.ts";

const appUrl =
  process.env.APP_URL?.trim() ||
  process.env.BETTER_AUTH_URL?.trim() ||
  "http://localhost:3000";
const isHttps =
  appUrl.startsWith("https://") ||
  Boolean(process.env.BETTER_AUTH_URL?.trim().startsWith("https://")) ||
  process.env.NODE_ENV === "production";
const emailVerificationEnabled = isGmailMailerConfigured();

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
    requireEmailVerification: emailVerificationEnabled,
  },
  emailVerification: {
    sendOnSignUp: emailVerificationEnabled,
    autoSignInAfterVerification: true,
  },
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 600,
      allowedAttempts: 5,
      storeOTP: "hashed",
      overrideDefaultEmailVerification: true,
      async sendVerificationOTP({ email, otp, type }) {
        if (type === "email-verification") {
          await sendVerificationOtpEmail({ to: email, otp });
        }
      },
    }),
  ],
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
