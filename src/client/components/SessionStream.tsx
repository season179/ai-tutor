import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { classNames } from "../lib/class-names.js";
import type { TranscriptTurn } from "../lib/transcript.js";

// useLayoutEffect follows the conversation before paint, so a new turn never
// flashes in at the old scroll position; fall back to useEffect during SSR to
// avoid the "useLayoutEffect does nothing on the server" warning.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// How close to the foot still counts as "reading the latest" — slack for
// sub-pixel rounding and the sticky problem pin's offset.
const STICK_TO_BOTTOM_PX = 96;

type SessionStreamProps = {
  goalStatus: "empty" | "framed" | "complete";
  problemPin: ReactNode;
  turns: TranscriptTurn[];
  unknownTarget: string | null;
};

/**
 * The Stream: the problem pin (the folded-in problem context), the north-star
 * target chip, and the growing transcript. The target chip is intentionally
 * empty and inert until the comprehension gate (M3) decides what we're finding.
 */
export function SessionStream({ goalStatus, problemPin, turns, unknownTarget }: SessionStreamProps) {
  const streamRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const prevLastIdRef = useRef<number | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [hasNew, setHasNew] = useState(false);

  // The stream is pinned to the foot: hide the catch-up affordance. One source
  // of truth for "we're at the bottom now", shared by the scroll button, the
  // programmatic follow, and the empty-stream reset.
  const markAtBottom = () => {
    atBottomRef.current = true;
    setShowJump(false);
    setHasNew(false);
  };

  const scrollToBottom = () => {
    const el = streamRef.current;
    if (!el) {
      return;
    }
    el.scrollTop = el.scrollHeight;
    markAtBottom();
  };

  const handleScroll = () => {
    const el = streamRef.current;
    if (!el) {
      return;
    }
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_TO_BOTTOM_PX;
    // Only act on a transition across the threshold. A continuous scroll fires
    // this every frame; re-asserting the same state each time is wasted work.
    if (atBottom === atBottomRef.current) {
      return;
    }
    if (atBottom) {
      markAtBottom();
    } else {
      atBottomRef.current = false;
      setShowJump(true);
    }
  };

  // Follow the conversation as it grows — but never yank a reader who has
  // scrolled up. Auto-scroll only when they're already at the foot, or when the
  // newest turn is their own; otherwise raise the "new messages" affordance.
  useIsomorphicLayoutEffect(() => {
    const lastTurn = turns.length > 0 ? turns[turns.length - 1]! : null;
    const prevLastId = prevLastIdRef.current;
    prevLastIdRef.current = lastTurn ? lastTurn.id : null;

    if (!lastTurn) {
      markAtBottom();
      return;
    }

    // Does this render continue the same transcript, or is it a fresh one (first
    // paint / a switched session)? The previous tail id surviving into the new
    // turns means we only appended; its absence means the whole stream changed.
    const sameTranscript = prevLastId !== null && turns.some((turn) => turn.id === prevLastId);

    if (!sameTranscript) {
      scrollToBottom();
      return;
    }

    if (lastTurn.id === prevLastId) {
      return; // same transcript, nothing new at the tail
    }

    const studentSpoke = turns.some((turn) => turn.id > prevLastId! && turn.role === "child");

    if (studentSpoke || atBottomRef.current) {
      scrollToBottom();
    } else {
      setHasNew(true);
    }
  }, [turns]);

  return (
    <div className="cc-stream" onScroll={handleScroll} ref={streamRef}>
      {problemPin}

      {/* The north-star target stays hidden until the comprehension gate (M3) names
          a goal: a chip with nothing in it is noise, not orientation. */}
      {goalStatus !== "empty" ? (
        <div className="target-row">
          <span
            className={classNames(
              "target-chip",
              goalStatus === "complete" ? "target-chip--complete" : "target-chip--framed"
            )}
          >
            {goalStatus === "complete" ? <CheckStar /> : <TargetStar />}
            <span className="tlabel">{goalStatus === "complete" ? "Found:" : "Find:"}</span>
            {` ${unknownTarget ?? ""}`}
          </span>
        </div>
      ) : null}

      {turns.length > 0 ? (
        <div className="transcript" aria-label="Conversation">
          {turns.map((turn) => (
            <div className={classNames("turn", `turn--${turn.role}`)} key={turn.id}>
              {turn.role === "coach" ? <EchoMark /> : null}
              <div className="bubble">
                {turn.verdict ? <VerdictChip verdict={turn.verdict} /> : null}
                {turn.text}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {showJump ? (
        <button
          aria-label="Jump to the latest message"
          className="cc-jump"
          onClick={scrollToBottom}
          type="button"
        >
          <JumpArrow />
          {hasNew ? "New messages" : "Latest"}
        </button>
      ) : null}
    </div>
  );
}

function JumpArrow() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.4"
      viewBox="0 0 24 24"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function EchoMark() {
  return (
    <span aria-hidden="true" className="echo-mark">
      <svg fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" viewBox="0 0 24 24">
        <path d="M4 12h2l2-6 4 14 3-9 2 4h3" />
      </svg>
    </span>
  );
}

function CheckStar() {
  return (
    <svg
      aria-hidden="true"
      className="star"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.4"
      viewBox="0 0 24 24"
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function TargetStar() {
  return (
    <svg
      aria-hidden="true"
      className="star"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z" />
    </svg>
  );
}

function VerdictChip({ verdict }: { verdict: NonNullable<TranscriptTurn["verdict"]> }) {
  return (
    <span className={classNames("vchip", `vchip--${verdict.chip}`)}>
      {verdict.chip === "ok" ? <CheckIcon /> : verdict.chip === "retry" ? <RetryIcon /> : <span>◐</span>}
      {verdict.label}
    </span>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.4"
      viewBox="0 0 24 24"
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.2"
      viewBox="0 0 24 24"
    >
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 4v4h4" />
    </svg>
  );
}
