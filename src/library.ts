import type { DroppedNeedleClient } from "./droppedneedle/client.js";
import { droppedNeedleMessage, isPublicCoverUrl } from "./droppedneedle/client.js";
import type { CatalogAlbumTrack, NeedleActiveRequest, PlayableTrack } from "./droppedneedle/types.js";
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

export type PublicArtist = {
  id: string;
  name: string;
  coverUrl: string | null;
  inLibrary: boolean;
  albumCount: number | null;
  disambiguation: string | null;
};

export type SearchResults = {
  artists: PublicArtist[];
  albums: PublicAlbum[];
  tracks: PublicTrack[];
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

type StoredArtist = {
  id: string;
  name: string;
  mbid: string | null;
  nativeId: string | null;
  coverUrl: string | null;
  inLibrary: boolean;
  albumCount: number | null;
  disambiguation: string | null;
};

const artistById = new Map<string, StoredArtist>();

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
  const artistStored = coverById.get(`artist:${fileId}`);
  if (artistStored) return artistStored;
  const track = playableById.get(fileId);
  if (track?.albumMbid) return coverArtArchiveUrl(track.albumMbid) ?? undefined;
  return undefined;
}

function artistCoverSrc(artist: StoredArtist): string | null {
  if (artist.coverUrl && isPublicCoverUrl(artist.coverUrl)) return artist.coverUrl;
  if (artist.coverUrl) return `/api/cover?artist=${encodeURIComponent(artist.id)}`;
  return null;
}

export function serializeArtist(artist: StoredArtist): PublicArtist {
  artistById.set(artist.id, artist);
  if (artist.coverUrl) coverById.set(`artist:${artist.id}`, artist.coverUrl);
  return {
    id: artist.id,
    name: artist.name,
    coverUrl: artistCoverSrc(artist),
    inLibrary: artist.inLibrary,
    albumCount: artist.albumCount,
    disambiguation: artist.disambiguation,
  };
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

function upsertArtist(artist: StoredArtist, portrait = false): void {
  const existing = artistById.get(artist.id);
  if (!existing) {
    artistById.set(artist.id, artist);
    return;
  }
  if (artist.inLibrary) existing.inLibrary = true;
  if (artist.nativeId && !existing.nativeId) existing.nativeId = artist.nativeId;
  if (artist.mbid && !existing.mbid) existing.mbid = artist.mbid;
  if (artist.coverUrl && (!existing.coverUrl || portrait)) existing.coverUrl = artist.coverUrl;
  if (artist.albumCount != null && existing.albumCount == null) existing.albumCount = artist.albumCount;
  if (artist.disambiguation && !existing.disambiguation) existing.disambiguation = artist.disambiguation;
  if (artist.name && artist.name !== existing.name) existing.name = artist.name;
}

function catalogArtistImage(needle: DroppedNeedleClient, item: { musicbrainz_id: string; thumb_url?: string | null; cover_url?: string | null; fanart_url?: string | null; image?: string | null }): string | null {
  const direct = needle.resolveUrl(item.thumb_url ?? item.image ?? item.cover_url ?? item.fanart_url);
  if (direct && (isPublicCoverUrl(direct) || needle.isLocalUrl(direct))) return direct;
  if (item.musicbrainz_id) return needle.resolveUrl(`/api/v1/covers/artist/${item.musicbrainz_id}`);
  return direct;
}

function nativeAlbumFromSearch(
  needle: DroppedNeedleClient,
  album: { id: string; title: string; artist_name: string; musicbrainz_release_group_id?: string | null; cover_available?: boolean; track_count?: number },
): StoredAlbum {
  const id = album.musicbrainz_release_group_id ?? `native:${album.id}`;
  return {
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
  };
}

function songKey(track: { title: string; artist: string; album: string }): string {
  return `${track.title.toLowerCase()}|${track.artist.toLowerCase()}|${track.album.toLowerCase()}`;
}

function normalizeArtistName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/^(the|a|an)\s+/, "")
    .trim();
}

function artistMatchScore(name: string, query: string): number {
  const n = normalizeArtistName(name);
  const q = normalizeArtistName(query);
  if (!n || !q) return 0;
  if (n === q) return 100;
  if (n.startsWith(`${q} `)) return 70;
  if (` ${n} `.includes(` ${q} `)) return 45;
  if (n.includes(q)) return 20;
  return 0;
}

