import {
  studentTurnEventMessage,
  tutorTurnEventMessage,
  type SessionEventRecord
} from "../../session-types.js";

export type TranscriptRole = "coach" | "child";

export type TranscriptTurn = {
  id: number;
  role: TranscriptRole;
  text: string;
};

/**
 * The conversation the child sees is reconstructed from the persisted event log.
 * The server writes a "Student turn" and a "Tutor turn" for every completed turn
 * — synchronously, before the turn response returns — and both carry the spoken
 * text. Those are the transcript's source of truth: they are guaranteed present
 * on a refetch (unlike the client's fire-and-forget "Student transcript"/"Tutor
 * said" log lines) and they never include image-only submissions, which the
 * server records under a different "Problem image submitted" message.
 */
function roleForMessage(message: string): TranscriptRole | null {
  if (message === studentTurnEventMessage) {
    return "child";
  }

  if (message === tutorTurnEventMessage) {
    return "coach";
  }

  return null;
}

function turnTextFromValue(value: unknown): string {
  if (value && typeof value === "object" && "text" in value) {
    const { text } = value as { text?: unknown };
    if (typeof text === "string") {
      return text.trim();
    }
  }

  return "";
}

export function toTranscriptTurns(events: SessionEventRecord[]): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];

  // The store returns events newest-first; the transcript reads oldest-first.
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    const role = roleForMessage(event.message);
    if (!role) {
      continue;
    }

    const text = turnTextFromValue(event.value);
    if (!text) {
      continue;
    }

    turns.push({ id: event.id, role, text });
  }

  return turns;
}
