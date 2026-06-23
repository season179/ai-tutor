import type { ThinkingLevel } from "@flue/runtime";

// The direct OpenAI endpoint reports its no-reasoning tier as "none", but Flue validates
// the public ThinkingLevel enum before provider dispatch. Use Flue's "off" value here;
// the provider adapter is responsible for translating that into OpenAI's no-reasoning mode.
const flueNoReasoning: ThinkingLevel = "off";

export function gateCheckThinkingLevel(model?: string): ThinkingLevel {
  return isDirectOpenAiModel(model) ? flueNoReasoning : "low";
}

export function verifierThinkingLevel(_model?: string): ThinkingLevel {
  return "low";
}

export function tutorThinkingLevel(model?: string): ThinkingLevel {
  return isDirectOpenAiModel(model) ? flueNoReasoning : "minimal";
}

function isDirectOpenAiModel(model?: string): boolean {
  return model?.startsWith("openai/") ?? false;
}
