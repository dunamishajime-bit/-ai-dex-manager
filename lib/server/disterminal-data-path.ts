import path from "path";

export function getDisterminalDataDir(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env.DISTERMINAL_DATA_DIR?.trim();
  if (configured) return path.resolve(configured);
  const resolvedCwd = path.resolve(cwd);
  const releaseDir = path.basename(path.dirname(resolvedCwd)) === "releases";
  if (releaseDir) {
    return path.resolve(resolvedCwd, "..", "..", "shared", "data");
  }
  return path.join(resolvedCwd, "data");
}
