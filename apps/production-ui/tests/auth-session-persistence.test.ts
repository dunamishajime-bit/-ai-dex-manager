import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const source = readFileSync(join(process.cwd(), "context/AuthContext.tsx"), "utf8");

test("HP auth does not force logout after short inactivity", () => {
  assert.doesNotMatch(source, /INACTIVITY_LIMIT_MS|jdex_last_activity/);
  assert.match(source, /AUTH_COOKIE_MAX_AGE_SECONDS/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /15 \* 60 \* 1000/);
});
