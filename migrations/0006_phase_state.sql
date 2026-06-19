ALTER TABLE tutor_sessions ADD COLUMN current_phase TEXT NOT NULL DEFAULT 'session_open';
ALTER TABLE tutor_sessions ADD COLUMN gate_status TEXT;
ALTER TABLE tutor_sessions ADD COLUMN current_support_level INTEGER NOT NULL DEFAULT 0;
