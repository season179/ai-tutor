import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import type { LocalTraceEvent, LocalTraceRun } from "../../../core/local-trace-types.js";
import { BrandLockup } from "../BrandLockup.js";
import { SignInScreen } from "../SignInScreen.js";
import { useAuth } from "../../hooks/use-auth.js";
import { clearLocalTraces, getLocalTraces } from "../../lib/local-traces-api.js";

const TRACE_QUERY_KEY = ["local-traces"] as const;

export function LocalTracesPage() {
  const { isAuthLoading, authError, signInWithGoogle } = useAuth();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const tracesQuery = useQuery({
    queryKey: TRACE_QUERY_KEY,
    queryFn: () => getLocalTraces(500),
    refetchInterval: autoRefresh ? 1_500 : false
  });

  const clearMutation = useMutation({
    mutationFn: clearLocalTraces,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TRACE_QUERY_KEY })
  });

  const runs = tracesQuery.data?.runs ?? [];
  const selectedRun = useMemo(
    () => runs.find((run) => run.traceId === selectedTraceId) ?? runs[0] ?? null,
    [runs, selectedTraceId]
  );

  useEffect(() => {
    if (!selectedTraceId && runs[0]) {
      setSelectedTraceId(runs[0].traceId);
    }
  }, [runs, selectedTraceId]);

  if (isAuthLoading) {
    return <main className="trace-page" aria-busy="true" />;
  }

  if (authError) {
    return (
      <SignInScreen
        message="Could not start a session. Sign in with Google to inspect local traces."
        onSignIn={signInWithGoogle}
      />
    );
  }

  const snapshot = tracesQuery.data;

  return (
    <main className="trace-page">
      <header className="trace-header">
        <BrandLockup />
        <div className="trace-header-actions">
          <Link className="text-button settings-back-link" to="/">
            Back to coaching
          </Link>
          <button
            className="trace-action"
            type="button"
            onClick={() => tracesQuery.refetch()}
            disabled={tracesQuery.isFetching}
          >
            Refresh
          </button>
          <button
            className="trace-action trace-action--danger"
            type="button"
            onClick={() => clearMutation.mutate()}
            disabled={!snapshot?.events.length || clearMutation.isPending}
          >
            Clear
          </button>
        </div>
      </header>

      <section className="trace-toolbar" aria-label="Trace controls">
        <div>
          <h1>Local traces</h1>
          <p>{summaryText(snapshot?.events.length ?? 0, runs.length, tracesQuery.isFetching)}</p>
        </div>
        <label className="trace-toggle">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(event) => setAutoRefresh(event.target.checked)}
          />
          <span>Auto-refresh</span>
        </label>
      </section>

      {snapshot?.enabled === false ? (
        <section className="trace-empty">
          <h2>Local trace buffer is off</h2>
          <p>Set LOCAL_TRACE_DEBUG=1 in .dev.vars, restart pnpm dev, then run a tutor turn.</p>
        </section>
      ) : snapshot?.error ? (
        <section className="trace-empty" role="alert">
          <h2>Trace buffer error</h2>
          <p>{snapshot.error}</p>
        </section>
      ) : tracesQuery.isError ? (
        <section className="trace-empty" role="alert">
          <h2>Could not load traces</h2>
          <p>{String((tracesQuery.error as Error)?.message ?? "")}</p>
        </section>
      ) : runs.length === 0 ? (
        <section className="trace-empty">
          <h2>No local traces yet</h2>
          <p>Run a tutor turn with LOCAL_TRACE_DEBUG=1 enabled.</p>
        </section>
      ) : (
        <div className="trace-layout">
          <TraceRunList
            runs={runs}
            selectedTraceId={selectedRun?.traceId ?? null}
            onSelect={setSelectedTraceId}
          />
          {selectedRun ? <TraceRunDetail run={selectedRun} /> : null}
        </div>
      )}
    </main>
  );
}

