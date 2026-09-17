import type {
  CatalogSearchResponse,
  CrateTrack,
  DroppedNeedleUser,
  HealthResponse,
  LocalAlbumSummary,
  LocalSearchResponse,
  LocalTrackInfo,
  NativeLibraryAlbum,
  NativeLibraryAlbumsResponse,
  NativeLibraryTrack,
  NativeLibraryTracksResponse,
  PlayableTrack,
  ResolvedTrack,
} from "./types.js";

type AuthMode =
  | { kind: "token"; token: string }
  | { kind: "password"; username: string; password: string };

export class DroppedNeedleError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "DroppedNeedleError";
  }
}

export class DroppedNeedleClient {
  private token: string | undefined;
  private readonly auth: AuthMode;

  constructor(
    private readonly baseUrl: string,
    auth: { token?: string; username?: string; password?: string },
  ) {
    if (auth.token) {
      this.auth = { kind: "token", token: auth.token };
      this.token = auth.token;
    } else if (auth.username && auth.password) {
      this.auth = { kind: "password", username: auth.username, password: auth.password };
    } else {
      throw new Error("DroppedNeedle auth requires a token or username/password");
    }
  }

  async connect(): Promise<DroppedNeedleUser> {
    const health = await this.health();
    if (health.status !== "ok") {
      throw new DroppedNeedleError(`DroppedNeedle health check failed: ${health.message ?? health.status}`);
    }

    if (this.auth.kind === "password") {
      await this.login(this.auth.username, this.auth.password);
    }

    return this.me();
  }

  async health(): Promise<HealthResponse> {
    const response = await fetch(`${this.baseUrl}/health`);
    if (!response.ok) {
      throw new DroppedNeedleError(`Health check HTTP ${response.status}`, response.status);
    }
    return (await response.json()) as HealthResponse;
  }

  async me(): Promise<DroppedNeedleUser> {
    return this.requestJson<DroppedNeedleUser>("/api/v1/auth/me");
  }

  async searchLibrary(query: string): Promise<LocalSearchResponse> {
    const params = new URLSearchParams({ q: query });
    return this.requestJson<LocalSearchResponse>(`/api/v1/local/search?${params}`);
  }

  async searchCatalog(query: string): Promise<CatalogSearchResponse> {
    const params = new URLSearchParams({
      q: query,
      limit_artists: "5",
      limit_albums: "8",
    });
    return this.requestJson<CatalogSearchResponse>(`/api/v1/search?${params}`);
  }

  async getAlbumTracks(mbid: string): Promise<LocalTrackInfo[]> {
    const encoded = encodeURIComponent(mbid);
    const payload = await this.requestJson<LocalTrackInfo[] | { items?: LocalTrackInfo[] }>(
      `/api/v1/local/albums/${encoded}/tracks`,
    );
    return Array.isArray(payload) ? payload : (payload.items ?? []);
  }

  async searchNativeTracks(query: string, limit = 15): Promise<NativeLibraryTrack[]> {
    const params = new URLSearchParams({
      q: query,
      limit: String(limit),
      offset: "0",
      sort: "recent",
    });
    const payload = await this.requestJson<NativeLibraryTracksResponse>(`/api/v1/library/tracks?${params}`);
    return payload.items ?? [];
  }

  async searchNativeAlbums(query: string): Promise<NativeLibraryAlbum[]> {
    const params = new URLSearchParams({ q: query, page: "1", page_size: "8", sort: "recent" });
    const payload = await this.requestJson<NativeLibraryAlbumsResponse>(`/api/v1/library/albums?${params}`);
    return payload.items ?? [];
  }

  async getNativeAlbumTracks(albumId: string): Promise<NativeLibraryTrack[]> {
    const payload = await this.requestJson<NativeLibraryTracksResponse>(
      `/api/v1/library/albums/${encodeURIComponent(albumId)}/tracks`,
    );
    return payload.items ?? [];
  }

