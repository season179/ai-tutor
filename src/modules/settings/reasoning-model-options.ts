import type {
  ProviderModelSetting,
  ReasoningStage,
  SettingType,
  SettingsModelOption,
  SettingsModelOptions,
} from "./settings-types.js";

type ReasoningSettingType = Extract<
  SettingType,
  "gate_check_model" | "verifier_model" | "tutor_model" | "extract_model"
>;

const openAiReasoningModels: SettingsModelOption[] = [
  {
    provider: "openai",
    model: "gpt-5.5",
    label: "GPT-5.5",
    input: ["text", "image"],
    reasoning: true,
  },
  {
    provider: "openai",
    model: "gpt-5.4-mini",
    label: "GPT-5.4 mini",
    input: ["text", "image"],
    reasoning: true,
  },
];

const openRouterReasoningModels: SettingsModelOption[] = [
  {
    provider: "openrouter",
    model: "google/gemini-3.5-flash",
    label: "Google: Gemini 3.5 Flash",
    input: ["text", "image"],
    reasoning: false,
  },
  {
    provider: "openrouter",
    model: "nvidia/nemotron-3-ultra-550b-a55b",
    label: "NVIDIA: Nemotron 3 Ultra 550B",
    input: ["text"],
    reasoning: true,
  },
];

const visionCapableReasoningModels: SettingsModelOption[] = [
  ...openAiReasoningModels,
  {
    provider: "openrouter",
    model: "google/gemini-3.5-flash",
    label: "Google: Gemini 3.5 Flash",
    input: ["text", "image"],
    reasoning: false,
  },
];

const textReasoningModels: SettingsModelOption[] = [
  ...openAiReasoningModels,
  ...openRouterReasoningModels,
];

export const reasoningModelOptionsBySetting: Record<
  ReasoningSettingType,
  SettingsModelOption[]
> = {
  gate_check_model: textReasoningModels,
  verifier_model: textReasoningModels,
  tutor_model: textReasoningModels,
  extract_model: visionCapableReasoningModels,
};

export const settingsModelOptions: SettingsModelOptions = {
  reasoning: reasoningModelOptionsBySetting,
};

const settingTypeByStage: Record<ReasoningStage, ReasoningSettingType> = {
  "gate-check": "gate_check_model",
  verifier: "verifier_model",
  "tutor-turn": "tutor_model",
  "extract-question": "extract_model",
};

const defaultModelByStage: Record<ReasoningStage, ProviderModelSetting> = {
  "gate-check": { provider: "openai", model: "gpt-5.4-mini" },
  verifier: { provider: "openai", model: "gpt-5.5" },
  "tutor-turn": {
    provider: "openrouter",
    model: "google/gemini-3.5-flash",
  },
  "extract-question": { provider: "openai", model: "gpt-5.5" },
};

export function defaultReasoningModelSpecifier(stage: ReasoningStage): string {
  const setting = defaultModelByStage[stage];
  return `${setting.provider}/${setting.model}`;
}

export function modelOptionsForStage(
  stage: ReasoningStage,
): SettingsModelOption[] {
  return reasoningModelOptionsBySetting[settingTypeByStage[stage]] ?? [];
}

export function isSupportedReasoningModel(
  type: SettingType,
  setting: ProviderModelSetting,
): boolean {
  if (!isReasoningSettingType(type)) return true;
  const options = reasoningModelOptionsBySetting[type] ?? [];
  return options.some(
    (option) =>
      option.provider === setting.provider && option.model === setting.model,
  );
}

function isReasoningSettingType(type: SettingType): type is ReasoningSettingType {
  return (
    type === "gate_check_model" ||
    type === "verifier_model" ||
    type === "tutor_model" ||
    type === "extract_model"
  );
}
