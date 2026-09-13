import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { V12DecisionObservation } from "@/lib/v12-x1-all";

export class FileV12DecisionObservationStore {
  constructor(readonly path: string) {}

  async save(snapshot: V12DecisionObservation) {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, this.path);
  }
}
