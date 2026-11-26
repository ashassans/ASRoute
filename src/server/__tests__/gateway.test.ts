import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import test, { after } from "node:test";
import { db, ensureSchema } from "../../db/index.ts";
import {
  combos,
  comboTiers,
  providerConnections,
  user,
} from "../../db/schema.ts";
import {
  getConnectionPrefix,
  getProviderSpec,
  hasFreeModelSuffix,
  isModelKnownFree,
  isSearchProvider,
  LLM_PROVIDER_PRESETS,
  READY_MADE_PROVIDER_PRESETS,
  SEARCH_PROVIDER_PRESETS,
} from "../../shared/catalog.ts";
import {
  decryptSecret,
  encryptSecret,
  generateGatewayApiKey,
  hashGatewayApiKey,
} from "../crypto.ts";
import {
  fetchProviderModels,
  invokeUpstreamCompletion,
  UpstreamHttpError,
} from "../providers.ts";
import {
  classifyRequestIntent,
  clearGatewayResponseCache,
  evaluateTierEligibility,
  executeGatewayChatCompletion,
  globToRegex,
  orderTiersByStrategy,
  resolveRoutingTarget,
} from "../routerEngine.ts";
import { isModelAllowedForKey } from "../routes/gateway.ts";
import {
  buildReadyMadeComboTiers,
  validateLlmComboConnections,
} from "../routes/combos.ts";
import {
  removeConnectionModels,
  testConnectionModelsBatch,
} from "../routes/providers.ts";
import {
  extractReadableContentFromHtml,
  parseDuckDuckGoHtml,
} from "../searchEngine.ts";
import { isBlockedHost, validateOutboundUrl } from "../urlSafety.ts";
import { serializeEncryptedKeyPool } from "../utils/connections.ts";

after(async () => {
  const g = globalThis as {
    _asRouterPglite?: { close?: () => Promise<void> };
  };
  await g._asRouterPglite?.close?.();
});

function makeConn(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: "conn_1",
    userId: "user_1",
    provider: "openai",
    name: "OpenAI Main",
    baseUrl: null,
    defaultModel: "gpt-4.1-mini",
    availableModels: null,
    modelHealth: null,
    encryptedApiKey: null,
    encryptedKeyPool: null,
    keyPoolCursor: 0,
    useServerKey: false,
    isActive: true,
    rpmLimit: null,
    rpdLimit: null,
    dailyTokenQuota: null,
    monthlyUsdQuota: null,
    usedRequestsToday: 0,
    usedTokensToday: 0,
    usedCostMonth: 0,
    quotaResetAt: now,
    circuitStatus: "healthy",
    failureCount: 0,
    cooldownUntil: null,
    lastLatencyMs: 250,
    lastError: null,
    createdAt: now,
    ...overrides,
  } as any;
}

function makeTier(overrides: Record<string, unknown> = {}) {
  return {
    id: "tier_1",
    comboId: "combo_1",
    connectionId: "conn_1",
    upstreamModel: "gpt-4.1-mini",
    priority: 0,
    weight: 100,
    maxRetries: 1,
    requestCount: 0,
    ...overrides,
  } as any;
}

test("urlSafety blocks private, loopback, metadata, and invalid protocols", () => {
  assert.equal(isBlockedHost("localhost"), true);
  assert.equal(isBlockedHost("127.0.0.1"), true);
  assert.equal(isBlockedHost("169.254.169.254"), true);
  assert.equal(isBlockedHost("metadata.google.internal"), true);
  assert.equal(isBlockedHost("10.0.0.5"), true);
  assert.equal(isBlockedHost("192.168.1.10"), true);
  assert.equal(isBlockedHost("172.16.0.1"), true);
  assert.equal(isBlockedHost("service.local"), true);
  assert.equal(isBlockedHost("::1"), true);
  assert.equal(isBlockedHost("api.openai.com"), false);

  assert.throws(() => validateOutboundUrl("file:///etc/passwd"));
  assert.throws(() => validateOutboundUrl("http://user:pass@api.openai.com/v1"));
  assert.throws(() => validateOutboundUrl("http://169.254.169.254/latest/meta-data"));
  assert.throws(() => validateOutboundUrl("http://localhost:3000/v1"));

  const valid = validateOutboundUrl("https://api.openai.com/v1");
  assert.equal(valid.hostname, "api.openai.com");
});

test("crypto encrypt/decrypt roundtrip and gateway API key hashing", () => {
  const plaintext = "sk-test-secret-value-12345";
  const encrypted = encryptSecret(plaintext);
  assert.notEqual(encrypted, plaintext);
  assert.equal(decryptSecret(encrypted), plaintext);

  const tampered = encrypted.slice(0, -4) + "abcd";
  assert.throws(() => decryptSecret(tampered));

  const generated = generateGatewayApiKey();
  assert.ok(generated.rawKey.startsWith("sk-asr-"));
  assert.equal(hashGatewayApiKey(generated.rawKey), generated.keyHash);
});

test("catalog isModelKnownFree and Nov 2026 primary models are configured", () => {
  assert.equal(isModelKnownFree("openrouter", "openrouter/free"), true);
  assert.equal(
    isModelKnownFree("openrouter", "meta-llama/llama-4-scout:free"),
    true
  );
  assert.equal(isModelKnownFree("gemini", "gemini-2.5-flash"), true);
  assert.equal(isModelKnownFree("gemini", "gemini-4-hydrogen"), true);
  assert.equal(isModelKnownFree("gemini", "gemini-2.5-pro"), false);
  assert.equal(isModelKnownFree("openai", "gpt-6.2-sol"), false);
  assert.equal(isModelKnownFree("anthropic", "claude-sonnet-5-5"), false);

  assert.equal(getProviderSpec("gemini").models[0]?.id, "gemini-4-hydrogen");
  assert.equal(getProviderSpec("openai").models[0]?.id, "gpt-6.2-sol");
  assert.equal(getProviderSpec("anthropic").models[0]?.id, "claude-sonnet-5-5");
  assert.equal(getProviderSpec("deepseek").models[0]?.id, "deepseek-flash");
  assert.equal(
    getProviderSpec("deepseek").models.some((m) => m.id === "deepseek-v4-pro"),
    true
  );
});

