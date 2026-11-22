import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { db } from "../db/index.ts";
import {
  gatewayApiKeys,
  providerConnections,
  requestLogs,
} from "../db/schema.ts";
import { getProviderSpec, isSearchProvider } from "../shared/catalog.ts";
import type {
  FallbackHop,
  GatewayExtractFailedItem,
  GatewayExtractRequest,
  GatewayExtractResponse,
  GatewayExtractResultItem,
  GatewaySearchRequest,
  GatewaySearchResponse,
  GatewaySearchResultItem,
} from "../types/gateway.ts";
import { decryptSecret } from "./crypto.ts";
import { invokeUpstreamCompletion, UpstreamHttpError } from "./providers.ts";
import {
  publishCircuitUpdate,
  publishRouteActivity,
  publishTelemetryUpdate,
  publishUserLog,
} from "./sse.ts";
import { validateOutboundUrlWithDns } from "./urlSafety.ts";

type ConnectionRow = typeof providerConnections.$inferSelect;

function getConnectionKeys(conn: ConnectionRow): string[] {
  const keys: string[] = [];
  if (conn.encryptedApiKey) {
    try {
      const k = decryptSecret(conn.encryptedApiKey).trim();
      if (k) keys.push(k);
    } catch {
      // ignore corrupted entry
    }
  }
  if (conn.encryptedKeyPool) {
    try {
      const parsed = JSON.parse(decryptSecret(conn.encryptedKeyPool));
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === "string" && item.trim() && !keys.includes(item.trim())) {
            keys.push(item.trim());
          }
        }
      }
    } catch {
      // ignore pool parse failure
    }
  }
  if (keys.length === 0 && conn.useServerKey && conn.provider === "gemini") {
    const serverKey = process.env.GEMINI_API_KEY?.trim();
    if (serverKey) keys.push(serverKey);
  }
  return keys;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) && code > 0 ? String.fromCharCode(code) : " ";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 ? String.fromCharCode(code) : " ";
    });
}

function stripAllTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function extractReadableContentFromHtml(
  html: string,
  format: "markdown" | "text" = "markdown",
  focusQuery?: string
): { title: string; content: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripAllTags(titleMatch[1]) : "";

  let cleaned = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");

  if (format === "markdown") {
    cleaned = cleaned
      .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level, inner) => {
        const text = stripAllTags(inner);
        return text ? `\n\n${"#".repeat(Number(level))} ${text}\n\n` : "\n";
      })
      .replace(
        /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
        (_m, href, inner) => {
          const text = stripAllTags(inner);
          const cleanHref = href.trim();
          if (!text) return "";
          if (/^https?:\/\//i.test(cleanHref)) {
            return `[${text}](${cleanHref})`;
          }
          return text;
        }
      )
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner) => {
        const text = stripAllTags(inner);
        return text ? `\n- ${text}` : "";
      })
      .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_m, inner) => {
        const text = decodeHtmlEntities(inner.replace(/<[^>]+>/g, "")).trim();
        return text ? `\n\n\`\`\`\n${text}\n\`\`\`\n\n` : "";
      })
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_m, inner) => {
        const text = stripAllTags(inner);
        return text ? `\`${text}\`` : "";
      });
  }

  cleaned = cleaned
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|tr|blockquote|h[1-6]|li)>/gi, "\n\n")
    .replace(/<td[^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, " ");

  let text = decodeHtmlEntities(cleaned)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (focusQuery && focusQuery.trim()) {
    const terms = focusQuery
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 2);
    if (terms.length > 0) {
      const chunks = text
        .split(/\n{2,}/)
        .map((c) => c.trim())
        .filter((c) => c.length >= 25);
      const scored = chunks.map((chunk, idx) => {
        const lower = chunk.toLowerCase();
        let hits = 0;
        for (const term of terms) {
          if (lower.includes(term)) hits += 1;
        }
        return { chunk, hits, idx };
      });
      const relevant = scored
        .filter((s) => s.hits > 0)
        .sort((a, b) => (b.hits !== a.hits ? b.hits - a.hits : a.idx - b.idx))
        .slice(0, 8)
        .sort((a, b) => a.idx - b.idx)
        .map((s) => s.chunk);
      if (relevant.length > 0) {
        text = relevant.join("\n\n");
      }
    }
  }

  if (text.length > 18000) {
    text = `${text.slice(0, 18000)}\n\n[Truncated at 18,000 characters]`;
  }

  return { title, content: text };
}

