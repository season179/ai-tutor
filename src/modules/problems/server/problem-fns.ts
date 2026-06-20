import { createServerFn } from "@tanstack/react-start";

import { authenticateServerRequest, workerEnv } from "../../../server-request-context.js";
import {
  createProblemContextHandlerEnv,
  handleExtractQuestionRequest,
  handlePreviewUrlRequest,
  handleUploadUrlRequest
} from "../problem-context-handler.js";
import type {
  ExtractQuestionRequest,
  PreviewUrlRequest,
  UploadUrlRequest
} from "../problem-context-types.js";

// Server-function adapters over the problem-context domain handlers. Each handler
// needs the R2 + vision env in addition to the per-user store/context, so the env is
// rebuilt from the Worker bindings inside the handler (server-only). The direct
// browser→R2 PUT stays a plain fetch in problem-context-api.ts — it is presigned by
// design and must not round-trip through the Worker.

export const requestUploadUrlFn = createServerFn({ method: "POST" })
  .validator((input: UploadUrlRequest) => input)
  .handler(async ({ data }) => {
    const { context, store } = await authenticateServerRequest();
    return handleUploadUrlRequest(data, createProblemContextHandlerEnv(workerEnv()), store, context);
  });

export const extractQuestionFn = createServerFn({ method: "POST" })
  .validator((input: ExtractQuestionRequest) => input)
  .handler(async ({ data }) => {
    const { context, store } = await authenticateServerRequest();
    return handleExtractQuestionRequest(data, createProblemContextHandlerEnv(workerEnv()), store, context);
  });

export const requestPreviewUrlFn = createServerFn({ method: "POST" })
  .validator((input: PreviewUrlRequest) => input)
  .handler(async ({ data }) => {
    const { context, store } = await authenticateServerRequest();
    return handlePreviewUrlRequest(data, createProblemContextHandlerEnv(workerEnv()), store, context);
  });
