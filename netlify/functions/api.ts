import serverless from "serverless-http";
import app from "../../server.ts";

const handlerFn = serverless(app, {
  binary: ["image/*", "application/octet-stream"],
});

export const handler = async (
  event: {
    path?: string;
    rawUrl?: string;
    [key: string]: unknown;
  },
  context: {
    callbackWaitsForEmptyEventLoop?: boolean;
    [key: string]: unknown;
  }
) => {
  if (context && typeof context === "object") {
    context.callbackWaitsForEmptyEventLoop = false;
  }

  let normalizedEvent = event;
  if (
    event &&
    typeof event.path === "string" &&
    event.path.startsWith("/.netlify/functions/api")
  ) {
    const stripped = event.path.slice("/.netlify/functions/api".length) || "/";
    normalizedEvent = { ...event, path: stripped };
  } else if (event && !event.path && typeof event.rawUrl === "string") {
    try {
      const parsed = new URL(event.rawUrl);
      normalizedEvent = { ...event, path: parsed.pathname };
    } catch {
      // keep original event
    }
  }

  return handlerFn(normalizedEvent, context);
};
