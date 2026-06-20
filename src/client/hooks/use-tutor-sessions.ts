import { useCallback, useEffect, useRef, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  toTutorSessionSummary,
  type TutorSessionRecord,
  type TutorSessionSummary
} from "../../modules/sessions/session-types.js";
import { errorMessage } from "../lib/error-message.js";
import { formatEventEntry } from "../lib/format-event-entry.js";
import {
  createSession,
  getSession,
  listSessions,
  SessionApiError,
  updateSession
} from "../lib/session-api.js";
import type { LoadedSessionContext, SessionListError, StatusTone } from "../types.js";
import {
  activeSessionStorageKey,
  legacyActiveSessionStorageKey
} from "../types.js";

type UseTutorSessionsOptions = {
  clearEventLog: () => void;
  getIsVoiceRunning: () => boolean;
  loadEventLog: (entries: string[]) => void;
  loadSessionContext: (context: LoadedSessionContext) => void;
  logEvent: (message: string, value?: unknown, persistSessionId?: string) => void;
  resetProblemImage: () => void;
  setStatus: (message: string, tone?: StatusTone) => void;
  stopVoiceSession: () => void;
  userId: string | undefined;
};

// Stable identity for the empty case so a render before data resolves doesn't
// hand App.tsx a fresh array each time (its visibleSessions useMemo keys on it).
const EMPTY_SESSIONS: TutorSessionSummary[] = [];

function sessionsQueryKey(userId: string | undefined): readonly [string, string | undefined] {
  return ["sessions", userId];
}

function toSessionListError(error: unknown): SessionListError {
  if (error instanceof SessionApiError) {
    if (error.status === 403) {
      return {
        kind: "auth",
        message: "Sign in required to load sessions."
      };
    }

    return {
      kind: "network",
      message: error.message
    };
  }

  return {
    kind: "unknown",
    message: errorMessage(error, "Could not load sessions.")
  };
}

function toLoadedSessionContext(
  session: Pick<
    TutorSessionRecord,
    | "extractionNotes"
    | "extractionOutcome"
    | "imageMeta"
    | "imageName"
    | "imageObjectKey"
    | "imagePrompt"
    | "promptConfirmed"
  >
): LoadedSessionContext {
  return {
    extractionNotes: session.extractionNotes,
    extractionOutcome: session.extractionOutcome,
    imageMeta: session.imageMeta,
    imageName: session.imageName,
    imageObjectKey: session.imageObjectKey,
    imagePrompt: session.imagePrompt,
    promptConfirmed: session.promptConfirmed
  };
}

function removeLegacyActiveSessionStorageKey(): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }

  sessionStorage.removeItem(legacyActiveSessionStorageKey);
}

function readStoredActiveSessionId(userId: string | undefined): string | undefined {
  if (!userId || typeof sessionStorage === "undefined") {
    return undefined;
  }

  removeLegacyActiveSessionStorageKey();
  return sessionStorage.getItem(activeSessionStorageKey(userId)) ?? undefined;
}

function writeStoredActiveSessionId(userId: string | undefined, sessionId: string | undefined): void {
  if (!userId || typeof sessionStorage === "undefined") {
    return;
  }

  const key = activeSessionStorageKey(userId);

  if (sessionId) {
    sessionStorage.setItem(key, sessionId);
    return;
  }

  sessionStorage.removeItem(key);
}