  async resolveTracks(tracks: NativeLibraryTrack[]): Promise<ResolvedTrack[]> {
    const payload = await this.requestJson<{ items?: ResolvedTrack[] }>("/api/v1/library/resolve-tracks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tracks: tracks.map((track) => ({
          release_group_mbid: track.musicbrainz_release_group_id,
          disc_number: track.disc_number ?? 1,
          track_number: track.track_number,
        })),
      }),
    });
    return payload.items ?? [];
  }

  streamUrl(fileId: string): string {
    return `${this.baseUrl}/api/v1/stream/local/${encodeURIComponent(fileId)}`;
  }

  resolveUrl(maybeRelative: string | null | undefined): string | null {
    if (!maybeRelative) return null;
    try {
      return new URL(maybeRelative, `${this.baseUrl}/`).toString();
    } catch {
      return null;
    }
  }

  async openStream(track: PlayableTrack): Promise<ReadableStream<Uint8Array>> {
    const url = track.streamUrl ?? this.streamUrl(track.fileId);
    const response = await this.request(url, { method: "GET" }, true);
    if (!response.body) {
      throw new DroppedNeedleError("DroppedNeedle returned an empty audio stream");
    }
    return response.body;
  }

  toPlayable(track: CrateTrack): PlayableTrack {
    return {
      fileId: track.track_file_id,
      title: track.title,
      artist: track.artist_name,
      album: track.album_name,
      durationSeconds: track.duration_seconds ?? null,
      coverUrl: this.resolveUrl(track.cover_url),
      albumMbid: track.album_mbid ?? null,
      streamUrl: this.streamUrl(track.track_file_id),
    };
  }

  albumToPlayable(album: LocalAlbumSummary, track: LocalTrackInfo): PlayableTrack {
    return {
      fileId: track.track_file_id,
      title: track.title,
      artist: album.artist_name,
      album: album.name,
      durationSeconds: track.duration_seconds ?? null,
      coverUrl: this.resolveUrl(album.cover_url),
      albumMbid: album.musicbrainz_id,
      streamUrl: this.streamUrl(track.track_file_id),
    };
  }

  nativeToPlayable(track: NativeLibraryTrack, resolved?: ResolvedTrack): PlayableTrack | null {
    const fileId = resolved?.track_source_id ?? track.id;
    const resolvedStream = this.resolveUrl(resolved?.stream_url);
    const streamUrl = resolvedStream ?? this.streamUrl(fileId);
    return {
      fileId,
      title: track.title,
      artist: track.artist_name,
      album: track.album_title,
      durationSeconds: resolved?.duration ?? track.duration_seconds ?? null,
      coverUrl: track.cover_available
        ? `${this.baseUrl}/api/v1/library/albums/${encodeURIComponent(track.album_id)}/artwork/cached`
        : null,
      albumMbid: track.musicbrainz_release_group_id ?? null,
      streamUrl,
    };
  }

  async playableFromNative(tracks: NativeLibraryTrack[]): Promise<PlayableTrack[]> {
    if (tracks.length === 0) return [];
    let resolved: ResolvedTrack[] = [];
    try {
      resolved = await this.resolveTracks(tracks);
    } catch (error) {
      console.warn("[rou] resolve-tracks failed, using local stream fallback:", error);
    }
    const playable: PlayableTrack[] = [];
    for (const [index, track] of tracks.entries()) {
      const match =
        resolved.find(
          (item) =>
            item.release_group_mbid === track.musicbrainz_release_group_id &&
            (item.track_number ?? track.track_number) === track.track_number &&
            (item.disc_number ?? track.disc_number ?? 1) === (track.disc_number ?? 1),
        ) ?? resolved[index];
      const converted = this.nativeToPlayable(track, match);
      if (converted) playable.push(converted);
    }
    return playable;
  }

  private async login(username: string, password: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "RouDiscordBot/0.1",
      },
      body: JSON.stringify({ username, password }),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new DroppedNeedleError(`DroppedNeedle login failed (${response.status})`, response.status, body);
    }
    const parsed = JSON.parse(body) as { token?: string };
    if (!parsed.token) {
      throw new DroppedNeedleError("DroppedNeedle login did not return a token", response.status, body);
    }
    this.token = parsed.token;
  }

  private async requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.request(`${this.baseUrl}${path}`, init);
    const text = await response.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }

  private async request(url: string, init?: RequestInit, isStream = false): Promise<Response> {
    const send = async (): Promise<Response> => {
      if (!this.token && this.auth.kind === "password") {
        await this.login(this.auth.username, this.auth.password);
      }
      if (!this.token) {
        throw new DroppedNeedleError("DroppedNeedle client has no bearer token");
      }
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${this.token}`);
      headers.set("User-Agent", "RouDiscordBot/0.1");
      if (!isStream && !headers.has("Accept")) {
        headers.set("Accept", "application/json");
      }
      return fetch(url, { ...init, headers });
    };

    let response = await send();
    if (response.status === 401 && this.auth.kind === "password") {
      this.token = undefined;
      await this.login(this.auth.username, this.auth.password);
      response = await send();
    }
    if (!response.ok) {
      const body = isStream ? undefined : await response.text().catch(() => undefined);
      throw new DroppedNeedleError(
        `DroppedNeedle ${init?.method ?? "GET"} ${url} failed (${response.status})`,
        response.status,
        body,
      );
    }
    return response;
  }
}
