import type { DroppedNeedleClient } from "./droppedneedle/client.js";
import { isPublicCoverUrl } from "./droppedneedle/client.js";
import type { PlayableTrack } from "./droppedneedle/types.js";
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
  fileId: string;
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
}

export async function findAlbums(needle: DroppedNeedleClient, query: string): Promise<PublicAlbum[]> {
  const [local, nativeAlbums, nativeTracks] = await Promise.all([
    needle.searchLibrary(query),
    needle.searchNativeAlbums(query).catch(() => [] as Awaited<ReturnType<DroppedNeedleClient["searchNativeAlbums"]>>),
    needle.searchNativeTracks(query, 25).catch(() => [] as Awaited<ReturnType<DroppedNeedleClient["searchNativeTracks"]>>),
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
    });
  }

  const seen = new Set<string>();
  const results: PublicAlbum[] = [];
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
  for (const album of order) {
    if (seen.has(album.id)) continue;
    seen.add(album.id);
    results.push(serializeAlbum(album));
  }
  return results.slice(0, 24);
}

export async function getAlbum(
  needle: DroppedNeedleClient,
  id: string,
): Promise<{ album: PublicAlbum; tracks: PublicTrack[] } | null> {
  let stored = albumById.get(id);
  const nativeId = stored?.nativeId ?? (id.startsWith("native:") ? id.slice(7) : null);
  const mbid = stored?.mbid ?? (/^[0-9a-f-]{36}$/i.test(id) ? id : null);

  if (nativeId) {
    const nativeTracks = await needle.getNativeAlbumTracks(nativeId);
    const playable = await needle.playableFromNative(nativeTracks);
    playable.forEach(rememberPlayable);
    const first = playable[0];
    if (!stored && first) {
      stored = {
        id,
        title: first.album,
        artist: first.artist,
        year: null,
        trackCount: playable.length,
        coverUrl: first.coverUrl,
        mbid: first.albumMbid,
        nativeId,
        matchedTrack: null,
      };
      albumById.set(id, stored);
    }
    if (!stored) return null;
    stored.trackCount = playable.length;
    return { album: serializeAlbum(stored), tracks: playable.map(serializeTrack) };
  }

  if (mbid) {
    const infos = await needle.getAlbumTracks(mbid);
    if (!stored) {
      stored = {
        id: mbid,
        title: infos[0] ? id : mbid,
        artist: "",
        year: null,
        trackCount: infos.length,
        coverUrl: coverArtArchiveUrl(mbid),
        mbid,
        nativeId: null,
        matchedTrack: null,
      };
    }
    const summary = {
      musicbrainz_id: mbid,
      name: stored.title || "Album",
      artist_name: stored.artist || "Unknown artist",
      year: stored.year ?? undefined,
      cover_url: stored.coverUrl,
    };
    if (!stored.title || stored.title === mbid) {
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
    playable.forEach(rememberPlayable);
    stored.trackCount = playable.length;
    albumById.set(stored.id, stored);
    if (playable.length === 0) return null;
    return { album: serializeAlbum(stored), tracks: playable.map(serializeTrack) };
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
  return detail.tracks.map((track) => playableFromId(track.fileId)).filter((track): track is PlayableTrack => Boolean(track));
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
        "Request it in DroppedNeedle, then try again once it imports.",
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
