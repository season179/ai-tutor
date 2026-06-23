import assert from "node:assert/strict";

import {
  mapD1ProblemContextRow,
  mapD1SessionRow,
  MemorySessionStore
} from "../src/modules/sessions/memory-session-store.ts";
import { updateSession } from "../src/modules/sessions/session-handler.ts";
import type { RequestContext } from "../src/core/request-context.ts";

const ownerKey = "access:user-a";
const context: RequestContext = {
  identity: { userId: "user-a" },
  ownerKey
};

test("MemorySessionStore scopes sessions by owner key", async () => {
  const store = new MemorySessionStore();
  const ownerA = "access:user-a";
  const ownerB = "access:user-b";

  const sessionA = await store.createSession(ownerA, { title: "Owner A" });
  const sessionB = await store.createSession(ownerB, { title: "Owner B" });

  const listA = await store.listSessions(ownerA);
  const listB = await store.listSessions(ownerB);

  assert.equal(listA.length, 1);
  assert.equal(listB.length, 1);
  assert.equal(listA[0]?.id, sessionA.id);
  assert.equal(listB[0]?.id, sessionB.id);

  assert.equal(await store.sessionExists(ownerA, sessionB.id), false);
  assert.equal(await store.getSession(ownerB, sessionA.id), null);
});

test("MemorySessionStore appends events and updates session timestamps", async () => {
  const store = new MemorySessionStore();
  const ownerKey = "access:user-a";
  const session = await store.createSession(ownerKey);

  await store.appendEvent(ownerKey, session.id, {
    message: "Voice session connected",
    value: { provider: "openai-voice-pipeline" }
  });

  const detail = await store.getSession(ownerKey, session.id);
  assert.ok(detail);
  assert.equal(detail.events.length, 1);
  assert.equal(detail.events[0]?.message, "Voice session connected");
  assert.notEqual(detail.session.updatedAt, session.updatedAt);
});

test("MemorySessionStore updates image metadata without storing data URLs", async () => {
  const store = new MemorySessionStore();
  const ownerKey = "access:user-a";
  const session = await store.createSession(ownerKey);

  const updated = await store.updateSession(ownerKey, session.id, {
    imageMeta: { bytes: 120_000, height: 900, width: 1200 },
    imageName: "worksheet.jpg",
    imagePrompt: "Walk me through this problem."
  });

  assert.ok(updated);
  assert.deepEqual(updated?.imageMeta, { bytes: 120_000, height: 900, width: 1200 });
  assert.equal(updated?.imageName, "worksheet.jpg");
  assert.equal(updated?.imagePrompt, "Walk me through this problem.");
});

test("MemorySessionStore transferOwnerSessions moves sessions and preserves events", async () => {
  const store = new MemorySessionStore();
  const ownerA = "user-a";
  const ownerB = "user-b";
  const otherOwner = "user-c";

  const sessionA1 = await store.createSession(ownerA, { title: "Session A1" });
  const sessionA2 = await store.createSession(ownerA, { title: "Session A2" });
  const sessionC = await store.createSession(otherOwner, { title: "Session C" });

  await store.appendEvent(ownerA, sessionA1.id, { message: "Event A1" });
  await store.appendEvent(ownerA, sessionA2.id, { message: "Event A2" });

  const transferred = await store.transferOwnerSessions(ownerA, ownerB);

  assert.equal(transferred, 2);
  assert.equal((await store.listSessions(ownerA)).length, 0);
  assert.deepEqual(
    (await store.listSessions(ownerB)).map((session) => session.id).sort(),
    [sessionA1.id, sessionA2.id].sort()
  );
  assert.equal((await store.listSessions(otherOwner))[0]?.id, sessionC.id);

  const detail = await store.getSession(ownerB, sessionA1.id);
  assert.ok(detail);
  assert.equal(detail.events[0]?.message, "Event A1");
});

test("MemorySessionStore starts sessions at the opening phase with support off", async () => {
  const store = new MemorySessionStore();
  const ownerKey = "access:user-a";
  const session = await store.createSession(ownerKey);

  assert.equal(session.currentPhase, "session_open");
  assert.equal(session.gateStatus, null);
  assert.equal(session.supportLevel, 0);
});

