CREATE TABLE problem_contexts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES tutor_sessions(id) ON DELETE CASCADE,
  r2_object_key TEXT,
  extracted_text TEXT NOT NULL DEFAULT '',
  confirmed_question TEXT,
  extraction_outcome TEXT NOT NULL,
  extraction_confidence TEXT,
  problem_type TEXT,
  skill_keys_json TEXT,
  quantities_json TEXT,
  relationships_json TEXT,
  unknown_target TEXT,
  diagram_description TEXT,
  task_language TEXT,
  language_is_subject INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX problem_contexts_session_id_idx ON problem_contexts(session_id);
