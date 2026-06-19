import { useCallback, useRef, useState } from "react";

import type { SessionImageMeta } from "../../session-types.js";
import { maxProblemImageBytes } from "../../problem-context/problem-context-types.js";
import { errorLogValue, errorMessage } from "../lib/error-message.js";
import {
  describePreparedImage,
  prepareImage,
  preparedImageMimeType,
  type PreparedImage
} from "../lib/image-preparation.js";
import {
  extractProblemQuestion,
  requestProblemImagePreviewUrl,
  requestProblemImageUploadUrl,
  uploadProblemImageToR2
} from "../lib/problem-context-api.js";
import { updateSession } from "../lib/session-api.js";
import type { LoadedSessionContext, StatusTone } from "../types.js";
import { defaultImagePrompt } from "../types.js";

const noProblemImageMessage = "No problem image yet.";

export type UploadStatus = "failed" | "idle" | "uploaded" | "uploading";
export type ExtractionStatus = "extracting" | "failed" | "idle" | "ready";

type UseProblemContextStep1Options = {
  activeSessionId: string | undefined;
  logEvent: (message: string, value?: unknown, persistSessionId?: string) => void;
  setStatus: (message: string, tone?: StatusTone) => void;
};

function describeImageMeta(image: PreparedImage): SessionImageMeta {
  return {
    bytes: image.size,
    height: image.height,
    width: image.width
  };
}

