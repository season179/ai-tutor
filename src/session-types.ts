export const sessionsPath = "/api/sessions";

export const maxSessionEvents = 200;

export type TutorSessionStatus = "draft" | "active" | "ended";

export type SessionImageMeta = {
  bytes: number;
  height: number;
  width: number;
};

export type TutorSessionSummary = {
  createdAt: string;
  id: string;
  status: TutorSessionStatus;
  title: string;
  updatedAt: string;
};

export type TutorSessionRecord = TutorSessionSummary & {
  imageMeta: SessionImageMeta | null;
  imageName: string | null;
  imagePrompt: string | null;
  ownerKey: string;
};

export type SessionEventRecord = {
  createdAt: string;
  id: number;
  message: string;
  sessionId: string;
  value: unknown;
};

export type TutorSessionDetail = {
  events: SessionEventRecord[];
  session: TutorSessionRecord;
};

export type CreateTutorSessionRequest = {
  title?: string;
};

export type UpdateTutorSessionRequest = {
  imageMeta?: SessionImageMeta | null;
  imageName?: string | null;
  imagePrompt?: string | null;
  status?: TutorSessionStatus;
  title?: string;
};

export type AppendSessionEventRequest = {
  message: string;
  value?: unknown;
};

export function toTutorSessionSummary(session: TutorSessionRecord): TutorSessionSummary {
  return {
    createdAt: session.createdAt,
    id: session.id,
    status: session.status,
    title: session.title,
    updatedAt: session.updatedAt
  };
}

export function applyTutorSessionUpdate(
  session: TutorSessionRecord,
  request: UpdateTutorSessionRequest,
  updatedAt: string
): TutorSessionRecord {
  return {
    ...session,
    imageMeta: request.imageMeta !== undefined ? request.imageMeta : session.imageMeta,
    imageName: request.imageName !== undefined ? request.imageName : session.imageName,
    imagePrompt: request.imagePrompt !== undefined ? request.imagePrompt : session.imagePrompt,
    status: request.status !== undefined ? request.status : session.status,
    title: request.title !== undefined ? request.title.trim() : session.title,
    updatedAt
  };
}
