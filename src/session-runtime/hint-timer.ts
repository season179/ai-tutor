/** Idle wait before a gentle hint nudge in the step loop (M5). */
export const hintWaitMs = 60_000;

export const hintTimerEventMessage = "Hint timer";

export function hintNudgeForSupportLevel(supportLevel: number): string {
  switch (supportLevel) {
    case 0:
      return "Take your time — point to each friend as you count.";
    case 1:
      return "Hint: one sticker for each friend first. How many friends are there?";
    case 2:
      return "Hint: count the friends — that's how many stickers if everyone gets one.";
    default:
      return "Hint: try giving one sticker to each friend. How many is that?";
  }
}

export function shouldArmHintTimer(phase: string): boolean {
  return phase === "step_loop";
}
