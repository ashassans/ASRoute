import { Router, type Response } from "express";
import { type AuthedRequest, requireSession } from "../middleware/auth.ts";
import { UpstreamHttpError } from "../providers.ts";
import { executeGatewayChatCompletion } from "../routerEngine.ts";

export const playgroundRouter = Router();

playgroundRouter.post(
  "/chat",
  requireSession,
  async (req: AuthedRequest, res: Response) => {
    const userId = req.authUser!.id;
    const {
      model,
      messages,
      temperature,
      max_tokens,
      tools,
      tool_choice,
      freeOnly,
      useCache,
      stream,
    } = req.body || {};

    if (!model || !Array.isArray(messages)) {
      return res
        .status(400)
        .json({ error: "Model and messages array are required." });
    }

    const abortController = new AbortController();
    req.on("close", () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    const safeTemp =
      typeof temperature === "number" && Number.isFinite(temperature)
        ? Math.min(2, Math.max(0, temperature))
        : undefined;
    const safeMaxTokens =
      typeof max_tokens === "number" && Number.isFinite(max_tokens) && max_tokens > 0
        ? Math.min(32768, Math.round(max_tokens))
        : undefined;

    if (stream === true) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      req.socket?.setNoDelay?.(true);
      res.flushHeaders?.();
      res.write(": playground-stream\n\n");

      try {
        const result = await executeGatewayChatCompletion({
          userId,
          apiKeyId: null,
          apiKeyPrefix: "dashboard-playground",
          freeOnly: Boolean(freeOnly),
          useCache: Boolean(useCache),
          signal: abortController.signal,
          request: {
            model: String(model),
            messages,
            stream: true,
            temperature: safeTemp,
            max_tokens: safeMaxTokens,
            tools: Array.isArray(tools) ? tools : undefined,
            tool_choice,
          },
          onStreamDelta: (delta) => {
            if (abortController.signal.aborted) return;
            res.write(`event: delta\ndata: ${JSON.stringify(delta)}\n\n`);
          },
        });

        if (!abortController.signal.aborted) {
          res.write(`event: result\ndata: ${JSON.stringify(result)}\n\n`);
        }
        return res.end();
      } catch (err: unknown) {
        if (!abortController.signal.aborted) {
          const message =
            err instanceof Error ? err.message : "Playground request failed";
          res.write(
            `event: error\ndata: ${JSON.stringify({ error: message })}\n\n`
          );
        }
        return res.end();
      }
    }

    try {
      const result = await executeGatewayChatCompletion({
        userId,
        apiKeyId: null,
        apiKeyPrefix: "dashboard-playground",
        freeOnly: Boolean(freeOnly),
        useCache: Boolean(useCache),
        signal: abortController.signal,
        request: {
          model: String(model),
          messages,
          stream: false,
          temperature: safeTemp,
          max_tokens: safeMaxTokens,
          tools: Array.isArray(tools) ? tools : undefined,
          tool_choice,
        },
      });

      return res.json(result);
    } catch (err: unknown) {
      const status = err instanceof UpstreamHttpError ? err.statusCode : 500;
      const message =
        err instanceof Error ? err.message : "Playground request failed";
      return res.status(status).json({ error: message });
    }
  }
);
