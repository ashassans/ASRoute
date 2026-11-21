import type { Response } from "express";

export interface LiveLogEvent {
  id: string;
  userId: string;
  apiKeyId: string | null;
  apiKeyPrefix: string | null;
  comboName: string | null;
  requestedModel: string;
  resolvedProvider: string;
  resolvedModel: string;
  connectionName: string | null;
  statusCode: number;
  outcome: string;
  fallbackAttempts: string;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  compressed: boolean;
  detectedIntent?: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface LiveRouteActivityEvent {
  requestId: string;
  phase: "start" | "end";
  provider: string;
  model: string;
  connectionId: string;
  connectionName: string;
  requestedModel: string;
  outcome?: "success" | "error";
  timestamp: string;
}

export interface LiveTelemetryEvent {
  connectionUpdate?: {
    id: string;
    circuitStatus?: string;
    failureCount?: number;
    cooldownUntil?: string | null;
    lastLatencyMs?: number | null;
    lastError?: string | null;
    usedRequestsToday?: number;
    usedTokensToday?: number;
    usedCostMonth?: number;
    modelHealth?: Record<string, unknown>;
  };
  tierIncrement?: {
    comboId: string;
    tierId: string;
    delta: number;
  };
  keyIncrement?: {
    keyId: string;
    requests: number;
    tokens: number;
    costUsd: number;
    lastUsedAt: string;
  };
  timestamp: string;
}

export interface LiveWorkspaceMutationEvent {
  entity: "provider" | "combo" | "key" | "wildcard" | "logs";
  action: "upsert" | "delete" | "clear";
  id?: string;
  record?: unknown;
  timestamp: string;
}

const subscribers = new Map<string, Set<Response>>();
const activeRequestsByUser = new Map<
  string,
  Map<string, LiveRouteActivityEvent>
>();

function broadcastEvent(userId: string, eventName: string, data: unknown): void {
  const set = subscribers.get(userId);
  if (!set || set.size === 0) return;

  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch {
      set.delete(res);
    }
  }
}

export function subscribeUserLogs(userId: string, res: Response): () => void {
  let set = subscribers.get(userId);
  if (!set) {
    set = new Set();
    subscribers.set(userId, set);
  }
  set.add(res);

  res.write(
    `event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`
  );

  const activeMap = activeRequestsByUser.get(userId);
  const activeList = activeMap ? Array.from(activeMap.values()) : [];
  res.write(
    `event: active_snapshot\ndata: ${JSON.stringify({ active: activeList })}\n\n`
  );

  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 15000);

  return () => {
    clearInterval(heartbeat);
    const active = subscribers.get(userId);
    if (active) {
      active.delete(res);
      if (active.size === 0) {
        subscribers.delete(userId);
      }
    }
  };
}

export function publishRouteActivity(
  userId: string,
  event: LiveRouteActivityEvent
): void {
  let userActive = activeRequestsByUser.get(userId);
  if (!userActive) {
    userActive = new Map();
    activeRequestsByUser.set(userId, userActive);
  }

  if (event.phase === "start") {
    userActive.set(event.requestId, event);
  } else {
    userActive.delete(event.requestId);
    if (userActive.size === 0) {
      activeRequestsByUser.delete(userId);
    }
  }

  broadcastEvent(userId, "activity", event);
}

export function publishUserLog(userId: string, event: LiveLogEvent): void {
  broadcastEvent(userId, "log", event);
}

export function publishCircuitUpdate(
  userId: string,
  connectionId: string,
  circuitStatus: string
): void {
  broadcastEvent(userId, "circuit", {
    connectionId,
    circuitStatus,
    timestamp: new Date().toISOString(),
  });
}

export function publishTelemetryUpdate(
  userId: string,
  event: Omit<LiveTelemetryEvent, "timestamp">
): void {
  broadcastEvent(userId, "telemetry", {
    ...event,
    timestamp: new Date().toISOString(),
  });
}

export function publishWorkspaceMutation(
  userId: string,
  event: Omit<LiveWorkspaceMutationEvent, "timestamp">
): void {
  broadcastEvent(userId, "workspace", {
    ...event,
    timestamp: new Date().toISOString(),
  });
}