function TraceRunList({
  runs,
  selectedTraceId,
  onSelect
}: {
  runs: LocalTraceRun[];
  selectedTraceId: string | null;
  onSelect: (traceId: string) => void;
}) {
  return (
    <aside className="trace-run-list" aria-label="Recent trace runs">
      <div className="trace-run-list-header">
        <span>Recent runs</span>
        <strong>{runs.length}</strong>
      </div>
      <div className="trace-run-strip">
        {runs.map((run) => {
          const selected = run.traceId === selectedTraceId;
          return (
            <button
              key={run.traceId}
              aria-current={selected ? "true" : undefined}
              className={selected ? "trace-run trace-run--active" : "trace-run"}
              type="button"
              onClick={() => onSelect(run.traceId)}
            >
              <span className="trace-run-topline">
                <span>{run.operation ?? "trace"}</span>
                <strong>{formatMs(run.totalDurationMs)}</strong>
              </span>
              <span className="trace-run-meta">
                {formatTime(run.endedAt)} · slowest {run.slowestStage ?? "none"}
              </span>
              <span className={run.status === "error" ? "trace-status trace-status--error" : "trace-status"}>
                {run.status}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function TraceRunDetail({ run }: { run: LocalTraceRun }) {
  const timelineEvents = traceTimelineEvents(run);
  const timelineDuration = Math.max(1, sumDurations(timelineEvents));
  const slowest = timelineEvents.reduce<LocalTraceEvent | null>(
    (current, event) => (!current || event.durationMs > current.durationMs ? event : current),
    null
  );

  return (
    <section className="trace-detail" aria-labelledby="trace-detail-title">
      <div className="trace-detail-header">
        <div>
          <h2 id="trace-detail-title">{run.operation ?? "Trace"}</h2>
          <p>
            {formatTime(run.startedAt)} to {formatTime(run.endedAt)} · {timelineEvents.length} stages
          </p>
        </div>
        <div className="trace-metrics" aria-label="Trace timing summary">
          <span>
            <strong>{formatMs(run.totalDurationMs)}</strong>
            <small>Total</small>
          </span>
          <span>
            <strong>{slowest ? formatMs(slowest.durationMs) : "0ms"}</strong>
            <small>{slowest?.stage ?? "Slowest"}</small>
          </span>
        </div>
      </div>

      <div className="trace-id-row">
        <span>Trace ID</span>
        <code title={run.traceId}>{run.traceId}</code>
      </div>

      <div className="trace-timeline-axis" aria-hidden="true">
        <span>{formatTime(run.startedAt)}</span>
        <span>{formatMs(timelineDuration)} staged duration</span>
        <span>{formatTime(run.endedAt)}</span>
      </div>

      <div className="trace-timeline-viewport">
        <div className="trace-timeline" role="list" aria-label="Trace stages from left to right">
          {timelineEvents.map((event, index) => (
            <TraceStageSegment
              key={event.id}
              event={event}
              index={index}
              totalDuration={timelineDuration}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function TraceStageSegment({
  event,
  index,
  totalDuration
}: {
  event: LocalTraceEvent;
  index: number;
  totalDuration: number;
}) {
  const share = Math.max(8, Math.round((event.durationMs / totalDuration) * 1000) / 10);
  const style: CSSProperties & { "--trace-share": string } = { "--trace-share": `${share}%` };
  const meta = traceEventMeta(event);

  return (
    <article
      className={event.status === "error" ? "trace-stage trace-stage--error" : "trace-stage"}
      role="listitem"
      style={style}
    >
      <span className="trace-stage-pin" aria-hidden="true" />
      <span className="trace-stage-index">{index + 1}</span>
      <h3 className="trace-stage-name">{event.stage}</h3>
      <strong className="trace-stage-time">{formatMs(event.durationMs)}</strong>
      <p className="trace-stage-recorded">{formatTime(event.recordedAt)}</p>
      {meta.length ? (
        <div className="trace-stage-meta">
          {meta.map((value) => (
            <span key={value} title={value}>
              {value}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function summaryText(eventCount: number, runCount: number, loading: boolean): string {
  if (loading && eventCount === 0) {
    return "Loading trace buffer.";
  }
  return `${eventCount} events across ${runCount} runs`;
}

function formatMs(value: number): string {
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2)}s`;
  }
  return `${Math.round(value)}ms`;
}

function formatTime(value: string): string {
  if (!value) {
    return "";
  }
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function traceTimelineEvents(run: LocalTraceRun): LocalTraceEvent[] {
  const stages = run.events.filter((event) => !isRootTraceStage(event.stage));
  return stages.length ? stages : run.events;
}

function isRootTraceStage(stage: string): boolean {
  return stage === "voice.turn" || stage === "problem.extract_request";
}

function sumDurations(events: LocalTraceEvent[]): number {
  return Math.round(events.reduce((total, event) => total + event.durationMs, 0) * 10) / 10;
}

function traceEventMeta(event: LocalTraceEvent): string[] {
  return [event.workflow, event.model, event.route].filter((value): value is string => Boolean(value));
}
