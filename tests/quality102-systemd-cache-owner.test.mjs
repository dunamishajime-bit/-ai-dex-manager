import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const unitPath = new URL("../ops/systemd/disdex-quality102-causal-v1@.service", import.meta.url);

test("Q102 systemd unit repairs persistent cache ownership before running as deploy", async () => {
  const text = await readFile(unitPath, "utf8");
  assert.match(text, /ExecStartPre=\+\/usr\/bin\/install -d -o deploy -g deploy -m 0700 \/var\/lib\/disdex\/quality102-causal-v1/);
  assert.match(text, /market-history\.json/);
  assert.match(text, /chown deploy:deploy/);
  assert.match(text, /chmod 600/);
});