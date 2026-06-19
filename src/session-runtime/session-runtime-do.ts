import { DurableObject } from "cloudflare:workers";

import { D1SessionStore } from "../d1-session-store.js";
import type { RequestContext } from "../request-context.js";
import { handleVoicePipelineTurnWithStore, type VoicePipelineServiceEnv } from "../voice-pipeline-service.js";
import type { VoicePipelineTurnRequest, VoicePipelineTurnResponse } from "../voice-types.js";
import { hintNudgeForSupportLevel, hintTimerEventMessage, hintWaitMs, shouldArmHintTimer } from "./hint-timer.js";

export type ProcessTurnPayload = {
  body: unknown;
  context: RequestContext;
};

type SessionRuntimeEnv = VoicePipelineServiceEnv & {
  DB: D1Database;
};

/**
 * One DO per tutoring session. Serializes turns and owns the step-loop hint timer.
 * Snapshots remain in D1 via the existing SessionStore path inside each turn.
 */
export class SessionRuntimeDO extends DurableObject<SessionRuntimeEnv> {
  async processTurn(payload: ProcessTurnPayload): Promise<VoicePipelineTurnResponse> {
    const store = new D1SessionStore(this.env.DB);
    const response = await handleVoicePipelineTurnWithStore(payload.body, this.env, store, payload.context);

    const request = payload.body as VoicePipelineTurnRequest;
    await this.ctx.storage.put("ownerKey", payload.context.ownerKey);
    await this.ctx.storage.put("sessionId", request.sessionId);

    if (shouldArmHintTimer(response.session.currentPhase)) {
      await this.ctx.storage.setAlarm(Date.now() + hintWaitMs);
    } else {
      await this.ctx.storage.deleteAlarm();
    }

    return response;
  }

  override async alarm(): Promise<void> {
    const ownerKey = await this.ctx.storage.get<string>("ownerKey");
    const sessionId = await this.ctx.storage.get<string>("sessionId");

    if (!ownerKey || !sessionId) {
      return;
    }

    const store = new D1SessionStore(this.env.DB);
    const detail = await store.getSession(ownerKey, sessionId);

    if (!detail || !shouldArmHintTimer(detail.session.currentPhase)) {
      return;
    }

    await store.appendEvent(ownerKey, sessionId, {
      message: hintTimerEventMessage,
      value: {
        kind: "idle_nudge",
        supportLevel: detail.session.supportLevel,
        // Derive the nudge from the live step (answer-free fields only), not a fixed script.
        text: hintNudgeForSupportLevel(detail.session.supportLevel, {
          ask: detail.session.activeStep?.ask ?? null,
          scaffoldAid: detail.session.activeStep?.scaffoldAid ?? null
        })
      }
    });

    await this.ctx.storage.setAlarm(Date.now() + hintWaitMs);
  }
}