test("routerEngine globToRegex and classifyRequestIntent", () => {
  const regex = globToRegex("gpt-*");
  assert.equal(regex.test("gpt-4.1-mini"), true);
  assert.equal(regex.test("claude-sonnet-4"), false);

  assert.equal(
    classifyRequestIntent({
      messages: [{ role: "user", content: "```ts\nconst a = 1;\n```" }],
    }),
    "coding"
  );
  assert.equal(
    classifyRequestIntent({
      messages: [{ role: "user", content: "Hi there" }],
    }),
    "fast"
  );
  assert.equal(
    classifyRequestIntent({
      messages: [{ role: "user", content: "Check weather" }],
      tools: [
        {
          type: "function",
          function: { name: "get_weather", parameters: {} },
        },
      ],
    }),
    "tools"
  );
  assert.equal(
    classifyRequestIntent({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is in this?" },
            { type: "image_url", image_url: { url: "https://example.com/a.png" } },
          ],
        },
      ],
    }),
    "vision"
  );
});

test("evaluateTierEligibility handles quotas, UTC rollover, and circuit cooldowns", () => {
  const now = new Date("2026-11-21T12:00:00Z");

  assert.deepEqual(evaluateTierEligibility(makeConn(), now), {
    eligible: true,
  });
  assert.equal(
    evaluateTierEligibility(makeConn({ isActive: false }), now).eligible,
    false
  );

  // Exhausted today's quota blocks requests
  assert.equal(
    evaluateTierEligibility(
      makeConn({ rpdLimit: 10, usedRequestsToday: 10, quotaResetAt: now }),
      now
    ).reason,
    "daily_request_quota_exceeded"
  );

  // Quota from yesterday automatically resets at UTC midnight
  const yesterday = new Date("2026-11-20T23:00:00Z");
  assert.equal(
    evaluateTierEligibility(
      makeConn({
        rpdLimit: 10,
        usedRequestsToday: 10,
        quotaResetAt: yesterday,
      }),
      now
    ).eligible,
    true
  );

  // Open circuit during cooldown is rejected; expired cooldown promotes to half_open
  assert.equal(
    evaluateTierEligibility(
      makeConn({
        circuitStatus: "open",
        cooldownUntil: new Date(now.getTime() + 60_000),
      }),
      now
    ).reason,
    "circuit_open_cooldown"
  );
  assert.deepEqual(
    evaluateTierEligibility(
      makeConn({
        circuitStatus: "open",
        cooldownUntil: new Date(now.getTime() - 1000),
      }),
      now
    ),
    { eligible: true, promotedToHalfOpen: true }
  );
});

test("orderTiersByStrategy orders priority, round_robin, cost_optimized, and intent_auto", () => {
  const paidConn = makeConn({ id: "c_paid", provider: "openai" });
  const freeConn = makeConn({ id: "c_free", provider: "gemini" });

  const tiers = [
    {
      tier: makeTier({ id: "t_paid", connectionId: "c_paid", upstreamModel: "gpt-4.1", priority: 0 }),
      connection: paidConn,
    },
    {
      tier: makeTier({ id: "t_free", connectionId: "c_free", upstreamModel: "gemini-2.5-flash", priority: 1 }),
      connection: freeConn,
    },
  ];

  assert.deepEqual(
    orderTiersByStrategy(tiers, "priority", 0, "fast").map((x) => x.tier.id),
    ["t_paid", "t_free"]
  );
  assert.deepEqual(
    orderTiersByStrategy(tiers, "round_robin", 1, "fast").map((x) => x.tier.id),
    ["t_free", "t_paid"]
  );
  assert.deepEqual(
    orderTiersByStrategy(tiers, "cost_optimized", 0, "fast").map((x) => x.tier.id),
    ["t_free", "t_paid"]
  );
  assert.deepEqual(
    orderTiersByStrategy(tiers, "intent_auto", 0, "fast").map((x) => x.tier.id),
    ["t_free", "t_paid"]
  );
  assert.deepEqual(
    orderTiersByStrategy(tiers, "intent_auto", 0, "coding").map((x) => x.tier.id),
    ["t_paid", "t_free"]
  );
});

test("resolveRoutingTarget prioritizes active connection owning nested-slash model ID", async () => {
  await ensureSchema();
  const uid = "user_route_nested";
  await db.delete(user).where(eq(user.id, uid));
  await db.insert(user).values({
    id: uid,
    name: "Route Test",
    email: "route-test@example.com",
  });

  await db.insert(providerConnections).values([
    {
      id: "conn_openai_non_owner",
      userId: uid,
      provider: "openai",
      name: "OpenAI",
      availableModels: JSON.stringify(["gpt-4.1-mini"]),
      encryptedApiKey: encryptSecret("sk-test-openai"),
      isActive: true,
      lastLatencyMs: 90,
    },
    {
      id: "conn_openrouter_owner",
      userId: uid,
      provider: "openrouter",
      name: "OpenRouter",
      availableModels: JSON.stringify(["meta-llama/llama-3.3-70b-instruct:free"]),
      encryptedApiKey: encryptSecret("sk-test-or"),
      isActive: true,
      lastLatencyMs: 320,
    },
  ]);

  const target = await resolveRoutingTarget(
    uid,
    "meta-llama/llama-3.3-70b-instruct:free"
  );
  assert.equal(target.matchedVia, "default");
  assert.equal(target.tiers[0]?.connection.id, "conn_openrouter_owner");
  assert.equal(
    target.tiers[0]?.tier.upstreamModel,
    "meta-llama/llama-3.3-70b-instruct:free"
  );
});

