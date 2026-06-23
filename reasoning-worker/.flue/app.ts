import { getModels } from "@earendil-works/pi-ai";
import { flue } from "@flue/runtime/routing";
import { Hono } from "hono";

const app = new Hono();

const catalogProviders = ["openai", "openrouter", "anthropic", "google", "mistral"] as const;

const reasoningFields = {
  gate_check_model: { requiresImage: false },
  verifier_model: { requiresImage: false },
  tutor_model: { requiresImage: false },
  extract_model: { requiresImage: true }
} as const;

app.get("/model-options", (context) => {
  const reasoning = Object.fromEntries(
    Object.entries(reasoningFields).map(([field, requirement]) => [
      field,
      modelOptions(requirement.requiresImage)
    ])
  );

  return context.json({ reasoning });
});

app.route("/", flue());

export default app;

function modelOptions(requiresImage: boolean) {
  const requiredInput = requiresImage ? "image" : "text";
  return catalogProviders.flatMap((provider) =>
    getModels(provider)
      .filter((model) => model.input.includes(requiredInput))
      .map((model) => ({
        provider,
        model: model.id,
        label: model.name || model.id,
        input: model.input,
        reasoning: Boolean(model.reasoning)
      }))
  );
}
