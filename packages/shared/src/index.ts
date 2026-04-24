export type SwipeDirection = 'like' | 'pass';

export type Track = {
  id: number;
  title: string;
  artistId: number;
  artistName: string;
  albumTitle: string | null;
  label: string | null;
  genreName: string | null;
  subGenre: string | null;
  releaseYear: number | null;
  previewUrl: string;
  artworkUrl: string;
  durationMs: number | null;
  isrc: string | null;
  bpm: number | null;
  keyCamelot: string | null;
  keyStandard: string | null;
};

export type Swipe = {
  trackId: number;
  direction: SwipeDirection;
  listenedMs: number;
  sessionId: string;
};

export type DeckResponse = {
  tracks: Track[];
};

export type CrateResponse = {
  tracks: Track[];
};

export type DownloadStatus = 'queued' | 'downloading' | 'ready' | 'failed';

export type DownloadState = {
  trackId: number;
  status: DownloadStatus;
  fileSizeBytes: number | null;
  bitrateKbps: number | null;
  error: string | null;
};

export type StreamingLinks = {
  spotify?: string;
  appleMusic?: string;
  youtubeMusic?: string;
  deezer?: string;
  tidal?: string;
  soundcloud?: string;
  bandcamp?: string;
  amazonMusic?: string;
};

export type ApiError = {
  error: string;
  code: string;
  details?: unknown;
};