test("executeGatewayChatCompletion falls back across HTTP 429, inline SSE 200 error, and isolates single 429 circuit", async () => {
  await ensureSchema();
  const uid = "user_fb_test";
  await db.delete(user).where(eq(user.id, uid));
  await db.insert(user).values({
    id: uid,
    name: "Fallback Test",
    email: "fallback-test@example.com",
  });

  await db.insert(providerConnections).values([
    {
      id: "conn_fb_1",
      userId: uid,
      provider: "openai",
      name: "Tier 1 OpenAI",
      baseUrl: "https://api.openai.com/v1",
      encryptedApiKey: encryptSecret("sk-key-1"),
      isActive: true,
    },
    {
      id: "conn_fb_2",
      userId: uid,
      provider: "openrouter",
      name: "Tier 2 OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      encryptedApiKey: encryptSecret("sk-key-2"),
      isActive: true,
    },
    {
      id: "conn_fb_3",
      userId: uid,
      provider: "groq",
      name: "Tier 3 Groq",
      baseUrl: "https://api.groq.com/openai/v1",
      encryptedApiKey: encryptSecret("sk-key-3"),
      isActive: true,
    },
  ]);

  await db.insert(combos).values({
    id: "combo_fb_1",
    userId: uid,
    name: "resilient-combo",
    strategy: "priority",
    isActive: true,
  });

  await db.insert(comboTiers).values([
    {
      id: "tier_fb_1",
      comboId: "combo_fb_1",
      connectionId: "conn_fb_1",
      upstreamModel: "gpt-4.1-mini",
      priority: 0,
      weight: 100,
    },
    {
      id: "tier_fb_2",
      comboId: "combo_fb_1",
      connectionId: "conn_fb_2",
      upstreamModel: "meta-llama/llama-3.3-70b-instruct:free",
      priority: 1,
      weight: 100,
    },
    {
      id: "tier_fb_3",
      comboId: "combo_fb_1",
      connectionId: "conn_fb_3",
      upstreamModel: "llama-3.3-70b-versatile",
      priority: 2,
      weight: 100,
    },
  ]);

  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  const seenUrls: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    seenUrls.push(url);

    if (url.includes("api.openai.com")) {
      return new Response(
        JSON.stringify({ error: { message: "Rate limit exceeded" } }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      );
    }

    if (url.includes("openrouter.ai")) {
      const sseBody = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'data: {"error":{"code":503,"message":"Provider overloaded"}}\n\n'
            )
          );
          controller.close();
        },
      });
      return new Response(sseBody, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }

    const okSseBody = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":"Recovered ok"}}]}\n\n'
          )
        );
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":9,"completion_tokens":3}}\n\n'
          )
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(okSseBody, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }) as typeof fetch;

  try {
    const deltas: string[] = [];
    const res1 = await executeGatewayChatCompletion({
      userId: uid,
      apiKeyId: null,
      apiKeyPrefix: null,
      request: {
        model: "resilient-combo",
        messages: [{ role: "user", content: "Hello" }],
        stream: true,
      },
      onStreamDelta: (d) => {
        if (d.content) deltas.push(d.content);
      },
    });

    assert.equal(res1.resolvedProvider, "groq");
    assert.equal(res1.resolvedModel, "llama-3.3-70b-versatile");
    assert.equal(res1.content, "Recovered ok");
    assert.equal(deltas.join(""), "Recovered ok");
    assert.equal(res1.fallbackAttempts.length, 3);
    assert.equal(res1.fallbackAttempts[0]?.status, "failed");
    assert.equal(res1.fallbackAttempts[0]?.statusCode, 429);
    assert.equal(res1.fallbackAttempts[1]?.status, "failed");
    assert.equal(res1.fallbackAttempts[1]?.statusCode, 503);
    assert.equal(res1.fallbackAttempts[2]?.status, "success");

    // Single 429 failure should NOT open the whole connection circuit yet (requires >= 2)
    const [conn1AfterFirst] = await db
      .select()
      .from(providerConnections)
      .where(eq(providerConnections.id, "conn_fb_1"));
    assert.equal(conn1AfterFirst?.circuitStatus, "healthy");
    assert.equal(conn1AfterFirst?.failureCount, 1);

    // Second request hitting another 429 on Tier 1 SHOULD open its circuit
    const res2 = await executeGatewayChatCompletion({
      userId: uid,
      apiKeyId: null,
      apiKeyPrefix: null,
      request: {
        model: "resilient-combo",
        messages: [{ role: "user", content: "Hello again" }],
        stream: true,
      },
      onStreamDelta: () => {},
    });
    assert.equal(res2.resolvedProvider, "groq");
    const [conn1AfterSecond] = await db
      .select()
      .from(providerConnections)
      .where(eq(providerConnections.id, "conn_fb_1"));
    assert.equal(conn1AfterSecond?.circuitStatus, "open");
    assert.equal(conn1AfterSecond?.failureCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("invokeUpstreamCompletion retries without stream_options on 400 and rejects empty completions", async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  const capturedBodies: Array<Record<string, unknown>> = [];

  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const parsed = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    capturedBodies.push(parsed);

    if (capturedBodies.length === 1) {
      return new Response("Extra inputs are not permitted: stream_options", {
        status: 400,
      });
    }
    if (capturedBodies.length === 2) {
      const sseBody = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode('data: {"choices":[{"delta":{"content":"Streamed"}}]}\n\n')
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(sseBody, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }

    return new Response(
      JSON.stringify({ choices: [{ message: { content: "" }, finish_reason: "stop" }] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const ok = await invokeUpstreamCompletion({
      provider: "openai",
      model: "gpt-4.1-mini",
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
      request: {
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      },
      onStreamDelta: () => {},
    });
    assert.equal(ok.content, "Streamed");
    assert.equal(capturedBodies.length, 2);
    assert.ok("stream_options" in capturedBodies[0]!);
    assert.equal("stream_options" in capturedBodies[1]!, false);

    await assert.rejects(
      () =>
        invokeUpstreamCompletion({
          provider: "openai",
          model: "gpt-4.1-mini",
          apiKey: "sk-test",
          baseUrl: "https://api.openai.com/v1",
          request: {
            model: "gpt-4.1-mini",
            messages: [{ role: "user", content: "hi" }],
            stream: false,
          },
        }),
      (err: unknown) =>
        err instanceof UpstreamHttpError &&
        err.statusCode === 502 &&
        err.retryable === true
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("invokeUpstreamCompletion aborts stalled SSE stream cleanly on timeoutMs", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    const stalledStream = new ReadableStream({
      start() {
        // Never enqueue or close to simulate an upstream hang after headers
      },
    });
    return new Response(stalledStream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        invokeUpstreamCompletion({
          provider: "openai",
          model: "gpt-4.1-mini",
          apiKey: "sk-test",
          baseUrl: "https://api.openai.com/v1",
          timeoutMs: 80,
          request: {
            model: "gpt-4.1-mini",
            messages: [{ role: "user", content: "hi" }],
            stream: true,
          },
          onStreamDelta: () => {},
        }),
      (err: unknown) =>
        err instanceof UpstreamHttpError &&
        err.statusCode === 504 &&
        err.retryable === true
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("routerEngine rotates pooled keys, retries tier 5xx, caches streaming responses, and enforces semantic API key scope", async () => {
  await ensureSchema();
  const uid = "user_pool_retry_test";
  await db.delete(user).where(eq(user.id, uid));
  await db.insert(user).values({
    id: uid,
    name: "Pool Retry Test",
    email: "pool-retry@example.com",
  });

  await db.insert(providerConnections).values({
    id: "conn_pool_1",
    userId: uid,
    provider: "openai",
    name: "Pooled OpenAI",
    baseUrl: "https://api.openai.com/v1",
    encryptedApiKey: encryptSecret("sk-pool-primary"),
    encryptedKeyPool: serializeEncryptedKeyPool(["sk-pool-secondary"]),
    keyPoolCursor: 0,
    isActive: true,
  });

  await db.insert(combos).values({
    id: "combo_pool_1",
    userId: uid,
    name: "smart-pool",
    strategy: "priority",
    enableCache: true,
    isActive: true,
  });

  await db.insert(comboTiers).values({
    id: "tier_pool_1",
    comboId: "combo_pool_1",
    connectionId: "conn_pool_1",
    upstreamModel: "gpt-6.2-sol",
    priority: 0,
    weight: 100,
    maxRetries: 2,
  });

  assert.equal(
    await isModelAllowedForKey("smart-pool", uid, "combo/smart-pool"),
    true
  );
  assert.equal(
    await isModelAllowedForKey("smart-pool", uid, "as-router-combo/smart-pool"),
    true
  );
  assert.equal(
    await isModelAllowedForKey("smart-pool", uid, "combo_pool_1"),
    true
  );
  assert.equal(
    await isModelAllowedForKey("smart-pool", uid, "other-combo"),
    false
  );

  // Verify Mistral, xAI & Perplexity auto-inference from unprefixed model IDs
  await db.insert(providerConnections).values([
    {
      id: "conn_mistral_auto",
      userId: uid,
      provider: "mistral",
      name: "Mistral Auto",
      encryptedApiKey: encryptSecret("sk-mistral-auto"),
      isActive: true,
    },
    {
      id: "conn_xai_auto",
      userId: uid,
      provider: "xai",
      name: "xAI Auto",
      encryptedApiKey: encryptSecret("sk-xai-auto"),
      isActive: true,
    },
    {
      id: "conn_pplx_auto",
      userId: uid,
      provider: "perplexity",
      name: "Perplexity Auto",
      encryptedApiKey: encryptSecret("sk-pplx-auto"),
      isActive: true,
    },
  ]);
  const mistralTarget = await resolveRoutingTarget(uid, "mistral-large-latest");
  assert.equal(mistralTarget.tiers[0]?.connection.provider, "mistral");
  const xaiTarget = await resolveRoutingTarget(uid, "grok-4.7");
  assert.equal(xaiTarget.tiers[0]?.connection.provider, "xai");
  const pplxTarget = await resolveRoutingTarget(uid, "sonar");
  assert.equal(pplxTarget.tiers[0]?.connection.provider, "perplexity");
  assert.equal(getProviderSpec("cerebras").defaultBaseUrl, "https://api.cerebras.ai/v1");
  assert.equal(getProviderSpec("together").defaultBaseUrl, "https://api.together.xyz/v1");
  assert.equal(getProviderSpec("fireworks").defaultBaseUrl, "https://api.fireworks.ai/inference/v1");

  clearGatewayResponseCache(uid);
  const originalFetch = globalThis.fetch;
  const authHeaders: string[] = [];
  let callCount = 0;

  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    callCount += 1;
    const headers = init?.headers as Record<string, string> | undefined;
    authHeaders.push(headers?.Authorization || headers?.authorization || "");

    // Call 1 (key 1): 429 -> rotate to key 2
    // Call 2 (key 2): 503 -> triggers retry pass #2 (maxRetries=2)
    // Call 3 (key 1): 200 OK
    if (callCount === 1) {
      return new Response(JSON.stringify({ error: { message: "Rate limit" } }), {
        status: 429,
      });
    }
    if (callCount === 2) {
      return new Response(JSON.stringify({ error: { message: "Transient 503" } }), {
        status: 503,
      });
    }

    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "Cached stream replay!" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 4 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const first = await executeGatewayChatCompletion({
      userId: uid,
      apiKeyId: null,
      apiKeyPrefix: null,
      request: {
        model: "smart-pool",
        messages: [{ role: "user", content: "Cache me please" }],
        stream: false,
        temperature: 0.2,
      },
    });
    assert.equal(first.content, "Cached stream replay!");
    assert.equal(callCount, 3);
    assert.equal(authHeaders[0], "Bearer sk-pool-primary");
    assert.equal(authHeaders[1], "Bearer sk-pool-secondary");

    // Second identical call WITH stream=true should hit cache and replay chunks without upstream fetch
    const streamDeltas: string[] = [];
    const second = await executeGatewayChatCompletion({
      userId: uid,
      apiKeyId: null,
      apiKeyPrefix: null,
      request: {
        model: "smart-pool",
        messages: [{ role: "user", content: "Cache me please" }],
        stream: true,
        temperature: 0.2,
      },
      onStreamDelta: (d) => {
        if (d.content) streamDeltas.push(d.content);
      },
    });
    assert.equal(second.cached, true);
    assert.equal(second.content, "Cached stream replay!");
    assert.equal(streamDeltas.join(""), "Cached stream replay!");
    assert.equal(callCount, 3);
  } finally {
    globalThis.fetch = originalFetch;
    clearGatewayResponseCache(uid);
  }
});

test("urlSafety ALLOW_LOCAL_PROVIDERS permits localhost Ollama while still blocking cloud metadata", () => {
  const prev = process.env.ALLOW_LOCAL_PROVIDERS;
  process.env.ALLOW_LOCAL_PROVIDERS = "true";
  try {
    assert.equal(isBlockedHost("localhost"), false);
    assert.equal(isBlockedHost("127.0.0.1"), false);
    assert.equal(isBlockedHost("169.254.169.254"), true);
    assert.equal(isBlockedHost("metadata.google.internal"), true);
    assert.equal(validateOutboundUrl("http://localhost:11434/v1").port, "11434");
    assert.throws(() => validateOutboundUrl("http://169.254.169.254/latest"));
  } finally {
    if (prev === undefined) {
      delete process.env.ALLOW_LOCAL_PROVIDERS;
    } else {
      process.env.ALLOW_LOCAL_PROVIDERS = prev;
    }
  }
});
test("getConnectionPrefix and resolveRoutingTarget resolve custom preset prefixes cleanly", async () => {
  assert.equal(
    getConnectionPrefix({
      provider: "custom",
      name: "SambaNova",
      baseUrl: "https://api.sambanova.ai/v1",
    }),
    "sambanova"
  );
  assert.equal(
    getConnectionPrefix({
      provider: "custom",
      name: "Cloudflare Workers AI #2",
      baseUrl: "https://api.cloudflare.com/client/v4/accounts/acc_12345/ai/v1",
    }),
    "cloudflare"
  );
  assert.equal(
    getConnectionPrefix({
      provider: "custom",
      name: "My Private Gateway",
      baseUrl: "https://gateway.example.com/v1",
    }),
    "my-private-gateway"
  );
  assert.ok(READY_MADE_PROVIDER_PRESETS.every((p) => Boolean(p.category)));
  const presetKeys = READY_MADE_PROVIDER_PRESETS.map((p) => p.key);
  assert.equal(new Set(presetKeys).size, presetKeys.length);
  assert.equal(
    getConnectionPrefix({
      provider: "custom",
      name: "Dahl Inference",
      baseUrl: "https://inference.dahl.global/v1",
    }),
    "dahl"
  );
  const freeTierPresets = READY_MADE_PROVIDER_PRESETS.filter(
    (p) => p.freeTier === "free-tier"
  );
  const freeCreditsPresets = READY_MADE_PROVIDER_PRESETS.filter(
    (p) => p.freeTier === "free-credits"
  );
  assert.ok(freeTierPresets.length >= 10);
  assert.ok(freeCreditsPresets.length >= 10);
  assert.ok(
    READY_MADE_PROVIDER_PRESETS.every(
      (p) => !p.freeTier || Boolean(p.freeTierNote?.trim())
    )
  );

  await ensureSchema();
  const uid = "user_prefix_test";
  await db.delete(user).where(eq(user.id, uid));
  await db.insert(user).values({
    id: uid,
    name: "Prefix Test",
    email: "prefix-test@example.com",
  });

  await db.insert(providerConnections).values([
    {
      id: "conn_pref_sambanova",
      userId: uid,
      provider: "custom",
      name: "SambaNova",
      baseUrl: "https://api.sambanova.ai/v1",
      defaultModel: "Meta-Llama-3.3-70B-Instruct",
      encryptedApiKey: encryptSecret("sk-test-sn"),
      isActive: true,
    },
    {
      id: "conn_pref_cohere",
      userId: uid,
      provider: "custom",
      name: "Cohere",
      baseUrl: "https://api.cohere.ai/compatibility/v1",
      defaultModel: "command-a-03-2025",
      encryptedApiKey: encryptSecret("sk-test-cohere"),
      isActive: true,
    },
  ]);

  const snTarget = await resolveRoutingTarget(
    uid,
    "sambanova/Meta-Llama-3.3-70B-Instruct"
  );
  assert.equal(snTarget.matchedVia, "direct");
  assert.equal(snTarget.tiers[0]?.connection.id, "conn_pref_sambanova");
  assert.equal(
    snTarget.tiers[0]?.tier.upstreamModel,
    "Meta-Llama-3.3-70B-Instruct"
  );

  const coTarget = await resolveRoutingTarget(uid, "cohere/command-a-03-2025");
  assert.equal(coTarget.matchedVia, "direct");
  assert.equal(coTarget.tiers[0]?.connection.id, "conn_pref_cohere");
  assert.equal(coTarget.tiers[0]?.tier.upstreamModel, "command-a-03-2025");
});

test("buildReadyMadeComboTiers ranks providers by preset intent and free eligibility", () => {
  const conns = [
    makeConn({
      id: "c_groq",
      provider: "groq",
      name: "Groq",
      defaultModel: "llama-3.3-70b-versatile",
      availableModels: JSON.stringify(["llama-3.3-70b-versatile"]),
      lastLatencyMs: 180,
    }),
    makeConn({
      id: "c_openai",
      provider: "openai",
      name: "OpenAI",
      defaultModel: "gpt-4.1-mini",
      availableModels: JSON.stringify(["gpt-4.1-mini", "o4-mini", "gpt-6.2-sol"]),
      lastLatencyMs: 420,
    }),
    makeConn({
      id: "c_deepseek",
      provider: "deepseek",
      name: "DeepSeek",
      defaultModel: "deepseek-chat",
      availableModels: JSON.stringify(["deepseek-chat", "deepseek-r1"]),
      lastLatencyMs: 550,
    }),
  ];

  const smartTiers = buildReadyMadeComboTiers("smart-auto", conns);
  assert.ok(smartTiers.length >= 3);

  const freeTiers = buildReadyMadeComboTiers("free-pool", conns);
  assert.ok(freeTiers.every((t) => t.connectionId !== "c_openai"));

  const fastTiers = buildReadyMadeComboTiers("fast-chat", conns);
  assert.equal(fastTiers[0]?.connectionId, "c_groq");

  const reasoningTiers = buildReadyMadeComboTiers("deep-reasoning", conns);
  assert.ok(
    reasoningTiers.some(
      (t) =>
        t.upstreamModel.includes("r1") || t.upstreamModel.includes("o4")
    )
  );
});

test("search catalog helpers distinguish search engines from LLM providers and presets include Tavily/Brave/Exa", () => {
  assert.equal(isSearchProvider("tavily"), true);
  assert.equal(isSearchProvider("brave-search"), true);
  assert.equal(isSearchProvider("exa"), true);
  assert.equal(isSearchProvider("openai"), false);
  assert.equal(isSearchProvider("custom"), false);
  assert.equal(getProviderSpec("custom").id, "custom");

  const searchPresets = READY_MADE_PROVIDER_PRESETS.filter(
    (p) => p.category === "search"
  );
  const keys = searchPresets.map((p) => p.key);
  assert.ok(keys.includes("tavily"));
  assert.ok(keys.includes("brave-search"));
  assert.ok(keys.includes("exa"));

  // Search providers must be excluded from automated LLM combo tier builders
  const mixedConns = [
    makeConn({
      id: "c_tavily",
      provider: "tavily",
      name: "Tavily",
      defaultModel: "tavily-search",
      availableModels: JSON.stringify(["tavily-search"]),
    }),
    makeConn({
      id: "c_groq",
      provider: "groq",
      name: "Groq",
      defaultModel: "llama-3.3-70b-versatile",
      availableModels: JSON.stringify(["llama-3.3-70b-versatile"]),
    }),
  ];
  const tiers = buildReadyMadeComboTiers("smart-auto", mixedConns);
  assert.equal(tiers.length, 1);
  assert.equal(tiers[0]?.connectionId, "c_groq");
});

test("parseDuckDuckGoHtml unwraps redirect URLs and applies include/exclude domain filters", () => {
  const sampleHtml = `
    <div class="result">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.example.com%2Fguide">Example Docs Guide</a>
      <div class="result__snippet">Complete developer guide for unified routing.</div>
    </div>
    <div class="result">
      <a class="result__a" href="https://spam.blocked.org/post">Blocked Post</a>
      <div class="result__snippet">Should be excluded cleanly.</div>
    </div>
    <div class="result">
      <a class="result__a" href="https://github.com/org/repo">Repo Readme</a>
      <a class="result__snippet">Open-source gateway implementation.</a>
    </div>
  `;

  const all = parseDuckDuckGoHtml(sampleHtml, [], ["blocked.org"], 5);
  assert.equal(all.length, 2);
  assert.equal(all[0]?.url, "https://docs.example.com/guide");
  assert.equal(all[0]?.title, "Example Docs Guide");
  assert.equal(all[0]?.content, "Complete developer guide for unified routing.");
  assert.equal(all[1]?.url, "https://github.com/org/repo");

  const scoped = parseDuckDuckGoHtml(sampleHtml, ["github.com"], [], 5);
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0]?.url, "https://github.com/org/repo");
});

test("extractReadableContentFromHtml strips scripts/styles, converts to Markdown, and filters by focus query", () => {
  const html = `
    <html>
      <head><title>Routing Benchmark &amp; Docs</title><style>.hidden{display:none}</style></head>
      <body>
        <nav><a href="/home">Home Nav</a></nav>
        <script>window.secret = "ignore-me";</script>
        <h1>Overview of Failover</h1>
        <p>Standard introductory paragraph discussing unrelated baseline metrics in general.</p>
        <h2>Tavily Failover Benchmarks</h2>
        <p>Our gateway achieves 99.95% uptime by rotating Tavily, Brave Search, and Exa keys with automatic circuit cooldowns.</p>
        <ul>
          <li>Supports <a href="https://docs.tavily.com">Tavily API</a> format</li>
        </ul>
      </body>
    </html>
  `;

  const full = extractReadableContentFromHtml(html, "markdown");
  assert.equal(full.title, "Routing Benchmark & Docs");
  assert.ok(!full.content.includes("ignore-me"));
  assert.ok(!full.content.includes("Home Nav"));
  assert.ok(full.content.includes("# Overview of Failover"));
  assert.ok(full.content.includes("[Tavily API](https://docs.tavily.com)"));

  const focused = extractReadableContentFromHtml(
    html,
    "markdown",
    "Tavily circuit cooldowns"
  );
  assert.ok(focused.content.includes("Tavily, Brave Search, and Exa"));
  assert.ok(!focused.content.includes("unrelated baseline metrics"));
});

test("LLM and Search presets are disjoint and search providers are blocked from AI combos and LLM routing", async () => {
  assert.equal(
    LLM_PROVIDER_PRESETS.length + SEARCH_PROVIDER_PRESETS.length,
    READY_MADE_PROVIDER_PRESETS.length
  );
  assert.ok(LLM_PROVIDER_PRESETS.every((p) => p.category !== "search"));
  assert.ok(SEARCH_PROVIDER_PRESETS.every((p) => p.category === "search"));

  await ensureSchema();
  const uid = "user_search_combo_block";
  await db.delete(user).where(eq(user.id, uid));
  await db.insert(user).values({
    id: uid,
    name: "Search Isolation Test",
    email: "search-isolation@example.com",
  });

  await db.insert(providerConnections).values([
    {
      id: "conn_iso_tavily",
      userId: uid,
      provider: "tavily",
      name: "Tavily Search",
      defaultModel: "tavily-search",
      encryptedApiKey: encryptSecret("tvly-test-key"),
      isActive: true,
    },
    {
      id: "conn_iso_groq",
      userId: uid,
      provider: "groq",
      name: "Groq LLM",
      defaultModel: "llama-3.3-70b-versatile",
      encryptedApiKey: encryptSecret("gsk-test-key"),
      isActive: true,
    },
  ]);

  const mixedCheck = await validateLlmComboConnections(uid, [
    "conn_iso_groq",
    "conn_iso_tavily",
  ]);
  assert.equal(mixedCheck.ok, false);
  if (!mixedCheck.ok) {
    assert.match(mixedCheck.error, /cannot be added to AI combos/i);
  }

  const llmOnlyCheck = await validateLlmComboConnections(uid, ["conn_iso_groq"]);
  assert.equal(llmOnlyCheck.ok, true);

  const directSearchTarget = await resolveRoutingTarget(uid, "tavily/tavily-search");
  assert.ok(
    directSearchTarget.tiers.every((t) => !isSearchProvider(t.connection.provider))
  );

  const defaultTarget = await resolveRoutingTarget(uid, "unknown-chat-model");
  assert.ok(
    defaultTarget.tiers.every((t) => !isSearchProvider(t.connection.provider))
  );
  assert.equal(defaultTarget.tiers[0]?.connection.id, "conn_iso_groq");
});

test("built-in auto model ID routes with intent_auto across active LLM connections and excludes search providers", async () => {
  await ensureSchema();
  const uid = "user_builtin_auto_test";
  await db.delete(user).where(eq(user.id, uid));
  await db.insert(user).values({
    id: uid,
    name: "Builtin Auto Test",
    email: "builtin-auto@example.com",
  });

  await db.insert(providerConnections).values([
    {
      id: "conn_auto_tavily",
      userId: uid,
      provider: "tavily",
      name: "Tavily Search",
      defaultModel: "tavily-search",
      encryptedApiKey: encryptSecret("tvly-auto-key"),
      isActive: true,
    },
    {
      id: "conn_auto_groq",
      userId: uid,
      provider: "groq",
      name: "Groq Fast",
      baseUrl: "https://api.groq.com/openai/v1",
      defaultModel: "llama-3.1-8b-instant",
      availableModels: JSON.stringify(["llama-3.1-8b-instant"]),
      encryptedApiKey: encryptSecret("gsk-auto-key"),
      isActive: true,
      lastLatencyMs: 120,
    },
    {
      id: "conn_auto_openai",
      userId: uid,
      provider: "openai",
      name: "OpenAI Flagship",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-6.2-sol",
      availableModels: JSON.stringify(["gpt-6.2-sol"]),
      encryptedApiKey: encryptSecret("sk-auto-key"),
      isActive: true,
      lastLatencyMs: 380,
    },
  ]);

  const target = await resolveRoutingTarget(uid, "auto");
  assert.equal(target.matchedVia, "builtin_auto");
  assert.equal(target.combo, null);
  assert.ok(target.tiers.length >= 2);
  assert.ok(target.tiers.every((t) => !isSearchProvider(t.connection.provider)));

  const prefixedTarget = await resolveRoutingTarget(uid, "as-router/auto");
  assert.equal(prefixedTarget.matchedVia, "builtin_auto");
  assert.equal(
    await isModelAllowedForKey("auto", uid, "as-router/auto"),
    true
  );

  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  let sentModel = "";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calledUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const body = JSON.parse(String(init?.body || "{}")) as { model?: string };
    sentModel = body.model || "";
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "Routed via auto!" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 6, completion_tokens: 4 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const res = await executeGatewayChatCompletion({
      userId: uid,
      apiKeyId: null,
      apiKeyPrefix: null,
      request: {
        model: "auto",
        messages: [{ role: "user", content: "Hi" }],
        stream: false,
      },
    });
    assert.equal(res.comboName, "auto");
    assert.equal(res.content, "Routed via auto!");
    assert.equal(res.resolvedProvider, "groq");
    assert.equal(res.resolvedModel, "llama-3.1-8b-instant");
    assert.ok(calledUrl.includes("api.groq.com"));
    assert.equal(sentModel, "llama-3.1-8b-instant");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Built-in 'claude' virtual model routes across active LLM providers and always picks the best flagship model", async () => {
  await ensureSchema();
  const uid = "usr_builtin_claude";
  await db.delete(user).where(eq(user.id, uid));
  await db.insert(user).values({
    id: uid,
    name: "Builtin Claude Test",
    email: "builtin-claude@example.com",
  });

  await db.insert(providerConnections).values([
    {
      id: "conn_claude_tavily",
      userId: uid,
      provider: "tavily",
      name: "Tavily Search",
      defaultModel: "tavily-search",
      encryptedApiKey: encryptSecret("tvly-claude-key"),
      isActive: true,
    },
    {
      id: "conn_claude_groq",
      userId: uid,
      provider: "groq",
      name: "Groq Fast",
      baseUrl: "https://api.groq.com/openai/v1",
      defaultModel: "llama-3.1-8b-instant",
      availableModels: JSON.stringify(["llama-3.1-8b-instant"]),
      encryptedApiKey: encryptSecret("gsk-claude-key"),
      isActive: true,
      lastLatencyMs: 90,
    },
    {
      id: "conn_claude_openai",
      userId: uid,
      provider: "openai",
      name: "OpenAI Flagship",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-6.2-sol",
      availableModels: JSON.stringify(["gpt-6.2-sol"]),
      encryptedApiKey: encryptSecret("sk-claude-key"),
      isActive: true,
      lastLatencyMs: 380,
    },
  ]);

  const target = await resolveRoutingTarget(uid, "claude");
  assert.equal(target.matchedVia, "builtin_claude");
  assert.equal(target.combo, null);
  assert.ok(target.tiers.length >= 2);
  assert.ok(target.tiers.every((t) => !isSearchProvider(t.connection.provider)));

  const prefixedTarget = await resolveRoutingTarget(uid, "as-router/claude");
  assert.equal(prefixedTarget.matchedVia, "builtin_claude");
  assert.equal(
    await isModelAllowedForKey("claude", uid, "as-router/claude"),
    true
  );

  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  let sentModel = "";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calledUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const body = JSON.parse(String(init?.body || "{}")) as { model?: string };
    sentModel = body.model || "";
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "Routed via best claude!" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 6, completion_tokens: 4 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const res = await executeGatewayChatCompletion({
      userId: uid,
      apiKeyId: null,
      apiKeyPrefix: null,
      request: {
        model: "claude",
        messages: [{ role: "user", content: "Hi" }],
        stream: false,
      },
    });
    assert.equal(res.comboName, "claude");
    assert.equal(res.content, "Routed via best claude!");
    assert.equal(res.resolvedProvider, "openai");
    assert.equal(res.resolvedModel, "gpt-6.2-astra");
    assert.ok(calledUrl.includes("api.openai.com"));
    assert.equal(sentModel, "gpt-6.2-astra");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("testConnectionModelsBatch and removeConnectionModels check all models and delete failed ones cleanly", async () => {
  await ensureSchema();
  const uid = "usr_model_batch_check";
  await db.delete(user).where(eq(user.id, uid));
  await db.insert(user).values({
    id: uid,
    name: "Batch Model Check",
    email: "batch-check@example.com",
  });

  await db.insert(providerConnections).values({
    id: "conn_batch_openai",
    userId: uid,
    provider: "openai",
    name: "OpenAI Batch",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "broken-model-404",
    availableModels: JSON.stringify(["broken-model-404", "gpt-6.2-sol"]),
    encryptedApiKey: encryptSecret("sk-batch-key"),
    isActive: true,
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || "{}")) as { model?: string };
    if (body.model === "broken-model-404") {
      return new Response(
        JSON.stringify({ error: { message: "Model broken-model-404 not found" } }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 4, completion_tokens: 1 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const checked = await testConnectionModelsBatch(uid, "conn_batch_openai", [
      "broken-model-404",
      "gpt-6.2-sol",
    ]);
    assert.equal(checked.results.length, 2);
    const failed = checked.results.find((r) => r.model === "broken-model-404");
    const working = checked.results.find((r) => r.model === "gpt-6.2-sol");
    assert.equal(failed?.ok, false);
    assert.ok(failed?.error?.includes("broken-model-404 not found"));
    assert.equal(working?.ok, true);
    assert.equal(checked.connection?.modelHealth["gpt-6.2-sol"]?.ok, true);
    assert.equal(checked.connection?.modelHealth["broken-model-404"]?.ok, false);

    // Delete only the failed model; working model stays & defaultModel updates
    const removedOne = await removeConnectionModels(uid, "conn_batch_openai", [
      "broken-model-404",
    ]);
    assert.equal(removedOne.ok, true);
    assert.equal(removedOne.removedCount, 1);
    assert.equal(removedOne.remainingCount, 1);
    assert.equal(removedOne.deactivated, false);
    assert.deepEqual(removedOne.connection?.availableModels, ["gpt-6.2-sol"]);
    assert.equal(removedOne.connection?.defaultModel, "gpt-6.2-sol");
    assert.equal(removedOne.connection?.modelHealth["broken-model-404"], undefined);

    // Delete the final remaining model; connection should deactivate cleanly
    const removedLast = await removeConnectionModels(uid, "conn_batch_openai", [
      "gpt-6.2-sol",
    ]);
    assert.equal(removedLast.deactivated, true);
    assert.equal(removedLast.remainingCount, 0);
    assert.equal(removedLast.connection?.isActive, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hasFreeModelSuffix and fetchProviderModels(freeOnly) only import models ending with 'free'", async () => {
  assert.equal(hasFreeModelSuffix("deepseek/deepseek-r1:free"), true);
  assert.equal(hasFreeModelSuffix("meta-llama/llama-3.3-70b-instruct:FREE"), true);
  assert.equal(hasFreeModelSuffix("openrouter/free"), true);
  assert.equal(hasFreeModelSuffix("qwen3-coder-free"), true);
  assert.equal(hasFreeModelSuffix("model_free"), true);
  assert.equal(hasFreeModelSuffix("openrouter/auto"), false);
  assert.equal(hasFreeModelSuffix("free-model-paid"), false);
  assert.equal(hasFreeModelSuffix("gemini-2.5-flash"), false);
  assert.equal(hasFreeModelSuffix("carefree"), false);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        data: [
          { id: "openrouter/auto", pricing: { prompt: "0", completion: "0" } },
          { id: "gpt-4o-mini", free: true },
          { id: "free-tier-model-v1" },
          { id: "deepseek/deepseek-r1:free", pricing: { prompt: "0", completion: "0" } },
          { id: "qwen/qwen3-coder-free" },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const models = await fetchProviderModels({
      provider: "openrouter",
      apiKey: "sk-or-test",
      baseUrl: "https://openrouter.ai/api/v1",
      freeOnly: true,
    });
    assert.deepEqual(models, [
      "deepseek/deepseek-r1:free",
      "qwen/qwen3-coder-free",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
