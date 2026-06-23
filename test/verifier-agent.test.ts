import assert from "node:assert/strict";

import { runVerifierAgent } from "../src/modules/tutoring/verifier-agent.ts";
import { installVoiceProviders, type VoiceProviderFake } from "./helpers/fake-voice-providers.ts";
import type { ProblemFrame } from "../src/modules/problems/problem-frame.ts";

function env(fake: VoiceProviderFake | null) {
  return {
    OPENAI_API_KEY: "test-openai-key",
    OPENROUTER_API_KEY: "test-openrouter-key",
    REASONING_TEST_TRANSPORT: fake?.reasoningTransport
  };
}

let fake: VoiceProviderFake | null = null;
afterEach(() => {
  fake?.restore();
  fake = null;
});

const frame: ProblemFrame = {
  diagramDescription: null,
  extractedText: "There were 150 books. 80 were borrowed. How many books are left?",
  languageIsSubject: false,
  likelySkillKeys: [],
  problemType: "word_problem",
  quantities: [
    { label: "books", raw: "150" },
    { label: "borrowed", raw: "80" }
  ],
  relationships: ["80 were borrowed"],
  taskLanguage: "en",
  unknownTarget: "how many books are left",
  visibleQuestion: "How many books are left?"
};

test("runVerifierAgent sends the verifier rubric to reasoning and parses the verdict", async () => {
  fake = installVoiceProviders({ verifier: { studentStatus: "correct" } });

  const verdict = await runVerifierAgent(
    { frame, kind: "final_answer", question: frame.visibleQuestion, studentText: "70 books are left" },
    env(fake)
  );

  assert.equal(verdict.studentStatus, "correct");
  assert.equal(verdict.confidence, "high");
  assert.equal(verdict.correctionHint, null);

  const input = fake.calls.workflowInputs("verifier")[0] ?? "";
  assert.match(input, /narrow answer verifier/i);
});

test("runVerifierAgent never sends a worked answer to the model", async () => {
  const leaky: ProblemFrame = {
    ...frame,
    extractedText: "How many books are left? The answer is 70.",
    relationships: ["150 − 80 = 70"],
    unknownTarget: "70"
  };

  fake = installVoiceProviders({ verifier: { studentStatus: "unknown" } });

  await runVerifierAgent(
    { frame: leaky, kind: "final_answer", question: "How many are left?", studentText: "um" },
    env(fake)
  );

  const input = fake.calls.workflowInputs("verifier")[0] ?? "";
  assert.doesNotMatch(input, /answer is\s*70/i, "worked answer phrasing must be scrubbed");
  assert.doesNotMatch(input, /=\s*70/, "trailing computed answer must be scrubbed");
  assert.doesNotMatch(input, /"unknownTarget":\s*"70"/, "a numeric-only target is the answer in disguise");
  assert.match(input, /"raw":\s*"150"/, "givens are preserved");
});

test("runVerifierAgent rejects an out-of-enum verdict", async () => {
  await assert.rejects(
    runVerifierAgent(
      { frame, kind: "step", question: "x", studentText: "y" },
      {
        OPENAI_API_KEY: "test-openai-key",
        OPENROUTER_API_KEY: "test-openrouter-key",
        REASONING_TEST_TRANSPORT: {
          async runReasoningWorkflow() {
            return {
              confidence: "high",
              correctionHint: null,
              misconceptionKey: null,
              studentStatus: "maybe"
            };
          }
        }
      }
    ),
    /verifier/i
  );
});
