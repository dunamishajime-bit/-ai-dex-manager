import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDisterminalDataDir } from "../lib/server/disterminal-data-path";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "disterminal-auth-"));
const releaseRoot = path.join(tempRoot, "disdex-ui", "releases");
const currentRelease = path.join(releaseRoot, "current-sha");
const expectedShared = path.join(tempRoot, "disdex-ui", "shared", "data");

assert.equal(
  getDisterminalDataDir(currentRelease, { NODE_ENV: "production" }),
  expectedShared,
  "production releases must use the shared data directory",
);

<<<<<<< HEAD
const legacyDeployRoot = path.join(tempRoot, "legacy-deploy");
const legacyRelease = path.join(legacyDeployRoot, "disdex-trading", "releases", "current-sha");
const legacyShared = path.join(legacyDeployRoot, "disdex-ui", "shared", "data");
fs.mkdirSync(legacyShared, { recursive: true });
assert.equal(
  getDisterminalDataDir(legacyRelease, { NODE_ENV: "production" }),
  legacyShared,
  "a release mounted under a migrated project root must retain the existing durable auth store",
);

=======
>>>>>>> 43843de8 (Persist authentication across UI releases)
const explicit = path.join(tempRoot, "explicit-data");
assert.equal(
  getDisterminalDataDir(currentRelease, {
    NODE_ENV: "production",
    DISTERMINAL_DATA_DIR: explicit,
  }),
  explicit,
  "DISTERMINAL_DATA_DIR must take precedence",
);

const localRoot = path.join(tempRoot, "local-project");
assert.equal(
  getDisterminalDataDir(localRoot, { NODE_ENV: "development" }),
  path.join(localRoot, "data"),
  "local development must retain the cwd/data default",
);

console.log("AUTH_PERSISTENCE_SELFTEST_OK");
