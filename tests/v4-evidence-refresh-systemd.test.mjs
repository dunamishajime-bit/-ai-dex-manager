import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const service = await readFile(new URL("../ops/systemd/disdex-v4-dynamic-evidence-refresh@.service", import.meta.url), "utf8");
const timer = await readFile(new URL("../ops/systemd/disdex-v4-dynamic-evidence-refresh@.timer", import.meta.url), "utf8");
const activate = await readFile(new URL("../scripts/ops/root/disdex-v4-evidence-refresh-activate", import.meta.url), "utf8");

test("refresh service runs the real apply helper under the exact release SHA", () => {
  assert.match(service, /User=root/);
  assert.match(service, /ProtectSystem=strict/);
  assert.match(service, /ReadWritePaths=\/etc\/disdex\/v12-v4-evidence \/var\/lib\/disdex\/v12-v4/);
  assert.match(service, /flock -n \/run\/lock\/disdex-v4-evidence-refresh\.lock/);
  assert.match(service, /disdex-v4-dynamic-evidence-refresh\.ts --sha %i --apply/);
  assert.match(service, /--lease \/var\/lib\/disdex\/unified-deploy\/refresh-leases\/v4\/%i\.json/);
  assert.doesNotMatch(service, /disdex-v4-evidence-expiry-watch/);
  assert.doesNotMatch(service, /systemctl\s+(restart|start|stop)/);
});

test("refresh timer is periodic and keeps monitor separate", () => {
  assert.match(timer, /OnCalendar=\*:0\/30/);
  assert.match(timer, /Unit=disdex-v4-dynamic-evidence-refresh@%i\.service/);
  assert.match(timer, /Persistent=true/);
});

test("owner activation enables only the exact refresh timer", () => {
  assert.match(activate, /systemctl enable --now/);
  assert.match(activate, /disdex-v4-dynamic-evidence-refresh@\$\{sha\}\.timer/);
  assert.match(activate, /systemctl start --wait "disdex-v4-dynamic-evidence-refresh@\$\{sha\}\.service"/);
  assert.doesNotMatch(activate, /systemctl\s+(restart|start|stop)\s+disdex-(?!v4-dynamic-evidence-refresh)/);
  assert.doesNotMatch(activate, /current-release|runner|ordersEnabled=true/);
});
