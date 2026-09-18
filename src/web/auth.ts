import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context, MiddlewareHandler } from "hono";
import type { WebConfig } from "../config.js";

const SESSION_COOKIE = "rou_session";
const STATE_COOKIE = "rou_oauth_state";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

export type SessionUser = {
  id: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
};

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

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function encode(secret: string, value: unknown): string {
  const payload = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${payload}.${sign(secret, payload)}`;
}

function decode<T>(secret: string, token: string | undefined): T | null {
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

export function readSession(c: Context, secret: string): SessionUser | null {
  return decode<SessionUser>(secret, getCookie(c, SESSION_COOKIE));
}

export function writeSession(c: Context, web: WebConfig, user: SessionUser): void {
  setCookie(c, SESSION_COOKIE, encode(web.sessionSecret, user), {
    httpOnly: true,
    sameSite: "Lax",
    secure: cookieSecure(web.publicUrl),
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export function clearSession(c: Context, web: WebConfig): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: cookieSecure(web.publicUrl) });
}

export function beginOAuth(c: Context, web: WebConfig, clientId: string): string {
  const state = randomBytes(16).toString("hex");
  setCookie(c, STATE_COOKIE, encode(web.sessionSecret, { state }), {
    httpOnly: true,
    sameSite: "Lax",
    secure: cookieSecure(web.publicUrl),
    path: "/",
    maxAge: 600,
  });
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri(web.publicUrl));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify guilds");
  url.searchParams.set("state", state);
  return url.toString();
}

export function consumeOAuthState(c: Context, web: WebConfig, state: string | undefined): boolean {
  const stored = decode<{ state: string }>(web.sessionSecret, getCookie(c, STATE_COOKIE));
  deleteCookie(c, STATE_COOKIE, { path: "/", secure: cookieSecure(web.publicUrl) });
  return Boolean(stored && state && stored.state === state);
}

export async function completeOAuth(
  web: WebConfig,
  clientId: string,
  code: string,
): Promise<{ user: SessionUser } | { error: string }> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: web.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(web.publicUrl),
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
  if (!Array.isArray(guilds) || !guilds.some((guild) => guild.id === web.guildId)) {
    return { error: "not_in_guild" };
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

export function originAllowed(origin: string | undefined, publicUrl: string): boolean {
  if (!origin) return true;
  try {
    return origin === new URL(publicUrl).origin;
  } catch {
    return false;
  }
}

declare module "hono" {
  interface ContextVariableMap {
    user: SessionUser;
  }
}
