import {
  appendSessionEventFn,
  createSessionFn,
  getSessionFn,
  listSessionsFn,
  updateSessionFn
} from "../../modules/sessions/server/session-fns.js";
import type {
  AppendSessionEventRequest,
  PublicTutorSessionDetail,
  PublicTutorSessionRecord,
  TutorSessionSummary,
  UpdateTutorSessionRequest
} from "../../modules/sessions/session-types.js";
import { errorMessage } from "./error-message.js";

export class SessionApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

// Server-function rejections deserialize (via Seroval) with their own properties
// intact but not as `SessionApiError` instances, so normalize every failure back to
// the `{ status, message }` shape the hooks branch on. The session endpoints only
// ever throw 401 (no session) or 404 (not owned) — never 403 — so callers that
// special-case 403 behave identically even when a status can't be recovered.
function toSessionApiError(error: unknown): SessionApiError {
  if (error instanceof SessionApiError) {
    return error;
  }

  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
      ? (error as { status: number }).status
      : 0;

  return new SessionApiError(status, errorMessage(error, "Request failed."));
}

export async function listSessions(): Promise<TutorSessionSummary[]> {
  try {
    return await listSessionsFn();
  } catch (error) {
    throw toSessionApiError(error);
  }
}

export async function createSession(title?: string): Promise<PublicTutorSessionRecord> {
  try {
    return await createSessionFn({ data: title ? { title } : {} });
  } catch (error) {
    throw toSessionApiError(error);
  }
}

export async function getSession(sessionId: string): Promise<PublicTutorSessionDetail> {
  try {
    return await getSessionFn({ data: { sessionId } });
  } catch (error) {
    throw toSessionApiError(error);
  }
}

export async function updateSession(
  sessionId: string,
  request: UpdateTutorSessionRequest
): Promise<PublicTutorSessionRecord> {
  try {
    return await updateSessionFn({ data: { request, sessionId } });
  } catch (error) {
    throw toSessionApiError(error);
  }
}

export async function appendSessionEvent(
  sessionId: string,
  request: AppendSessionEventRequest
): Promise<void> {
  try {
    await appendSessionEventFn({ data: { request, sessionId } });
  } catch (error) {
    throw toSessionApiError(error);
  }
}
