CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL,
  num_players INTEGER NOT NULL,
  target_score INTEGER NOT NULL,
  hands_played INTEGER NOT NULL,
  finished_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS match_players (
  match_id TEXT NOT NULL REFERENCES matches(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  team INTEGER NOT NULL,
  score INTEGER NOT NULL,
  won INTEGER NOT NULL,
  PRIMARY KEY (match_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_mp_player ON match_players(player_id);
CREATE INDEX IF NOT EXISTS idx_matches_finished ON matches(finished_at);