function preferArtist(left: StoredArtist, right: StoredArtist, topId: string | null): StoredArtist {
  const rank = (artist: StoredArtist) =>
    (topId && artist.id === topId ? 16 : 0) +
    (artist.coverUrl ? 8 : 0) +
    (artist.inLibrary ? 4 : 0) +
    (artist.nativeId ? 2 : 0) +
    (artist.mbid ? 1 : 0);
  const winner = rank(left) >= rank(right) ? left : right;
  const other = winner === left ? right : left;
  if (other.inLibrary) winner.inLibrary = true;
  if (other.nativeId && !winner.nativeId) winner.nativeId = other.nativeId;
  if (other.mbid && !winner.mbid) winner.mbid = other.mbid;
  if (other.coverUrl && !winner.coverUrl) winner.coverUrl = other.coverUrl;
  if (other.disambiguation && !winner.disambiguation) winner.disambiguation = other.disambiguation;
  if (other.albumCount != null && winner.albumCount == null) winner.albumCount = other.albumCount;
  return winner;
}

function pickSearchArtists(artists: StoredArtist[], query: string, topId: string | null): StoredArtist[] {
  const unique = new Map<string, StoredArtist>();
  for (const artist of artists) {
    const key = normalizeArtistName(artist.name);
    if (!key) continue;
    const existing = unique.get(key);
    unique.set(key, existing ? preferArtist(existing, artist, topId) : artist);
  }
  const ranked = [...unique.values()]
    .map((artist) => ({ artist, score: artistMatchScore(artist.name, query) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || Number(right.artist.inLibrary) - Number(left.artist.inLibrary));
  if (ranked.length === 0) return [];
  const best = ranked[0]!.score;
  const floor = best >= 100 ? 100 : best >= 70 ? 70 : 45;
  return ranked
    .filter((item) => item.score >= floor)
    .slice(0, best >= 100 ? 1 : 3)
    .map((item) => item.artist);
}

function collectAlbums(order: StoredAlbum[]): PublicAlbum[] {
  const seen = new Set<string>();
  const playable: PublicAlbum[] = [];
  const requestable: PublicAlbum[] = [];
  for (const album of order) {
    if (seen.has(album.id)) continue;
    seen.add(album.id);
    const serialized = serializeAlbum(album);
    if (serialized.inLibrary) playable.push(serialized);
    else requestable.push(serialized);
  }
  return [...playable, ...requestable];
}

export async function searchMedia(needle: DroppedNeedleClient, query: string): Promise<SearchResults> {
  const [local, nativeAlbums, nativeTracks, nativeArtists, catalog] = await Promise.all([
    needle.searchLibrary(query),
    needle.searchNativeAlbums(query).catch(() => [] as Awaited<ReturnType<DroppedNeedleClient["searchNativeAlbums"]>>),
    needle.searchNativeTracks(query, 25).catch(() => [] as Awaited<ReturnType<DroppedNeedleClient["searchNativeTracks"]>>),
    needle.searchNativeArtists(query).catch(() => [] as Awaited<ReturnType<DroppedNeedleClient["searchNativeArtists"]>>),
    needle.searchCatalog(query).catch(() => ({
      albums: [] as NonNullable<Awaited<ReturnType<DroppedNeedleClient["searchCatalog"]>>["albums"]>,
      artists: [] as NonNullable<Awaited<ReturnType<DroppedNeedleClient["searchCatalog"]>>["artists"]>,
      top_artist: null,
      top_album: null,
    })),
  ]);

  const foundArtists = new Set<string>();
  const rememberArtist = (artist: StoredArtist, portrait = false) => {
    upsertArtist(artist, portrait);
    foundArtists.add(artist.id);
  };

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
    if (album.artist_mbid) {
      rememberArtist({
        id: album.artist_mbid,
        name: album.artist_name,
        mbid: album.artist_mbid,
        nativeId: null,
        coverUrl: needle.resolveUrl(album.cover_url),
        inLibrary: true,
        albumCount: null,
        disambiguation: null,
      });
    }
  }
  for (const album of nativeAlbums) {
    upsertAlbum(nativeAlbumFromSearch(needle, album));
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
      inLibrary: Boolean(album.in_library),
      requested: Boolean(album.requested),
    });
  }

  const catalogArtists = [
    catalog.top_artist,
    ...(catalog.artists ?? []),
  ].filter((item): item is NonNullable<typeof item> => Boolean(item?.musicbrainz_id));
  for (const artist of catalogArtists) {
    rememberArtist(
      {
        id: artist.musicbrainz_id,
        name: artist.title,
        mbid: artist.musicbrainz_id,
        nativeId: null,
        coverUrl: catalogArtistImage(needle, artist),
        inLibrary: Boolean(artist.in_library),
        albumCount: null,
        disambiguation: artist.disambiguation ?? null,
      },
      true,
    );
  }
  for (const artist of nativeArtists) {
    const id = artist.musicbrainz_artist_id ?? `native-artist:${artist.id}`;
    rememberArtist({
      id,
      name: artist.name,
      mbid: artist.musicbrainz_artist_id ?? null,
      nativeId: artist.id,
      coverUrl: artist.musicbrainz_artist_id
        ? needle.resolveUrl(`/api/v1/covers/artist/${artist.musicbrainz_artist_id}`)
        : null,
      inLibrary: true,
      albumCount: artist.album_count ?? null,
      disambiguation: null,
    });
  }

  const artistOrder = pickSearchArtists(
    [...foundArtists].map((id) => artistById.get(id)).filter((artist): artist is StoredArtist => Boolean(artist)),
    query,
    catalog.top_artist?.musicbrainz_id ?? null,
  );

  const albumOrder: StoredAlbum[] = [];
  if (catalog.top_album?.musicbrainz_id) {
    const top = albumById.get(catalog.top_album.musicbrainz_id);
    if (top) albumOrder.push(top);
  }
  for (const album of local.albums ?? []) {
    const stored = albumById.get(album.musicbrainz_id);
    if (stored) albumOrder.push(stored);
  }
  for (const album of nativeAlbums) {
    const stored = albumById.get(album.musicbrainz_release_group_id ?? `native:${album.id}`);
    if (stored) albumOrder.push(stored);
  }
  for (const album of catalog.albums ?? []) {
    const stored = albumById.get(album.musicbrainz_id);
    if (stored) albumOrder.push(stored);
  }

  const tracks: PublicTrack[] = [];
  const seenSongs = new Set<string>();
  const seenFiles = new Set<string>();
  const pushTrack = (track: PublicTrack) => {
    const key = songKey(track);
    if (track.fileId && seenFiles.has(track.fileId)) return;
    if (seenSongs.has(key)) return;
    seenSongs.add(key);
    if (track.fileId) seenFiles.add(track.fileId);
    tracks.push(track);
  };
  for (const track of local.tracks ?? []) {
    pushTrack(serializeTrack(needle.toPlayable(track)));
  }
  for (const track of nativeTracks) {
    const playable = needle.nativeToPlayable(track);
    if (playable) pushTrack(serializeTrack(playable));
  }

  return {
    artists: artistOrder.map(serializeArtist),
    albums: collectAlbums(albumOrder).slice(0, 12),
    tracks: tracks.slice(0, 8),
  };
}

