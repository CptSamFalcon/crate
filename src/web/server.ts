import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import type { Client } from "discord.js";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppConfig, WebConfig } from "../config.js";
import type { DroppedNeedleClient } from "../droppedneedle/client.js";
import {
  coverUrlFor,
  findAlbum,
  findTracks,
  missingLibrary,
  playableFromId,
  serializeTrack,
  toQueueItem,
} from "../library.js";
import type { GuildPlayer, PlayerManager } from "../player/manager.js";
import {
  beginOAuth,
  clearSession,
  completeOAuth,
  consumeOAuthState,
  originAllowed,
  requireSession,
  writeSession,
  type SessionUser,
} from "./auth.js";
import { pickVoiceChannel } from "./voice.js";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "public");

export type WebDeps = {
  config: AppConfig;
  web: WebConfig;
  client: Client;
  players: PlayerManager;
  needle: DroppedNeedleClient;
};

async function publicFile(name: string, type: string): Promise<Response> {
  const body = await readFile(join(publicDir, name));
  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "no-store",
    },
  });
}

async function playerStatus(client: Client, player: GuildPlayer) {
  const channelId = player.channelId ?? null;
  let channelName: string | null = null;
  if (channelId) {
    const cached = client.channels.cache.get(channelId);
    channelName = cached && "name" in cached ? String(cached.name) : null;
  }
  return {
    paused: player.paused,
    volume: player.volumePercent,
    channelId,
    channelName,
    nowPlaying: player.nowPlaying
      ? { ...serializeTrack(player.nowPlaying.track), startedAt: player.nowPlaying.startedAt }
      : null,
    queue: player.upcoming.map(serializeTrack),
  };
}