test("advanceSessionPhase moves the phase when the expected phase matches", async () => {
  const store = new MemorySessionStore();
  const ownerKey = "access:user-a";
  const session = await store.createSession(ownerKey);

  const advanced = await store.advanceSessionPhase(ownerKey, session.id, "session_open", {
    activeStep: null,
    currentPhase: "frame_task",
    gateStatus: "needs_restatement",
    supportLevel: 0
  });

  assert.ok(advanced);
  assert.equal(advanced?.currentPhase, "frame_task");
  assert.equal(advanced?.gateStatus, "needs_restatement");

  const detail = await store.getSession(ownerKey, session.id);
  assert.equal(detail?.session.currentPhase, "frame_task");
});

test("advanceSessionPhase refuses to advance when the expected phase is stale", async () => {
  const store = new MemorySessionStore();
  const ownerKey = "access:user-a";
  const session = await store.createSession(ownerKey);

  const result = await store.advanceSessionPhase(ownerKey, session.id, "step_loop", {
    activeStep: null,
    currentPhase: "answer_check",
    gateStatus: null,
    supportLevel: 0
  });

  assert.equal(result, null);
  const detail = await store.getSession(ownerKey, session.id);
  assert.equal(detail?.session.currentPhase, "session_open");
});

test("MemorySessionStore records and lists comprehension checks in order", async () => {
  const store = new MemorySessionStore();
  const ownerKey = "access:user-a";
  const session = await store.createSession(ownerKey);

  await store.appendComprehensionCheck(ownerKey, session.id, {
    accepted: false,
    checkKind: "context",
    studentResponse: "It's about sharing stickers."
  });
  await store.appendComprehensionCheck(ownerKey, session.id, {
    accepted: true,
    checkKind: "context",
    studentResponse: "Four friends share 24 stickers."
  });

  const checks = await store.listComprehensionChecks(ownerKey, session.id);
  assert.equal(checks.length, 2);
  assert.equal(checks[0]?.checkKind, "context");
  assert.equal(checks[0]?.accepted, false);
  assert.equal(checks[1]?.accepted, true);
  assert.equal(checks[1]?.sessionId, session.id);
  assert.ok(checks[0]?.createdAt);
});

test("comprehension checks are scoped to their session", async () => {
  const store = new MemorySessionStore();
  const ownerKey = "access:user-a";
  const sessionA = await store.createSession(ownerKey);
  const sessionB = await store.createSession(ownerKey);

  await store.appendComprehensionCheck(ownerKey, sessionA.id, {
    accepted: true,
    checkKind: "target",
    studentResponse: "Find how many each friend gets."
  });

  assert.equal((await store.listComprehensionChecks(ownerKey, sessionA.id)).length, 1);
  assert.equal((await store.listComprehensionChecks(ownerKey, sessionB.id)).length, 0);
});

test("commitTurn applies the advance, events, check, and reflection as one unit", async () => {
  const store = new MemorySessionStore();
  const ownerKey = "access:user-a";
  const session = await store.createSession(ownerKey);
  await store.advanceSessionPhase(ownerKey, session.id, "session_open", {
    activeStep: null,
    currentPhase: "memory_write",
    gateStatus: "complete",
    supportLevel: 0
  });

  const committed = await store.commitTurn(ownerKey, session.id, {
    activate: true,
    advance: { activeStep: null, currentPhase: "wrap_up", gateStatus: "complete", supportLevel: 0 },
    comprehensionCheck: { accepted: true, checkKind: "restatement", studentResponse: "We find each share." },
    events: [
      { message: "Student turn", value: { text: "Drawing helped me." } },
      { message: "Tutor turn", value: { text: "You did it!" } }
    ],
    expectedPhase: "memory_write",
    reflection: { reflectionText: "Drawing one per friend helped." }
  });

  assert.ok(committed);
  assert.equal(committed?.currentPhase, "wrap_up");

  const detail = await store.getSession(ownerKey, session.id);
  assert.equal(detail?.session.currentPhase, "wrap_up");
  assert.equal(detail?.session.status, "active");
  assert.equal(detail?.events.length, 2);
  assert.equal(detail?.reflection?.reflectionText, "Drawing one per friend helped.");
  assert.equal((await store.listComprehensionChecks(ownerKey, session.id)).length, 1);
});

