import path from "node:path";

function isAbsolute(value: string) {
  return path.posix.isAbsolute(value) || path.win32.isAbsolute(value);
}

function join(base: string, fileName: string) {
  return path.posix.isAbsolute(base)
    ? path.posix.join(base, fileName)
    : path.win32.isAbsolute(base)
      ? path.win32.join(base, fileName)
      : path.join(base, fileName);
}

export function resolveUiDataPath(
  fileName: string,
  configuredDirectory = process.env.DISDEX_UI_DATA_DIR || process.env.DISTERMINAL_DATA_DIR,
  workingDirectory = process.cwd(),
) {
  const directory = String(configuredDirectory || "").trim();
  if (directory) {
    if (!isAbsolute(directory)) throw new Error("DISDEX_UI_DATA_DIR must be an absolute path.");
    return join(directory, fileName);
  }
  return join(join(workingDirectory, "data"), fileName);
}
