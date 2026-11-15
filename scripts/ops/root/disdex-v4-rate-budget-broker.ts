import { chmod, lstat, readFile, realpath } from "node:fs/promises";
import { reserveAsterGlobalRateSlot, deferAsterGlobalRateBudget } from "../../../lib/disdex-aster-global-rate-budget";
import { createV4BudgetBrokerServer } from "../../../lib/disdex-v4-rate-budget-server";
import { validateV4BudgetBrokerRuntime } from "../../../lib/disdex-v4-rate-budget-runtime";

const BUDGET_PATH = "/var/lib/disdex/shared/aster-rate-budget.json";

function safeReason(error: unknown): string {
  return (error instanceof Error ? error.message : "UNKNOWN").replace(/[^A-Za-z0-9_:.-]/g, "_").slice(0, 160);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--sha" || !/^[a-f0-9]{40}$/.test(args[1])) throw new Error("V4_BUDGET_BROKER_ARGUMENT_INVALID");
  const sha = args[1], release = `/home/deploy/disdex-trading/releases/${sha}`;
  if (process.env.DISDEX_RELEASE_SHA !== sha || typeof process.getuid !== "function" || typeof process.getgid !== "function") {
    throw new Error("V4_BUDGET_BROKER_RUNTIME_UNTRUSTED");
  }
  const records = (await readFile("/etc/passwd", "utf8")).split("\n").filter((line) => line.startsWith("deploy:"));
  const fields = records.length === 1 ? records[0].split(":") : [];
  if (!/^\d+$/.test(fields[2] || "") || !/^\d+$/.test(fields[3] || "")) throw new Error("V4_BUDGET_BROKER_RUNTIME_UNTRUSTED");
  const directory = `/run/disdex-v4-budget-${sha}`;
  const socketPath = `${directory}/budget.sock`;
  const [releaseStat, markerStat, socketDirStat, cwd, marker] = await Promise.all([
    lstat(release), lstat(`${release}/.disdex-release-sha`), lstat(directory), realpath(process.cwd()),
    readFile(`${release}/.disdex-release-sha`, "utf8"),
  ]);
  validateV4BudgetBrokerRuntime({sha,cwd,
    releaseIsDirectory:releaseStat.isDirectory(),releaseIsSymlink:releaseStat.isSymbolicLink(),releaseUid:releaseStat.uid,releaseMode:releaseStat.mode,
    markerIsFile:markerStat.isFile(),markerIsSymlink:markerStat.isSymbolicLink(),markerUid:markerStat.uid,markerMode:markerStat.mode,markerSha:marker.trim(),
    socketDirectoryIsDirectory:socketDirStat.isDirectory(),socketDirectoryIsSymlink:socketDirStat.isSymbolicLink(),
    socketDirectoryUid:socketDirStat.uid,socketDirectoryGid:socketDirStat.gid,socketDirectoryMode:socketDirStat.mode,
    uid:process.getuid(),gid:process.getgid(),deployUid:Number(fields[2]),deployGid:Number(fields[3]),
    proxyEnvironmentPresent:Boolean(process.env.DISDEX_ASTER_RATE_BUDGET_PROXY_SOCKET),
  });
  try { await lstat(socketPath); throw new Error("V4_BUDGET_BROKER_SOCKET_EXISTS"); }
  catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
  const server = createV4BudgetBrokerServer({
    reserve: async (weight, priority) => {
      try {
        const slot = await reserveAsterGlobalRateSlot({path:BUDGET_PATH,minIntervalMs:50,maxQueueMs:5000,weight,priority});
        console.log(JSON.stringify({event:"V4_BUDGET_RESERVE",sha,pid:process.pid,priority,weight,waitMs:slot.waitMs}));
        return slot;
      } catch (error) {
        console.error(JSON.stringify({event:"V4_BUDGET_RESERVE_BLOCKED",sha,pid:process.pid,priority,weight,reason:safeReason(error)}));
        throw error;
      }
    },
    defer: async (status, cooldownMs) => {
      try {
        const result = await deferAsterGlobalRateBudget({path:BUDGET_PATH,status,cooldownMs});
        console.log(JSON.stringify({event:"V4_BUDGET_COOLDOWN",sha,pid:process.pid,status,cooldownMs,cooldownUntil:result.cooldownUntil}));
        return result;
      } catch (error) {
        console.error(JSON.stringify({event:"V4_BUDGET_COOLDOWN_BLOCKED",sha,pid:process.pid,status,reason:safeReason(error)}));
        throw error;
      }
    },
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(socketPath, resolve); });
  try {
    await chmod(socketPath, 0o660);
  } catch (error) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw error;
  }
  console.log(JSON.stringify({event:"V4_BUDGET_BROKER_READY",sha,pid:process.pid,socketPath}));
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => server.close());
}

main().catch((error) => {
  console.error(JSON.stringify({event:"V4_BUDGET_BROKER_BLOCKED",reason:safeReason(error)}));
  process.exitCode = 1;
});
