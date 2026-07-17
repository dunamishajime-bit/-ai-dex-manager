import fs from "fs/promises";
import path from "path";

const DATA_DIR = "C:\\Users\\dis\\Documents\\New trade\\data\\updown";

async function main() {
  const names = (await fs.readdir(DATA_DIR))
    .filter((name) => /^updown_lag_.*\.ndjson$/.test(name))
    .sort();

  const counts = new Map<string, number>();
  const penguSamples: Array<{ file: string; ts: number; horizonSec: number; moveBps: number }> = [];

  for (const name of names) {
    const text = await fs.readFile(path.join(DATA_DIR, name), "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      const key = `${String(row.coin)}|${String(row.horizonSec)}`;
      counts.set(key, (counts.get(key) || 0) + 1);
      if (String(row.coin).toUpperCase() === "PENGU" && penguSamples.length < 20) {
        penguSamples.push({
          file: name,
          ts: Number(row.ts),
          horizonSec: Number(row.horizonSec),
          moveBps: Number(row.moveBps),
        });
      }
    }
  }

  console.log(JSON.stringify({
    counts: Object.fromEntries([...counts.entries()].sort()),
    penguSampleRows: penguSamples,
    totalPenguRows: [...counts.entries()]
      .filter(([key]) => key.startsWith("PENGU|"))
      .reduce((sum, [, count]) => sum + count, 0),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
