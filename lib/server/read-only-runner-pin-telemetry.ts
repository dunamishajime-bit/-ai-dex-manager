import { lstat, readFile } from "node:fs/promises";
import { acceptsV1ReadOnlyEvidenceMode } from "@/lib/server/read-only-pin-evidence-mode";
import {
  RUNNER_PIN_MANIFEST_PATH,
  RUNNER_PIN_PREFIX,
  validateRunnerPinManifest,
  type RunnerPin,
  type RunnerPinId,
} from "@/lib/server/runner-pin-manifest";

// Display/observability only. This adapter NEVER certifies v1 evidence for order enablement.
// All trading and deployment approval paths must continue using the strict v2 loader.
export type ReadOnlyRunnerPins = {
  schema: "disdex-runner-pin-manifest/v1" | "disdex-runner-pin-manifest/v2";
  operatorTarget: string | null;
  legacy: boolean;
  runners: Record<RunnerPinId, RunnerPin>;
};

const SHA = /^[0-9a-f]{40}$/;
const IDS = Object.keys(RUNNER_PIN_PREFIX).sort() as RunnerPinId[];

export async function loadReadOnlyRunnerPins(
  filePath = RUNNER_PIN_MANIFEST_PATH,
): Promise<ReadOnlyRunnerPins> {
  const stat = await lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o022) !== 0) {
    throw new Error("RUNNER_PIN_MANIFEST_UNTRUSTED_OWNER_MODE");
  }
  const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("RUNNER_PIN_MANIFEST_NOT_OBJECT");
  }
  const raw = parsed as Record<string, unknown>;
  if (raw.schema === "disdex-runner-pin-manifest/v2") {
    const valid = validateRunnerPinManifest(parsed);
    return { schema: valid.schema, operatorTarget: valid.operatorTarget, legacy: false, runners: valid.runners };
  }
  if (raw.schema !== "disdex-runner-pin-manifest/v1" || raw.target !== "professional-dismanager.net") {
    throw new Error("RUNNER_PIN_MANIFEST_SCHEMA_OR_TARGET");
  }
  const incoming = raw.runners;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    throw new Error("RUNNER_PIN_MANIFEST_RUNNERS");
  }
  const entries = incoming as Record<string, unknown>;
  if (JSON.stringify(Object.keys(entries).sort()) !== JSON.stringify(IDS)) {
    throw new Error("RUNNER_PIN_MANIFEST_RUNNER_SET");
  }
  const runners = {} as Record<RunnerPinId, RunnerPin>;
  for (const id of IDS) {
    const pin = entries[id] as Record<string, unknown> | undefined;
    if (!pin || typeof pin !== "object" || Array.isArray(pin)) {
      throw new Error(`RUNNER_PIN_MISSING:${id}`);
    }
    const sha = String(pin.sha ?? "").trim().toLowerCase();
    const releaseRoot = String(pin.releaseRoot ?? "");
    const serviceUnit = String(pin.serviceUnit ?? "");
    if (!SHA.test(sha) || releaseRoot !== `/home/deploy/disdex-trading/releases/${sha}`
      || serviceUnit !== `${RUNNER_PIN_PREFIX[id]}@${sha}.service`
      || !acceptsV1ReadOnlyEvidenceMode(pin.evidenceMode)) {
      throw new Error(`RUNNER_PIN_IDENTITY_INVALID:${id}`);
    }
    // v1 has no trustworthy healthPath/tickPath. Never synthesize evidence.
    runners[id] = { sha, releaseRoot, serviceUnit, evidenceMode: "legacy", statePath: "", healthPath: "", tickPath: "" };
  }
  return { schema: "disdex-runner-pin-manifest/v1", operatorTarget: null, legacy: true, runners };
}
