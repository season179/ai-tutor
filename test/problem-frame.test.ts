import assert from "node:assert/strict";
import test from "node:test";

import { frameContainsComputedSolution } from "../dist/problem-context/problem-frame.js";
import { buildProblemFrame } from "../dist/problem-context/question-extraction-service.js";

test("frameContainsComputedSolution flags numeric-only unknown targets", () => {
  const frame = buildProblemFrame({
    confidence: "high",
    diagramDescription: null,
    extractedText: "24 stickers shared among 4 friends.",
    languageIsSubject: false,
    likelySkillKeys: [],
    notes: null,
    outcome: "extracted",
    problemType: "word_problem",
    quantities: [{ label: "stickers", raw: "24" }],
    question: "How many stickers does each friend get?",
    relationships: ["shared equally"],
    taskLanguage: "en",
    unknownTarget: "6"
  });

  assert.equal(frameContainsComputedSolution(frame), true);
});

test("frameContainsComputedSolution allows goal language without a computed answer", () => {
  const frame = buildProblemFrame({
    confidence: "high",
    diagramDescription: null,
    extractedText: "24 stickers shared among 4 friends.",
    languageIsSubject: false,
    likelySkillKeys: [],
    notes: null,
    outcome: "extracted",
    problemType: "word_problem",
    quantities: [{ label: "stickers", raw: "24" }],
    question: "How many stickers does each friend get?",
    relationships: ["shared equally"],
    taskLanguage: "en",
    unknownTarget: "how many stickers each friend gets"
  });

  assert.equal(frameContainsComputedSolution(frame), false);
});
