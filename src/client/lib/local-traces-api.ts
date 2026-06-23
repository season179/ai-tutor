import type { LocalTraceSnapshot } from "../../core/local-trace-types.js";
import {
  clearLocalTracesFn,
  getLocalTracesFn,
  type ClearLocalTraceResponse
} from "../../modules/debug/server/local-trace-fns.js";
import { errorMessage } from "./error-message.js";

export async function getLocalTraces(limit = 500): Promise<LocalTraceSnapshot> {
  try {
    return await getLocalTracesFn({ data: { limit } });
  } catch (error) {
    throw new Error(errorMessage(error, "Could not load local traces."));
  }
}

export async function clearLocalTraces(): Promise<ClearLocalTraceResponse> {
  try {
    return await clearLocalTracesFn();
  } catch (error) {
    throw new Error(errorMessage(error, "Could not clear local traces."));
  }
}
