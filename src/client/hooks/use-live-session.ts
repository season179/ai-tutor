import { useEffect, useState } from "react";

import { sessionPhases, type SessionPhase } from "../../tutor-action.js";
import { getSession } from "../lib/session-api.js";
import { toTranscriptTurns, type TranscriptTurn } from "../lib/transcript.js";

const initialPhase: SessionPhase = sessionPhases[0];

type UseLiveSessionOptions = {
  activeSessionId: string | undefined;
  eventCount: number;
  ready: boolean;
};

/**
 * The center column's read model. The server owns the phase and the canonical
 * event log, so this hook treats the server as the source of truth: whenever the
 * active session changes or a new event is logged (the `eventCount` pulse), it
 * re-fetches the session detail and projects it into the authoritative phase and
 * transcript the surface renders. Keeping the projection here leaves the existing
 * session/voice/event hooks untouched.
 */
type LiveSessionView = {
  currentPhase: SessionPhase;
  turns: TranscriptTurn[];
};

const emptyView: LiveSessionView = { currentPhase: initialPhase, turns: [] };

export function useLiveSession({
  activeSessionId,
  eventCount,
  ready
}: UseLiveSessionOptions): LiveSessionView {
  // Phase and transcript are one projection of a single fetch, so they live in
  // one state object — they always update together, in a single render.
  const [view, setView] = useState<LiveSessionView>(emptyView);

  // Clear the moment the active session changes so a previous session's
  // conversation never lingers on screen while the next one loads.
  useEffect(() => {
    setView(emptyView);
  }, [activeSessionId]);

  useEffect(() => {
    if (!ready || !activeSessionId) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const detail = await getSession(activeSessionId);
        if (cancelled) {
          return;
        }

        setView({
          currentPhase: detail.session.currentPhase,
          turns: toTranscriptTurns(detail.events)
        });
      } catch {
        // Leave the last-known view in place; the event log surfaces failures.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeSessionId, eventCount, ready]);

  return view;
}
