import { sessionNotFoundHttpError } from "../../core/http-error.js";
import { initialGateStatus } from "../tutoring/phase-policy.js";
import { problemFrameFromConfirmedPrompt } from "../problems/problem-frame.js";
import {
  parseAppendSessionEventRequest,
  parseCreateTutorSessionRequest,
  parseUpdateTutorSessionRequest
} from "./session-schema.js";
import type { SessionStore } from "./session-store.js";
import {
  toPublicSessionDetail,
  toPublicTutorSessionRecord,
  type PublicTutorSessionDetail,
  type PublicTutorSessionRecord
} from "./session-types.js";
import type { RequestContext } from "../../core/request-context.js";

function requireSessionResult<T>(value: T | null): T {
  if (value === null) {
    throw sessionNotFoundHttpError();
  }

  return value;
}

export async function listSessions(context: RequestContext, store: SessionStore) {
  return store.listSessions(context.ownerKey);
}

export async function createSession(
  body: unknown,
  context: RequestContext,
  store: SessionStore
): Promise<PublicTutorSessionRecord> {
  const request = parseCreateTutorSessionRequest(body);
  return toPublicTutorSessionRecord(await store.createSession(context.ownerKey, request));
}

export async function getSession(
  sessionId: string,
  context: RequestContext,
  store: SessionStore
): Promise<PublicTutorSessionDetail> {
  return toPublicSessionDetail(
    requireSessionResult(await store.getSession(context.ownerKey, sessionId))
  );
}

export async function updateSession(
  sessionId: string,
  body: unknown,
  context: RequestContext,
  store: SessionStore
) {
  const request = parseUpdateTutorSessionRequest(body);
  const confirmedPrompt = request.promptConfirmed === true ? request.imagePrompt?.trim() : "";

  if (confirmedPrompt) {
    const existing = await store.getSession(context.ownerKey, sessionId);
    if (!existing) {
      throw sessionNotFoundHttpError();
    }

    await store.saveProblemContext(context.ownerKey, {
      extractionConfidence: existing.session.extractionOutcome ? "medium" : null,
      extractionOutcome: existing.session.extractionOutcome ?? "extracted",
      frame: problemFrameFromConfirmedPrompt(confirmedPrompt),
      r2ObjectKey: existing.session.imageObjectKey,
      sessionId
    });

    if (existing.session.gateStatus !== "complete") {
      request.gateStatus = initialGateStatus;
    }
  }

  return toPublicTutorSessionRecord(
    requireSessionResult(await store.updateSession(context.ownerKey, sessionId, request))
  );
}

export async function appendSessionEvent(
  sessionId: string,
  body: unknown,
  context: RequestContext,
  store: SessionStore
) {
  const request = parseAppendSessionEventRequest(body);
  try {
    return await store.appendEvent(context.ownerKey, sessionId, request);
  } catch {
    throw sessionNotFoundHttpError();
  }
}
