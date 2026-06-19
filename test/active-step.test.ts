import assert from "node:assert/strict";
import test from "node:test";

import { deriveFinalAnswerCheck, deriveFirstCheckableStep } from "../dist/active-step.js";
import type { ProblemFrame } from "../src/problem-context/problem-frame.ts";

function wordProblem(overrides: Partial<ProblemFrame>): ProblemFrame {
  return {
    diagramDescription: null,
    extractedText: "",
    languageIsSubject: false,
    likelySkillKeys: [],
    problemType: "word_problem",
    quantities: [],
    relationships: [],
    taskLanguage: "en",
    unknownTarget: null,
    visibleQuestion: "",
    ...overrides
  };
}

const sharingFrame: ProblemFrame = {
  diagramDescription: null,
  extractedText: "24 stickers are shared equally among 4 friends.",
  languageIsSubject: false,
  likelySkillKeys: [],
  problemType: "word_problem",
  quantities: [{ label: "stickers", raw: "24" }],
  relationships: ["shared equally among 4 friends"],
  taskLanguage: "en",
  unknownTarget: "how many stickers each friend gets",
  visibleQuestion: "How many stickers does each friend get?"
};

test("deriveFirstCheckableStep seeds a one-sticker-each step for sharing problems", () => {
  const step = deriveFirstCheckableStep(sharingFrame);

  assert.ok(step);
  assert.equal(step.expectedAnswers[0], 4);
  assert.match(step.ask, /1 sticker/i);
  assert.match(step.scaffoldAid, /4 friends/);
  assert.ok(step.distractorNudges["24"]?.includes("all the stickers"));
});

test("deriveFirstCheckableStep reads friend count from a friends quantity row", () => {
  const step = deriveFirstCheckableStep({
    ...sharingFrame,
    relationships: ["shared equally"],
    quantities: [
      { label: "stickers", raw: "24" },
      { label: "friends", raw: "4" }
    ]
  });

  assert.equal(step?.expectedAnswers[0], 4);
});

test("deriveFirstCheckableStep returns null without a friend count", () => {
  const step = deriveFirstCheckableStep({
    ...sharingFrame,
    relationships: ["shared equally"],
    quantities: [{ label: "stickers", raw: "24" }]
  });

  assert.equal(step, null);
});

test("deriveFinalAnswerCheck computes a clean subtraction problem", () => {
  const step = deriveFinalAnswerCheck(
    wordProblem({
      extractedText: "There were 150 books. 80 were borrowed. How many books are left?",
      quantities: [
        { label: "books", raw: "150" },
        { label: "borrowed", raw: "80" }
      ],
      relationships: ["80 were borrowed"],
      unknownTarget: "how many books are left",
      visibleQuestion: "How many books are left?"
    })
  );

  assert.ok(step);
  assert.deepEqual(step.expectedAnswers, [70]);
  assert.equal(step.scaffoldAid, "150 − 80");
  // The wrong-operation result (the sum) is offered as a redirect, never the answer.
  assert.ok(step.distractorNudges["230"]?.includes("total"));
});

test("deriveFinalAnswerCheck computes a clean addition problem", () => {
  const step = deriveFinalAnswerCheck(
    wordProblem({
      extractedText: "Ali has 30 marbles and Mei has 45 marbles. How many marbles do they have altogether?",
      quantities: [
        { label: "Ali", raw: "30" },
        { label: "Mei", raw: "45" }
      ],
      visibleQuestion: "How many marbles do they have altogether?"
    })
  );

  assert.ok(step);
  assert.deepEqual(step.expectedAnswers, [75]);
  assert.equal(step.scaffoldAid, "30 + 45");
});

test("deriveFinalAnswerCheck defers (null) when a total cue hides a multiplication", () => {
  const step = deriveFinalAnswerCheck(
    wordProblem({
      extractedText: "There are 5 boxes of 4 pencils. How many pencils are there in total?",
      quantities: [
        { label: "boxes", raw: "5" },
        { label: "pencils per box", raw: "4" }
      ],
      visibleQuestion: "How many pencils are there in total?"
    })
  );

  assert.equal(step, null, "5 + 4 would be a confident wrong grade — the LLM track must handle this");
});

test("deriveFinalAnswerCheck defers (null) with three givens or no operation cue", () => {
  const threeGivens = deriveFinalAnswerCheck(
    wordProblem({
      extractedText: "Ali ate 30, Mei ate 45, Sam ate 10. How many altogether?",
      quantities: [
        { label: "Ali", raw: "30" },
        { label: "Mei", raw: "45" },
        { label: "Sam", raw: "10" }
      ],
      visibleQuestion: "How many altogether?"
    })
  );
  assert.equal(threeGivens, null);

  const noCue = deriveFinalAnswerCheck(
    wordProblem({
      extractedText: "Ali has 30 marbles. Mei has 45 marbles.",
      quantities: [
        { label: "Ali", raw: "30" },
        { label: "Mei", raw: "45" }
      ],
      visibleQuestion: "Compare the two collections."
    })
  );
  assert.equal(noCue, null);
});
