import type { RefObject } from "react";

import { VoiceBar } from "./VoiceBar.js";

type CenterAnchorProps = {
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
 * The Anchor: the one fixed instrument panel at the bottom of the center column.
 * A single focus card (the current call to action) sits above the voice bar.
 */
export function CenterAnchor({
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
}: CenterAnchorProps) {
  return (
    <div className="cc-anchor">
      <div className="focus-card">
        <div className="focus-kicker">Your turn</div>
        <div className="ask">{focusAsk(isRunning, isRecording)}</div>
      </div>

      <VoiceBar
        audioRef={audioRef}
        canRecordAudioTurn={canRecordAudioTurn}
        hasPriorActivity={hasPriorActivity}
        isRecording={isRecording}
        isRunning={isRunning}
        onFinishAudioTurn={onFinishAudioTurn}
        onStart={onStart}
        onStartAudioTurn={onStartAudioTurn}
        onStop={onStop}
        sessionReady={sessionReady}
      />
    </div>
  );
}

function focusAsk(isRunning: boolean, isRecording: boolean): string {
  if (!isRunning) {
    return "Ready to start? Tap to talk and say hi 👋";
  }

  if (isRecording) {
    return "I'm listening — tell me what you're thinking.";
  }

  return "Your turn — tap the mic and talk it out.";
}
