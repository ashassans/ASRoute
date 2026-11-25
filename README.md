# ASRoute

**ASRoute** is a unified, multi-provider AI gateway with a dashboard for routing, failover, observability, quotas, and API-key management.

[![Live Demo](https://img.shields.io/badge/Live%20Demo-asroute.vercel.app-111827?style=for-the-badge&logo=vercel)](https://asroute.vercel.app)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Unlicensed-lightgrey?style=for-the-badge)](#license)

## Live applications

- **Website:** https://asroute.vercel.app
- **Health check:** https://asroute.vercel.app/api/health
- **Gateway endpoint:** `https://asroute.vercel.app/v1`

## Overview

ASRoute gives applications one consistent interface for many AI providers. It supports OpenAI-compatible and Anthropic-compatible requests, while the dashboard lets you manage provider credentials, model routing, fallback chains, usage limits, logs, and analytics.

## Features

- **Unified OpenAI API** — compatible with `POST /v1/chat/completions` and `GET /v1/models`
- **Anthropic Messages compatibility** — compatible with `POST /v1/messages`
- **Multiple providers** — Google Gemini, OpenAI, Anthropic, Groq, DeepSeek, Mistral AI, OpenRouter, and custom OpenAI-compatible endpoints
- **Intelligent routing** — intent-based automatic routing, priority, round-robin, weighted, least-used, and cost-optimized strategies
- **Model combos** — combine multiple providers and models into reusable aliases with ordered fallback tiers
- **Automatic failover** — retry rate limits, overload errors, and upstream failures on the next healthy route
- **Circuit breakers** — isolate failing connections and provide manual reset controls
- **Prompt and response controls** — optional prompt compression, caching, streaming, tools, and vision input
- **BYOK provider keys** — encrypted provider credentials and support for multiple API keys
- **Gateway key security** — scoped `sk-asr-*` keys with daily token limits, monthly budgets, allowed combos, and free-model restrictions
- **Real-time observability** — SSE logs, provider health, latency, tokens, spend, routes, and analytics
- **Authentication** — email/password, optional email OTP verification, Google OAuth, and isolated workspaces
- **Dry-run simulator** — preview route selection without consuming upstream quota

## Tech stack

- React 19 and TypeScript
- Vite 8
- Express 4
- Tailwind CSS 4
- Drizzle ORM
- Better Auth
- PostgreSQL / Neon
- PGlite for local embedded PostgreSQL mode
- Server-Sent Events (SSE)
- Docker

## Quick start

### 1. Clone the repository

```bash
git clone https://github.com/ashassans/ASRoute.git
cd ASRoute
```

### 2. Install dependencies

```bash
npm install --legacy-peer-deps
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---:|---|
| `APP_URL` | Yes in production | Public application URL, for example `https://asroute.vercel.app` |
| `BETTER_AUTH_URL` | Yes in production | Better Auth public base URL |
| `BETTER_AUTH_SECRET` | Yes | Long random secret used for authentication |
| `DATABASE_URL` | Recommended | PostgreSQL or Neon connection string |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth client secret |
| `GMAIL_USER` | No | Gmail address for email OTP delivery |
| `GMAIL_APP_PASSWORD` | No | Gmail app password for email OTP delivery |
| `GEMINI_API_KEY` | No | Optional server-managed Gemini key |

For local development, ASRoute can use PGlite when `DATABASE_URL` is not configured. PGlite data is stored in `.asrouter-pgdata`.

Generate an authentication secret:

```bash
openssl rand -base64 32
```

### 4. Start locally

```bash
npm run dev
```

Open `http://localhost:3000`.

The development server serves both the React application and the API.

## API usage

First, register or sign in to ASRoute, then add a provider and create a gateway key in the dashboard. Provider keys belong to your workspace; the generated gateway key is what your applications use.

### OpenAI-compatible API

Set the base URL to:

```text
https://asroute.vercel.app/v1
```

#### JavaScript / TypeScript

```ts
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://asroute.vercel.app/v1",
  apiKey: "sk-asr-YOUR_GATEWAY_KEY",
});

const response = await client.chat.completions.create({
  model: "smart-auto",
  messages: [{ role: "user", content: "Explain circuit breakers concisely." }],
});

console.log(response.choices[0].message.content);
```

#### Python

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://asroute.vercel.app/v1",
    api_key="sk-asr-YOUR_GATEWAY_KEY",
)

response = client.chat.completions.create(
    model="smart-auto",
    messages=[{"role": "user", "content": "Explain circuit breakers concisely."}],
)

print(response.choices[0].message.content)
```

#### cURL

```bash
curl https://asroute.vercel.app/v1/chat/completions \
  -H "Authorization: Bearer sk-asr-YOUR_GATEWAY_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "smart-auto",
    "messages": [{"role":"user","content":"Hello!"}],
    "stream": false
  }'
