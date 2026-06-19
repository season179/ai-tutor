import type { RefObject } from "react";

import { classNames } from "../lib/class-names.js";

type VoiceBarProps = {
  audioRef: RefObject<HTMLAudioElement | null>;
  canRecordAudioTurn: boolean;
  hasPriorActivity: boolean;
  isRecording: boolean;
  isRunning: boolean;
  onFinishAudioTurn: () => void;
  onStart: () => void;
  onStartAudioTurn: () => void;
  onStop: () => void;
  sessionReady: boolean;
};

/**
 * The voice bar lives in the center anchor (moved out of the right sidebar in
 * M2): one primary talk button that adapts to the turn state, an optional "End"
 * control while a session is live, and the audio sink for Echo's replies.
 */
export function VoiceBar({
  audioRef,
  canRecordAudioTurn,
  hasPriorActivity,
  isRecording,
  isRunning,
  onFinishAudioTurn,
  onStart,
  onStartAudioTurn,
  onStop,
  sessionReady
}: VoiceBarProps) {
  return (
    <div aria-label="Voice controls" className="voice-bar" role="group">
      <PrimaryTalkButton
        canRecordAudioTurn={canRecordAudioTurn}
        hasPriorActivity={hasPriorActivity}
        isRecording={isRecording}
        isRunning={isRunning}
        onFinishAudioTurn={onFinishAudioTurn}
        onStart={onStart}
        onStartAudioTurn={onStartAudioTurn}
        sessionReady={sessionReady}
      />

      {isRunning ? (
        <button className="vb-btn" onClick={onStop} type="button">
          <StopIcon />
          End
        </button>
      ) : null}

      <audio autoPlay id="remote-audio" ref={audioRef} />
    </div>
  );
}

type PrimaryTalkButtonProps = Omit<VoiceBarProps, "audioRef" | "onStop">;

function PrimaryTalkButton({
  canRecordAudioTurn,
  hasPriorActivity,
  isRecording,
  isRunning,
  onFinishAudioTurn,
  onStart,
  onStartAudioTurn,
  sessionReady
}: PrimaryTalkButtonProps) {
  if (!isRunning) {
    const startLabel = hasPriorActivity ? "Continue with Echo" : "Start with Echo";
    return (
      <button className="talk" disabled={!sessionReady} onClick={onStart} type="button">
        <MicIcon />
        {startLabel}
      </button>
    );
  }

  // A connected provider with no manual record turn (e.g. realtime) listens
  // continuously, so the primary button shows the live state rather than a tap target.
  if (!canRecordAudioTurn) {
    return (
      <button className="talk" disabled type="button">
        <Wave />
        Listening…
      </button>
    );
  }

  if (isRecording) {
    return (
      <button className="talk" onClick={onFinishAudioTurn} type="button">
        <Wave />
        Stop and send
      </button>
    );
  }

  return (
    <button className="talk" onClick={onStartAudioTurn} type="button">
      <MicIcon />
      Tap to talk
    </button>
  );
}

function MicIcon() {
  return (
    <svg
      aria-hidden="true"
      className="mic"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <rect height="11" rx="3" width="6" x="9" y="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <rect height="12" rx="2" width="12" x="6" y="6" />
    </svg>
  );
}

function Wave() {
  return (
    <span aria-hidden="true" className="wave">
      <span />
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}