export function startWeb(deps: WebDeps): void {
  const { web, client, players, needle } = deps;
  const clientId = deps.config.DISCORD_CLIENT_ID ?? client.user?.id;
  if (!clientId) {
    console.warn("[rou] web UI disabled: Discord client id is not available yet");
    return;
  }

  const app = new Hono();
  const player = players.get(web.guildId);

  app.use("/api/*", async (c, next) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method) && !originAllowed(c.req.header("origin"), web.publicUrl)) {
      return c.json({ error: "Bad origin" }, 403);
    }
    await next();
  });

  app.get("/", () => publicFile("index.html", "text/html; charset=utf-8"));
  app.get("/app.js", () => publicFile("app.js", "text/javascript; charset=utf-8"));
  app.get("/styles.css", () => publicFile("styles.css", "text/css; charset=utf-8"));

  app.get("/auth/discord", (c) => c.redirect(beginOAuth(c, web, clientId)));
  app.get("/logout", (c) => {
    clearSession(c, web);
    return c.redirect("/");
  });
  app.get("/auth/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!consumeOAuthState(c, web, state) || !code) {
      return c.redirect("/?error=oauth");
    }
    const result = await completeOAuth(web, clientId, code);
    if ("error" in result) {
      return c.redirect(`/?error=${encodeURIComponent(result.error)}`);
    }
    writeSession(c, web, result.user);
    return c.redirect("/");
  });

  const api = new Hono();
  api.use("*", requireSession(web.sessionSecret));
  api.onError((error, c) => {
    console.error("[rou] web API error:", error);
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return c.json({ error: message }, 500);
  });

  api.get("/me", (c) => c.json(c.get("user")));

  api.get("/status", async (c) => c.json(await playerStatus(client, player)));

  api.get("/events", async (c) => {
    return streamSSE(c, async (stream) => {
      const send = async () => {
        await stream.writeSSE({ data: JSON.stringify(await playerStatus(client, player)) });
      };
      await send();
      const stop = player.onStatus(() => {
        void send();
      });
      try {
        while (true) {
          await stream.sleep(15_000);
          await stream.writeSSE({ event: "ping", data: "" });
        }
      } finally {
        stop();
      }
    });
  });

  api.get("/search", async (c) => {
    const query = c.req.query("q")?.trim() ?? "";
    if (!query) return c.json({ error: "Missing query" }, 400);
    const tracks = await findTracks(needle, query);
    if (tracks.length === 0) {
      const miss = await missingLibrary(needle, query);
      return c.json({ tracks: [], message: miss.message, catalog: miss.catalog });
    }
    return c.json({ tracks: tracks.map(serializeTrack), message: null, catalog: [] });
  });

  api.post("/play", async (c) => {
    const user = c.get("user") as SessionUser;
    const body = (await c.req.json().catch(() => ({}))) as { query?: string; fileId?: string };
    const query = body.query?.trim() ?? "";
    const cached = body.fileId ? playableFromId(body.fileId) : undefined;
    let tracks = cached ? [cached] : [];
    if (tracks.length === 0 && query) {
      tracks = await findTracks(needle, query, true);
    }
    if (tracks.length === 0) {
      const miss = await missingLibrary(needle, query || "that track");
      return c.json({ error: miss.message, catalog: miss.catalog }, 404);
    }
    const channel = await pickVoiceChannel(client, web.guildId, player.channelId);
    if (!channel) return c.json({ error: "No voice channel available for Rou to join." }, 409);
    const queued = tracks.map((track) => toQueueItem(track!, displayName(user)));
    const position = await player.enqueue(channel, queued);
    return c.json({
      position,
      track: serializeTrack(queued[0]!),
      status: await playerStatus(client, player),
    });
  });

  api.post("/album", async (c) => {
    const user = c.get("user") as SessionUser;
    const body = (await c.req.json().catch(() => ({}))) as { query?: string };
    const query = body.query?.trim() ?? "";
    if (!query) return c.json({ error: "Missing query" }, 400);
    const tracks = await findAlbum(needle, query);
    if (tracks.length === 0) {
      const miss = await missingLibrary(needle, query);
      return c.json({ error: miss.message, catalog: miss.catalog }, 404);
    }
    const channel = await pickVoiceChannel(client, web.guildId, player.channelId);
    if (!channel) return c.json({ error: "No voice channel available for Rou to join." }, 409);
    const queued = tracks.map((track) => toQueueItem(track, displayName(user)));
    const position = await player.enqueue(channel, queued);
    return c.json({
      position,
      count: queued.length,
      track: serializeTrack(queued[0]!),
      status: await playerStatus(client, player),
    });
  });

  api.post("/skip", (c) => {
    const skipped = player.skip();
    return c.json({ skipped: skipped ? serializeTrack(skipped) : null });
  });
  api.post("/pause", (c) => c.json({ ok: player.pause() }));
  api.post("/resume", (c) => c.json({ ok: player.resume() }));
  api.post("/stop", (c) => {
    player.stop();
    return c.json({ ok: true });
  });
  api.post("/volume", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { percent?: number };
    const percent = Number(body.percent);
    if (!Number.isFinite(percent)) return c.json({ error: "Missing percent" }, 400);
    player.setVolume(percent);
    return c.json({ volume: player.volumePercent });
  });

  api.get("/cover", async (c) => {
    const id = c.req.query("id");
    if (!id) return new Response(null, { status: 400 });
    const url = coverUrlFor(id);
    if (!url) return new Response(null, { status: 404 });
    try {
      const response = await needle.fetchMedia(url);
      if (!response.ok || !response.body) return new Response(null, { status: 502 });
      return new Response(response.body, {
        headers: {
          "Content-Type": response.headers.get("content-type") ?? "image/jpeg",
          "Cache-Control": "private, max-age=3600",
        },
      });
    } catch (error) {
      console.error("[rou] cover proxy failed:", error);
      return new Response(null, { status: 502 });
    }
  });

  app.route("/api", api);

  app.notFound((c) => {
    if (c.req.path.startsWith("/api/")) return c.json({ error: "Not found" }, 404);
    return publicFile("index.html", "text/html; charset=utf-8");
  });

  serve({ fetch: app.fetch, port: web.port }, (info) => {
    console.log(`[rou] web UI on :${info.port} (${web.publicUrl})`);
  });
}

function displayName(user: SessionUser): string {
  return user.globalName || user.username;
}
