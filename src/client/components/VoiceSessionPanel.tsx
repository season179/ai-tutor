import type { RefObject } from "react";

import { ActionButton } from "./ActionButton.js";
import { Panel } from "./Panel.js";

type VoiceSessionPanelProps = {
  audioRef: RefObject<HTMLAudioElement | null>;
  canRecordAudioTurn: boolean;
  hasPriorActivity: boolean;
  isRunning: boolean;
  isRecording: boolean;
  onFinishAudioTurn: () => void;
  onStart: () => void;
  onStartAudioTurn: () => void;
  onStop: () => void;
  sessionReady: boolean;
};

export function VoiceSessionPanel({
  audioRef,
  canRecordAudioTurn,
  hasPriorActivity,
  isRunning,
  isRecording,
  onFinishAudioTurn,
  onStart,
  onStartAudioTurn,
  onStop,
  sessionReady
}: VoiceSessionPanelProps) {
  const startLabel = hasPriorActivity ? "Continue tutoring" : "Start tutoring";

  return (
    <Panel
      className="session-panel"
      description="Speak naturally, keep the lesson moving."
      id="session-title"
      title="Voice session"
    >
      <div className="controls">
        <ActionButton
          disabled={!sessionReady || isRunning}
          icon="play"
          onClick={onStart}
          variant="primary"
        >
          {startLabel}
        </ActionButton>
        <ActionButton disabled={!isRunning} icon="stop" onClick={onStop} variant="secondary">
          End session
        </ActionButton>
        {canRecordAudioTurn ? (
          <ActionButton
            disabled={!isRunning}
            icon={isRecording ? "send" : "play"}
            onClick={isRecording ? onFinishAudioTurn : onStartAudioTurn}
            variant="secondary"
          >
            {isRecording ? "Stop and send" : "Record answer"}
          </ActionButton>
        ) : null}
      </div>

      <div className="session-note">
        <h3>Session behavior</h3>
        <p>
          The tutor gives one step at a time. Record your answer after each prompt, then wait for the
          next hint or question.
        </p>
      </div>

      <audio ref={audioRef} id="remote-audio" autoPlay />
    </Panel>
  );
}
