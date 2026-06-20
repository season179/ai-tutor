import assert from "node:assert/strict";

import { transferSessionsOnLink } from "../src/modules/auth/auth.ts";

test("transferSessionsOnLink forwards anonymous and Google user ids", async () => {
  const calls: Array<[string, string]> = [];

  await transferSessionsOnLink(async (fromUserId, toUserId) => {
    calls.push([fromUserId, toUserId]);
  }, "anonymous-user-id", "google-user-id");

  assert.deepEqual(calls, [["anonymous-user-id", "google-user-id"]]);
});
