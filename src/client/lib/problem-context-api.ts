import type {
  ExtractQuestionResponse,
  PreviewUrlResponse,
  UploadUrlResponse
} from "../../modules/problems/problem-context-types.js";
import {
  extractQuestionFn,
  requestPreviewUrlFn,
  requestUploadUrlFn
} from "../../modules/problems/server/problem-fns.js";
import { errorMessage } from "./error-message.js";

export async function requestProblemImageUploadUrl(
  sessionId: string,
  contentType: string,
  bytes: number
): Promise<UploadUrlResponse> {
  try {
    return await requestUploadUrlFn({ data: { bytes, contentType, sessionId } });
  } catch (error) {
    throw new Error(errorMessage(error, "Failed to create upload URL."));
  }
}

export async function uploadProblemImageToR2(
  uploadUrl: string,
  blob: Blob,
  contentType: string
): Promise<void> {
  let response: Response;

  try {
    response = await fetch(uploadUrl, {
      body: blob,
      headers: {
        "Content-Length": String(blob.size),
        "Content-Type": contentType
      },
      method: "PUT"
    });
  } catch (error) {
    throw new Error(
      "Could not upload the image to storage. This is often a bucket CORS issue for direct browser uploads.",
      { cause: error }
    );
  }

  if (!response.ok) {
    throw new Error(`Failed to upload problem image (${response.status}).`);
  }
}

export async function extractProblemQuestion(
  sessionId: string,
  objectKey: string
): Promise<ExtractQuestionResponse> {
  try {
    return await extractQuestionFn({ data: { objectKey, sessionId } });
  } catch (error) {
    throw new Error(errorMessage(error, "Failed to extract question."));
  }
}

export async function requestProblemImagePreviewUrl(
  sessionId: string,
  objectKey: string
): Promise<PreviewUrlResponse> {
  try {
    return await requestPreviewUrlFn({ data: { objectKey, sessionId } });
  } catch (error) {
    throw new Error(errorMessage(error, "Failed to create preview URL."));
  }
}
