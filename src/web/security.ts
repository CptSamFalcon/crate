import type { Context, MiddlewareHandler } from "hono";

const RATE_WINDOWS = new Map<string, number[]>();
const MAX_JSON_BYTES = 32 * 1024;

export function clientIp(c: Context): string {
  const cf = c.req.header("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return c.req.header("x-real-ip")?.trim() || "unknown";
}

export function allowRequest(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (RATE_WINDOWS.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
  if (RATE_WINDOWS.size > 10_000) {
    for (const [entry, stamps] of RATE_WINDOWS) {
      const live = stamps.filter((stamp) => now - stamp < 15 * 60_000);
      if (live.length === 0) RATE_WINDOWS.delete(entry);
      else RATE_WINDOWS.set(entry, live);
    }
  }
  if (recent.length >= limit) {
    RATE_WINDOWS.set(key, recent);
    return false;
  }
  recent.push(now);
  RATE_WINDOWS.set(key, recent);
  return true;
}

export function rateLimit(prefix: string, limit: number, windowMs: number): MiddlewareHandler {
  return async (c, next) => {
    if (!allowRequest(`${prefix}:${clientIp(c)}`, limit, windowMs)) {
      return c.json({ error: "Too many requests. Try again shortly." }, 429);
    }
    await next();
  };
}

export function limitJsonBody(): MiddlewareHandler {
  return async (c, next) => {
    const length = Number(c.req.header("content-length") ?? "0");
    if (Number.isFinite(length) && length > MAX_JSON_BYTES) {
      return c.json({ error: "Payload too large" }, 413);
    }
    await next();
  };
}

export function securityHeaders(publicUrl: string): MiddlewareHandler {
  const https = publicUrl.startsWith("https://");
  return async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    c.header("Cross-Origin-Opener-Policy", "same-origin");
    c.header("Cross-Origin-Resource-Policy", "same-origin");
    c.header("X-DNS-Prefetch-Control", "off");
    c.header(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' https://cdn.discordapp.com https://coverartarchive.org https://archive.org https://*.archive.org data:",
        "connect-src 'self'",
        "media-src 'none'",
      ].join("; "),
    );
    if (https) {
      c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
  };
}

export function isSafeId(value: string | undefined | null): value is string {
  if (!value || value.length > 128) return false;
  if (value.includes("/") || value.includes("\\") || value.includes("..") || value.includes("\0")) return false;
  if (/[?#]/.test(value)) return false;
  return true;
}

export function clampQuery(value: string, max = 200): string {
  return value.slice(0, max);
}
