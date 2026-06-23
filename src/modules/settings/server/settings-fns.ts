import { createServerFn } from "@tanstack/react-start";

import { authenticateServerRequest, workerEnv } from "../../../server-request-context.js";
import {
  serverFnMiddleware,
  writeServerFnMiddleware
} from "../../../core/server-fn-middleware.js";
import { HttpError } from "../../../core/http-error.js";
import { D1SettingsStore } from "../settings-store.js";
import { providerSettingsPatchSchema } from "../settings-schema.js";
import {
  isSupportedReasoningModel,
  settingsModelOptions
} from "../reasoning-model-options.js";
import {
  REASONING_MODEL_SETTING_TYPES,
  providerModelSpecifier,
  type ProviderSettings,
  type ProviderSettingsPatch,
  type ReasoningModelSettingType,
  type SettingsModelOptions
} from "../settings-types.js";
import { requireAdmin } from "./settings-admin-gate.js";

// Thin server-function adapters over the provider/model settings store. Mirrors the session
// server fns: a GET reads the full typed snapshot, a POST upserts a partial patch. Both
// require an AUTHENTICATED ADMIN session (the gate below) — settings mutate global config, so
// only users whose `role === "admin"` may read or write them. The gate here is the real
// protection layer; the frontend hides the page/link for non-admins, but a direct server-fn
// call from a non-admin still fails with 403 here.

export const getSettingsFn = createServerFn({ method: "GET" })
  .middleware(serverFnMiddleware)
  .handler(async (): Promise<ProviderSettings> => {
    const { context } = await authenticateServerRequest();
    requireAdmin(context.identity.role);
    const store = new D1SettingsStore(workerEnv().DB);
    return store.getAllSettings();
  });

export const getSettingsModelOptionsFn = createServerFn({ method: "GET" })
  .middleware(serverFnMiddleware)
  .handler(async (): Promise<SettingsModelOptions> => {
    const { context } = await authenticateServerRequest();
    requireAdmin(context.identity.role);
    return settingsModelOptions;
  });

export const saveSettingsFn = createServerFn({ method: "POST" })
  .middleware(writeServerFnMiddleware)
  .validator((input: ProviderSettingsPatch) => providerSettingsPatchSchema.parse(input))
  .handler(async ({ data }): Promise<ProviderSettings> => {
    const { context } = await authenticateServerRequest();
    requireAdmin(context.identity.role);
    assertReasoningModelsAreSupported(data);
    const store = new D1SettingsStore(workerEnv().DB);
    return store.saveSettings(data);
  });

function assertReasoningModelsAreSupported(patch: ProviderSettingsPatch): void {
  const reasoningEntries = REASONING_MODEL_SETTING_TYPES.flatMap((type) =>
    Object.hasOwn(patch, type) && patch[type] ? [[type, patch[type]] as const] : []
  );

  if (reasoningEntries.length === 0) {
    return;
  }

  for (const [type, setting] of reasoningEntries) {
    if (!isSupportedReasoningModel(type, setting)) {
      throw new HttpError(
        400,
        `${fieldLabel(type)} must use a supported reasoning model. "${providerModelSpecifier(setting)}" is not in the local reasoning model registry.`
      );
    }
  }
}

function fieldLabel(type: ReasoningModelSettingType): string {
  switch (type) {
    case "gate_check_model":
      return "Gate-check model";
    case "verifier_model":
      return "Verifier model";
    case "tutor_model":
      return "Tutor model";
    case "extract_model":
      return "Extract-question model";
  }
}
