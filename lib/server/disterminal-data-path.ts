import fs from "fs";
import path from "path";

const LEGACY_SHARED_DATA_DIR = "disdex-ui/shared/data";

function existingSharedDataDir(resolvedCwd: string): string | null {
  const releaseShared = path.resolve(resolvedCwd, "..", "..", "shared", "data");
  if (fs.existsSync(releaseShared)) return releaseShared;

  // Older UI releases were deployed under a different project root. Keep
  // using that durable store when a newer release is mounted elsewhere.
  const deployRoot = path.resolve(resolvedCwd, "..", "..", "..");
  const legacyShared = path.join(deployRoot, LEGACY_SHARED_DATA_DIR);
  if (fs.existsSync(legacyShared)) return legacyShared;

  return null;
}

export function getDisterminalDataDir(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env.DISTERMINAL_DATA_DIR?.trim();
  if (configured) return path.resolve(configured);
  const resolvedCwd = path.resolve(cwd);
  const releaseDir = path.basename(path.dirname(resolvedCwd)) === "releases";
  if (releaseDir) {
    return existingSharedDataDir(resolvedCwd) ?? path.resolve(resolvedCwd, "..", "..", "shared", "data");
  }
  return path.join(resolvedCwd, "data");
}
