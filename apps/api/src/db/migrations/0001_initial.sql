-- CrateSwipe initial schema (see §7 of CRATESWIPE_BRIEF.md)

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE TABLE tracks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  artist_id INTEGER NOT NULL,
  artist_name TEXT NOT NULL,
  album_id INTEGER,
  album_title TEXT,
  label TEXT,
  genre_id INTEGER,
  genre_name TEXT,
  sub_genre TEXT,
  release_year INTEGER,
  preview_url TEXT NOT NULL,
  artwork_url TEXT NOT NULL,
  duration_ms INTEGER,
  isrc TEXT,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE bpm_cache (
  track_id INTEGER PRIMARY KEY REFERENCES tracks(id),
  bpm INTEGER,
  key_camelot TEXT,
  key_standard TEXT,
  source TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE odesli_cache (
  track_id INTEGER PRIMARY KEY REFERENCES tracks(id),
  links_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE swipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  track_id INTEGER NOT NULL REFERENCES tracks(id),
  direction TEXT NOT NULL CHECK (direction IN ('like', 'pass')),
  listened_ms INTEGER NOT NULL DEFAULT 0,
  session_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, track_id)
);

CREATE TABLE crates (
  user_id INTEGER NOT NULL REFERENCES users(id),
  track_id INTEGER NOT NULL REFERENCES tracks(id),
  liked_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, track_id)
);

CREATE TABLE affinities (
  user_id INTEGER NOT NULL REFERENCES users(id),
  dimension TEXT NOT NULL,
  key TEXT NOT NULL,
  score REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, dimension, key)
);

CREATE TABLE candidates (
  user_id INTEGER NOT NULL REFERENCES users(id),
  track_id INTEGER NOT NULL REFERENCES tracks(id),
  score REAL NOT NULL,
  source TEXT NOT NULL,
  generated_at INTEGER NOT NULL,
  served_at INTEGER,
  PRIMARY KEY (user_id, track_id)
);

CREATE TABLE downloads (
  track_id INTEGER PRIMARY KEY REFERENCES tracks(id),
  status TEXT NOT NULL CHECK (status IN ('queued', 'downloading', 'ready', 'failed')),
  file_path TEXT,
  file_size_bytes INTEGER,
  bitrate_kbps INTEGER,
  error TEXT,
  started_at INTEGER,
  finished_at INTEGER
);

CREATE INDEX idx_swipes_user ON swipes(user_id, created_at DESC);
CREATE INDEX idx_affinities_user_dim ON affinities(user_id, dimension, score DESC);
CREATE INDEX idx_candidates_user_score ON candidates(user_id, score DESC);
