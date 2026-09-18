import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context, MiddlewareHandler } from "hono";
import type { WebConfig } from "../config.js";

const SESSION_COOKIE = "crate_session";
const STATE_COOKIE = "crate_oauth_state";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;
const STATE_MAX_AGE = 600;

export type SessionUser = {
  id: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
};

type SignedSession = SessionUser & { exp: number };
type SignedOAuthState = { state: string; verifier: string; exp: number };

type DiscordTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type DiscordUser = {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
};

type DiscordGuild = {
  id: string;
};

export function redirectUri(publicUrl: string): string {
  return `${publicUrl.replace(/\/+$/, "")}/auth/callback`;
}

export function cookieSecure(publicUrl: string): boolean {
  return publicUrl.startsWith("https://");
}

export function originAllowed(origin: string | undefined, publicUrl: string): boolean {
  if (!origin) return false;
  try {
    return origin === new URL(publicUrl).origin;
  } catch {
    return false;
  }
}

export function mutatingRequestAllowed(
  origin: string | undefined,
  referer: string | undefined,
  publicUrl: string,
): boolean {
  if (originAllowed(origin, publicUrl)) return true;
  if (origin) return false;
  if (!referer) return false;
  try {
    return new URL(referer).origin === new URL(publicUrl).origin;
  } catch {
    return false;
  }
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function encode(secret: string, value: unknown): string {
  const payload = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${payload}.${sign(secret, payload)}`;
}

export function decode<T>(secret: string, token: string | undefined): T | null {
  if (!token) return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = sign(secret, payload);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

function asSessionUser(value: SignedSession | null): SessionUser | null {
  if (!value || typeof value.exp !== "number" || value.exp < Date.now()) return null;
  if (!/^\d{17,22}$/.test(value.id) || !value.username) return null;
  return {
    id: value.id,
    username: String(value.username).slice(0, 64),
    globalName: value.globalName == null ? null : String(value.globalName).slice(0, 64),
    avatar: value.avatar == null ? null : String(value.avatar).slice(0, 128),
  };
}

export function readSession(c: Context, secret: string): SessionUser | null {
  return sessionUserFromToken(secret, getCookie(c, SESSION_COOKIE));
}

export function sessionUserFromToken(secret: string, token: string | undefined): SessionUser | null {
  return asSessionUser(decode<SignedSession>(secret, token));
}

function cookieOptions(web: WebConfig, maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "Lax" as const,
    secure: cookieSecure(web.publicUrl),
    path: "/",
    maxAge,
  };
}

export function writeSession(c: Context, web: WebConfig, user: SessionUser): void {
  setCookie(
    c,
    SESSION_COOKIE,
    encode(web.sessionSecret, { ...user, exp: Date.now() + SESSION_MAX_AGE * 1000 } satisfies SignedSession),
    cookieOptions(web, SESSION_MAX_AGE),
  );
}

export function clearSession(c: Context, web: WebConfig): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: cookieSecure(web.publicUrl) });
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function beginOAuth(c: Context, web: WebConfig, clientId: string): string {
  const state = randomBytes(16).toString("hex");
  const verifier = randomBytes(32).toString("base64url");
  setCookie(
    c,
    STATE_COOKIE,
    encode(web.sessionSecret, { state, verifier, exp: Date.now() + STATE_MAX_AGE * 1000 } satisfies SignedOAuthState),
    cookieOptions(web, STATE_MAX_AGE),
  );
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri(web.publicUrl));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify guilds");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", pkceChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export function consumeOAuthState(c: Context, web: WebConfig, state: string | undefined): string | null {
  const stored = decode<SignedOAuthState>(web.sessionSecret, getCookie(c, STATE_COOKIE));
  deleteCookie(c, STATE_COOKIE, { path: "/", secure: cookieSecure(web.publicUrl) });
  if (!stored || !state || !stored.verifier) return null;
  if (typeof stored.exp !== "number" || stored.exp < Date.now()) return null;
  if (!safeEqual(stored.state, state)) return null;
  return stored.verifier;
}

export async function completeOAuth(
  web: WebConfig,
  clientId: string,
  code: string,
  verifier: string,
  allowedGuildIds: Iterable<string> = [],
): Promise<{ user: SessionUser } | { error: string }> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: web.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(web.publicUrl),
    code_verifier: verifier,
  });
  const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const token = (await tokenResponse.json()) as DiscordTokenResponse;
  if (!token.access_token) {
    return { error: token.error_description ?? token.error ?? "Discord login failed." };
  }

  const headers = { Authorization: `Bearer ${token.access_token}` };
  const [userResponse, guildsResponse] = await Promise.all([
    fetch("https://discord.com/api/users/@me", { headers, signal: AbortSignal.timeout(15_000) }),
    fetch("https://discord.com/api/users/@me/guilds", { headers, signal: AbortSignal.timeout(15_000) }),
  ]);
  if (!userResponse.ok || !guildsResponse.ok) {
    return { error: "Could not read your Discord profile." };
  }
  const profile = (await userResponse.json()) as DiscordUser;
  const guilds = (await guildsResponse.json()) as DiscordGuild[] | { message?: string };
  const allowed = new Set(allowedGuildIds);
  if (web.guildId) allowed.add(web.guildId);
  if (!Array.isArray(guilds) || !guilds.some((guild) => allowed.has(guild.id))) {
    return { error: "not_in_guild" };
  }
  if (!/^\d{17,22}$/.test(profile.id)) {
    return { error: "Discord login failed." };
  }
  return {
    user: {
      id: profile.id,
      username: profile.username,
      globalName: profile.global_name ?? null,
      avatar: profile.avatar ?? null,
    },
  };
}

export function requireSession(secret: string): MiddlewareHandler {
  return async (c, next) => {
    const user = readSession(c, secret);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    c.set("user", user);
    await next();
  };
}

declare module "hono" {
  interface ContextVariableMap {
    user: SessionUser;
  }
}
