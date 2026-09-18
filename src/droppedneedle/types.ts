export type DroppedNeedleUser = {
  id: string;
  display_name: string;
  role: string;
  username?: string | null;
};

export type CrateTrack = {
  track_file_id: string;
  title: string;
  album_name: string;
  artist_name: string;
  album_mbid?: string | null;
  cover_url?: string | null;
  format?: string;
  year?: number | null;
  duration_seconds?: number | null;
  reason?: string;
};

export type LocalAlbumSummary = {
  musicbrainz_id: string;
  name: string;
  artist_name: string;
  artist_mbid?: string | null;
  year?: number | null;
  track_count?: number;
  cover_url?: string | null;
};

export type LocalSearchResponse = {
  albums?: LocalAlbumSummary[];
  tracks?: CrateTrack[];
};

export type LocalTrackInfo = {
  track_file_id: string;
  title: string;
  track_number: number;
  disc_number?: number;
  duration_seconds?: number | null;
  format?: string;
};

export type CatalogSearchResult = {
  type: string;
  title: string;
  musicbrainz_id: string;
  artist?: string | null;
  year?: number | null;
  in_library?: boolean;
  requested?: boolean;
  cover_url?: string | null;
  album_thumb_url?: string | null;
  thumb_url?: string | null;
  fanart_url?: string | null;
  banner_url?: string | null;
  disambiguation?: string | null;
  score?: number;
};

export type CatalogAlbumBasic = {
  title: string;
  musicbrainz_id: string;
  artist_name: string;
  year?: number | null;
  in_library?: boolean;
  requested?: boolean;
  cover_url?: string | null;
  album_thumb_url?: string | null;
};

export type CatalogAlbumTrack = {
  position: number;
  title: string;
  disc_number?: number;
  length?: number | null;
  recording_id?: string | null;
};

export type CatalogAlbumTracks = {
  tracks?: CatalogAlbumTrack[];
  total_tracks?: number;
};

export type AlbumRequestResponse = {
  success?: boolean;
  message?: string;
  musicbrainz_id?: string;
  status?: string;
};

export type TrackRequestResponse = {
  status?: string;
  task_id?: string | null;
  message?: string;
};

export type NeedleActiveRequest = {
  musicbrainz_id: string;
  artist_name: string;
  album_title: string;
  status: string;
  year?: number | null;
  cover_url?: string | null;
  progress?: number | null;
  download_status?: string | null;
  download_state?: string | null;
  error_message?: string | null;
  request_kind?: string;
  track_title?: string | null;
  track_release_group_mbid?: string | null;
  in_library?: boolean;
  requested_by_name?: string | null;
  eta?: string | null;
  status_messages?: { title?: string | null; messages?: string[] }[] | null;
};

export type NeedleRequestHistoryItem = NeedleActiveRequest & {
  completed_at?: string | null;
  in_library?: boolean;
};

export type NeedleActiveRequestsResponse = {
  items?: NeedleActiveRequest[];
  count?: number;
};

export type NeedleRequestHistoryResponse = {
  items?: NeedleRequestHistoryItem[];
  total?: number;
};

export type CatalogSearchResponse = {
  artists?: CatalogSearchResult[];
  albums?: CatalogSearchResult[];
  top_artist?: CatalogSearchResult | null;
  top_album?: CatalogSearchResult | null;
};

export type CatalogArtistInfo = {
  name: string;
  musicbrainz_id: string;
  disambiguation?: string | null;
  image?: string | null;
  fanart_url?: string | null;
  thumb_url?: string | null;
};

export type ArtistReleaseItem = {
  id?: string | null;
  title?: string | null;
  type?: string | null;
  year?: number | null;
  in_library?: boolean;
  requested?: boolean;
};

export type ArtistReleases = {
  albums?: ArtistReleaseItem[];
  singles?: ArtistReleaseItem[];
  eps?: ArtistReleaseItem[];
};

export type HealthResponse = {
  status: string;
  message?: string;
};

export type NativeLibraryTrack = {
  id: string;
  title: string;
  album_id: string;
  album_title: string;
  artist_name: string;
  musicbrainz_release_group_id?: string | null;
  disc_number?: number;
  track_number?: number;
  duration_seconds?: number;
  cover_available?: boolean;
};

export type NativeLibraryTracksResponse = {
  items?: NativeLibraryTrack[];
  total?: number;
};

export type NativeLibraryAlbum = {
  id: string;
  title: string;
  artist_name: string;
  musicbrainz_release_group_id?: string | null;
  cover_available?: boolean;
  track_count?: number;
};

export type NativeLibraryArtist = {
  id: string;
  name: string;
  musicbrainz_artist_id?: string | null;
  album_count?: number;
  track_count?: number;
};

export type NativeLibraryArtistsResponse = {
  items?: NativeLibraryArtist[];
  total?: number;
};

export type NativeLibraryAlbumsResponse = {
  items?: NativeLibraryAlbum[];
  total?: number;
};

export type ResolvedTrack = {
  release_group_mbid?: string | null;
  disc_number?: number | null;
  track_number?: number | null;
  source?: string | null;
  track_source_id?: string | null;
  stream_url?: string | null;
  format?: string | null;
  duration?: number | null;
};

export type PlayableTrack = {
  fileId: string;
  title: string;
  artist: string;
  album: string;
  durationSeconds: number | null;
  coverUrl: string | null;
  albumMbid: string | null;
  streamUrl: string | null;
  trackNumber?: number | null;
};
