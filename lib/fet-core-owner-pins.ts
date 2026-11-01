import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MemoryQuality102CausalV1StateStore, type Quality102CausalV1State } from "./disdex-quality102-causal-v1-state";

const COMMIT_SHA = /^[0-9a-f]{40}$/i;

/** Owner releases must come from their own explicit pins, never from a caller or state file. */
export function resolveFetCoreOwnerPins(env: NodeJS.ProcessEnv):
  | { fetSha: string; q102Sha: string }
  | { error: string } {
  const fetSha = String(env.FET_BRK48_RUNTIME_SHA || "").trim();
  if (!COMMIT_SHA.test(fetSha)) return { error: "FET_CORE_PREEMPT_FET_OWNER_SHA_PIN_REQUIRED" };
  const q102Sha = String(env.DISDEX_Q102_RUNTIME_SHA || "").trim();
  if (!COMMIT_SHA.test(q102Sha)) return { error: "FET_CORE_PREEMPT_Q102_OWNER_SHA_PIN_REQUIRED" };
  return { fetSha, q102Sha };
}
/** Validate the same snapshot that was read; a second read can turn ENOENT into an empty state. */
export async function readPinnedQ102Owner(env: NodeJS.ProcessEnv, expectedSha: string) {
  const path = String(env.QUALITY102_CAUSAL_V1_STATE_PATH || env.DISDEX_QUALITY102_CAUSAL_V1_STATE_PATH || "").trim();
  if (!path) throw new Error("FET_CORE_PREEMPT_Q102_OWNER_STATE_REQUIRED");
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(resolve(path), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") throw new Error("FET_CORE_PREEMPT_Q102_OWNER_STATE_REQUIRED");
    throw error;
  }
  const store = new MemoryQuality102CausalV1StateStore(raw as Quality102CausalV1State, "LIVE", expectedSha);
  const state = await store.load();
  return { state, position: state.position, pending: state.pending };
}
