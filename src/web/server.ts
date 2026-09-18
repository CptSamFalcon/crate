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
  coverArtArchiveUrl,
  coverUrlFor,
  findAlbum,
  findTracks,
  getAlbum,
  getAlbumTracksById,
  getArtist,
  listIncomingRequests,
  missingLibrary,
  playableFromId,
  requestFromNeedle,
  searchMedia,
  serializeTrack,
  toQueueItem,
  tracksForIncoming,
  type IncomingWatch,
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
import { pickVoiceChannel, listBotGuilds, memberInGuild } from "./voice.js";

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

async function playerStatus(
  client: Client,
  player: GuildPlayer,
  extra?: { guildId: string; guildName: string | null; guilds: { id: string; name: string; iconUrl: string | null; active: boolean }[] },
) {
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
    guildId: extra?.guildId,
    guildName: extra?.guildName ?? null,
    guilds: extra?.guilds ?? [],
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
  let activeGuildId = web.guildId;
  const currentPlayer = () => players.get(activeGuildId);
  const statusPayload = async () => {
    const player = currentPlayer();
    const guild = client.guilds.cache.get(activeGuildId);
    return playerStatus(client, player, {
      guildId: activeGuildId,
      guildName: guild?.name ?? null,
      guilds: listBotGuilds(client).map((item) => ({ ...item, active: item.id === activeGuildId })),
    });
  };

  app.use("/api/*", async (c, next) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method) && !originAllowed(c.req.header("origin"), web.publicUrl)) {
      return c.json({ error: "Bad origin" }, 403);
    }
    await next();
  });

  app.get("/", () => publicFile("index.html", "text/html; charset=utf-8"));
  app.get("/app.js", () => publicFile("app.js", "text/javascript; charset=utf-8"));
  app.get("/styles.css", () => publicFile("styles.css", "text/css; charset=utf-8"));
  app.get("/rou.png", () => publicFile("rou.png", "image/png"));

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
    const result = await completeOAuth(web, clientId, code, client.guilds.cache.keys());
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

  api.get("/status", async (c) => c.json(await statusPayload()));

  api.get("/events", async (c) => {
    return streamSSE(c, async (stream) => {
      const send = async () => {
        await stream.writeSSE({ data: JSON.stringify(await statusPayload()) });
      };
      await send();
      const stop = players.onStatus(() => {
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
    const results = await searchMedia(needle, query);
    if (results.artists.length === 0 && results.albums.length === 0 && results.tracks.length === 0) {
      return c.json({ ...results, message: `Nothing matched “${query}”.` });
    }
    return c.json({ ...results, message: null });
  });

  api.get("/artists/:id", async (c) => {
    const id = decodeURIComponent(c.req.param("id"));
    const detail = await getArtist(needle, id);
    if (!detail) return c.json({ error: "Artist not found" }, 404);
    return c.json(detail);
  });

  api.get("/albums/:id", async (c) => {
    const id = decodeURIComponent(c.req.param("id"));
    const detail = await getAlbum(needle, id);
    if (!detail) return c.json({ error: "Album not found" }, 404);
    return c.json(detail);
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
    const player = currentPlayer();
    const channel = await pickVoiceChannel(client, activeGuildId, player.channelId);
    if (!channel) return c.json({ error: "No voice channel available for Rou to join." }, 409);
    const queued = tracks.map((track) => toQueueItem(track!, displayName(user)));
    const position = await player.enqueue(channel, queued);
    return c.json({
      position,
      track: serializeTrack(queued[0]!),
      status: await statusPayload(),
    });
  });

  api.post("/album", async (c) => {
    const user = c.get("user") as SessionUser;
    const body = (await c.req.json().catch(() => ({}))) as { query?: string; albumId?: string };
    const query = body.query?.trim() ?? "";
    const tracks = body.albumId
      ? await getAlbumTracksById(needle, body.albumId)
      : query
        ? await findAlbum(needle, query)
        : [];
    if (tracks.length === 0) {
      const miss = await missingLibrary(needle, query || "that album");
      return c.json({ error: miss.message, catalog: miss.catalog }, 404);
    }
    const player = currentPlayer();
    const channel = await pickVoiceChannel(client, activeGuildId, player.channelId);
    if (!channel) return c.json({ error: "No voice channel available for Rou to join." }, 409);
    const queued = tracks.map((track) => toQueueItem(track, displayName(user)));
    const position = await player.enqueue(channel, queued);
    return c.json({
      position,
      count: queued.length,
      track: serializeTrack(queued[0]!),
      status: await statusPayload(),
    });
  });

  api.post("/request", async (c) => {
    const user = c.get("user") as SessionUser;
    const body = (await c.req.json().catch(() => ({}))) as {
      albumId?: string;
      recordingMbid?: string;
      title?: string;
      durationSeconds?: number | null;
    };
    const albumId = body.albumId?.trim() ?? "";
    const recordingMbid = body.recordingMbid?.trim() ?? "";
    if (!albumId && !recordingMbid) return c.json({ error: "Missing album or track to request" }, 400);
    const result = await requestFromNeedle(needle, {
      albumId: albumId || undefined,
      recordingMbid: recordingMbid || undefined,
      title: body.title,
      durationSeconds: body.durationSeconds,
    });
    if (result.watch) {
      const watch = { ...result.watch, requestedBy: displayName(user) };
      requestors.set(watch.key, watch.requestedBy);
      waiting.set(watch.key, watch);
    }
    return c.json(result);
  });

  api.get("/requests", async (c) => {
    const snapshot = await listIncomingRequests(needle);
    const items = snapshot.active
      .filter((item) => !item.ready && !item.failed)
      .map((item) => ({
        ...item,
        requestedBy: requestors.get(`${item.kind}:${item.id}`) ?? item.requestedBy,
      }));
    return c.json({ items });
  });

  api.post("/guild", async (c) => {
    const user = c.get("user") as SessionUser;
    const body = (await c.req.json().catch(() => ({}))) as { guildId?: string };
    const guildId = body.guildId?.trim() ?? "";
    if (!guildId) return c.json({ error: "Missing server" }, 400);
    if (!(await memberInGuild(client, guildId, user.id))) {
      return c.json({ error: "You're not in that server." }, 403);
    }
    if (guildId === activeGuildId) return c.json({ ok: true, status: await statusPayload() });

    const from = currentPlayer();
    const moving = Boolean(from.nowPlaying || from.upcoming.length);
    const channel = moving ? await pickVoiceChannel(client, guildId) : null;
    if (moving && !channel) {
      return c.json({ error: "No voice channel available in that server." }, 409);
    }
    const session = await from.takeSession();
    activeGuildId = guildId;
    const to = currentPlayer();
    to.setVolume(session.volume);
    if (session.tracks.length > 0 && channel) {
      await to.enqueue(channel, session.tracks);
    }
    return c.json({ ok: true, status: await statusPayload() });
  });

  api.post("/skip", (c) => {
    const skipped = currentPlayer().skip();
    return c.json({ skipped: skipped ? serializeTrack(skipped) : null });
  });
  api.post("/pause", (c) => c.json({ ok: currentPlayer().pause() }));
  api.post("/resume", (c) => c.json({ ok: currentPlayer().resume() }));
  api.post("/stop", (c) => {
    currentPlayer().stop();
    return c.json({ ok: true });
  });
  api.post("/volume", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { percent?: number };
    const percent = Number(body.percent);
    if (!Number.isFinite(percent)) return c.json({ error: "Missing percent" }, 400);
    currentPlayer().setVolume(percent);
    return c.json({ volume: currentPlayer().volumePercent });
  });

  api.get("/cover", async (c) => {
    const id = c.req.query("id");
    const albumId = c.req.query("album");
    const artistId = c.req.query("artist");
    if (!id && !albumId && !artistId) return new Response(null, { status: 400 });
    const url = artistId
      ? (coverUrlFor(`artist:${artistId}`) ?? needle.resolveUrl(`/api/v1/covers/artist/${artistId}`))
      : albumId
        ? coverUrlFor(albumId)
        : coverUrlFor(id!) ?? coverArtArchiveUrl(playableFromId(id!)?.albumMbid);
    if (!url) return new Response(null, { status: 404 });
    try {
      const response = await needle.fetchCover(url);
      if (!response.ok || !response.body) return new Response(null, { status: 502 });
      return new Response(response.body, {
        headers: {
          "Content-Type": response.headers.get("content-type") ?? "image/jpeg",
          "Cache-Control": "private, max-age=3600",
        },
      });
    } catch (error) {
      const key = id ?? albumId ?? "";
      const fallback = coverArtArchiveUrl(
        playableFromId(key)?.albumMbid ?? (albumId && /^[0-9a-f-]{36}$/i.test(albumId) ? albumId : null),
      );
      if (fallback && fallback !== url) {
        try {
          const response = await needle.fetchCover(fallback);
          if (response.ok && response.body) {
            return new Response(response.body, {
              headers: {
                "Content-Type": response.headers.get("content-type") ?? "image/jpeg",
                "Cache-Control": "private, max-age=3600",
              },
            });
          }
        } catch {
          // fall through
        }
      }
      console.error("[rou] cover proxy failed:", error);
      return new Response(null, { status: 502 });
    }
  });

  app.route("/api", api);

  app.notFound((c) => {
    if (c.req.path.startsWith("/api/")) return c.json({ error: "Not found" }, 404);
    return publicFile("index.html", "text/html; charset=utf-8");
  });

  serve({ fetch: app.fetch, hostname: "0.0.0.0", port: web.port }, (info) => {
    console.log(`[rou] web UI on http://0.0.0.0:${info.port} (${web.publicUrl})`);
  });
}

function displayName(user: SessionUser): string {
  return user.globalName || user.username;
}

const waiting = new Map<string, IncomingWatch>();
const requestors = new Map<string, string>();

async function playIncoming(
  deps: { client: Client; guildId: string; player: GuildPlayer; needle: DroppedNeedleClient },
  watch: IncomingWatch,
): Promise<boolean> {
  const tracks = await tracksForIncoming(deps.needle, watch);
  if (tracks.length === 0) return false;
  const channel = await pickVoiceChannel(deps.client, deps.guildId, deps.player.channelId);
  if (!channel) return false;
  await deps.player.enqueue(
    channel,
    tracks.map((track) => toQueueItem(track, watch.requestedBy)),
  );
  return true;
}

async function syncIncoming(deps: {
  client: Client;
  guildId: string;
  player: GuildPlayer;
  needle: DroppedNeedleClient;
}): Promise<{ items: Awaited<ReturnType<typeof listIncomingRequests>>["active"]; moved: boolean }> {
  const snapshot = await listIncomingRequests(deps.needle);
  const byKey = new Map(snapshot.active.map((item) => [`${item.kind}:${item.id}`, item]));
  const historyByKey = new Map(snapshot.history.map((item) => [`${item.kind}:${item.id}`, item]));
  let moved = false;

  for (const [key, watch] of [...waiting]) {
    const live = byKey.get(key) ?? historyByKey.get(key);
    if (live && live.failed) {
      waiting.delete(key);
      continue;
    }
    if (live && !live.ready) continue;
    try {
      if (await playIncoming(deps, watch)) {
        waiting.delete(key);
        moved = true;
      }
    } catch (error) {
      console.error("[rou] failed to queue a ready request:", error);
    }
  }

  const items = snapshot.active.filter((item) => {
    const key = `${item.kind}:${item.id}`;
    if (waiting.has(key)) return true;
    return !item.ready && !item.failed;
  });
  return { items, moved };
}
