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
};

export type CatalogSearchResponse = {
  artists?: CatalogSearchResult[];
  albums?: CatalogSearchResult[];
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
};