export async function safeFetchWebPage(
  rawUrl: string,
  options: {
    format?: "markdown" | "text";
    focusQuery?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {}
): Promise<{ url: string; title: string; content: string }> {
  let currentUrl = (await validateOutboundUrlWithDns(rawUrl, "extract URL")).toString();
  const maxRedirects = 3;
  let response: globalThis.Response | null = null;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const timeoutSig = AbortSignal.timeout(options.timeoutMs ?? 12000);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSig])
      : timeoutSig;

    const res = await fetch(currentUrl, {
      method: "GET",
      redirect: "manual",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ASRouterBot/1.0; +https://asrouter.local)",
        Accept:
          "text/html,application/xhtml+xml,text/plain,text/markdown,application/json;q=0.9,*/*;q=0.5",
      },
      signal,
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) {
        throw new Error(`HTTP ${res.status} redirect without location header`);
      }
      const nextRaw = new URL(location, currentUrl).toString();
      currentUrl = (await validateOutboundUrlWithDns(nextRaw, "redirect URL")).toString();
      continue;
    }

    response = res;
    break;
  }

  if (!response) {
    throw new Error("Exceeded maximum redirects while fetching URL");
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText || "error"}`);
  }

  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (
    contentType &&
    !contentType.includes("text/") &&
    !contentType.includes("html") &&
    !contentType.includes("xml") &&
    !contentType.includes("json") &&
    !contentType.includes("markdown")
  ) {
    throw new Error(`Unsupported binary content type: ${contentType}`);
  }

  const rawBuffer = await response.arrayBuffer();
  const maxBytes = 1_500_000;
  const sliced =
    rawBuffer.byteLength > maxBytes ? rawBuffer.slice(0, maxBytes) : rawBuffer;
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(sliced);

  if (
    contentType.includes("text/plain") ||
    contentType.includes("text/markdown") ||
    contentType.includes("application/json")
  ) {
    const trimmed = decoded.trim().slice(0, 18000);
    return {
      url: currentUrl,
      title: new URL(currentUrl).hostname,
      content: trimmed,
    };
  }

  const extracted = extractReadableContentFromHtml(
    decoded,
    options.format || "markdown",
    options.focusQuery
  );
  return {
    url: currentUrl,
    title: extracted.title || new URL(currentUrl).hostname,
    content: extracted.content,
  };
}

function normalizeDomainList(domains?: string[]): string[] {
  if (!Array.isArray(domains)) return [];
  return domains
    .map((d) =>
      String(d || "")
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/\/.*$/, "")
        .replace(/^www\./, "")
    )
    .filter(Boolean)
    .slice(0, 50);
}

function matchesDomainFilter(
  urlStr: string,
  includeDomains: string[],
  excludeDomains: string[]
): boolean {
  let host = "";
  try {
    host = new URL(urlStr).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  if (excludeDomains.some((d) => host === d || host.endsWith(`.${d}`))) {
    return false;
  }
  if (includeDomains.length > 0) {
    return includeDomains.some((d) => host === d || host.endsWith(`.${d}`));
  }
  return true;
}

export function parseDuckDuckGoHtml(
  html: string,
  includeDomains: string[] = [],
  excludeDomains: string[] = [],
  maxResults = 10
): GatewaySearchResultItem[] {
  const results: GatewaySearchResultItem[] = [];
  const seenUrls = new Set<string>();

  const linkRegex =
    /<a[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex =
    /<(?:a|div|span)[^>]*class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div|span)>/gi;

  const links: Array<{ url: string; title: string; index: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null) {
    let rawHref = decodeHtmlEntities(match[1].trim());
    if (rawHref.startsWith("//")) rawHref = `https:${rawHref}`;
    try {
      const parsed = new URL(rawHref, "https://duckduckgo.com");
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) {
        rawHref = decodeURIComponent(uddg);
      }
    } catch {
      // keep rawHref
    }
    if (!/^https?:\/\//i.test(rawHref)) continue;
    const title = stripAllTags(match[2]);
    if (!title) continue;
    links.push({ url: rawHref, title, index: match.index });
  }

  const snippets: Array<{ text: string; index: number }> = [];
  while ((match = snippetRegex.exec(html)) !== null) {
    const text = stripAllTags(match[1]);
    if (text) {
      snippets.push({ text, index: match.index });
    }
  }

  for (let i = 0; i < links.length; i += 1) {
    const item = links[i];
    if (seenUrls.has(item.url)) continue;
    if (!matchesDomainFilter(item.url, includeDomains, excludeDomains)) continue;
    seenUrls.add(item.url);

    const nextLinkIdx = i + 1 < links.length ? links[i + 1].index : Infinity;
    const matchingSnippet = snippets.find(
      (s) => s.index > item.index && s.index < nextLinkIdx
    );

    const rankScore = Number(Math.max(0.45, 0.96 - results.length * 0.04).toFixed(2));
    results.push({
      title: item.title,
      url: item.url,
      content: matchingSnippet?.text || item.title,
      score: rankScore,
      raw_content: null,
      published_date: null,
    });

    if (results.length >= maxResults) break;
  }

  return results;
}

async function executeBuiltinSearch(
  req: GatewaySearchRequest,
  signal?: AbortSignal
): Promise<{
  results: GatewaySearchResultItem[];
  groundedAnswer: string | null;
  answerModel: string | null;
}> {
  const maxResults = Math.min(20, Math.max(1, Number(req.max_results) || 5));
  const includeDomains = normalizeDomainList(req.include_domains);
  const excludeDomains = normalizeDomainList(req.exclude_domains);

  let effectiveQuery = req.query.trim();
  if (req.topic === "news" && !/\bnews\b/i.test(effectiveQuery)) {
    effectiveQuery = `${effectiveQuery} news`;
  } else if (req.topic === "finance" && !/\bfinance|market|stock\b/i.test(effectiveQuery)) {
    effectiveQuery = `${effectiveQuery} finance`;
  }
  if (includeDomains.length > 0 && includeDomains.length <= 3) {
    const siteClause = includeDomains.map((d) => `site:${d}`).join(" OR ");
    effectiveQuery = `${effectiveQuery} (${siteClause})`;
  }
  if (excludeDomains.length > 0 && excludeDomains.length <= 5) {
    effectiveQuery = `${effectiveQuery} ${excludeDomains.map((d) => `-site:${d}`).join(" ")}`;
  }

  let results: GatewaySearchResultItem[] = [];
  let groundedAnswer: string | null = null;
  let answerModel: string | null = null;

  // 1. Live DuckDuckGo HTML Index
  try {
    const ddgTimeMap: Record<string, string> = {
      day: "d",
      week: "w",
      month: "m",
      year: "y",
    };
    const params = new URLSearchParams({ q: effectiveQuery });
    if (req.time_range && ddgTimeMap[req.time_range]) {
      params.set("df", ddgTimeMap[req.time_range]);
    }
    const timeoutSig = AbortSignal.timeout(10000);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSig]) : timeoutSig;
    const ddgRes = await fetch(`https://html.duckduckgo.com/html/?${params.toString()}`, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: combinedSignal,
    });
    if (ddgRes.ok) {
      const html = await ddgRes.text();
      results = parseDuckDuckGoHtml(
        html,
        includeDomains,
        excludeDomains,
        maxResults
      );
    }
  } catch {
    // fallback handled below
  }

  // 2. Fallback to Gemini Google Search Grounding if DDG yielded empty & server key exists
  const serverGeminiKey = process.env.GEMINI_API_KEY?.trim();
  if (results.length === 0 && serverGeminiKey) {
    try {
      const ai = new GoogleGenAI({
        apiKey: serverGeminiKey,
        httpOptions: { headers: { "User-Agent": "aistudio-build" } },
      });
      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: `Search the web and provide grounded facts for: ${req.query}`,
        config: {
          tools: [{ googleSearch: {} }],
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });

      const chunks =
        response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      const seen = new Set<string>();
      for (const ch of chunks) {
        const uri = ch?.web?.uri;
        const title = ch?.web?.title;
        if (!uri || !/^https?:\/\//i.test(uri) || seen.has(uri)) continue;
        if (!matchesDomainFilter(uri, includeDomains, excludeDomains)) continue;
        seen.add(uri);
        results.push({
          title: title || new URL(uri).hostname,
          url: uri,
          content: response.text
            ? response.text.slice(0, 320).trim()
            : title || uri,
          score: Number(Math.max(0.55, 0.95 - results.length * 0.05).toFixed(2)),
          raw_content: null,
          published_date: null,
        });
        if (results.length >= maxResults) break;
      }

      if (req.include_answer && response.text?.trim()) {
        groundedAnswer = response.text.trim();
        answerModel = "gemini-4-hydrogen (googleSearch)";
      }
    } catch {
      // continue to Wikipedia instant fallback if needed
    }
  }

  // 3. Secondary Wikipedia Search fallback if still empty
  if (results.length === 0) {
    try {
      const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
        req.query.trim()
      )}&srlimit=${maxResults}&format=json&utf8=1`;
      const wikiRes = await fetch(wikiUrl, {
        headers: { "User-Agent": "ASRouterBot/1.0" },
        signal: AbortSignal.timeout(8000),
      });
      if (wikiRes.ok) {
        const wikiJson = (await wikiRes.json()) as {
          query?: {
            search?: Array<{ title?: string; snippet?: string; pageid?: number }>;
          };
        };
        const items = wikiJson.query?.search || [];
        for (const item of items) {
          if (!item.title) continue;
          const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(
            item.title.replace(/\s+/g, "_")
          )}`;
          if (!matchesDomainFilter(url, includeDomains, excludeDomains)) continue;
          results.push({
            title: `${item.title} - Wikipedia`,
            url,
            content: stripAllTags(item.snippet || item.title),
            score: Number(Math.max(0.5, 0.9 - results.length * 0.06).toFixed(2)),
            raw_content: null,
            published_date: null,
          });
          if (results.length >= maxResults) break;
        }
      }
    } catch {
      // leave results empty
    }
  }

  // 4. Optional page extraction for raw_content or advanced search_depth
  const wantsRaw = Boolean(req.include_raw_content);
  const enrichCount =
    wantsRaw || req.search_depth === "advanced" ? Math.min(results.length, 5) : 0;

  if (enrichCount > 0) {
    const format = req.include_raw_content === "text" ? "text" : "markdown";
    await Promise.all(
      results.slice(0, enrichCount).map(async (item, idx) => {
        try {
          const fetched = await safeFetchWebPage(item.url, {
            format,
            focusQuery: req.query,
            timeoutMs: 7000,
            signal,
          });
          if (fetched.content) {
            if (wantsRaw) {
              results[idx].raw_content = fetched.content;
            }
            if (
              results[idx].content.length < 140 &&
              fetched.content.length > results[idx].content.length
            ) {
              results[idx].content = fetched.content.slice(0, 600);
            }
          }
        } catch {
          // keep search snippet if individual page blocked scraping
        }
      })
    );
  }

  return { results, groundedAnswer, answerModel };
}

