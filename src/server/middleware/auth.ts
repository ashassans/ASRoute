import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { ensureSchema } from "../../db/index.ts";
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
    await ensureSchema();
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
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
