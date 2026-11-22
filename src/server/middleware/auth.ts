import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { ensureSchema, isNeonConfigured } from "../../db/index.ts";
import { auth } from "../auth.ts";

export interface AuthedRequest extends Request {
  authUser?: {
    id: string;
    email: string;
    name: string;
  };
}

export async function requireSession(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const headers = fromNodeHeaders(req.headers);
    let session;
    if (isNeonConfigured) {
      let lookupFailed = false;
      const [, resolved] = await Promise.all([
        ensureSchema(),
        auth.api.getSession({ headers }).catch(() => {
          lookupFailed = true;
          return null;
        }),
      ]);
      session = lookupFailed
        ? await auth.api.getSession({ headers })
        : resolved;
    } else {
      await ensureSchema();
      session = await auth.api.getSession({ headers });
    }

    if (!session || !session.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    req.authUser = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    };
    return next();
  } catch (err) {
    console.error("[AS ROUTER] Session check failed:", err);
    return res.status(401).json({ error: "Unauthorized" });
  }
}
