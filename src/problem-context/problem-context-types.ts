export const problemContextUploadUrlPath = "/api/problem-context/upload-url";
export const problemContextExtractQuestionPath = "/api/problem-context/extract-question";
export const problemContextPreviewUrlPath = "/api/problem-context/preview-url";

export const maxProblemImageBytes = 5_000_000;

export type ProblemImageMeta = {
  bytes: number;
  contentType: string;
  height: number;
  objectKey: string;
  width: number;
};

export type UploadUrlRequest = {
  bytes: number;
  contentType: string;
  sessionId: string;
};

export type UploadUrlResponse = {
  expiresAt: string;
  objectKey: string;
  uploadUrl: string;
};

export type ExtractQuestionRequest = {
  objectKey: string;
  sessionId: string;
};

export type ExtractQuestionResponse = {
  confidence: "high" | "low" | "medium";
  notes: string | null;
  question: string;
};

export type PreviewUrlRequest = {
  objectKey: string;
  sessionId: string;
};

export type PreviewUrlResponse = {
  expiresAt: string;
  url: string;
};

export type ExtractedQuestion = ExtractQuestionResponse;