async function invokeTavilySearch(
  conn: ConnectionRow,
  apiKey: string,
  req: GatewaySearchRequest,
  signal?: AbortSignal
): Promise<{ results: GatewaySearchResultItem[]; answer: string | null }> {
  const baseUrl = (conn.baseUrl || "https://api.tavily.com").replace(/\/+$/, "");
  const validated = (
    await validateOutboundUrlWithDns(`${baseUrl}/search`, "Tavily endpoint")
  ).toString();
  const timeoutSig = AbortSignal.timeout(20000);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSig]) : timeoutSig;

  const res = await fetch(validated, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query: req.query,
      search_depth: req.search_depth || "basic",
      topic: req.topic || "general",
      max_results: Math.min(20, Math.max(1, Number(req.max_results) || 5)),
      include_answer: Boolean(req.include_answer),
      include_raw_content: Boolean(req.include_raw_content),
      ...(req.include_domains?.length ? { include_domains: req.include_domains } : {}),
      ...(req.exclude_domains?.length ? { exclude_domains: req.exclude_domains } : {}),
      ...(req.time_range ? { time_range: req.time_range } : {}),
      ...(req.days ? { days: req.days } : {}),
    }),
    signal: combinedSignal,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new UpstreamHttpError(
      `Tavily HTTP ${res.status}: ${errText.slice(0, 180)}`,
      res.status,
      res.status === 429 || res.status >= 500
    );
  }

  const json = (await res.json()) as {
    answer?: string | null;
    results?: Array<{
      title?: string;
      url?: string;
      content?: string;
      score?: number;
      raw_content?: string | null;
      published_date?: string | null;
    }>;
  };

  return {
    answer: json.answer ?? null,
    results: (Array.isArray(json.results) ? json.results : []).map((r, i) => ({
      title: String(r.title || r.url || "Untitled"),
      url: String(r.url || ""),
      content: String(r.content || ""),
      score: typeof r.score === "number" ? r.score : Number((0.95 - i * 0.05).toFixed(2)),
      raw_content: r.raw_content ?? null,
      published_date: r.published_date ?? null,
    })),
  };
}