export function useTutorSessions({
  clearEventLog,
  getIsVoiceRunning,
  loadEventLog,
  loadSessionContext,
  logEvent,
  resetProblemImage,
  setStatus,
  stopVoiceSession,
  userId
}: UseTutorSessionsOptions): {
  activeSession: TutorSessionSummary | undefined;
  activeSessionId: string | undefined;
  createNewSession: () => Promise<string | undefined>;
  eventCount: number;
  isHydrating: boolean;
  isLoading: boolean;
  isSwitching: boolean;
  listError: SessionListError | null;
  refreshSessions: () => Promise<TutorSessionSummary[]>;
  selectSession: (sessionId: string) => Promise<void>;
  sessions: TutorSessionSummary[];
  updateActiveSession: (request: Parameters<typeof updateSession>[1]) => Promise<void>;
  notifyEventLogged: () => void;
} {
  const queryClient = useQueryClient();

  // The session list is the one cacheable server read; the create/hydrate
  // orchestration around it (below) stays imperative.
  const sessionsQuery = useQuery({
    queryKey: sessionsQueryKey(userId),
    queryFn: listSessions,
    enabled: Boolean(userId)
  });
  const sessions = sessionsQuery.data ?? EMPTY_SESSIONS;

  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [isHydrating, setIsHydrating] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  // Switch/create failures; list failures come from the query itself.
  const [switchError, setSwitchError] = useState<SessionListError | null>(null);
  const [eventCount, setEventCount] = useState(0);
  const initializedForUserIdRef = useRef<string | undefined>(undefined);
  const initGenerationRef = useRef(0);

  const isLoading = sessionsQuery.isFetching;
  const listError =
    switchError ?? (sessionsQuery.isError ? toSessionListError(sessionsQuery.error) : null);

  const { mutateAsync: createSessionAsync } = useMutation({ mutationFn: () => createSession() });

  const { mutateAsync: updateSessionAsync } = useMutation({
    mutationFn: ({ sessionId, request }: { sessionId: string; request: Parameters<typeof updateSession>[1] }) =>
      updateSession(sessionId, request),
    onSuccess: (updated) => {
      queryClient.setQueryData<TutorSessionSummary[]>(sessionsQueryKey(userId), (previous) =>
        (previous ?? []).map((session) =>
          session.id === updated.id ? toTutorSessionSummary(updated) : session
        )
      );
    }
  });

  const persistActiveSessionId = useCallback(
    (sessionId: string | undefined) => {
      setActiveSessionId(sessionId);
      writeStoredActiveSessionId(userId, sessionId);
    },
    [userId]
  );

  const notifyEventLogged = useCallback(() => {
    setEventCount((previous) => previous + 1);
  }, []);

  const hydrateSession = useCallback(
    async (sessionId: string) => {
      const detail = await getSession(sessionId);
      const entries = detail.events.map((event) =>
        formatEventEntry(event.createdAt, event.message, event.value, { omitNullValue: true })
      );

      setEventCount(detail.events.length);
      loadEventLog(entries);
      loadSessionContext(toLoadedSessionContext(detail.session));
    },
    [loadEventLog, loadSessionContext]
  );

  const refreshSessions = useCallback(async () => {
    if (!userId) {
      return [];
    }

    setSwitchError(null);
    // staleTime defaults to 0, so this always hits the network like the old
    // hand-rolled refresh, and updates the cache the list query observes.
    return queryClient.fetchQuery({
      queryKey: sessionsQueryKey(userId),
      queryFn: listSessions
    });
  }, [queryClient, userId]);

  const runSessionSwitch = useCallback(
    async <T>(task: () => Promise<T>): Promise<T> => {
      setIsSwitching(true);
      setSwitchError(null);

      try {
        if (getIsVoiceRunning()) {
          stopVoiceSession();
        }

        return await task();
      } catch (error) {
        const mapped = toSessionListError(error);
        setSwitchError(mapped);
        setStatus(mapped.message, "error");
        throw error;
      } finally {
        setIsSwitching(false);
      }
    },
    [getIsVoiceRunning, setStatus, stopVoiceSession]
  );

  const selectSession = useCallback(
    async (sessionId: string) => {
      if (sessionId === activeSessionId) {
        return;
      }

      await runSessionSwitch(async () => {
        await hydrateSession(sessionId);
        persistActiveSessionId(sessionId);
        setStatus("Session loaded.", "ready");
      });
    },
    [
      activeSessionId,
      hydrateSession,
      persistActiveSessionId,
      runSessionSwitch,
      setStatus
    ]
  );

  const createNewSession = useCallback(() => {
    return runSessionSwitch(async () => {
      const created = await createSessionAsync();
      const nextSessions = await refreshSessions();

      if (!nextSessions.some((session) => session.id === created.id)) {
        queryClient.setQueryData<TutorSessionSummary[]>(sessionsQueryKey(userId), [
          created,
          ...nextSessions
        ]);
      }

      clearEventLog();
      resetProblemImage();
      loadSessionContext(toLoadedSessionContext(created));
      setEventCount(0);
      persistActiveSessionId(created.id);
      setStatus("New session ready.", "ready");
      logEvent("Session created", { sessionId: created.id, title: created.title }, created.id);
      return created.id;
    });
  }, [
    clearEventLog,
    createSessionAsync,
    loadSessionContext,
    logEvent,
    persistActiveSessionId,
    queryClient,
    refreshSessions,
    resetProblemImage,
    runSessionSwitch,
    setStatus,
    userId
  ]);

  const updateActiveSession = useCallback(
    async (request: Parameters<typeof updateSession>[1]) => {
      if (!activeSessionId) {
        return;
      }

      await updateSessionAsync({ sessionId: activeSessionId, request });
    },
    [activeSessionId, updateSessionAsync]
  );

  // Per-user reset: the moment the user changes (sign-in/out/switch), drop the
  // previous selection immediately, cancel any in-flight hydration, and mark the
  // session as hydrating until the init effect below finishes — so `sessionReady`
  // stays false across the whole init, exactly as before. The list itself is the
  // query, keyed by userId, so it swaps and refetches on its own.
  useEffect(() => {
    initGenerationRef.current += 1;
    initializedForUserIdRef.current = undefined;
    setActiveSessionId(readStoredActiveSessionId(userId));
    setSwitchError(null);
    setEventCount(0);
    setIsSwitching(false);
    setIsHydrating(Boolean(userId));
  }, [userId]);

  // Init (once per user, after the list resolves): create-if-empty, else hydrate
  // the stored-or-first session. The generation guard covers only this async
  // sequence; the query handles its own stale-fetch cancellation.
  useEffect(() => {
    if (!userId || initializedForUserIdRef.current === userId) {
      return;
    }

    if (sessionsQuery.isPending || sessionsQuery.isFetching) {
      return; // isHydrating stays true (set by the reset effect)
    }

    if (sessionsQuery.isError) {
      // Surfaced via listError; a retry refetches and re-runs this effect.
      setIsHydrating(false);
      return;
    }

    initializedForUserIdRef.current = userId;
    const storedId = readStoredActiveSessionId(userId);
    const initGeneration = ++initGenerationRef.current;
    const nextSessions = sessionsQuery.data ?? [];

    void (async () => {
      try {
        if (nextSessions.length === 0) {
          const created = await createSession();
          if (initGeneration !== initGenerationRef.current) {
            return;
          }

          clearEventLog();
          resetProblemImage();
          loadSessionContext(toLoadedSessionContext(created));
          setEventCount(0);
          queryClient.setQueryData<TutorSessionSummary[]>(sessionsQueryKey(userId), [created]);
          persistActiveSessionId(created.id);
          setStatus("New session ready.", "ready");
          logEvent("Session created", { sessionId: created.id, title: created.title }, created.id);
          return;
        }

        const targetId =
          storedId && nextSessions.some((session) => session.id === storedId)
            ? storedId
            : nextSessions[0]!.id;

        await hydrateSession(targetId);
        if (initGeneration !== initGenerationRef.current) {
          return;
        }

        persistActiveSessionId(targetId);
      } catch {
        // Errors are surfaced through listError and status.
      } finally {
        if (initGeneration === initGenerationRef.current) {
          setIsHydrating(false);
        }
      }
    })();
  }, [
    clearEventLog,
    hydrateSession,
    loadSessionContext,
    logEvent,
    persistActiveSessionId,
    queryClient,
    resetProblemImage,
    sessionsQuery.data,
    sessionsQuery.isError,
    sessionsQuery.isFetching,
    sessionsQuery.isPending,
    setStatus,
    userId
  ]);

  const activeSession = sessions.find((session) => session.id === activeSessionId);

  return {
    activeSession,
    activeSessionId,
    createNewSession,
    eventCount,
    isHydrating,
    isLoading,
    isSwitching,
    listError,
    notifyEventLogged,
    refreshSessions,
    selectSession,
    sessions,
    updateActiveSession
  };
}