export async function findAlbums(needle: DroppedNeedleClient, query: string): Promise<PublicAlbum[]> {
  return (await searchMedia(needle, query)).albums;
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

export async function getArtist(
  needle: DroppedNeedleClient,
  id: string,
): Promise<{ artist: PublicArtist; albums: PublicAlbum[] } | null> {
  let stored = artistById.get(id);
  const nativeId = stored?.nativeId ?? (id.startsWith("native-artist:") ? id.slice(14) : null);
  const mbid = stored?.mbid ?? (/^[0-9a-f-]{36}$/i.test(id) ? id : null);
  if (!stored) {
    if (!mbid && !nativeId) return null;
    stored = {
      id,
      name: "",
      mbid,
      nativeId,
      coverUrl: mbid ? needle.resolveUrl(`/api/v1/covers/artist/${mbid}`) : null,
      inLibrary: Boolean(nativeId),
      albumCount: null,
      disambiguation: null,
    };
    artistById.set(id, stored);
  }

  const [nativeAlbums, catalog, releases] = await Promise.all([
    nativeId ? needle.getNativeArtistAlbums(nativeId).catch(() => []) : Promise.resolve([]),
    mbid ? needle.getCatalogArtist(mbid).catch(() => null) : Promise.resolve(null),
    mbid ? needle.getArtistReleases(mbid).catch(() => null) : Promise.resolve(null),
  ]);

  if (catalog) {
    stored.name = catalog.name || stored.name;
    stored.mbid = catalog.musicbrainz_id || stored.mbid;
    stored.disambiguation = catalog.disambiguation ?? stored.disambiguation;
    const portrait = catalogArtistImage(needle, catalog);
    if (portrait) stored.coverUrl = portrait;
    upsertArtist(stored, true);
  }
  stored.name = stored.name || "Artist";

  for (const album of nativeAlbums) {
    const item = nativeAlbumFromSearch(needle, album);
    if (!item.artist) item.artist = stored.name;
    upsertAlbum(item);
  }

  const releaseItems = [
    ...(releases?.albums ?? []),
    ...(releases?.eps ?? []),
    ...(releases?.singles ?? []),
  ];
  for (const release of releaseItems) {
    if (!release.id || !release.title) continue;
    upsertAlbum({
      id: release.id,
      title: release.title,
      artist: stored.name,
      year: release.year ?? null,
      trackCount: null,
      coverUrl: coverArtArchiveUrl(release.id),
      mbid: release.id,
      nativeId: null,
      matchedTrack: null,
      inLibrary: Boolean(release.in_library),
      requested: Boolean(release.requested),
    });
  }

  const albumOrder: StoredAlbum[] = [];
  for (const album of nativeAlbums) {
    const item = albumById.get(album.musicbrainz_release_group_id ?? `native:${album.id}`);
    if (item) albumOrder.push(item);
  }
  for (const release of releaseItems) {
    if (!release.id) continue;
    const item = albumById.get(release.id);
    if (item) albumOrder.push(item);
  }

  stored.albumCount = collectAlbums(albumOrder).length || stored.albumCount;
  artistById.set(stored.id, stored);
  return { artist: serializeArtist(stored), albums: collectAlbums(albumOrder).slice(0, 48) };
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
): Promise<{
  status: string;
  message: string;
  album: PublicAlbum | null;
  watch: IncomingWatch | null;
}> {
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
      const watch: IncomingWatch = {
        key: `track:${input.recordingMbid}`,
        kind: "track",
        id: input.recordingMbid,
        albumId: mbid,
        recordingMbid: input.recordingMbid,
        title: input.title || stored?.title || "Track",
        artist: stored?.artist || "Unknown artist",
        requestedBy: "",
      };
      return {
        status,
        message: describeNeedleRequest(status, result.message),
        album: stored ? serializeAlbum(stored) : null,
        watch,
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
    const watch: IncomingWatch = {
      key: `album:${mbid}`,
      kind: "album",
      id: mbid,
      albumId: mbid,
      title: stored?.title || "Album",
      artist: stored?.artist || "Unknown artist",
      requestedBy: "",
    };
    return {
      status,
      message: describeNeedleRequest(status, result.message),
      album: stored ? serializeAlbum(stored) : null,
      watch,
    };
  } catch (error) {
    throw new Error(droppedNeedleMessage(error));
  }
}

export type IncomingWatch = {
  key: string;
  kind: "album" | "track";
  id: string;
  albumId: string | null;
  recordingMbid?: string;
  title: string;
  artist: string;
  requestedBy: string;
};

export type IncomingRequest = {
  id: string;
  albumId: string | null;
  kind: "album" | "track";
  title: string;
  artist: string;
  status: string;
  statusLabel: string;
  progress: number | null;
  ready: boolean;
  failed: boolean;
  coverUrl: string | null;
  error: string | null;
  requestedBy: string | null;
};

function requestKey(item: { request_kind?: string; musicbrainz_id: string }): string {
  return `${item.request_kind === "track" ? "track" : "album"}:${item.musicbrainz_id}`;
}

function progressPercent(progress: number | null | undefined): number | null {
  if (progress == null || !Number.isFinite(progress)) return null;
  const value = progress <= 1 ? progress * 100 : progress;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function isRequestReady(item: NeedleActiveRequest): boolean {
  if (item.in_library) return true;
  const status = (item.status ?? "").toLowerCase();
  return status === "completed" || status === "already_in_library" || status === "fulfilled";
}

function requestStatusLabel(item: NeedleActiveRequest): string {
  if (isRequestReady(item)) return "Ready";
  const status = (item.download_state || item.download_status || item.status || "").toLowerCase();
  const percent = progressPercent(item.progress);
  const headline = item.status_messages?.[0]?.title?.trim();
  const detail = item.status_messages?.[0]?.messages?.find((line) => line.trim());
  if (status === "awaiting_approval" || status === "pending_approval") return "Needs approval";
  if (status === "searching") return headline || "Searching";
  if (status === "pending" || status === "queued") return headline || "Queued";
  if (status.includes("download")) {
    if (percent != null) return `Downloading ${percent}%`;
    return headline || detail || "Downloading";
  }
  if (status === "processing" || status === "importing") return headline || "Importing";
  if (status === "failed" || status === "error") return "Failed";
  if (status === "cancelled" || status === "rejected") return "Cancelled";
  if (headline) return percent != null ? `${headline} ${percent}%` : headline;
  return item.status || "Requested";
}

function isRequestFailed(item: NeedleActiveRequest): boolean {
  const status = (item.download_state || item.download_status || item.status || "").toLowerCase();
  return status === "failed" || status === "error" || status === "cancelled" || status === "rejected";
}

function serializeIncoming(needle: DroppedNeedleClient, item: NeedleActiveRequest): IncomingRequest {
  const kind = item.request_kind === "track" ? "track" : "album";
  const albumId = kind === "track" ? (item.track_release_group_mbid ?? null) : item.musicbrainz_id;
  const title = kind === "track" ? (item.track_title || item.album_title) : item.album_title;
  const cover =
    needle.resolveUrl(item.cover_url) ??
    coverArtArchiveUrl(albumId ?? (kind === "album" ? item.musicbrainz_id : null));
  return {
    id: item.musicbrainz_id,
    albumId,
    kind,
    title: title || "Untitled",
    artist: item.artist_name || "Unknown artist",
    status: item.status,
    statusLabel: requestStatusLabel(item),
    progress: progressPercent(item.progress),
    ready: isRequestReady(item),
    failed: isRequestFailed(item),
    coverUrl: cover && isPublicCoverUrl(cover) ? cover : coverArtArchiveUrl(albumId),
    error: item.error_message ?? null,
    requestedBy: item.requested_by_name ?? null,
  };
}

export async function listIncomingRequests(needle: DroppedNeedleClient): Promise<{
  active: IncomingRequest[];
  history: IncomingRequest[];
}> {
  const [active, history] = await Promise.all([
    needle.listActiveRequests().catch(() => ({ items: [] as NeedleActiveRequest[] })),
    needle.listRequestHistory(1, 30).catch(() => ({ items: [] as NeedleActiveRequest[] })),
  ]);
  return {
    active: (active.items ?? []).map((item) => serializeIncoming(needle, item)),
    history: (history.items ?? []).map((item) => serializeIncoming(needle, item)),
  };
}

export async function tracksForIncoming(
  needle: DroppedNeedleClient,
  watch: IncomingWatch,
): Promise<PlayableTrack[]> {
  if (watch.kind === "album" && watch.albumId) {
    return getAlbumTracksById(needle, watch.albumId);
  }
  if (watch.albumId) {
    const albumTracks = await getAlbumTracksById(needle, watch.albumId);
    const wanted = watch.title.toLowerCase();
    const match = albumTracks.find((track) => track.title.toLowerCase() === wanted);
    if (match) return [match];
    if (albumTracks.length > 0 && watch.kind === "track") return albumTracks.slice(0, 1);
    if (albumTracks.length > 0) return albumTracks;
  }
  if (!watch.title) return [];
  return findTracks(needle, `${watch.artist} ${watch.title}`.trim(), watch.kind === "track");
}