async function invokeBraveSearch(
  conn: ConnectionRow,
  apiKey: string,
  req: GatewaySearchRequest,
  signal?: AbortSignal
): Promise<{ results: GatewaySearchResultItem[]; answer: string | null }> {
  const baseUrl = (conn.baseUrl || "https://api.search.brave.com/res/v1").replace(
    /\/+$/,
    ""
  );
  const includeDomains = normalizeDomainList(req.include_domains);
  const excludeDomains = normalizeDomainList(req.exclude_domains);

  let q = req.query.trim();
  if (includeDomains.length > 0 && includeDomains.length <= 3) {
    q = `${q} (${includeDomains.map((d) => `site:${d}`).join(" OR ")})`;
  }
  if (excludeDomains.length > 0 && excludeDomains.length <= 5) {
    q = `${q} ${excludeDomains.map((d) => `-site:${d}`).join(" ")}`;
  }

  const count = Math.min(20, Math.max(1, Number(req.max_results) || 5));
  const params = new URLSearchParams({
    q,
    count: String(count),
    extra_snippets: "true",
  });
  const braveFreshness: Record<string, string> = {
    day: "pd",
    week: "pw",
    month: "pm",
    year: "py",
  };
  if (req.time_range && braveFreshness[req.time_range]) {
    params.set("freshness", braveFreshness[req.time_range]);
  }

  const validated = (
    await validateOutboundUrlWithDns(
      `${baseUrl}/web/search?${params.toString()}`,
      "Brave Search endpoint"
    )
  ).toString();
  const timeoutSig = AbortSignal.timeout(15000);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSig]) : timeoutSig;

  const res = await fetch(validated, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
    signal: combinedSignal,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new UpstreamHttpError(
      `Brave Search HTTP ${res.status}: ${errText.slice(0, 180)}`,
      res.status,
      res.status === 429 || res.status >= 500
    );
  }

  const json = (await res.json()) as {
    web?: {
      results?: Array<{
        title?: string;
        url?: string;
        description?: string;
        extra_snippets?: string[];
        page_age?: string;
      }>;
    };
  };

  const items = (json.web?.results || [])
    .filter((r) => Boolean(r.url) && matchesDomainFilter(r.url!, includeDomains, excludeDomains))
    .slice(0, count);

  const results: GatewaySearchResultItem[] = items.map((r, i) => ({
    title: String(r.title || r.url),
    url: String(r.url),
    content: [r.description, ...(r.extra_snippets || []).slice(0, 2)]
      .filter(Boolean)
      .join(" ")
      .trim(),
    score: Number(Math.max(0.45, 0.95 - i * 0.04).toFixed(2)),
    raw_content: null,
    published_date: r.page_age || null,
  }));

  if (req.include_raw_content) {
    const format = req.include_raw_content === "text" ? "text" : "markdown";
    await Promise.all(
      results.slice(0, 5).map(async (item, idx) => {
        try {
          const fetched = await safeFetchWebPage(item.url, {
            format,
            focusQuery: req.query,
            timeoutMs: 7000,
            signal,
          });
          results[idx].raw_content = fetched.content;
        } catch {
          // ignore per-page fetch error
        }
      })
    );
  }

  return { results, answer: null };
}

async function invokeExaSearch(
  conn: ConnectionRow,
  apiKey: string,
  req: GatewaySearchRequest,
  signal?: AbortSignal
): Promise<{ results: GatewaySearchResultItem[]; answer: string | null }> {
  const baseUrl = (conn.baseUrl || "https://api.exa.ai").replace(/\/+$/, "");
  const validated = (
    await validateOutboundUrlWithDns(`${baseUrl}/search`, "Exa Search endpoint")
  ).toString();
  const timeoutSig = AbortSignal.timeout(20000);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSig]) : timeoutSig;

  const includeDomains = normalizeDomainList(req.include_domains);
  const excludeDomains = normalizeDomainList(req.exclude_domains);

  const payload: Record<string, unknown> = {
    query: req.query,
    numResults: Math.min(20, Math.max(1, Number(req.max_results) || 5)),
    type: req.search_depth === "advanced" ? "neural" : "auto",
    contents: {
      text: Boolean(req.include_raw_content),
      highlights: { numSentences: 3 },
    },
  };
  if (includeDomains.length > 0) payload.includeDomains = includeDomains;
  if (excludeDomains.length > 0) payload.excludeDomains = excludeDomains;
  if (req.topic === "news") payload.category = "news";

  const res = await fetch(validated, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(payload),
    signal: combinedSignal,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new UpstreamHttpError(
      `Exa HTTP ${res.status}: ${errText.slice(0, 180)}`,
      res.status,
      res.status === 429 || res.status >= 500
    );
  }

  const json = (await res.json()) as {
    results?: Array<{
      title?: string;
      url?: string;
      text?: string;
      highlights?: string[];
      score?: number;
      publishedDate?: string;
    }>;
  };

  return {
    answer: null,
    results: (json.results || []).map((r, i) => ({
      title: String(r.title || r.url || "Untitled"),
      url: String(r.url || ""),
      content:
        (Array.isArray(r.highlights) && r.highlights.join(" ... ")) ||
        (r.text ? r.text.slice(0, 450) : "") ||
        String(r.title || ""),
      score:
        typeof r.score === "number"
          ? Number(Math.min(1, Math.max(0, r.score)).toFixed(2))
          : Number(Math.max(0.45, 0.94 - i * 0.04).toFixed(2)),
      raw_content: req.include_raw_content ? r.text || null : null,
      published_date: r.publishedDate || null,
    })),
  };
}