test("commitTurn writes nothing when the optimistic lock loses the race", async () => {
  const store = new MemorySessionStore();
  const ownerKey = "access:user-a";
  const session = await store.createSession(ownerKey); // stays at session_open

  const result = await store.commitTurn(ownerKey, session.id, {
    activate: true,
    advance: { activeStep: null, currentPhase: "answer_check", gateStatus: "complete", supportLevel: 0 },
    comprehensionCheck: { accepted: true, checkKind: "restatement", studentResponse: "x" },
    events: [{ message: "Student turn", value: { text: "x" } }],
    expectedPhase: "step_loop", // wrong — the session is still at session_open
    reflection: { reflectionText: "y" }
  });

  assert.equal(result, null);
  const detail = await store.getSession(ownerKey, session.id);
  // The whole turn is a no-op: phase unchanged and not a single dependent write landed.
  assert.equal(detail?.session.currentPhase, "session_open");
  assert.equal(detail?.session.status, "draft");
  assert.equal(detail?.events.length, 0);
  assert.equal(detail?.reflection, null);
  assert.equal((await store.listComprehensionChecks(ownerKey, session.id)).length, 0);
});

test("mapD1SessionRow normalizes optional image columns", () => {
  const session = mapD1SessionRow({
    created_at: "2026-06-17T01:02:03.000Z",
    extraction_notes: "Bottom cut off.",
    extraction_outcome: "partial",
    id: "session-1",
    image_meta_json: JSON.stringify({ bytes: 120_000, height: 900, width: 1200 }),
    image_name: "",
    image_object_key: "session-1/image.jpg",
    image_prompt: "Find x.",
    owner_key: "access:user-a",
    prompt_confirmed: 1,
    status: "draft",
    title: "Algebra help",
    updated_at: "2026-06-17T01:02:03.000Z"
  });

  assert.deepEqual(session.imageMeta, { bytes: 120_000, height: 900, width: 1200 });
  assert.equal(session.imageName, null);
  assert.equal(session.imagePrompt, "Find x.");
  assert.equal(session.extractionOutcome, "partial");
  assert.equal(session.extractionNotes, "Bottom cut off.");
  assert.equal(session.promptConfirmed, true);
});

test("mapD1SessionRow parses active_step_json", () => {
  const session = mapD1SessionRow({
    active_step_json: JSON.stringify({
      ask: "How many stickers is that?",
      defaultWrongNudge: "Try again.",
      distractorNudges: { "24": "That is the total." },
      expectedAnswers: [4],
      scaffoldAid: "4 friends · 1 sticker each"
    }),
    created_at: "2026-06-17T01:02:03.000Z",
    current_phase: "step_loop",
    current_support_level: 1,
    extraction_notes: null,
    extraction_outcome: null,
    gate_status: "complete",
    id: "session-1",
    image_meta_json: null,
    image_name: null,
    image_object_key: null,
    image_prompt: null,
    owner_key: "access:user-a",
    prompt_confirmed: 0,
    status: "active",
    title: "Sharing",
    updated_at: "2026-06-17T02:03:04.000Z"
  });

  assert.equal(session.activeStep?.expectedAnswers[0], 4);
  assert.equal(session.currentPhase, "step_loop");
  assert.equal(session.supportLevel, 1);
});

test("mapD1ProblemContextRow infers quantities for old rows that stored an empty list", () => {
  const fullStatement =
    "智民小学获得 RM70 000 捐款。校长拨出 RM54 000 给图书馆，剩下的钱要购买单价是 RM1 980 的科学仪器。校长能够购买多少个科学仪器？";

  const context = mapD1ProblemContextRow({
    confirmed_question: null,
    created_at: "2026-06-23T09:54:37.662Z",
    diagram_description: null,
    extracted_text: fullStatement,
    extraction_confidence: "medium",
    extraction_outcome: "extracted",
    id: "problem-1",
    language_is_subject: 0,
    problem_type: "other",
    quantities_json: "[]",
    r2_object_key: "session/image.jpg",
    relationships_json: "[]",
    session_id: "session-1",
    skill_keys_json: "[]",
    task_language: "en",
    unknown_target: fullStatement,
    updated_at: "2026-06-23T09:54:39.899Z"
  });

  assert.deepEqual(
    context.quantities.map((quantity) => quantity.raw),
    ["RM70 000", "RM54 000", "RM1 980"]
  );
});

test("confirming a typed prompt seeds problem context and gate status", async () => {
  const store = new MemorySessionStore();
  const session = await store.createSession(ownerKey, { title: "Manual prompt" });

  const updated = await updateSession(
    session.id,
    {
      imagePrompt: "How many stickers does each friend get?",
      promptConfirmed: true
    },
    context,
    store
  );

  assert.equal(updated.promptConfirmed, true);
  assert.equal(updated.gateStatus, "needs_context_read");

  const detail = await store.getSession(ownerKey, session.id);
  assert.equal(detail?.problemContext?.unknownTarget, "How many stickers does each friend get?");
  assert.equal(detail?.problemContext?.visibleQuestion, "How many stickers does each friend get?");
});
