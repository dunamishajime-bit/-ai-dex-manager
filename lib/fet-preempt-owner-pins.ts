import { constants } from "node:fs";
import { open } from "node:fs/promises";

type Pin = { sha?: unknown; releaseRoot?: unknown; serviceUnit?: unknown };

export function parseFetCoreOwnerPins(raw: unknown) {
  const manifest = raw as { schema?: unknown; runners?: Record<string, Pin> } | null;
  if (manifest?.schema !== "disdex-runner-pin-manifest/v1") throw Error("FET_CORE_PREEMPT_PIN_MANIFEST_INVALID");
  const shaFor = (runner: string, unit: string, label: string) => {
    const pin = manifest.runners?.[runner];
    if (typeof pin?.sha !== "string" || !/^[a-f0-9]{40}$/.test(pin.sha) ||
        pin.releaseRoot !== "/home/deploy/disdex-trading/releases/" + pin.sha ||
        pin.serviceUnit !== unit + "@" + pin.sha + ".service") {
      throw Error("FET_CORE_PREEMPT_" + label + "_OWNER_SHA_PIN_REQUIRED");
    }
    return pin.sha;
  };
  return { fet: shaFor("FET_BRK48_RESIDUAL", "disdex-fet-brk48", "FET"),
    q102: shaFor("QUALITY102_CAUSAL_V1", "disdex-quality102-causal-v1", "Q102") };
}

export async function readFetCoreOwnerPins() {
  const file = await open("/etc/disdex/runner-pins.json", constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = await file.stat();
    if (!st.isFile() || st.uid !== 0 || (st.mode & 0o022) !== 0 || st.size > 65536) {
      throw Error("FET_CORE_PREEMPT_PIN_MANIFEST_UNTRUSTED");
    }
    return parseFetCoreOwnerPins(JSON.parse(await file.readFile("utf8")));
  } finally {
    await file.close();
  }
}
