import { createServerFn } from "@tanstack/react-start";

import { authenticateServerRequest } from "../../../server-request-context.js";
import {
  appendSessionEvent,
  createSession,
  getSession,
  listSessions,
  updateSession
} from "../session-handler.js";
import type {
  AppendSessionEventRequest,
  UpdateTutorSessionRequest
} from "../session-types.js";

// Thin server-function adapters over the HTTP-decoupled session domain handlers.
// The handlers still re-parse their `body`/`request` payloads, so the validators
// only pass input through to give callers an end-to-end type while the handler
// keeps owning runtime validation. Reads are GET; writes are POST (server fns are
// GET/POST only — the previous PATCH was just transport).

export const listSessionsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { context, store } = await authenticateServerRequest();
  return listSessions(context, store);
});

export const createSessionFn = createServerFn({ method: "POST" })
  .validator((input: { title?: string }) => input)
  .handler(async ({ data }) => {
    const { context, store } = await authenticateServerRequest();
    return createSession(data, context, store);
  });

export const getSessionFn = createServerFn({ method: "GET" })
  .validator((input: { sessionId: string }) => input)
  .handler(async ({ data }) => {
    const { context, store } = await authenticateServerRequest();
    return getSession(data.sessionId, context, store);
  });

export const updateSessionFn = createServerFn({ method: "POST" })
  .validator((input: { request: UpdateTutorSessionRequest; sessionId: string }) => input)
  .handler(async ({ data }) => {
    const { context, store } = await authenticateServerRequest();
    return updateSession(data.sessionId, data.request, context, store);
  });

export const appendSessionEventFn = createServerFn({ method: "POST" })
  .validator((input: { request: AppendSessionEventRequest; sessionId: string }) => input)
  .handler(async ({ data }) => {
    const { context, store } = await authenticateServerRequest();
    await appendSessionEvent(data.sessionId, data.request, context, store);
  });
