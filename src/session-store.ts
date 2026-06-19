import type {
  AppendSessionEventRequest,
  CreateTutorSessionRequest,
  SessionEventRecord,
  TutorSessionDetail,
  TutorSessionRecord,
  TutorSessionSummary,
  UpdateTutorSessionRequest
} from "./session-types.js";
import type { ComprehensionGateStatus, SessionPhase, SupportLevel } from "./tutor-action.js";

/** The server-owned phase state a tutoring turn advances to. */
export type SessionPhaseAdvance = {
  currentPhase: SessionPhase;
  gateStatus: ComprehensionGateStatus | null;
  supportLevel: SupportLevel;
};

export type SessionStore = {
  /**
   * Advance the authoritative phase state, guarded by an optimistic lock on the
   * expected current phase. Returns the updated record, or null if the session is
   * gone or another writer already moved it off `expectedPhase` (a lost race).
   */
  advanceSessionPhase(
    ownerKey: string,
    sessionId: string,
    expectedPhase: SessionPhase,
    advance: SessionPhaseAdvance
  ): Promise<TutorSessionRecord | null>;
  appendEvent(ownerKey: string, sessionId: string, request: AppendSessionEventRequest): Promise<SessionEventRecord>;
  createSession(ownerKey: string, request?: CreateTutorSessionRequest): Promise<TutorSessionRecord>;
  getSession(ownerKey: string, sessionId: string): Promise<TutorSessionDetail | null>;
  listSessions(ownerKey: string): Promise<TutorSessionSummary[]>;
  sessionExists(ownerKey: string, sessionId: string): Promise<boolean>;
  transferOwnerSessions(fromOwnerKey: string, toOwnerKey: string): Promise<number>;
  updateSession(
    ownerKey: string,
    sessionId: string,
    request: UpdateTutorSessionRequest
  ): Promise<TutorSessionRecord | null>;
};

export function sessionStoreNotFoundError(): Error {
  return new Error("Session not found");
}
