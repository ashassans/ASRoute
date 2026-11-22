import { Router, type Response } from "express";
import { type AuthedRequest, requireSession } from "../middleware/auth.ts";
import { UpstreamHttpError } from "../providers.ts";
import { executeGatewayExtract, executeGatewaySearch } from "../searchEngine.ts";
import type {
  GatewayExtractRequest,
  GatewaySearchRequest,
} from "../../types/gateway.ts";

export const searchRouter = Router();

searchRouter.post(
  "/query",
  requireSession,
  async (req: AuthedRequest, res: Response) => {
    try {
      const userId = req.authUser!.id;
      const body = (req.body || {}) as Partial<GatewaySearchRequest>;

      if (!body.query || typeof body.query !== "string" || !body.query.trim()) {
        return res.status(400).json({ error: "A search query is required." });
      }

      const abortController = new AbortController();
      req.on("close", () => {
        if (!res.writableEnded) abortController.abort();
      });

      const result = await executeGatewaySearch({
        userId,
        apiKeyId: null,
        apiKeyPrefix: "dashboard-search",
        signal: abortController.signal,
        request: {
          query: body.query.trim(),
          search_depth: body.search_depth === "advanced" ? "advanced" : "basic",
          topic:
            body.topic === "news" || body.topic === "finance"
              ? body.topic
              : "general",
          max_results:
            typeof body.max_results === "number"
              ? Math.min(20, Math.max(1, Math.round(body.max_results)))
              : 5,
          include_answer: Boolean(body.include_answer),
          include_raw_content: body.include_raw_content,
          include_domains: Array.isArray(body.include_domains)
            ? body.include_domains.map(String)
            : undefined,
          exclude_domains: Array.isArray(body.exclude_domains)
            ? body.exclude_domains.map(String)
            : undefined,
          time_range: body.time_range,
          days: typeof body.days === "number" ? body.days : undefined,
          provider: body.provider || "auto",
        },
      });

      return res.json(result);
    } catch (err: unknown) {
      const status = err instanceof UpstreamHttpError ? err.statusCode : 500;
      const message =
        err instanceof Error ? err.message : "Web search request failed";
      return res.status(status).json({ error: message });
    }
  }
);

searchRouter.post(
  "/extract",
  requireSession,
  async (req: AuthedRequest, res: Response) => {
    try {
      const userId = req.authUser!.id;
      const body = (req.body || {}) as Partial<GatewayExtractRequest>;
      const rawUrls = Array.isArray(body.urls)
        ? body.urls
        : typeof body.urls === "string"
          ? [body.urls]
          : [];
      const urls = rawUrls.map((u) => String(u || "").trim()).filter(Boolean);

      if (urls.length === 0) {
        return res
          .status(400)
          .json({ error: "Provide at least one URL to extract." });
      }

      const abortController = new AbortController();
      req.on("close", () => {
        if (!res.writableEnded) abortController.abort();
      });

      const result = await executeGatewayExtract({
        userId,
        apiKeyId: null,
        apiKeyPrefix: "dashboard-search",
        signal: abortController.signal,
        request: {
          urls,
          extract_depth:
            body.extract_depth === "advanced" ? "advanced" : "basic",
          query: typeof body.query === "string" ? body.query.trim() : undefined,
          format: body.format === "text" ? "text" : "markdown",
          provider: body.provider || "auto",
        },
      });

      return res.json(result);
    } catch (err: unknown) {
      const status = err instanceof UpstreamHttpError ? err.statusCode : 500;
      const message =
        err instanceof Error ? err.message : "URL extraction failed";
      return res.status(status).json({ error: message });
    }
  }
);
