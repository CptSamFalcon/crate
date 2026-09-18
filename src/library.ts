import type { DroppedNeedleClient } from "./droppedneedle/client.js";
import { droppedNeedleMessage, isPublicCoverUrl } from "./droppedneedle/client.js";
import type { CatalogAlbumTrack, PlayableTrack } from "./droppedneedle/types.js";
import type { QueueItem } from "./player/manager.js";

const playableById = new Map<string, PlayableTrack>();
const coverById = new Map<string, string>();

export function rememberPlayable(track: PlayableTrack): void {
  playableById.set(track.fileId, track);
  if (track.coverUrl) coverById.set(track.fileId, track.coverUrl);
}

export function playableFromId(fileId: string): PlayableTrack | undefined {
  return playableById.get(fileId);
}

export function coverArtArchiveUrl(mbid: string | null | undefined): string | null {
  if (!mbid) return null;
  return `https://coverartarchive.org/release-group/${encodeURIComponent(mbid)}/front-500`;
}

export function toQueueItem(track: PlayableTrack, requestedBy: string): QueueItem {
  rememberPlayable(track);
  return { ...track, requestedBy };
}

export type PublicTrack = {
  fileId: string | null;
  recordingMbid: string | null;
  title: string;
  artist: string;
  album: string;
  durationSeconds: number | null;
  albumMbid: string | null;
  requestedBy: string | null;
  coverUrl: string | null;
  trackNumber: number | null;
};

export function serializeTrack(track: PlayableTrack & { requestedBy?: string }): PublicTrack {
  rememberPlayable(track);
  let coverUrl: string | null = null;
  if (track.coverUrl && isPublicCoverUrl(track.coverUrl)) {
    coverUrl = track.coverUrl;
  } else if (track.coverUrl) {
    coverUrl = `/api/cover?id=${encodeURIComponent(track.fileId)}`;
  } else {
    coverUrl = coverArtArchiveUrl(track.albumMbid);
  }
  return {
    fileId: track.fileId,
    recordingMbid: null,
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationSeconds: track.durationSeconds,
    albumMbid: track.albumMbid,
    requestedBy: track.requestedBy ?? null,
    coverUrl,
    trackNumber: track.trackNumber ?? null,
  };
}

export type PublicAlbum = {
  id: string;
  title: string;
  artist: string;
  year: number | null;
  trackCount: number | null;
  coverUrl: string | null;
  matchedTrack: string | null;
  inLibrary: boolean;
  requested: boolean;
};

type StoredAlbum = {
  id: string;
  title: string;
  artist: string;
  year: number | null;
  trackCount: number | null;
  coverUrl: string | null;
  mbid: string | null;
  nativeId: string | null;
  matchedTrack: string | null;
  inLibrary: boolean;
  requested: boolean;
};

const albumById = new Map<string, StoredAlbum>();

function albumCoverSrc(album: StoredAlbum): string | null {
  if (album.coverUrl && isPublicCoverUrl(album.coverUrl)) return album.coverUrl;
  if (album.coverUrl) return `/api/cover?album=${encodeURIComponent(album.id)}`;
  return coverArtArchiveUrl(album.mbid);
}

export function serializeAlbum(album: StoredAlbum): PublicAlbum {
  albumById.set(album.id, album);
  if (album.coverUrl) coverById.set(`album:${album.id}`, album.coverUrl);
  return {
    id: album.id,
    title: album.title,
    artist: album.artist,
    year: album.year,
    trackCount: album.trackCount,
    coverUrl: albumCoverSrc(album),
    matchedTrack: album.matchedTrack,
    inLibrary: album.inLibrary,
    requested: album.requested,
  };
}

export function coverUrlFor(fileId: string): string | undefined {
  const stored = coverById.get(fileId);
  if (stored) return stored;
  const albumStored = coverById.get(`album:${fileId}`);
  if (albumStored) return albumStored;
  const track = playableById.get(fileId);
  if (track?.albumMbid) return coverArtArchiveUrl(track.albumMbid) ?? undefined;
  return undefined;
}

