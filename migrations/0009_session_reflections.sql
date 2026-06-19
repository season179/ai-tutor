CREATE TABLE session_reflections (
  session_id TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL,
  reflection_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
