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

/**
 * Shared runtime files are read by deploy-owned trading runners and may be
 * written by a root recovery helper.  Keep the file regular and non-world
 * writable, while allowing the deploy group to read/write the shared state.
 */
export async function normalizeLiveSharedStateOwnership(
  path: string,
  options: { user?: string; group?: string; mode?: number; label?: string } = {},
) {
  const user = options.user || "deploy";
  const group = options.group || "deploy";
  const mode = options.mode ?? 0o660;
  const label = options.label || "LIVE_SHARED_STATE";
  if ((mode & 0o007) !== 0 || (mode & 0o600) !== 0o600) {
    throw new Error(`${label}_MODE_POLICY_INVALID`);
  }
  const uid = numericId("-u", user);
  const gid = numericId("-g", group);
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`${label}_NOT_REGULAR_FILE`);
  }
  await chown(path, uid, gid);
  await chmod(path, mode);
  const after = await lstat(path);
  if (!after.isFile() || after.isSymbolicLink() || after.uid !== uid || after.gid !== gid || (after.mode & 0o777) !== mode) {
    throw new Error(`${label}_POSTCHECK_FAILED`);
  }
  return { uid, gid, mode: after.mode & 0o777 };
}