function upsertAlbum(album: StoredAlbum): void {
  const existing = albumById.get(album.id);
  if (!existing) {
    albumById.set(album.id, album);
    return;
  }
  if (!existing.matchedTrack && album.matchedTrack) existing.matchedTrack = album.matchedTrack;
  if (!existing.coverUrl && album.coverUrl) existing.coverUrl = album.coverUrl;
  if (!existing.year && album.year) existing.year = album.year;
  if (!existing.trackCount && album.trackCount) existing.trackCount = album.trackCount;
  if (!existing.mbid && album.mbid) existing.mbid = album.mbid;
  if (!existing.nativeId && album.nativeId) existing.nativeId = album.nativeId;
  if (album.inLibrary) existing.inLibrary = true;
  if (album.requested) existing.requested = true;
}

export async function findAlbums(needle: DroppedNeedleClient, query: string): Promise<PublicAlbum[]> {
  const [local, nativeAlbums, nativeTracks, catalog] = await Promise.all([
    needle.searchLibrary(query),
    needle.searchNativeAlbums(query).catch(() => [] as Awaited<ReturnType<DroppedNeedleClient["searchNativeAlbums"]>>),
    needle.searchNativeTracks(query, 25).catch(() => [] as Awaited<ReturnType<DroppedNeedleClient["searchNativeTracks"]>>),
    needle.searchCatalog(query).catch(() => ({ albums: [] as NonNullable<Awaited<ReturnType<DroppedNeedleClient["searchCatalog"]>>["albums"]> })),
  ]);

  for (const album of local.albums ?? []) {
    upsertAlbum({
      id: album.musicbrainz_id,
      title: album.name,
      artist: album.artist_name,
      year: album.year ?? null,
      trackCount: album.track_count ?? null,
      coverUrl: needle.resolveUrl(album.cover_url),
      mbid: album.musicbrainz_id,
      nativeId: null,
      matchedTrack: null,
      inLibrary: true,
      requested: false,
    });
  }
  for (const track of local.tracks ?? []) {
    const id = track.album_mbid ?? `name:${track.artist_name.toLowerCase()}|${track.album_name.toLowerCase()}`;
    upsertAlbum({
      id,
      title: track.album_name,
      artist: track.artist_name,
      year: track.year ?? null,
      trackCount: null,
      coverUrl: needle.resolveUrl(track.cover_url),
      mbid: track.album_mbid ?? null,
      nativeId: null,
      matchedTrack: track.title,
      inLibrary: true,
      requested: false,
    });
  }
  for (const album of nativeAlbums) {
    const id = album.musicbrainz_release_group_id ?? `native:${album.id}`;
    upsertAlbum({
      id,
      title: album.title,
      artist: album.artist_name,
      year: null,
      trackCount: album.track_count ?? null,
      coverUrl: album.cover_available ? needle.nativeArtworkUrl(album.id) : null,
      mbid: album.musicbrainz_release_group_id ?? null,
      nativeId: album.id,
      matchedTrack: null,
      inLibrary: true,
      requested: false,
    });
  }
  for (const track of nativeTracks) {
    const id = track.musicbrainz_release_group_id ?? `native:${track.album_id}`;
    upsertAlbum({
      id,
      title: track.album_title,
      artist: track.artist_name,
      year: null,
      trackCount: null,
      coverUrl: track.cover_available ? needle.nativeArtworkUrl(track.album_id) : null,
      mbid: track.musicbrainz_release_group_id ?? null,
      nativeId: track.album_id,
      matchedTrack: track.title,
      inLibrary: true,
      requested: false,
    });
  }
  for (const album of catalog.albums ?? []) {
    if (!album.musicbrainz_id) continue;
    upsertAlbum({
      id: album.musicbrainz_id,
      title: album.title,
      artist: album.artist ?? "Unknown artist",
      year: album.year ?? null,
      trackCount: null,
      coverUrl:
        needle.resolveUrl(album.cover_url ?? album.album_thumb_url) ?? coverArtArchiveUrl(album.musicbrainz_id),
      mbid: album.musicbrainz_id,
      nativeId: null,
      matchedTrack: null,
      inLibrary: false,
      requested: Boolean(album.requested),
    });
  }

  const seen = new Set<string>();
  const order: StoredAlbum[] = [];
  for (const album of local.albums ?? []) {
    const stored = albumById.get(album.musicbrainz_id);
    if (stored) order.push(stored);
  }
  for (const track of local.tracks ?? []) {
    const id = track.album_mbid ?? `name:${track.artist_name.toLowerCase()}|${track.album_name.toLowerCase()}`;
    const stored = albumById.get(id);
    if (stored) order.push(stored);
  }
  for (const album of nativeAlbums) {
    const stored = albumById.get(album.musicbrainz_release_group_id ?? `native:${album.id}`);
    if (stored) order.push(stored);
  }
  for (const track of nativeTracks) {
    const stored = albumById.get(track.musicbrainz_release_group_id ?? `native:${track.album_id}`);
    if (stored) order.push(stored);
  }
  for (const album of catalog.albums ?? []) {
    const stored = albumById.get(album.musicbrainz_id);
    if (stored) order.push(stored);
  }

  const playable: PublicAlbum[] = [];
  const requestable: PublicAlbum[] = [];
  for (const album of order) {
    if (seen.has(album.id)) continue;
    seen.add(album.id);
    const serialized = serializeAlbum(album);
    if (serialized.inLibrary) playable.push(serialized);
    else requestable.push(serialized);
  }
  return [...playable, ...requestable].slice(0, 32);
}

