import { createServerFn } from "@tanstack/react-start";

import { authenticateServerRequest, workerEnv } from "../../../server-request-context.js";
import {
  clearLocalTraceEvents,
  readLocalTraceSnapshot,
  type LocalTraceEnv
} from "../../../core/local-trace-store.js";
import type { LocalTraceSnapshot } from "../../../core/local-trace-types.js";
import {
  serverFnMiddleware,
  writeServerFnMiddleware
} from "../../../core/server-fn-middleware.js";

export type LocalTraceQuery = {
  limit?: number;
};

export type ClearLocalTraceResponse = {
  cleared: number;
};

export const getLocalTracesFn = createServerFn({ method: "GET" })
  .middleware(serverFnMiddleware)
  .validator((input: LocalTraceQuery | undefined) => input ?? {})
  .handler(async ({ data }): Promise<LocalTraceSnapshot> => {
    await authenticateServerRequest();
    return readLocalTraceSnapshot(workerEnv() as LocalTraceEnv, data.limit);
  });

export const clearLocalTracesFn = createServerFn({ method: "POST" })
  .middleware(writeServerFnMiddleware)
  .handler(async (): Promise<ClearLocalTraceResponse> => {
    await authenticateServerRequest();
    const cleared = await clearLocalTraceEvents(workerEnv() as LocalTraceEnv);
    return { cleared };
  });
