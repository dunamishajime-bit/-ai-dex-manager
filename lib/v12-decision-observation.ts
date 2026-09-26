import { appendFile, chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { V12DecisionObservation } from "@/lib/v12-x1-all";

export class FileV12DecisionObservationStore {
  constructor(
    readonly path: string,
    readonly historyPath = path.endsWith("decision-snapshot.json")
      ? path.slice(0, -"decision-snapshot.json".length) + "v12-gate-diagnostics.jsonl"
      : `${path}.jsonl`,
  ) {}

  async save(snapshot: V12DecisionObservation) {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, this.path);

    const observedAt = new Date(snapshot.observedAt);
    if (!Number.isFinite(observedAt.getTime())) throw new Error("V12_GATE_DIAGNOSTICS_INVALID_OBSERVED_AT");
    const utcDay = observedAt.toISOString().slice(0, 10);
    const dailyHistoryPath = this.historyPath.endsWith(".jsonl")
      ? `${this.historyPath.slice(0, -".jsonl".length)}-${utcDay}.jsonl`
      : `${this.historyPath}-${utcDay}.jsonl`;
    await appendFile(dailyHistoryPath, `${JSON.stringify(snapshot)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(dailyHistoryPath, 0o600);
  }
}