function emptyStored(id: string, mbid: string | null, nativeId: string | null): StoredAlbum {
  return {
    id,
    title: "",
    artist: "",
    year: null,
    trackCount: null,
    coverUrl: coverArtArchiveUrl(mbid),
    mbid,
    nativeId,
    matchedTrack: null,
    inLibrary: false,
    requested: false,
  };
}

function serializeCatalogTrack(album: StoredAlbum, track: CatalogAlbumTrack): PublicTrack {
  const durationSeconds =
    track.length && track.length > 0 ? Math.max(1, Math.round(track.length / 1000)) : null;
  return {
    fileId: null,
    recordingMbid: track.recording_id ?? null,
    title: track.title,
    artist: album.artist || "Unknown artist",
    album: album.title || "Album",
    durationSeconds,
    albumMbid: album.mbid,
    requestedBy: null,
    coverUrl: albumCoverSrc(album),
    trackNumber: track.position || null,
  };
}

async function catalogAlbumDetail(
  needle: DroppedNeedleClient,
  stored: StoredAlbum,
  mbid: string,
): Promise<{ album: PublicAlbum; tracks: PublicTrack[] }> {
  const [basic, tracksPayload] = await Promise.all([
    needle.getCatalogAlbumBasic(mbid).catch(() => null),
    needle.getCatalogAlbumTracks(mbid).catch(() => null),
  ]);
  if (basic) {
    stored.title = basic.title || stored.title;
    stored.artist = basic.artist_name || stored.artist;
    stored.year = basic.year ?? stored.year;
    stored.requested = stored.requested || Boolean(basic.requested);
    stored.coverUrl =
      needle.resolveUrl(basic.cover_url ?? basic.album_thumb_url) ?? stored.coverUrl ?? coverArtArchiveUrl(mbid);
  }
  stored.title = stored.title || "Album";
  stored.artist = stored.artist || "Unknown artist";
  stored.inLibrary = false;
  stored.mbid = mbid;
  stored.coverUrl = stored.coverUrl ?? coverArtArchiveUrl(mbid);
  const tracks = (tracksPayload?.tracks ?? []).map((track) => serializeCatalogTrack(stored, track));
  stored.trackCount = tracks.length || stored.trackCount;
  albumById.set(stored.id, stored);
  return { album: serializeAlbum(stored), tracks };
}