function formatStoredImageMeta(meta: SessionImageMeta | null, name: string | null): string {
  if (!meta) {
    return noProblemImageMessage;
  }

  const label = name ? `${name} · ` : "";
  return `${label}${meta.width}×${meta.height} · ${meta.bytes.toLocaleString()} bytes`;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const commaIndex = dataUrl.indexOf(",");

  if (!dataUrl.startsWith("data:") || commaIndex < 0) {
    throw new Error("Prepared image data URL was invalid.");
  }

  const metadata = dataUrl.slice("data:".length, commaIndex);
  const mimeType = metadata.split(";")[0] || preparedImageMimeType;
  const binary = atob(dataUrl.slice(commaIndex + 1));
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

function extractionStatusHint(status: ExtractionStatus, error: string | null): string | null {
  switch (status) {
    case "extracting":
      return "Extracting question…";
    case "ready":
      return "Review and edit if needed.";
    case "failed":
      return error ?? "Could not extract the question.";
    default:
      return null;
  }
}

export function useProblemContextStep1({
  activeSessionId,
  logEvent,
  setStatus
}: UseProblemContextStep1Options) {
  const [preparedImage, setPreparedImage] = useState<PreparedImage | undefined>(undefined);
  const [selectedImageFile, setSelectedImageFile] = useState<File | undefined>(undefined);
  const [objectKey, setObjectKey] = useState<string | undefined>(undefined);
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(undefined);
  const [imageMeta, setImageMeta] = useState(noProblemImageMessage);
  const [emptyMessage, setEmptyMessage] = useState(noProblemImageMessage);
  const [imagePrompt, setImagePrompt] = useState(defaultImagePrompt);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [extractionStatus, setExtractionStatus] = useState<ExtractionStatus>("idle");
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const workflowIdRef = useRef(0);
  const promptPersistTimeoutRef = useRef<number | undefined>(undefined);

  const persistContext = useCallback(
    async (
      image: PreparedImage | undefined,
      prompt: string,
      nextObjectKey: string | null | undefined
    ) => {
      if (!activeSessionId) {
        return;
      }

      await updateSession(activeSessionId, {
        imageMeta: image ? describeImageMeta(image) : null,
        imageName: image?.name ?? null,
        imageObjectKey: nextObjectKey ?? null,
        imagePrompt: prompt
      });
    },
    [activeSessionId]
  );

  const setPreparedImageFromSend = useCallback((image: PreparedImage) => {
    setPreparedImage(image);
    setImageMeta(describePreparedImage(image));
  }, []);

  const resetStep1 = useCallback(() => {
    workflowIdRef.current += 1;
    setPreparedImage(undefined);
    setSelectedImageFile(undefined);
    setObjectKey(undefined);
    setPreviewUrl(undefined);
    setImageMeta(noProblemImageMessage);
    setEmptyMessage(noProblemImageMessage);
    setImagePrompt(defaultImagePrompt);
    setUploadStatus("idle");
    setExtractionStatus("idle");
    setExtractionError(null);
    setIsBusy(false);
  }, []);

  const loadPreviewForObjectKey = useCallback(
    async (sessionId: string, nextObjectKey: string, workflowId: number) => {
      const preview = await requestProblemImagePreviewUrl(sessionId, nextObjectKey);

      if (workflowId !== workflowIdRef.current) {
        return;
      }

      setPreviewUrl(preview.url);
    },
    []
  );

  const runExtraction = useCallback(
    async (
      sessionId: string,
      nextObjectKey: string,
      workflowId: number,
      image: PreparedImage | undefined,
      _currentPrompt: string
    ) => {
      setExtractionStatus("extracting");
      setExtractionError(null);

      try {
        const result = await extractProblemQuestion(sessionId, nextObjectKey);

        if (workflowId !== workflowIdRef.current) {
          return;
        }

        const nextPrompt = result.question || defaultImagePrompt;
        setImagePrompt(nextPrompt);
        setExtractionStatus("ready");
        setStatus("Question extracted. Review it before continuing.", "ready");
        logEvent("Question extracted", {
          confidence: result.confidence,
          notes: result.notes,
          objectKey: nextObjectKey
        });

        if (image) {
          await persistContext(image, nextPrompt, nextObjectKey);
        } else {
          await persistContext(undefined, nextPrompt, nextObjectKey);
        }
      } catch (error) {
        if (workflowId !== workflowIdRef.current) {
          return;
        }

        const message = errorMessage(error, "Could not extract the question.");
        setExtractionStatus("failed");
        setExtractionError(message);
        setStatus(message, "error");
        logEvent("Question extraction failed", errorLogValue(error));
      }
    },
    [logEvent, persistContext, setStatus]
  );

  const uploadAndExtract = useCallback(
    async (file: File) => {
      if (!activeSessionId) {
        throw new Error("Choose or create a session first.");
      }

      const workflowId = ++workflowIdRef.current;
      setIsBusy(true);
      setUploadStatus("uploading");
      setExtractionStatus("idle");
      setExtractionError(null);
      setEmptyMessage("Preparing problem image...");
      setImageMeta("Preparing problem image...");
      setPreviewUrl(undefined);
      setPreparedImage(undefined);
      setSelectedImageFile(undefined);
      setObjectKey(undefined);

      try {
        setSelectedImageFile(file);
        const image = await prepareImage(file, maxProblemImageBytes);

        if (workflowId !== workflowIdRef.current) {
          return;
        }

        setPreparedImage(image);
        setImageMeta("Uploading problem image...");
        setEmptyMessage("Uploading problem image...");

        let upload;
        try {
          upload = await requestProblemImageUploadUrl(
            activeSessionId,
            preparedImageMimeType,
            image.size
          );
        } catch (error) {
          logEvent("Problem image upload URL failed", errorLogValue(error));
          throw error;
        }

        if (workflowId !== workflowIdRef.current) {
          return;
        }

        try {
          await uploadProblemImageToR2(
            upload.uploadUrl,
            dataUrlToBlob(image.dataUrl),
            preparedImageMimeType
          );
        } catch (error) {
          logEvent("Problem image R2 upload failed", errorLogValue(error));
          throw error;
        }

        if (workflowId !== workflowIdRef.current) {
          return;
        }

        setObjectKey(upload.objectKey);
        setUploadStatus("uploaded");
        setImageMeta(describePreparedImage(image));
        setPreviewUrl(image.dataUrl);
        logEvent("Problem image uploaded", {
          bytes: image.size,
          height: image.height,
          objectKey: upload.objectKey,
          width: image.width
        });

        await persistContext(image, imagePrompt, upload.objectKey);
        await runExtraction(activeSessionId, upload.objectKey, workflowId, image, imagePrompt);

        try {
          await loadPreviewForObjectKey(activeSessionId, upload.objectKey, workflowId);
        } catch (error) {
          logEvent("Problem image preview failed", errorLogValue(error));
        }
      } catch (error) {
        if (workflowId !== workflowIdRef.current) {
          return;
        }

        const message = errorMessage(error, "Could not upload the problem image.");
        setUploadStatus("failed");
        setExtractionStatus("failed");
        setExtractionError(message);
        setEmptyMessage(message);
        setImageMeta(message);
        setStatus(message, "error");
        logEvent("Problem image upload failed", errorLogValue(error));
      } finally {
        if (workflowId === workflowIdRef.current) {
          setIsBusy(false);
        }
      }
    },
    [activeSessionId, imagePrompt, loadPreviewForObjectKey, logEvent, persistContext, runExtraction, setStatus]
  );

  const handleFileChange = useCallback(
    (file: File | undefined) => {
      if (!file) {
        resetStep1();
        void persistContext(undefined, defaultImagePrompt, null);
        return;
      }

      uploadAndExtract(file).catch((error: unknown) => {
        logEvent("Problem image workflow failed", errorLogValue(error));
      });
    },
    [logEvent, persistContext, resetStep1, uploadAndExtract]
  );

  const handlePromptChange = useCallback(
    (value: string) => {
      setImagePrompt(value);

      if (promptPersistTimeoutRef.current !== undefined) {
        window.clearTimeout(promptPersistTimeoutRef.current);
      }

      promptPersistTimeoutRef.current = window.setTimeout(() => {
        void persistContext(preparedImage, value, objectKey ?? null);
      }, 400);
    },
    [objectKey, persistContext, preparedImage]
  );

  const reExtractQuestion = useCallback(async () => {
    if (!activeSessionId || !objectKey) {
      throw new Error("Upload a problem image first.");
    }

    const workflowId = ++workflowIdRef.current;
    setIsBusy(true);

    try {
      await runExtraction(activeSessionId, objectKey, workflowId, preparedImage, imagePrompt);
    } finally {
      if (workflowId === workflowIdRef.current) {
        setIsBusy(false);
      }
    }
  }, [activeSessionId, imagePrompt, objectKey, preparedImage, runExtraction]);

  const loadSessionContext = useCallback(
    (context: LoadedSessionContext) => {
      workflowIdRef.current += 1;
      setPreparedImage(undefined);
      setSelectedImageFile(undefined);
      setObjectKey(context.imageObjectKey ?? undefined);
      setPreviewUrl(undefined);
      setImagePrompt(context.imagePrompt || defaultImagePrompt);
      setUploadStatus(context.imageObjectKey ? "uploaded" : "idle");
      setExtractionStatus(context.imagePrompt && context.imageObjectKey ? "ready" : "idle");
      setExtractionError(null);
      setIsBusy(false);
      setEmptyMessage(context.imageMeta ? "Saved problem image loaded." : noProblemImageMessage);
      setImageMeta(formatStoredImageMeta(context.imageMeta, context.imageName));

      if (activeSessionId && context.imageObjectKey) {
        const workflowId = workflowIdRef.current;
        loadPreviewForObjectKey(activeSessionId, context.imageObjectKey, workflowId).catch((error: unknown) => {
          logEvent("Problem image preview failed", errorLogValue(error));
        });
      }
    },
    [activeSessionId, loadPreviewForObjectKey, logEvent]
  );

  return {
    emptyMessage,
    extractionError,
    extractionStatus,
    extractionStatusHint: extractionStatusHint(extractionStatus, extractionError),
    handleFileChange,
    handlePromptChange,
    imageMeta,
    imagePrompt,
    isBusy,
    loadSessionContext,
    objectKey,
    preparedImage,
    previewUrl,
    reExtractQuestion,
    resetStep1,
    selectedImageFile,
    setPreparedImageFromSend,
    uploadStatus
  };
}
