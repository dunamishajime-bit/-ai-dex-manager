import { chmod, chown, lstat } from "node:fs/promises";
import { spawnSync } from "node:child_process";

export type LiveStateMetadata = {
  isFile: () => boolean;
  isSymbolicLink: () => boolean;
  uid: number;
  gid: number;
  mode: number;
};

export function assertLiveStateMetadata(
  stats: LiveStateMetadata,
  expectedUid: number,
  expectedGid: number,
  label = "LIVE_STATE",
) {
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label}_NOT_REGULAR_FILE`);
  }
  if (stats.uid !== expectedUid || stats.gid !== expectedGid) {
    throw new Error(`${label}_OWNER_MISMATCH:${stats.uid}:${stats.gid}`);
  }
  if ((stats.mode & 0o777) !== 0o600) {
    throw new Error(`${label}_MODE_MISMATCH:${(stats.mode & 0o777).toString(8)}`);
  }
}

function numericId(flag: "-u" | "-g", principal: string) {
  const result = spawnSync("/usr/bin/id", [flag, principal], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(`LIVE_STATE_ID_LOOKUP_FAILED:${flag}:${principal}`);
  }
  const value = Number(String(result.stdout || "").trim());
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`LIVE_STATE_ID_INVALID:${flag}:${principal}`);
  }
  return value;
}

export async function normalizeLiveStateOwnership(
  path: string,
  options: { user?: string; group?: string; label?: string } = {},
) {
  const user = options.user || "deploy";
  const group = options.group || "deploy";
  const label = options.label || "LIVE_STATE";
  const uid = numericId("-u", user);
  const gid = numericId("-g", group);

  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`${label}_NOT_REGULAR_FILE`);
  }
  await chown(path, uid, gid);
  await chmod(path, 0o600);
  const after = await lstat(path);
  assertLiveStateMetadata(after, uid, gid, label);
  return { uid, gid, mode: after.mode & 0o777 };
}