async function synthesizeSearchAnswer(params: {
  userId: string;
  query: string;
  results: GatewaySearchResultItem[];
  depth: "basic" | "advanced";
  signal?: AbortSignal;
}): Promise<{ answer: string | null; answerModel: string | null }> {
  const { userId, query, results, depth, signal } = params;
  if (results.length === 0) {
    return {
      answer: `No live web results were found for "${query}". Try broadening your search terms or domain filters.`,
      answerModel: null,
    };
  }

  const contextBlock = results
    .slice(0, 6)
    .map(
      (r, idx) =>
        `[${idx + 1}] ${r.title}\nURL: ${r.url}\nSnippet: ${r.content.slice(0, 600)}`
    )
    .join("\n\n");

  const systemPrompt =
    "You synthesize accurate, concise answers grounded strictly in the provided search results. Cite sources inline using [1], [2], etc. Never fabricate facts not present in the sources.";
  const userPrompt =
    depth === "advanced"
      ? `Question: ${query}\n\nSearch Results:\n${contextBlock}\n\nWrite a clear, structured summary answering the question with inline [n] citations.`
      : `Question: ${query}\n\nSearch Results:\n${contextBlock}\n\nWrite a concise 2-4 sentence answer grounded in the sources with inline [n] citations.`;

  // 1. Try connected active LLM connections in user's workspace
  try {
    const userConns = await db
      .select()
      .from(providerConnections)
      .where(
        and(
          eq(providerConnections.userId, userId),
          eq(providerConnections.isActive, true)
        )
      );

    const now = Date.now();
    const llmConns = userConns
      .filter((c) => !isSearchProvider(c.provider))
      .filter((c) => !(c.cooldownUntil && new Date(c.cooldownUntil).getTime() > now))
      .sort((a, b) => {
        const fastOrder = ["gemini", "groq", "cerebras", "openai", "openrouter"];
        const ai = fastOrder.indexOf(a.provider);
        const bi = fastOrder.indexOf(b.provider);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });

    for (const conn of llmConns.slice(0, 2)) {
      const keys = getConnectionKeys(conn);
      const key = keys[0];
      const spec = getProviderSpec(conn.provider);
      const model = conn.defaultModel || spec.models[0]?.id;
      if (!key || !model) continue;

      try {
        const res = await invokeUpstreamCompletion({
          provider: conn.provider,
          model,
          apiKey: key,
          baseUrl: conn.baseUrl,
          timeoutMs: 12000,
          signal,
          request: {
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            max_tokens: depth === "advanced" ? 700 : 350,
            temperature: 0.2,
            stream: false,
          },
        });
        if (res.content.trim()) {
          return {
            answer: res.content.trim(),
            answerModel: `${conn.provider}/${model}`,
          };
        }
      } catch {
        // try next LLM connection
      }
    }
  } catch {
    // ignore workspace LLM lookup error
  }

  // 2. Fallback to server-side Gemini key if configured
  const serverGeminiKey = process.env.GEMINI_API_KEY?.trim();
  if (serverGeminiKey) {
    try {
      const ai = new GoogleGenAI({
        apiKey: serverGeminiKey,
        httpOptions: { headers: { "User-Agent": "aistudio-build" } },
      });
      const res = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: userPrompt,
        config: {
          systemInstruction: systemPrompt,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      if (res.text?.trim()) {
        return {
          answer: res.text.trim(),
          answerModel: "gemini-4-hydrogen",
        };
      }
    } catch {
      // fall through to extractive summary
    }
  }

  // 3. Deterministic extractive summary fallback
  const topLines = results
    .slice(0, 3)
    .map((r, i) => `${r.content.slice(0, 180).trim()} [${i + 1}]`)
    .join(" ");
  return { answer: topLines, answerModel: "extractive-summary" };
}

function getOrderedSearchConnections(
  allConns: ConnectionRow[],
  preference: string
): ConnectionRow[] {
  const now = Date.now();
  const activeSearch = allConns.filter(
    (c) =>
      c.isActive &&
      isSearchProvider(c.provider) &&
      !(c.cooldownUntil && new Date(c.cooldownUntil).getTime() > now)
  );

  if (preference === "builtin") return [];
  if (preference !== "auto") {
    return activeSearch.filter((c) => c.provider === preference);
  }

  const order = ["tavily", "brave-search", "exa"];
  return [...activeSearch].sort((a, b) => {
    const ai = order.indexOf(a.provider);
    const bi = order.indexOf(b.provider);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}

async function recordSearchTelemetry(params: {
  userId: string;
  apiKeyId: string | null;
  apiKeyPrefix: string;
  requestedAction: string;
  intent: "search" | "extract";
  resolvedProvider: string;
  resolvedModel: string;
  connectionName: string | null;
  statusCode: number;
  outcome: string;
  hops: FallbackHop[];
  latencyMs: number;
  errorMessage: string | null;
}) {
  const logId = `log_${crypto.randomBytes(8).toString("hex")}`;
  const serializedHops = JSON.stringify(params.hops);
  const now = new Date();

  try {
    await db.insert(requestLogs).values({
      id: logId,
      userId: params.userId,
      apiKeyId: params.apiKeyId,
      apiKeyPrefix: params.apiKeyPrefix,
      comboName: null,
      requestedModel: params.requestedAction,
      resolvedProvider: params.resolvedProvider,
      resolvedModel: params.resolvedModel,
      connectionName: params.connectionName,
      statusCode: params.statusCode,
      outcome: params.outcome,
      fallbackAttempts: serializedHops,
      promptTokens: 0,
      completionTokens: 0,
      estimatedCostUsd: 0,
      latencyMs: params.latencyMs,
      compressed: false,
      detectedIntent: params.intent,
      errorMessage: params.errorMessage,
    });

    publishUserLog(params.userId, {
      id: logId,
      userId: params.userId,
      apiKeyId: params.apiKeyId,
      apiKeyPrefix: params.apiKeyPrefix,
      comboName: null,
      requestedModel: params.requestedAction,
      resolvedProvider: params.resolvedProvider,
      resolvedModel: params.resolvedModel,
      connectionName: params.connectionName,
      statusCode: params.statusCode,
      outcome: params.outcome,
      fallbackAttempts: serializedHops,
      promptTokens: 0,
      completionTokens: 0,
      estimatedCostUsd: 0,
      latencyMs: params.latencyMs,
      compressed: false,
      detectedIntent: params.intent,
      errorMessage: params.errorMessage,
      createdAt: now.toISOString(),
    });

    if (params.apiKeyId) {
      await db
        .update(gatewayApiKeys)
        .set({
          totalRequests: sql`${gatewayApiKeys.totalRequests} + 1`,
          lastUsedAt: now,
        })
        .where(eq(gatewayApiKeys.id, params.apiKeyId));

      publishTelemetryUpdate(params.userId, {
        keyIncrement: {
          keyId: params.apiKeyId,
          requests: 1,
          tokens: 0,
          costUsd: 0,
          lastUsedAt: now.toISOString(),
        },
      });
    }
  } catch (err) {
    console.error("[AS ROUTER] Failed to record search log:", err);
  }
}

export async function executeGatewaySearch(params: {
  userId: string;
  apiKeyId: string | null;
  apiKeyPrefix: string;
  request: GatewaySearchRequest;
  signal?: AbortSignal;
}): Promise<GatewaySearchResponse> {
  const start = Date.now();
  const { userId, apiKeyId, apiKeyPrefix, request, signal } = params;
  const preference = request.provider || "auto";
  const depth = request.search_depth === "advanced" ? "advanced" : "basic";
  const hops: FallbackHop[] = [];
  const requestId = `srch_${crypto.randomBytes(6).toString("hex")}`;

  const allConns = await db
    .select()
    .from(providerConnections)
    .where(eq(providerConnections.userId, userId));

  const candidates = getOrderedSearchConnections(allConns, preference);

  let results: GatewaySearchResultItem[] | null = null;
  let answer: string | null = null;
  let answerModel: string | null = null;
  let resolvedProvider = "builtin";
  let connectionName: string | null = "Built-in Web Search";

  for (const conn of candidates) {
    const keys = getConnectionKeys(conn);
    const apiKey = keys[conn.keyPoolCursor % Math.max(1, keys.length)];
    if (!apiKey) {
      hops.push({
        tierId: conn.id,
        connectionId: conn.id,
        connectionName: conn.name,
        provider: conn.provider,
        model: conn.defaultModel || conn.provider,
        status: "skipped",
        reason: "Missing decrypted API key",
        latencyMs: 0,
      });
      continue;
    }

    const attemptStart = Date.now();
    publishRouteActivity(userId, {
      requestId,
      phase: "start",
      provider: conn.provider,
      model: conn.defaultModel || conn.provider,
      connectionId: conn.id,
      connectionName: conn.name,
      requestedModel: `search:${depth}`,
      timestamp: new Date().toISOString(),
    });

    try {
      const upstream =
        conn.provider === "tavily"
          ? await invokeTavilySearch(conn, apiKey, request, signal)
          : conn.provider === "brave-search"
            ? await invokeBraveSearch(conn, apiKey, request, signal)
            : await invokeExaSearch(conn, apiKey, request, signal);

      const attemptLatency = Date.now() - attemptStart;
      results = upstream.results;
      answer = upstream.answer;
      resolvedProvider = conn.provider;
      connectionName = conn.name;

      hops.push({
        tierId: conn.id,
        connectionId: conn.id,
        connectionName: conn.name,
        provider: conn.provider,
        model: conn.defaultModel || `${conn.provider}-search`,
        status: "success",
        statusCode: 200,
        reason: `Returned ${upstream.results.length} results`,
        latencyMs: attemptLatency,
      });

      await db
        .update(providerConnections)
        .set({
          usedRequestsToday: sql`${providerConnections.usedRequestsToday} + 1`,
          circuitStatus: "healthy",
          failureCount: 0,
          cooldownUntil: null,
          lastLatencyMs: attemptLatency,
          lastError: null,
          keyPoolCursor: (conn.keyPoolCursor + 1) % Math.max(1, keys.length),
        })
        .where(eq(providerConnections.id, conn.id));

      publishRouteActivity(userId, {
        requestId,
        phase: "end",
        provider: conn.provider,
        model: conn.defaultModel || conn.provider,
        connectionId: conn.id,
        connectionName: conn.name,
        requestedModel: `search:${depth}`,
        outcome: "success",
        timestamp: new Date().toISOString(),
      });
      break;
    } catch (err: unknown) {
      const attemptLatency = Date.now() - attemptStart;
      const statusCode = err instanceof UpstreamHttpError ? err.statusCode : 502;
      const msg = err instanceof Error ? err.message : "Search upstream failed";

      hops.push({
        tierId: conn.id,
        connectionId: conn.id,
        connectionName: conn.name,
        provider: conn.provider,
        model: conn.defaultModel || `${conn.provider}-search`,
        status: "failed",
        statusCode,
        reason: msg.slice(0, 140),
        latencyMs: attemptLatency,
      });

      const nextFailCount = (conn.failureCount || 0) + 1;
      const shouldCooldown = statusCode === 429 || statusCode >= 500;
      const cooldownUntil = shouldCooldown ? new Date(Date.now() + 60_000) : null;
      await db
        .update(providerConnections)
        .set({
          failureCount: nextFailCount,
          circuitStatus: shouldCooldown ? "open" : conn.circuitStatus,
          cooldownUntil,
          lastError: msg.slice(0, 200),
          lastLatencyMs: attemptLatency,
        })
        .where(eq(providerConnections.id, conn.id));
      if (shouldCooldown) {
        publishCircuitUpdate(userId, conn.id, "open");
      }

      publishRouteActivity(userId, {
        requestId,
        phase: "end",
        provider: conn.provider,
        model: conn.defaultModel || conn.provider,
        connectionId: conn.id,
        connectionName: conn.name,
        requestedModel: `search:${depth}`,
        outcome: "error",
        timestamp: new Date().toISOString(),
      });
    }
  }

  if (results === null) {
    if (preference !== "auto" && preference !== "builtin" && candidates.length === 0) {
      throw new UpstreamHttpError(
        `No active "${preference}" search connection found in your workspace.`,
        404,
        false
      );
    }
    if (preference !== "auto" && preference !== "builtin") {
      const lastReason =
        hops[hops.length - 1]?.reason || "Search provider request failed";
      throw new UpstreamHttpError(lastReason, 502, true);
    }

    const builtinStart = Date.now();
    const builtin = await executeBuiltinSearch(request, signal);
    results = builtin.results;
    if (builtin.groundedAnswer) {
      answer = builtin.groundedAnswer;
      answerModel = builtin.answerModel;
    }
    resolvedProvider = "builtin";
    connectionName = "Built-in Web Search";
    hops.push({
      tierId: "builtin",
      connectionId: "builtin",
      connectionName: "Built-in Web Search",
      provider: "builtin",
      model: "builtin-web-search",
      status: "success",
      statusCode: 200,
      reason: `Returned ${results.length} results`,
      latencyMs: Date.now() - builtinStart,
    });
  }

  if (request.include_answer && !answer) {
    const synthesized = await synthesizeSearchAnswer({
      userId,
      query: request.query,
      results,
      depth,
      signal,
    });
    answer = synthesized.answer;
    answerModel = synthesized.answerModel;
  }

  const totalLatencyMs = Date.now() - start;
  const hadFailedHop = hops.some((h) => h.status === "failed");

  await recordSearchTelemetry({
    userId,
    apiKeyId,
    apiKeyPrefix,
    requestedAction: `search:${depth}`,
    intent: "search",
    resolvedProvider,
    resolvedModel:
      resolvedProvider === "builtin" ? "builtin-web-search" : `${resolvedProvider}-search`,
    connectionName,
    statusCode: 200,
    outcome: hadFailedHop ? "fallback_success" : "success",
    hops,
    latencyMs: totalLatencyMs,
    errorMessage: null,
  });

  return {
    query: request.query,
    answer,
    results,
    response_time: Number((totalLatencyMs / 1000).toFixed(2)),
    usage: { credits: depth === "advanced" ? 2 : 1 },
    x_asrouter: {
      resolved_provider: resolvedProvider,
      connection_name: connectionName,
      answer_model: answerModel,
      latency_ms: totalLatencyMs,
      fallback_hops: hops,
    },
  };
}

export async function executeGatewayExtract(params: {
  userId: string;
  apiKeyId: string | null;
  apiKeyPrefix: string;
  request: GatewayExtractRequest;
  signal?: AbortSignal;
}): Promise<GatewayExtractResponse> {
  const start = Date.now();
  const { userId, apiKeyId, apiKeyPrefix, request, signal } = params;
  const rawUrls = Array.isArray(request.urls) ? request.urls : [request.urls];
  const urls = Array.from(
    new Set(rawUrls.map((u) => String(u || "").trim()).filter(Boolean))
  ).slice(0, 20);

  if (urls.length === 0) {
    throw new UpstreamHttpError("At least one valid URL is required.", 400, false);
  }

  const format = request.format === "text" ? "text" : "markdown";
  const depth = request.extract_depth === "advanced" ? "advanced" : "basic";
  const preference = request.provider || "auto";
  const hops: FallbackHop[] = [];

  const allConns = await db
    .select()
    .from(providerConnections)
    .where(eq(providerConnections.userId, userId));

  const candidates = getOrderedSearchConnections(allConns, preference).filter(
    (c) => c.provider === "tavily" || c.provider === "exa"
  );

  let results: GatewayExtractResultItem[] | null = null;
  let failedResults: GatewayExtractFailedItem[] = [];
  let resolvedProvider = "builtin";
  let connectionName: string | null = "Built-in Markdown Extractor";

  for (const conn of candidates) {
    const keys = getConnectionKeys(conn);
    const apiKey = keys[conn.keyPoolCursor % Math.max(1, keys.length)];
    if (!apiKey) continue;

    // Validate all URLs upfront against SSRF before passing to any upstream
    const safeUrls: string[] = [];
    const preFailed: GatewayExtractFailedItem[] = [];
    for (const u of urls) {
      try {
        await validateOutboundUrlWithDns(u, "extract URL");
        safeUrls.push(u);
      } catch (err: unknown) {
        preFailed.push({
          url: u,
          error: err instanceof Error ? err.message : "Invalid URL",
        });
      }
    }

    if (safeUrls.length === 0) {
      results = [];
      failedResults = preFailed;
      resolvedProvider = conn.provider;
      connectionName = conn.name;
      break;
    }

    const attemptStart = Date.now();
    try {
      if (conn.provider === "tavily") {
        const baseUrl = (conn.baseUrl || "https://api.tavily.com").replace(/\/+$/, "");
        const endpoint = (
          await validateOutboundUrlWithDns(`${baseUrl}/extract`, "Tavily extract")
        ).toString();
        const r = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            urls: safeUrls,
            extract_depth: depth,
            format,
            ...(request.query ? { query: request.query } : {}),
          }),
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
            : AbortSignal.timeout(20000),
        });
        if (!r.ok) {
          throw new UpstreamHttpError(
            `Tavily Extract HTTP ${r.status}`,
            r.status,
            r.status === 429 || r.status >= 500
          );
        }
        const json = (await r.json()) as {
          results?: Array<{ url?: string; raw_content?: string }>;
          failed_results?: Array<{ url?: string; error?: string }>;
        };
        results = (json.results || []).map((item) => ({
          url: String(item.url || ""),
          raw_content: String(item.raw_content || ""),
        }));
        failedResults = [
          ...preFailed,
          ...(json.failed_results || []).map((f) => ({
            url: String(f.url || ""),
            error: String(f.error || "Extraction failed"),
          })),
        ];
      } else {
        // Exa contents endpoint
        const baseUrl = (conn.baseUrl || "https://api.exa.ai").replace(/\/+$/, "");
        const endpoint = (
          await validateOutboundUrlWithDns(`${baseUrl}/contents`, "Exa contents")
        ).toString();
        const r = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
          },
          body: JSON.stringify({
            urls: safeUrls,
            text: true,
          }),
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
            : AbortSignal.timeout(20000),
        });
        if (!r.ok) {
          throw new UpstreamHttpError(
            `Exa Contents HTTP ${r.status}`,
            r.status,
            r.status === 429 || r.status >= 500
          );
        }
        const json = (await r.json()) as {
          results?: Array<{ url?: string; title?: string; text?: string }>;
          statuses?: Array<{ id?: string; status?: string; error?: { tag?: string } }>;
        };
        results = (json.results || [])
          .filter((item) => Boolean(item.text))
          .map((item) => ({
            url: String(item.url || ""),
            title: item.title,
            raw_content: String(item.text || ""),
          }));
        const okUrls = new Set(results.map((item) => item.url));
        failedResults = [
          ...preFailed,
          ...safeUrls
            .filter((u) => !okUrls.has(u))
            .map((u) => ({ url: u, error: "Exa returned no readable content" })),
        ];
      }

      resolvedProvider = conn.provider;
      connectionName = conn.name;
      hops.push({
        tierId: conn.id,
        connectionId: conn.id,
        connectionName: conn.name,
        provider: conn.provider,
        model: `${conn.provider}-extract`,
        status: "success",
        statusCode: 200,
        reason: `Extracted ${results.length}/${urls.length} URLs`,
        latencyMs: Date.now() - attemptStart,
      });
      break;
    } catch (err: unknown) {
      hops.push({
        tierId: conn.id,
        connectionId: conn.id,
        connectionName: conn.name,
        provider: conn.provider,
        model: `${conn.provider}-extract`,
        status: "failed",
        statusCode: err instanceof UpstreamHttpError ? err.statusCode : 502,
        reason: err instanceof Error ? err.message.slice(0, 140) : "Extract failed",
        latencyMs: Date.now() - attemptStart,
      });
    }
  }

  if (results === null) {
    if (preference !== "auto" && preference !== "builtin" && candidates.length === 0) {
      throw new UpstreamHttpError(
        `No active "${preference}" extract connection found in your workspace.`,
        404,
        false
      );
    }

    const builtinStart = Date.now();
    const okList: GatewayExtractResultItem[] = [];
    const failList: GatewayExtractFailedItem[] = [];

    await Promise.all(
      urls.map(async (targetUrl) => {
        try {
          const fetched = await safeFetchWebPage(targetUrl, {
            format,
            focusQuery: request.query,
            timeoutMs: depth === "advanced" ? 15000 : 10000,
            signal,
          });
          okList.push({
            url: fetched.url,
            title: fetched.title,
            raw_content: fetched.content,
          });
        } catch (err: unknown) {
          failList.push({
            url: targetUrl,
            error: err instanceof Error ? err.message : "Failed to extract URL",
          });
        }
      })
    );

    results = okList;
    failedResults = failList;
    resolvedProvider = "builtin";
    connectionName = "Built-in Markdown Extractor";
    hops.push({
      tierId: "builtin",
      connectionId: "builtin",
      connectionName: "Built-in Markdown Extractor",
      provider: "builtin",
      model: `builtin-extract-${format}`,
      status: "success",
      statusCode: 200,
      reason: `Extracted ${okList.length}/${urls.length} URLs`,
      latencyMs: Date.now() - builtinStart,
    });
  }

  const totalLatencyMs = Date.now() - start;
  const hadFailedHop = hops.some((h) => h.status === "failed");

  await recordSearchTelemetry({
    userId,
    apiKeyId,
    apiKeyPrefix,
    requestedAction: `extract:${format}`,
    intent: "extract",
    resolvedProvider,
    resolvedModel:
      resolvedProvider === "builtin"
        ? `builtin-extract-${format}`
        : `${resolvedProvider}-extract`,
    connectionName,
    statusCode: 200,
    outcome: hadFailedHop ? "fallback_success" : "success",
    hops,
    latencyMs: totalLatencyMs,
    errorMessage: null,
  });

  return {
    results,
    failed_results: failedResults,
    response_time: Number((totalLatencyMs / 1000).toFixed(2)),
    usage: { credits: Math.max(1, Math.ceil(results.length / 5)) },
    x_asrouter: {
      resolved_provider: resolvedProvider,
      connection_name: connectionName,
      latency_ms: totalLatencyMs,
      fallback_hops: hops,
    },
  };
}
