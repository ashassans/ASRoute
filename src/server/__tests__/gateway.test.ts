import assert from "node:assert/strict";
import test, { after } from "node:test";

after(async () => {
  const g = globalThis as {
    _asRouterPglite?: { close?: () => Promise<void> };
  };
  await g._asRouterPglite?.close?.();
});
import { isModelKnownFree } from "../../shared/catalog.ts";
import {
  decryptSecret,
  encryptSecret,
  generateGatewayApiKey,
  hashGatewayApiKey,
} from "../crypto.ts";
import {
  classifyRequestIntent,
  evaluateTierEligibility,
  globToRegex,
  orderTiersByStrategy,
} from "../routerEngine.ts";
import { isBlockedHost, validateOutboundUrl } from "../urlSafety.ts";

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

test("catalog isModelKnownFree checks explicit free suffixes and known free models", () => {
  assert.equal(isModelKnownFree("openrouter", "openrouter/free"), true);
  assert.equal(
    isModelKnownFree("openrouter", "meta-llama/llama-4-scout:free"),
    true
  );
  assert.equal(isModelKnownFree("gemini", "gemini-2.5-flash"), true);
  assert.equal(isModelKnownFree("gemini", "gemini-4-hydrogen"), true);
  assert.equal(isModelKnownFree("gemini", "gemini-2.5-pro"), false);
  assert.equal(isModelKnownFree("openai", "gpt-4.1"), false);
  assert.equal(isModelKnownFree("anthropic", "claude-sonnet-4-20250514"), false);
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
