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

export function coverUrlFor(fileId: string): string | undefined {
  const stored = coverById.get(fileId);
  if (stored) return stored;
  const track = playableById.get(fileId);
  if (track?.albumMbid) return coverArtArchiveUrl(track.albumMbid) ?? undefined;
  return undefined;
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
  };
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
