import type {
  AppendSessionEventRequest,
  ComprehensionCheckRecord,
  CreateTutorSessionRequest,
  SessionEventRecord,
  SessionReflectionRecord,
  TutorSessionDetail,
  TutorSessionRecord,
  TutorSessionSummary,
  UpdateTutorSessionRequest
} from "./session-types.js";
import type { ExtractionOutcome } from "./problem-context/problem-context-types.js";
import type { ProblemContextRecord, ProblemFrame } from "./problem-context/problem-frame.js";
import type { ActiveStep } from "./active-step.js";
import type { ComprehensionGateStatus, SessionPhase, SupportLevel } from "./tutor-action.js";

export type SaveProblemContextRequest = {
  confirmedQuestion?: string | null;
  extractionConfidence: "high" | "low" | "medium" | null;
  extractionOutcome: ExtractionOutcome;
  frame: ProblemFrame;
  r2ObjectKey?: string | null;
  sessionId: string;
};

/** The server-owned phase state a tutoring turn advances to. */
export type SessionPhaseAdvance = {
  activeStep: ActiveStep | null;
  currentPhase: SessionPhase;
  gateStatus: ComprehensionGateStatus | null;
  supportLevel: SupportLevel;
};

export type SaveReflectionRequest = {
  reflectionText: string;
  sessionId: string;
};

export type AppendComprehensionCheckRequest = {
  accepted: boolean;
  checkKind: string;
  studentResponse: string;
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
  appendComprehensionCheck(
    ownerKey: string,
    sessionId: string,
    request: AppendComprehensionCheckRequest
  ): Promise<void>;
  appendEvent(ownerKey: string, sessionId: string, request: AppendSessionEventRequest): Promise<SessionEventRecord>;
  createSession(ownerKey: string, request?: CreateTutorSessionRequest): Promise<TutorSessionRecord>;
  listComprehensionChecks(ownerKey: string, sessionId: string): Promise<ComprehensionCheckRecord[]>;
  getProblemContext(ownerKey: string, sessionId: string): Promise<ProblemContextRecord | null>;
  getSession(ownerKey: string, sessionId: string): Promise<TutorSessionDetail | null>;
  listSessions(ownerKey: string): Promise<TutorSessionSummary[]>;
  saveProblemContext(ownerKey: string, request: SaveProblemContextRequest): Promise<ProblemContextRecord>;
  saveReflection(ownerKey: string, request: SaveReflectionRequest): Promise<SessionReflectionRecord>;
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
