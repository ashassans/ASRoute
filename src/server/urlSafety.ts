export function isBlockedHost(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .trim()
    .replace(/^\[|\]$/g, "");

  if (!host) return true;

  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "::" ||
    host === "169.254.169.254" ||
    host === "metadata.google.internal" ||
    host === "metadata.goog" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localhost")
  ) {
    return true;
  }

  // Handle IPv4-mapped IPv6 like ::ffff:127.0.0.1 or ::ffff:7f00:1
  const ipv4Target = host.startsWith("::ffff:") ? host.slice(7) : host;
  const ipv4 = ipv4Target.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const o1 = Number(ipv4[1]);
    const o2 = Number(ipv4[2]);
    if (o1 === 10 || o1 === 127 || o1 === 0) return true;
    if (o1 === 169 && o2 === 254) return true;
    if (o1 === 172 && o2 >= 16 && o2 <= 31) return true;
    if (o1 === 192 && o2 === 168) return true;
    if (o1 === 100 && o2 >= 64 && o2 <= 127) return true; // CGNAT 100.64.0.0/10
  }

  // Block IPv6 link-local (fe80::/10) and unique-local (fc00::/7)
  if (host.includes(":")) {
    const firstHextet = host.split(":")[0];
    if (
      firstHextet.startsWith("fc") ||
      firstHextet.startsWith("fd") ||
      firstHextet.startsWith("fe8") ||
      firstHextet.startsWith("fe9") ||
      firstHextet.startsWith("fea") ||
      firstHextet.startsWith("feb")
    ) {
      return true;
    }
  }

  return false;
}

export function validateOutboundUrl(
  rawUrl: string,
  label = "URL"
): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error(`Invalid ${label} format.`);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`${label} must use http:// or https:// protocol.`);
  }

  if (parsed.username || parsed.password) {
    throw new Error(`${label} must not contain embedded credentials.`);
  }

  if (isBlockedHost(parsed.hostname)) {
    throw new Error(
      `Access to internal, loopback, or restricted addresses is blocked for ${label}.`
    );
  }

  return parsed;
}
