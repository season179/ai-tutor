import type { RefObject } from "react";

import type { SessionPhase } from "../../tutor-action.js";
import { VoiceBar } from "./VoiceBar.js";

type CenterAnchorProps = {
  audioRef: RefObject<HTMLAudioElement | null>;
  canRecordAudioTurn: boolean;
  currentPhase: SessionPhase;
  focusAsk: string | null;
  hasPriorActivity: boolean;
  isRecording: boolean;
  isRunning: boolean;
  onFinishAudioTurn: () => void;
  onHint: () => void;
  onPark: () => void;
  onStart: () => void;
  onStartAudioTurn: () => void;
  onStop: () => void;
  outputLanguageLabel: string | null;
  pendingHint: string | null;
  scaffoldAid: string | null;
  sessionReady: boolean;
};

/**
 * The Anchor: the one fixed instrument panel at the bottom of the center column.
 * A single focus card (the current call to action) sits above the voice bar.
 */
export function CenterAnchor({
  audioRef,
  canRecordAudioTurn,
  currentPhase,
  focusAsk,
  hasPriorActivity,
  isRecording,
  isRunning,
  onFinishAudioTurn,
  onHint,
  onPark,
  onStart,
  onStartAudioTurn,
  onStop,
  outputLanguageLabel,
  pendingHint,
  scaffoldAid,
  sessionReady
}: CenterAnchorProps) {
  const inStepLoop = currentPhase === "step_loop";
  const inAnswerCheck = currentPhase === "answer_check";
  const inWrap = currentPhase === "wrap_up" || currentPhase === "memory_write";

  return (
    <div className="cc-anchor">
      <div className="focus-card">
        <div className="focus-kicker">
          {kickerLabel(currentPhase, Boolean(focusAsk))}
          {outputLanguageLabel && inAnswerCheck ? (
            <span className="lang-chip">{outputLanguageLabel}</span>
          ) : null}
        </div>
        <div className="ask">{resolveAsk(focusAsk, inWrap, isRunning, isRecording)}</div>
        {pendingHint && inStepLoop ? (
          <div className="aid aid--hint">
            <HintBulb />
            {pendingHint}
          </div>
        ) : null}
        {scaffoldAid && inStepLoop && !pendingHint ? (
          <div className="aid">
            <AidDots />
            {scaffoldAid}
          </div>
        ) : null}
      </div>

      <VoiceBar
        audioRef={audioRef}
        canRecordAudioTurn={canRecordAudioTurn}
        hasPriorActivity={hasPriorActivity}
        isRecording={isRecording}
        isRunning={isRunning}
        onFinishAudioTurn={onFinishAudioTurn}
        onHint={inStepLoop ? onHint : undefined}
        onPark={inStepLoop ? onPark : undefined}
        onStart={onStart}
        onStartAudioTurn={onStartAudioTurn}
        onStop={onStop}
        sessionReady={sessionReady}
      />
    </div>
  );
}

function kickerLabel(phase: SessionPhase, hasFocusAsk: boolean): string {
  if (phase === "wrap_up") {
    return "You did it";
  }

  if (phase === "memory_write") {
    return "Quick reflection";
  }

  if (phase === "answer_check") {
    return "Say the answer";
  }

  if ((phase === "step_loop" || phase === "plan_first_step") && hasFocusAsk) {
    return "One step";
  }

  return "Your turn";
}

function resolveAsk(
  focusAsk: string | null,
  inWrap: boolean,
  isRunning: boolean,
  isRecording: boolean
): string {
  if (focusAsk?.trim()) {
    return focusAsk;
  }

  if (inWrap) {
    return "Take a breath — you worked that all the way through.";
  }

  if (!isRunning) {
    return "Ready to start? Tap to talk and say hi 👋";
  }

  if (isRecording) {
    return "I'm listening — tell me what you're thinking.";
  }

  return "Your turn — tap the mic and talk it out.";
}

function AidDots() {
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
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

function HintBulb() {
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
      <path d="M12 3a6 6 0 0 0-4 10c.8.7 1 1.2 1 2v1h6v-1c0-.8.2-1.3 1-2a6 6 0 0 0-4-10z" />
      <path d="M9 21h6" />
    </svg>
  );
}