```

Streaming is supported by adding `"stream": true`.

### Anthropic Messages API

```ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "https://asroute.vercel.app",
  apiKey: "sk-asr-YOUR_GATEWAY_KEY",
});

const message = await client.messages.create({
  model: "smart-auto",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Review this TypeScript module." }],
});

console.log(message.content);
```

### List models

```bash
curl https://asroute.vercel.app/v1/models \
  -H "Authorization: Bearer sk-asr-YOUR_GATEWAY_KEY"
```

## Routing

Use a provider/model pair such as `gemini/gemini-model-name`, or create a named combo and use its alias, such as `smart-auto` or `free-auto`.

Available routing strategies include:

| Strategy | Behavior |
|---|---|
| `intent_auto` | Selects routes based on detected request intent and capabilities |
| `priority` | Uses an ordered fallback chain |
| `round_robin` | Distributes requests evenly across healthy targets |
| `weighted` | Uses configured weights for traffic distribution |
| `least_used` | Prefers targets with lower usage |
| `cost_optimized` | Prefers lower-cost or eligible free targets |

## Dashboard

- **Overview** — request volume, success rate, spend, latency, and provider distribution
- **Providers** — add and test providers, synchronize models, configure quotas, and manage circuit breakers
- **Models** — search and copy available model identifiers
- **Combos** — build visual multi-provider fallback routes
- **API Keys** — create, scope, revoke, and limit gateway keys
- **Logs** — inspect live routing decisions and request outcomes through SSE
- **Playground** — test chat completions and dry-run routing

## Production build

```bash
npm run build
npm start
```

`npm run build` creates the Vite `dist` directory. In production, Express serves the built application and API from the same server.

Run checks:

```bash
npm run lint
```

## Docker

```bash
docker build -t asroute .

docker run --rm -p 3000:3000 \
  -e APP_URL=http://localhost:3000 \
  -e BETTER_AUTH_URL=http://localhost:3000 \
  -e BETTER_AUTH_SECRET="replace-with-a-long-random-secret" \
  -e DATABASE_URL="postgresql://user:password@host:5432/database" \
  asroute
```

The container exposes port `3000`.

## Deployment

### Vercel

The repository includes `vercel.json` and can be deployed as a Vercel project.

Set these environment variables in the deployment:

```text
APP_URL=https://asroute.vercel.app
BETTER_AUTH_URL=https://asroute.vercel.app
BETTER_AUTH_SECRET=<long-random-secret>
DATABASE_URL=<postgres-or-neon-url>
```

Add the Google OAuth and Gmail variables only when those integrations are required.

For authentication cookies and OAuth redirects, production URLs must match `APP_URL` and `BETTER_AUTH_URL`.

## Security

- Provider API keys are encrypted with AES-256-GCM before database storage
- Gateway keys are stored as hashes rather than raw values
- Workspace data is isolated by authenticated user ID
- Gateway keys can be restricted by combo and usage limits
- Remote image URLs are validated against private, loopback, and metadata networks
- API responses should never expose provider secrets

## Environment notes

- If no database URL is provided, ASRoute uses embedded PGlite storage
- PGlite is convenient for local development but PostgreSQL/Neon is recommended for production
- Provider credentials are workspace-specific
- The optional Gemini server key is not the primary provider-connection flow