export async function getAlbum(
  needle: DroppedNeedleClient,
  id: string,
): Promise<{ album: PublicAlbum; tracks: PublicTrack[] } | null> {
  let stored = albumById.get(id);
  const nativeId = stored?.nativeId ?? (id.startsWith("native:") ? id.slice(7) : null);
  const mbid = stored?.mbid ?? (/^[0-9a-f-]{36}$/i.test(id) ? id : null);

  if (nativeId) {
    try {
      const nativeTracks = await needle.getNativeAlbumTracks(nativeId);
      const playable = await needle.playableFromNative(nativeTracks);
      playable.forEach(rememberPlayable);
      const first = playable[0];
      if (!stored && first) {
        stored = {
          ...emptyStored(id, first.albumMbid, nativeId),
          title: first.album,
          artist: first.artist,
          trackCount: playable.length,
          coverUrl: first.coverUrl,
          inLibrary: true,
        };
        albumById.set(id, stored);
      }
      if (stored && playable.length > 0) {
        stored.trackCount = playable.length;
        stored.inLibrary = true;
        albumById.set(stored.id, stored);
        return { album: serializeAlbum(stored), tracks: playable.map(serializeTrack) };
      }
    } catch {
      // Fall through to MusicBrainz / catalogue lookup.
    }
  }

  if (mbid) {
    stored ??= emptyStored(id, mbid, nativeId);
    try {
      const infos = await needle.getAlbumTracks(mbid);
      const summary = {
        musicbrainz_id: mbid,
        name: stored.title || "Album",
        artist_name: stored.artist || "Unknown artist",
        year: stored.year ?? undefined,
        cover_url: stored.coverUrl,
      };
      if (!stored.title || stored.title === mbid || stored.title === id) {
        const local = await needle.searchLibrary(queryGuess(stored, id));
        const match = local.albums?.find((album) => album.musicbrainz_id === mbid) ?? local.albums?.[0];
        if (match) {
          stored.title = match.name;
          stored.artist = match.artist_name;
          stored.year = match.year ?? stored.year;
          stored.coverUrl = needle.resolveUrl(match.cover_url) ?? stored.coverUrl;
          summary.name = match.name;
          summary.artist_name = match.artist_name;
          summary.cover_url = match.cover_url ?? stored.coverUrl;
        } else if (local.tracks?.[0]) {
          stored.title = local.tracks[0].album_name;
          stored.artist = local.tracks[0].artist_name;
          stored.coverUrl = needle.resolveUrl(local.tracks[0].cover_url) ?? stored.coverUrl;
          summary.name = stored.title;
          summary.artist_name = stored.artist;
        }
      }
      const playable = infos.map((track) => needle.albumToPlayable(summary, track));
      if (playable.length > 0) {
        playable.forEach(rememberPlayable);
        stored.trackCount = playable.length;
        stored.inLibrary = true;
        albumById.set(stored.id, stored);
        return { album: serializeAlbum(stored), tracks: playable.map(serializeTrack) };
      }
    } catch {
      // Not on the media server — show the catalogue copy so it can be requested.
    }
    return catalogAlbumDetail(needle, stored, mbid);
  }

  if (id.startsWith("name:")) {
    const local = await needle.searchLibrary(id.slice(5).replace("|", " "));
    const album = local.albums?.[0];
    if (!album) return null;
    return getAlbum(needle, album.musicbrainz_id);
  }

  return null;
}

function queryGuess(stored: StoredAlbum, id: string): string {
  if (stored.title && stored.title !== id) return `${stored.artist} ${stored.title}`.trim();
  return stored.artist || stored.title || id;
}

export async function getAlbumTracksById(needle: DroppedNeedleClient, id: string): Promise<PlayableTrack[]> {
  const detail = await getAlbum(needle, id);
  if (!detail) return [];
  return detail.tracks
    .map((track) => (track.fileId ? playableFromId(track.fileId) : undefined))
    .filter((track): track is PlayableTrack => Boolean(track));
}

export async function findTracks(
  needle: DroppedNeedleClient,
  query: string,
  firstOnly = false,
): Promise<PlayableTrack[]> {
  const local = await needle.searchLibrary(query);
  const localTracks = (local.tracks ?? []).map((track) => needle.toPlayable(track));
  if (localTracks.length > 0) {
    const tracks = firstOnly ? localTracks.slice(0, 1) : localTracks;
    tracks.forEach(rememberPlayable);
    return tracks;
  }
  if (local.albums && local.albums.length > 0) {
    const album = local.albums[0]!;
    const albumTracks = await needle.getAlbumTracks(album.musicbrainz_id);
    const playable = albumTracks.map((track) => needle.albumToPlayable(album, track));
    if (playable.length > 0) {
      playable.forEach(rememberPlayable);
      return playable;
    }
  }
  const nativeTracks = await needle.searchNativeTracks(query, firstOnly ? 5 : 25);
  const resolved = await needle.playableFromNative(nativeTracks);
  const tracks = firstOnly ? resolved.slice(0, 1) : resolved;
  tracks.forEach(rememberPlayable);
  return tracks;
}

