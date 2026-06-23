/**
 * extractQuestion (vision) through the in-app reasoning executor.
 *
 * The app ships the extraction instructions as the reasoning `input` and the presigned
 * image URL as `imageUrl`, then applies normalizeExtractionResponse (scrub + outcome
 * normalization) to the result.
 */

import assert from "node:assert/strict";

import { HttpError } from "../src/core/http-error.ts";
import { extractQuestionFromImageUrl } from "../src/modules/problems/question-extraction-service.ts";

const fullExtractionPayload = {
  confidence: "high" as const,
  diagramDescription: null,
  extractedText: "What is the value of x?",
  languageIsSubject: false,
  likelySkillKeys: [],
  notes: null,
  outcome: "extracted" as const,
  problemType: "equation" as const,
  quantities: [],
  question: "What is the value of x?",
  relationships: [],
  taskLanguage: "en",
  unknownTarget: "the value of x"
};

const imageUrl = "https://r2.example.com/session-1/image.jpg";

type ReasoningCall = { imageUrl?: string; input: string; stage: string };

function makeReasoningTransport(result: unknown, calls: ReasoningCall[]) {
  return {
    async runReasoningWorkflow(payload: { stage: string; input: string; imageUrl?: string }) {
      calls.push({
        imageUrl: payload.imageUrl,
        input: payload.input,
        stage: payload.stage
      });
      return result;
    }
  };
}

test("extractQuestionFromImageUrl routes through reasoning and scrubs the result", async () => {
  const calls: ReasoningCall[] = [];
  const env = {
    REASONING_TEST_TRANSPORT: makeReasoningTransport(fullExtractionPayload, calls)
  };

  const response = await extractQuestionFromImageUrl(imageUrl, env);

  const reasoningCall = calls.find((call) => call.stage === "extract-question");
  assert.ok(reasoningCall, "expected a reasoning invocation");
  assert.equal(reasoningCall!.imageUrl, imageUrl);
  assert.match(reasoningCall!.input, /Extract the homework problem/);

  // The app's normalization still ran on the reasoning result.
  assert.equal(response.outcome, "extracted");
  assert.equal(response.question, "What is the value of x?");
  assert.equal(response.frame.unknownTarget, "the value of x");
  assert.equal(response.requiresConfirmation, true);
});

test("extractQuestionFromImageUrl degrades an out-of-enum problemType to \"other\" instead of failing", async () => {
  // Regression: an older reasoning schema once typed problemType as a bare string, so the
  // model could return "word problem" (space) where the app enum requires "word_problem"
  // (underscore). problemType is supplementary, so an unrecognized value must degrade to
  // "other", not sink the upload.
  const calls: ReasoningCall[] = [];
  const env = {
    REASONING_TEST_TRANSPORT: makeReasoningTransport(
      { ...fullExtractionPayload, problemType: "word problem" },
      calls
    )
  };

  const response = await extractQuestionFromImageUrl(imageUrl, env);

  assert.equal(response.outcome, "extracted");
  assert.equal(response.frame.problemType, "other");
});

test("extractQuestionFromImageUrl maps a reasoning failure to HttpError(502)", async () => {
  // Extraction is NOT fail-soft (it runs at session creation, outside the turn loop): a
  // reasoning failure must surface, not degrade.
  const env = {
    REASONING_TEST_TRANSPORT: {
      async runReasoningWorkflow() {
        throw new HttpError(502, "upstream error");
      }
    }
  };

  await assert.rejects(
    extractQuestionFromImageUrl(imageUrl, env),
    (error: unknown) => {
      assert.equal((error as { status?: number }).status, 502);
      return true;
    }
  );
});

test("extractQuestionFromImageUrl uses reasoning by default", async () => {
  const calls: ReasoningCall[] = [];
  const env = {
    REASONING_TEST_TRANSPORT: makeReasoningTransport(fullExtractionPayload, calls)
  };

  const response = await extractQuestionFromImageUrl(imageUrl, env);
  assert.equal(response.outcome, "extracted");
  assert.equal(calls.length, 1);
});
