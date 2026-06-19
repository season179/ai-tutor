-- One row per Three Reads comprehension check (M3). The accumulating gate status on
-- tutor_sessions is what gates solving and lets a child resume mid-gate; this table is the
-- per-read audit trail: which read, what the child said, and whether it was accepted.
CREATE TABLE comprehension_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES tutor_sessions(id) ON DELETE CASCADE,
  check_kind TEXT NOT NULL,
  student_response TEXT NOT NULL,
  accepted INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX comprehension_checks_session_id_idx ON comprehension_checks(session_id, created_at);
