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

const subscribers = new Map<string, Set<Response>>();
const activeRequestsByUser = new Map<
  string,
  Map<string, LiveRouteActivityEvent>
>();

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
  }, 25000);

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

  const set = subscribers.get(userId);
  if (!set || set.size === 0) return;

  const payload = `event: activity\ndata: ${JSON.stringify(event)}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch {
      set.delete(res);
    }
  }
}

export function publishUserLog(userId: string, event: LiveLogEvent): void {
  const set = subscribers.get(userId);
  if (!set || set.size === 0) return;

  const payload = `event: log\ndata: ${JSON.stringify(event)}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch {
      set.delete(res);
    }
  }
}

export function publishCircuitUpdate(
  userId: string,
  connectionId: string,
  circuitStatus: string
): void {
  const set = subscribers.get(userId);
  if (!set || set.size === 0) return;

  const payload = `event: circuit\ndata: ${JSON.stringify({
    connectionId,
    circuitStatus,
    timestamp: new Date().toISOString(),
  })}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch {
      set.delete(res);
    }
  }
}
