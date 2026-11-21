import "dotenv/config";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { toNodeHandler } from "better-auth/node";
import { databaseMode, ensureSchema } from "./src/db/index.ts";
import { auth } from "./src/server/auth.ts";
import { analyticsRouter } from "./src/server/routes/analytics.ts";
import { combosRouter } from "./src/server/routes/combos.ts";
import { gatewayRouter } from "./src/server/routes/gateway.ts";
import { keysRouter } from "./src/server/routes/keys.ts";
import { playgroundRouter } from "./src/server/routes/playground.ts";
import { providersRouter } from "./src/server/routes/providers.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const authHandler = toNodeHandler(auth);

app.set("trust proxy", 1);

function isTrustedControlPlaneOrigin(origin: string | undefined, req: Request): boolean {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const originHost = parsed.host.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();

    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]" ||
      hostname.endsWith(".run.app")
    ) {
      return true;
    }

    const reqHost = String(
      req.headers["x-forwarded-host"] || req.get("host") || ""
    )
      .split(",")[0]
      .trim()
      .toLowerCase();
    if (reqHost && originHost === reqHost) {
      return true;
    }

    for (const envUrl of [process.env.APP_URL, process.env.BETTER_AUTH_URL]) {
      if (!envUrl?.trim()) continue;
      try {
        if (new URL(envUrl.trim()).host.toLowerCase() === originHost) {
          return true;
        }
      } catch {
        // ignore invalid env URL
      }
    }
    return false;
  } catch {
    return false;
  }
}

app.use(
  "/v1",
  cors({
    origin: true,
    credentials: false,
  })
);

app.use("/api", (req: Request, res: Response, next: NextFunction) => {
  const middleware = cors({
    origin: (origin, callback) => {
      callback(null, isTrustedControlPlaneOrigin(origin, req));
    },
    credentials: true,
  });
  return middleware(req, res, next);
});

// Better Auth handler MUST precede express.json()
app.all("/api/auth/*", async (req: Request, res: Response) => {
  try {
    await ensureSchema();
    return authHandler(req, res);
  } catch (err) {
    console.error("[AS ROUTER] Auth handler error:", err);
    return res.status(500).json({ error: "Authentication service error" });
  }
});

app.use(express.json({ limit: "4mb" }));

// Unified AI Gateway Endpoints (/v1/*)
app.use("/v1", gatewayRouter);

// Dashboard Control-Plane REST APIs (/api/*)
app.use("/api/keys", keysRouter);
app.use("/api/providers", providersRouter);
app.use("/api", combosRouter);
app.use("/api", analyticsRouter);
app.use("/api/playground", playgroundRouter);

async function startServer() {
  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== "production") {
    const hmrDisabled = process.env.DISABLE_HMR === "true";
    if (hmrDisabled) {
      app.get("/@vite/client", (_req: Request, res: Response) => {
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.send(`
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement("style");
    style.setAttribute("type", "text/css");
    style.setAttribute("data-vite-dev-id", id);
    style.textContent = content;
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style && style.parentNode) {
    style.parentNode.removeChild(style);
  }
  sheetsMap.delete(id);
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    decline() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url, queryToInject) {
  if (url[0] !== "." && url[0] !== "/") return url;
  const pathname = url.replace(/[?#].*$/, "");
  const { search, hash } = new URL(url, "http://vite.dev");
  return pathname + "?" + queryToInject + (search ? "&" + search.slice(1) : "") + (hash || "");
}
export class ErrorOverlay {}
`);
      });
    }
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: hmrDisabled ? false : { server: httpServer },
        ws: hmrDisabled ? false : undefined,
        watch: null,
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, "dist");
    app.use(express.static(distDir));
    app.get("*", (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith("/api/") || req.path.startsWith("/v1/")) {
        return next();
      }
      return res.sendFile(path.join(distDir, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(
      `[AS ROUTER] Unified AI Gateway listening on http://0.0.0.0:${PORT} (DB mode: ${databaseMode})`
    );
  });

  const shutdown = async () => {
    httpServer.close();
    const g = globalThis as {
      _asRouterPglite?: { close?: () => Promise<void> };
      _asRouterPool?: { end?: () => Promise<void> };
    };
    try {
      await g._asRouterPglite?.close?.();
      await g._asRouterPool?.end?.();
    } catch {
      // ignore close errors during shutdown
    }
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

export default app;

if (process.env.VERCEL !== "1") {
  startServer().catch((err) => {
    console.error("[AS ROUTER] Fatal startup error:", err);
    process.exit(1);
  });
}
