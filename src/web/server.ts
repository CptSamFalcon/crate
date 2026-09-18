import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import type { Client } from "discord.js";
import { Hono } from "hono";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppConfig, WebConfig } from "../config.js";
import type { DroppedNeedleClient } from "../droppedneedle/client.js";
import {
  coverArtArchiveUrl,
  coverUrlFor,
  rewriteCoverUrl,
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
  mutatingRequestAllowed,
  requireSession,
  writeSession,
  type SessionUser,
} from "./auth.js";
import { clampQuery, isSafeId, limitJsonBody, rateLimit, securityHeaders } from "./security.js";
import { pickVoiceChannel, listVoiceChannels, listMemberGuilds, memberInGuild } from "./voice.js";

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
  extra?: {
    guildId: string;
    guildName: string | null;
    guilds: { id: string; name: string; iconUrl: string | null; active: boolean }[];
    channels: { id: string; name: string; memberCount: number; current: boolean; you: boolean }[];
  },
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
    channels: extra?.channels ?? [],
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
  const membershipCache = new Map<string, { at: number; guilds: Awaited<ReturnType<typeof listMemberGuilds>> }>();
  const memberGuilds = async (userId: string) => {
    const cached = membershipCache.get(userId);
    if (cached && Date.now() - cached.at < 15_000) return cached.guilds;
    const guilds = await listMemberGuilds(client, userId);
    membershipCache.set(userId, { at: Date.now(), guilds });
    return guilds;
  };
  const idleStatus = (
    guilds: { id: string; name: string; iconUrl: string | null }[],
  ) => ({
    paused: false,
    volume: 80,
    channelId: null,
    channelName: null,
    guildId: null as string | null,
    guildName: null as string | null,
    guilds: guilds.map((item) => ({ ...item, active: false })),
    channels: [] as { id: string; name: string; memberCount: number; current: boolean; you: boolean }[],
    nowPlaying: null,
    queue: [] as ReturnType<typeof serializeTrack>[],
    canControl: false,
  });
  const statusPayload = async (user: SessionUser, refresh = false) => {
    const guilds = await memberGuilds(user.id);
    if (!guilds.some((guild) => guild.id === activeGuildId)) {
      return idleStatus(guilds);
    }
    const player = currentPlayer();
    const guild = client.guilds.cache.get(activeGuildId);
    return {
      ...(await playerStatus(client, player, {
        guildId: activeGuildId,
        guildName: guild?.name ?? null,
        guilds: guilds.map((item) => ({ ...item, active: item.id === activeGuildId })),
        channels: await listVoiceChannels(client, activeGuildId, {
          botChannelId: player.channelId,
          userId: user.id,
          refresh,
        }).catch((error) => {
          console.warn("[rou] voice channel list failed:", error);
          return [];
        }),
      })),
      canControl: true,
    };
  };

  app.use("*", securityHeaders(web.publicUrl));
  app.use("*", limitJsonBody());
  app.use("*", async (c, next) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method) && !mutatingRequestAllowed(c.req.header("origin"), c.req.header("referer"), web.publicUrl)) {
      return c.json({ error: "Bad origin" }, 403);
    }
    await next();
  });
  const denyUnlessMember = async (c: Context) => {
    const user = c.get("user");
    if (!(await memberInGuild(client, activeGuildId, user.id))) {
      return c.json({ error: "You're not in that server." }, 403);
    }
    return null;
  };

  app.get("/", () => publicFile("index.html", "text/html; charset=utf-8"));
  app.get("/app.js", () => publicFile("app.js", "text/javascript; charset=utf-8"));
  app.get("/styles.css", () => publicFile("styles.css", "text/css; charset=utf-8"));
  app.get("/rou.png", () => publicFile("rou.png", "image/png"));
  const brandFiles: Record<string, string> = {
    "crate-logo.png": "image/png",
    "crate-icon.png": "image/png",
    "crate-favicon.png": "image/png",
    "tokens.css": "text/css; charset=utf-8",
  };
  app.get("/favicon.png", () => publicFile("brand/crate-favicon.png", "image/png"));
  app.get("/favicon.ico", () => publicFile("brand/crate-favicon.png", "image/png"));
  app.get("/brand/:name", (c) => {
    const name = c.req.param("name");
    const type = brandFiles[name];
    if (!type) return c.notFound();
    return publicFile(`brand/${name}`, type);
  });

  app.get("/auth/discord", rateLimit("oauth", 10, 10 * 60_000), (c) => c.redirect(beginOAuth(c, web, clientId)));
  const logout = (c: Parameters<typeof clearSession>[0]) => {
    clearSession(c, web);
    return c.redirect("/");
  };
  app.get("/logout", logout);
  app.post("/logout", logout);
  app.get("/auth/callback", rateLimit("oauth-callback", 20, 10 * 60_000), async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const verifier = consumeOAuthState(c, web, state);
    if (!verifier || !code) {
      return c.redirect("/?error=oauth");
    }
    const result = await completeOAuth(web, clientId, code, verifier, client.guilds.cache.keys());
    if ("error" in result) {
      const error = result.error === "not_in_guild" ? "not_in_guild" : "oauth";
      return c.redirect(`/?error=${encodeURIComponent(error)}`);
    }
    writeSession(c, web, result.user);
    return c.redirect("/");
  });

  const api = new Hono();
  api.use("*", requireSession(web.sessionSecret));
  api.use("*", async (c, next) => {
    const user = c.get("user");
    if ((await memberGuilds(user.id)).length === 0) {
      clearSession(c, web);
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  });
  api.onError((error, c) => {
    console.error("[rou] web API error:", error);
    return c.json({ error: "Something went wrong." }, 500);
  });

  api.get("/me", (c) => c.json(c.get("user")));

  api.get("/status", async (c) => {
    const user = c.get("user") as SessionUser;
    return c.json(await statusPayload(user, true));
  });

  api.get("/events", async (c) => {
    const user = c.get("user") as SessionUser;
    return streamSSE(c, async (stream) => {
      const send = async () => {
        await stream.writeSSE({ data: JSON.stringify(await statusPayload(user)) });
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

  api.get("/search", rateLimit("search", 30, 60_000), async (c) => {
    const query = clampQuery(c.req.query("q")?.trim() ?? "");
    if (!query) return c.json({ error: "Missing query" }, 400);
    const results = await searchMedia(needle, query);
    if (results.artists.length === 0 && results.albums.length === 0 && results.tracks.length === 0) {
      return c.json({ ...results, message: `Nothing matched “${query}”.` });
    }
    return c.json({ ...results, message: null });
  });

  api.get("/artists/:id", async (c) => {
    const id = decodeURIComponent(c.req.param("id"));
    if (!isSafeId(id)) return c.json({ error: "Artist not found" }, 404);
    const detail = await getArtist(needle, id);
    if (!detail) return c.json({ error: "Artist not found" }, 404);
    return c.json(detail);
  });

  api.get("/albums/:id", async (c) => {
    const id = decodeURIComponent(c.req.param("id"));
    if (!isSafeId(id)) return c.json({ error: "Album not found" }, 404);
    const detail = await getAlbum(needle, id);
    if (!detail) return c.json({ error: "Album not found" }, 404);
    return c.json(detail);
  });

  api.post("/play", async (c) => {
    const forbidden = await denyUnlessMember(c);
    if (forbidden) return forbidden;
    const user = c.get("user") as SessionUser;
    const body = (await c.req.json().catch(() => ({}))) as { query?: string; fileId?: string };
    const query = clampQuery(body.query?.trim() ?? "");
    const fileId = isSafeId(body.fileId) ? body.fileId : undefined;
    const cached = fileId ? playableFromId(fileId) : undefined;
    let tracks = cached ? [cached] : [];
    if (tracks.length === 0 && query) {
      tracks = await findTracks(needle, query, true);
    }
    if (tracks.length === 0) {
      const miss = await missingLibrary(needle, query || "that track");
      return c.json({ error: miss.message, catalog: miss.catalog }, 404);
    }
    const player = currentPlayer();
    const channel = await pickVoiceChannel(client, activeGuildId, {
      currentChannelId: player.channelId,
      userId: user.id,
    });
    if (!channel) return c.json({ error: "No voice channel available for Rou to join." }, 409);
    const queued = tracks.map((track) => toQueueItem(track!, displayName(user)));
    const position = await player.enqueue(channel, queued);
    players.leaveOthers(activeGuildId);
    return c.json({
      position,
      track: serializeTrack(queued[0]!),
      status: await statusPayload(user),
    });
  });

  api.post("/album", async (c) => {
    const forbidden = await denyUnlessMember(c);
    if (forbidden) return forbidden;
    const user = c.get("user") as SessionUser;
    const body = (await c.req.json().catch(() => ({}))) as { query?: string; albumId?: string };
    const query = clampQuery(body.query?.trim() ?? "");
    const tracks = isSafeId(body.albumId)
      ? await getAlbumTracksById(needle, body.albumId)
      : query
        ? await findAlbum(needle, query)
        : [];
    if (tracks.length === 0) {
      const miss = await missingLibrary(needle, query || "that album");
      return c.json({ error: miss.message, catalog: miss.catalog }, 404);
    }
    const player = currentPlayer();
    const channel = await pickVoiceChannel(client, activeGuildId, {
      currentChannelId: player.channelId,
      userId: user.id,
    });
    if (!channel) return c.json({ error: "No voice channel available for Rou to join." }, 409);
    const queued = tracks.map((track) => toQueueItem(track, displayName(user)));
    const position = await player.enqueue(channel, queued);
    players.leaveOthers(activeGuildId);
    return c.json({
      position,
      count: queued.length,
      track: serializeTrack(queued[0]!),
      status: await statusPayload(user),
    });
  });

  api.post("/request", rateLimit("request", 10, 60_000), async (c) => {
    const user = c.get("user") as SessionUser;
    const body = (await c.req.json().catch(() => ({}))) as {
      albumId?: string;
      recordingMbid?: string;
      title?: string;
      durationSeconds?: number | null;
    };
    const albumId = isSafeId(body.albumId?.trim()) ? body.albumId!.trim() : "";
    const recordingMbid = isSafeId(body.recordingMbid?.trim()) ? body.recordingMbid!.trim() : "";
    if (!albumId && !recordingMbid) return c.json({ error: "Missing album or track to request" }, 400);
    const result = await requestFromNeedle(needle, {
      albumId: albumId || undefined,
      recordingMbid: recordingMbid || undefined,
      title: clampQuery(body.title?.trim() ?? "", 200) || undefined,
      durationSeconds:
        typeof body.durationSeconds === "number" && Number.isFinite(body.durationSeconds)
          ? Math.min(Math.max(body.durationSeconds, 0), 86_400)
          : undefined,
    });
    if (result.watch) {
      const watch = { ...result.watch, requestedBy: displayName(user) };
      requestors.set(watch.key, watch.requestedBy);
      waiting.set(watch.key, watch);
      dismissed.delete(watch.key);
    }
    return c.json(result);
  });

  api.get("/requests", async (c) => {
    const snapshot = await listIncomingRequests(needle);
    const items = snapshot.active
      .filter((item) => !item.ready && !item.failed && !dismissed.has(`${item.kind}:${item.id}`))
      .map((item) => ({
        ...item,
        requestedBy: requestors.get(`${item.kind}:${item.id}`) ?? item.requestedBy,
      }));
    return c.json({ items });
  });

  api.post("/requests/remove", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { id?: string; kind?: string };
    const id = body.id?.trim() ?? "";
    const kind = body.kind === "track" ? "track" : "album";
    if (!isSafeId(id)) return c.json({ error: "Missing request" }, 400);
    const key = `${kind}:${id}`;
    waiting.delete(key);
    dismissed.add(key);
    try {
      await needle.cancelRequest(id, kind);
    } catch (error) {
      console.warn("[rou] cancel request failed:", error);
      try {
        await needle.rejectRequest(id, kind);
      } catch (rejectError) {
        console.warn("[rou] reject request failed:", rejectError);
      }
    }
    const snapshot = await listIncomingRequests(needle);
    const items = snapshot.active
      .filter((item) => !item.ready && !item.failed && !dismissed.has(`${item.kind}:${item.id}`))
      .map((item) => ({
        ...item,
        requestedBy: requestors.get(`${item.kind}:${item.id}`) ?? item.requestedBy,
      }));
    return c.json({ ok: true, items });
  });

  api.get("/channels", async (c) => {
    const user = c.get("user") as SessionUser;
    const guildId = c.req.query("guildId")?.trim() || activeGuildId;
    if (!isSafeId(guildId) || !(await memberInGuild(client, guildId, user.id))) {
      return c.json({ error: "You're not in that server." }, 403);
    }
    const player = players.get(guildId);
    return c.json({
      guildId,
      channels: await listVoiceChannels(client, guildId, {
        botChannelId: player.channelId,
        userId: user.id,
      }),
    });
  });

  api.post("/channel", async (c) => {
    const forbidden = await denyUnlessMember(c);
    if (forbidden) return forbidden;
    const user = c.get("user") as SessionUser;
    const body = (await c.req.json().catch(() => ({}))) as { channelId?: string };
    const channelId = body.channelId?.trim() ?? "";
    if (!isSafeId(channelId)) return c.json({ error: "Missing voice channel" }, 400);
    const channel = await pickVoiceChannel(client, activeGuildId, {
      preferredChannelId: channelId,
      userId: user.id,
      allowEmptyFallback: false,
    });
    if (!channel || channel.id !== channelId) {
      return c.json({ error: "Rou can't join that voice channel." }, 409);
    }
    await currentPlayer().moveTo(channel);
    players.leaveOthers(activeGuildId);
    return c.json({ ok: true, status: await statusPayload(user) });
  });

  api.post("/queue/remove", async (c) => {
    const forbidden = await denyUnlessMember(c);
    if (forbidden) return forbidden;
    const user = c.get("user") as SessionUser;
    const body = (await c.req.json().catch(() => ({}))) as { index?: number };
    const index = Number(body.index);
    const removed = currentPlayer().removeQueued(index);
    if (!removed) return c.json({ error: "Nothing at that queue position." }, 404);
    return c.json({ ok: true, removed: serializeTrack(removed), status: await statusPayload(user) });
  });

  api.post("/guild", async (c) => {
    const user = c.get("user") as SessionUser;
    const body = (await c.req.json().catch(() => ({}))) as { guildId?: string; channelId?: string };
    const guildId = body.guildId?.trim() ?? "";
    if (!isSafeId(guildId)) return c.json({ error: "Missing server" }, 400);
    if (!(await memberInGuild(client, guildId, user.id))) {
      return c.json({ error: "You're not in that server." }, 403);
    }
    if (guildId === activeGuildId) {
      const channelId = body.channelId?.trim();
      if (channelId) {
        if (!isSafeId(channelId)) return c.json({ error: "Rou can't join that voice channel." }, 409);
        const channel = await pickVoiceChannel(client, guildId, {
          preferredChannelId: channelId,
          userId: user.id,
          allowEmptyFallback: false,
        });
        if (!channel || channel.id !== channelId) {
          return c.json({ error: "Rou can't join that voice channel." }, 409);
        }
        await currentPlayer().moveTo(channel);
        players.leaveOthers(activeGuildId);
      }
      return c.json({ ok: true, status: await statusPayload(user) });
    }

    const from = currentPlayer();
    const previousId = activeGuildId;
    const moving = Boolean(from.nowPlaying || from.upcoming.length);
    const destChannels = await listVoiceChannels(client, guildId, { userId: user.id });
    const preferredChannelId = isSafeId(body.channelId?.trim()) ? body.channelId!.trim() : undefined;
    const channel = await pickVoiceChannel(client, guildId, {
      preferredChannelId,
      userId: user.id,
      allowEmptyFallback: false,
    });
    if (moving && !channel) {
      return c.json(
        {
          error: "Pick a voice channel in that server, or join one there first.",
          guildId,
          channels: destChannels,
        },
        409,
      );
    }

    const session = from.copySession();
    const to = players.get(guildId);
    if (to.channelId || !to.isIdle()) to.leave();
    to.setVolume(session.volume);
    if (moving) from.pause();
    activeGuildId = guildId;
    try {
      if (moving && channel) {
        await to.enqueue(channel, session.tracks);
      } else if (channel) {
        await to.moveTo(channel);
      }
    } catch (error) {
      activeGuildId = previousId;
      to.leave();
      from.resume();
      throw error;
    }
    players.leaveOthers(guildId);
    return c.json({ ok: true, status: await statusPayload(user) });
  });

  api.post("/skip", async (c) => {
    const forbidden = await denyUnlessMember(c);
    if (forbidden) return forbidden;
    const skipped = currentPlayer().skip();
    return c.json({ skipped: skipped ? serializeTrack(skipped) : null });
  });
  api.post("/pause", async (c) => {
    const forbidden = await denyUnlessMember(c);
    if (forbidden) return forbidden;
    return c.json({ ok: currentPlayer().pause() });
  });
  api.post("/resume", async (c) => {
    const forbidden = await denyUnlessMember(c);
    if (forbidden) return forbidden;
    return c.json({ ok: currentPlayer().resume() });
  });
  api.post("/stop", async (c) => {
    const forbidden = await denyUnlessMember(c);
    if (forbidden) return forbidden;
    currentPlayer().stop();
    players.leaveOthers(activeGuildId);
    return c.json({ ok: true });
  });
  api.post("/volume", async (c) => {
    const forbidden = await denyUnlessMember(c);
    if (forbidden) return forbidden;
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
    if ([id, albumId, artistId].some((value) => value != null && value !== "" && !isSafeId(value))) {
      return new Response(null, { status: 400 });
    }
    if (!id && !albumId && !artistId) return new Response(null, { status: 400 });
    let url = artistId
      ? (coverUrlFor(`artist:${artistId}`) ?? needle.resolveUrl(`/api/v1/covers/artist/${artistId}`))
      : albumId
        ? coverUrlFor(albumId)
        : coverUrlFor(id!) ?? coverArtArchiveUrl(playableFromId(id!)?.albumMbid);
    if (!url) return new Response(null, { status: 404 });
    url =
      rewriteCoverUrl(
        url,
        playableFromId(id ?? "")?.albumMbid ?? (albumId && /^[0-9a-f-]{36}$/i.test(albumId) ? albumId : null),
      ) ?? url;
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

  serve({ fetch: app.fetch, hostname: web.bind, port: web.port }, (info) => {
    console.log(`[rou] web UI on http://${web.bind}:${info.port} (${web.publicUrl})`);
  });
}

function displayName(user: SessionUser): string {
  return user.globalName || user.username;
}

const waiting = new Map<string, IncomingWatch>();
const requestors = new Map<string, string>();
const dismissed = new Set<string>();

async function playIncoming(
  deps: { client: Client; guildId: string; player: GuildPlayer; needle: DroppedNeedleClient },
  watch: IncomingWatch,
): Promise<boolean> {
  const tracks = await tracksForIncoming(deps.needle, watch);
  if (tracks.length === 0) return false;
  const channel = await pickVoiceChannel(deps.client, deps.guildId, {
    currentChannelId: deps.player.channelId,
  });
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
    if (dismissed.has(key)) {
      waiting.delete(key);
      continue;
    }
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
    if (dismissed.has(key)) return false;
    if (waiting.has(key)) return true;
    return !item.ready && !item.failed;
  });
  return { items, moved };
}
