# AS ROUTER — Unified AI Gateway

**AS ROUTER** is a multi-provider AI gateway and intelligent routing platform. It unifies **Google Gemini, OpenAI, Anthropic, Groq, DeepSeek, Mistral, OpenRouter, and custom OpenAI-compatible endpoints** behind a single **OpenAI** and **Anthropic**-compatible API—complete with intent-based routing, automatic failover, circuit breakers, encrypted key storage, per-key spend budgets, and real-time telemetry.

---

## Core Services & Endpoints

| Endpoint | Compatibility | Capabilities |
| :--- | :--- | :--- |
| `POST /v1/chat/completions` | **OpenAI API** (`openai` TS/Python, LangChain, Cursor, cURL) | Streaming SSE, tool/function calling, multimodal vision (`image_url` & base64), prompt compression |
| `POST /v1/messages` | **Anthropic Messages API** (`@anthropic-ai/sdk`, Claude Code) | Full message & tool translation across non-Anthropic providers, streaming SSE |
| `GET /v1/models` | **OpenAI Models API** | Dynamically lists connected models and custom routing combos scoped to the workspace |
| `GET /api/logs/stream` | **Server-Sent Events (SSE)** | Real-time active routing status, live request logs, and circuit breaker state updates |

---

## Supported Providers

AS ROUTER supports **Bring Your Own Key (BYOK)** across 8 upstream provider types:

- **Google Gemini** (`@google/genai` native execution, multimodal vision & tool translation)
- **OpenAI**
- **Anthropic (Claude)**
- **Groq**
- **DeepSeek**
- **Mistral AI**
- **OpenRouter**
- **Custom OpenAI-Compatible** (Ollama, vLLM, LM Studio, Together, Fireworks, LiteLLM, or any self-hosted endpoint)

---

## Key Features

### 1. Intelligent Routing & Custom Combos
- **Built-in `smart-auto` Router**: Analyzes incoming requests (`vision`, `tools`, `coding`, `reasoning`, or `fast` chat) and selects the best connected model automatically.
- **6 Routing Strategies**:
  - `intent_auto` — Capability-matched routing based on request intent
  - `priority` — Deterministic ordered fallback chain
  - `round_robin` — Even distribution across healthy targets
  - `weighted` — Custom percentage traffic splitting
  - `least_used` — Balances load across lower-usage connections
  - `cost_optimized` — Prefers lowest-cost / free-tier eligible models first
- **Multi-Model Combos**: Create custom aliases (e.g., `my-prod-stack`) with drag-and-drop fallback chains across different providers.

### 2. High Availability & Failover
- **Automatic `429` & Error Failover**: Seamlessly retries rate-limited (`HTTP 429`), overloaded, or `5xx` responses onto the next healthy model in the chain before the client ever sees an error.
- **Circuit Breakers**: Automatically places failing connections on a short cooldown to protect latency, with live circuit status monitoring and manual reset controls.
- **Live Health Checks**: Test provider keys and inspect active health/cooldown state directly from the dashboard.

### 3. API Key Management, Quotas & Guardrails
- **Scoped Gateway Keys (`sk-asr-*`)**: Issue separate gateway keys for apps, scripts, or team members.
- **Daily & Monthly Quotas**: Enforce per-key **Daily Token Caps** and **Monthly USD Spend Limits** with automatic UTC daily/monthly resets.
- **Model & Cost Guardrails**: Restrict specific keys to an allowed model list or enable **Free Models Only** enforcement.
- **AES-256-GCM Key Vault**: Upstream provider API keys are encrypted at rest before database persistence.
- **SSRF Protection**: Validates remote `image_url` inputs and blocks private/loopback/metadata IP ranges during multimodal processing.

### 4. Dashboard & Observability
- **Overview**: Real-time request metrics, token consumption, estimated spend, latency stats, and provider distribution.
- **Providers**: Add, test, enable/disable, prioritize, set daily token/request limits, and manage custom models per provider.
- **Models Directory**: Unified searchable catalog of all connected providers and Model IDs with **1-click copy**.
- **Combos**: Visual builder for multi-provider routing chains and fallback strategies.
- **API Keys**: Create, revoke, copy, and configure budget/model limits for gateway keys.
- **Live Logs**: Real-time SSE request inspector displaying status codes, intent classification, resolved provider/model, fallback hops, latency, tokens, and estimated USD cost.
- **Interactive Playground & Dry-Run Simulator**: Test live chat completions, streaming responses, and preview exact routing paths without hitting upstream quotas.

### 5. Workspace Authentication & Multi-Tenancy
- **Isolated Workspaces**: Each account manages its own encrypted providers, models, combos, API keys, and request logs.
- **Better Auth**: Supports Email/Password authentication, Google OAuth sign-in, optional Email OTP verification on account registration, and workspace account/password settings.

---

## Drop-In SDK Usage

Use any standard OpenAI or Anthropic client by pointing `baseURL` to your AS ROUTER instance and authenticating with a generated gateway key (`sk-asr-...`):

### OpenAI SDK (TypeScript / JavaScript)
```ts
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://your-gateway-domain/v1",
  apiKey: "sk-asr-YOUR_GATEWAY_KEY",
});

const response = await client.chat.completions.create({
  model: "smart-auto",
  messages: [{ role: "user", content: "Explain circuit breakers concisely." }],
});
```

### OpenAI SDK (Python)
```python
from openai import OpenAI

client = OpenAI(
    base_url="https://your-gateway-domain/v1",
    api_key="sk-asr-YOUR_GATEWAY_KEY",
)

res = client.chat.completions.create(
    model="smart-auto",
    messages=[{"role": "user", "content": "Refactor this SQL query."}],
)
print(res.choices[0].message.content)
```

### Anthropic Claude SDK
```ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "https://your-gateway-domain",
  apiKey: "sk-asr-YOUR_GATEWAY_KEY",
});

const msg = await client.messages.create({
  model: "smart-auto",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Review this TypeScript module." }],
});
```

---
