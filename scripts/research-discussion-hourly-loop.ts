import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const stateDir = path.resolve(process.env.RESEARCH_AUTONOMOUS_STATE_DIR ?? ".research-state");
const lockPath = path.join(stateDir, ".manual-run.lock");
const logPath = path.join(stateDir, "manual-run.log");
const discussionDir = path.join(stateDir, "discussions");
const indexPath = path.join(discussionDir, "index.json");
const RETENTION_MS = 4 * 60 * 60 * 1000;

async function pruneOldDiscussions() {
  const cutoff = Date.now() - RETENTION_MS;
  let index: { items?: Array<Record<string, unknown>>; updatedAt?: string; version?: number } = {};
  try { index = JSON.parse(await fs.readFile(indexPath, "utf8")); } catch { return; }
  const items = Array.isArray(index.items) ? index.items : [];
  const retained = items.filter((item) => typeof item.completedAt !== "string" || Date.parse(item.completedAt) >= cutoff);
  for (const item of items) {
    if (retained.includes(item) || typeof item.path !== "string") continue;
    const target = path.join(stateDir, item.path);
    if (target.startsWith(discussionDir + path.sep)) await fs.rm(target, { force: true });
  }
  await fs.writeFile(indexPath, JSON.stringify({ ...index, updatedAt: new Date().toISOString(), items: retained }, null, 2) + "\n", "utf8");
}

async function main() {
  await fs.mkdir(discussionDir, { recursive: true });
  try {
    const handle = await fs.open(lockPath, "wx");
    await handle.writeFile(JSON.stringify({ startedAt: new Date().toISOString(), mode: "hourly" }));
    await handle.close();
  } catch { process.exit(0); }
  try {
    await pruneOldDiscussions();
    await new Promise<void>((resolve) => {
      const child = spawn(process.execPath, [path.join(projectRoot, "node_modules/tsx/dist/cli.mjs"), "scripts/research-lab-main-strategy-research-runner.ts"], {
        cwd: projectRoot,
        env: { ...process.env, RESEARCH_AUTONOMOUS_STATE_DIR: stateDir },
        stdio: ["ignore", "pipe", "pipe"],
      });
      void (async () => {
        const log = await fs.open(logPath, "a");
        child.stdout?.on("data", (chunk) => void log.write(chunk));
        child.stderr?.on("data", (chunk) => void log.write(chunk));
        child.once("close", async () => { await log.close(); resolve(); });
      })();
    });
    await pruneOldDiscussions();
  } finally { await fs.rm(lockPath, { force: true }); }
}

void main().catch(async (error) => {
  await fs.rm(lockPath, { force: true }).catch(() => undefined);
  await fs.appendFile(logPath, `[hourly-loop-error] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`).catch(() => undefined);
  process.exitCode = 1;
});