export async function findAlbum(needle: DroppedNeedleClient, query: string): Promise<PlayableTrack[]> {
  const local = await needle.searchLibrary(query);
  const album = local.albums?.[0];
  if (album) {
    const albumTracks = await needle.getAlbumTracks(album.musicbrainz_id);
    const playable = albumTracks.map((track) => needle.albumToPlayable(album, track));
    if (playable.length > 0) {
      playable.forEach(rememberPlayable);
      return playable;
    }
  }
  const nativeAlbums = await needle.searchNativeAlbums(query);
  const nativeAlbum = nativeAlbums[0];
  if (!nativeAlbum) return [];
  const nativeTracks = await needle.getNativeAlbumTracks(nativeAlbum.id);
  const playable = await needle.playableFromNative(nativeTracks);
  playable.forEach(rememberPlayable);
  return playable;
}

export type CatalogHint = {
  title: string;
  artist: string | null;
  inLibrary: boolean;
};

export async function missingLibrary(
  needle: DroppedNeedleClient,
  query: string,
): Promise<{ message: string; catalog: CatalogHint[] }> {
  try {
    const catalog = await needle.searchCatalog(query);
    const albums = (catalog.albums ?? []).slice(0, 3);
    const hints = albums.map((album) => ({
      title: album.title,
      artist: album.artist ?? null,
      inLibrary: Boolean(album.in_library),
    }));
    if (hints.length === 0) {
      return { message: `Nothing in the DroppedNeedle library matched “${query}”.`, catalog: [] };
    }
    const lines = hints.map((album) => {
      const owned = album.inLibrary ? "in library" : "not downloaded";
      return `• ${album.title}${album.artist ? ` — ${album.artist}` : ""} (${owned})`;
    });
    return {
      message: [
        `Nothing playable in the library matched **${query}**.`,
        "Catalogue hits:",
        ...lines,
        "Request it from the Rou dashboard, then try again once it imports.",
      ].join("\n"),
      catalog: hints,
    };
  } catch {
    return { message: `Nothing in the DroppedNeedle library matched “${query}”.`, catalog: [] };
  }
}

export async function missingLibraryMessage(needle: DroppedNeedleClient, query: string): Promise<string> {
  return (await missingLibrary(needle, query)).message;
}

function describeNeedleRequest(status: string, message?: string | null): string {
  if (message?.trim()) return message;
  if (status === "awaiting_approval") return "Requested. An admin needs to approve it before DroppedNeedle downloads it.";
  if (status === "already_in_library") return "That's already on the media server.";
  if (status === "queued" || status === "pending") return "Requested. DroppedNeedle is looking for it.";
  return "Requested.";
}

export async function requestFromNeedle(
  needle: DroppedNeedleClient,
  input: {
    albumId?: string;
    recordingMbid?: string;
    title?: string;
    durationSeconds?: number | null;
  },
): Promise<{ status: string; message: string; album: PublicAlbum | null }> {
  const stored = input.albumId ? albumById.get(input.albumId) : undefined;
  const mbid = stored?.mbid ?? (input.albumId && /^[0-9a-f-]{36}$/i.test(input.albumId) ? input.albumId : null);

  try {
    if (input.recordingMbid) {
      const result = await needle.requestTrack({
        recordingMbid: input.recordingMbid,
        artistName: stored?.artist || "Unknown artist",
        trackTitle: input.title || "Track",
        albumTitle: stored?.title,
        durationSeconds: input.durationSeconds,
        releaseGroupMbid: mbid,
      });
      const status = result.status ?? "pending";
      return {
        status,
        message: describeNeedleRequest(status, result.message),
        album: stored ? serializeAlbum(stored) : null,
      };
    }

    if (!mbid) {
      throw new Error("This album cannot be requested without a MusicBrainz id.");
    }
    const result = await needle.requestAlbum({
      musicbrainz_id: mbid,
      artist: stored?.artist,
      album: stored?.title,
      year: stored?.year,
    });
    const status = result.status ?? "pending";
    if (stored && status !== "already_in_library") {
      stored.requested = true;
      albumById.set(stored.id, stored);
    }
    return {
      status,
      message: describeNeedleRequest(status, result.message),
      album: stored ? serializeAlbum(stored) : null,
    };
  } catch (error) {
    throw new Error(droppedNeedleMessage(error));
  }
}
