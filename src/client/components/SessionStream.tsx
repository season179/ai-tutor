import type { ReactNode } from "react";

import { classNames } from "../lib/class-names.js";
import type { TranscriptTurn } from "../lib/transcript.js";

type SessionStreamProps = {
  problemPin: ReactNode;
  turns: TranscriptTurn[];
};

/**
 * The Stream: the problem pin (the folded-in problem context), the north-star
 * target chip, and the growing transcript. The target chip is intentionally
 * empty and inert until the comprehension gate (M3) decides what we're finding.
 */
export function SessionStream({ problemPin, turns }: SessionStreamProps) {
  return (
    <div className="cc-stream">
      {problemPin}

      <div className="target-row">
        <span className="target-chip target-chip--empty">
          <span className="tlabel">We need to find</span> ___
        </span>
      </div>

      {turns.length > 0 ? (
        <div className="transcript" aria-label="Conversation">
          {turns.map((turn) => (
            <div className={classNames("turn", `turn--${turn.role}`)} key={turn.id}>
              {turn.role === "coach" ? <EchoMark /> : null}
              <div className="bubble">
                {turn.text}
                {turn.role === "child" ? (
                  <span aria-hidden="true" className="mic">
                    {" "}
                    🎙
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
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
