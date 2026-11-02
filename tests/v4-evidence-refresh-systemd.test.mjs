import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const service = await readFile(new URL("../ops/systemd/disdex-v4-dynamic-evidence-refresh@.service", import.meta.url), "utf8");
const timer = await readFile(new URL("../ops/systemd/disdex-v4-dynamic-evidence-refresh@.timer", import.meta.url), "utf8");
const activate = await readFile(new URL("../scripts/ops/root/disdex-v4-evidence-refresh-activate", import.meta.url), "utf8");

test("refresh service runs the real apply helper under the exact release SHA", () => {
  assert.match(service, /User=root/);
  assert.match(service, /ProtectSystem=strict/);
  assert.match(service, /ReadWritePaths=\/run\/disdex-v4-evidence-refresh \/etc\/disdex\/v12-v4-evidence \/var\/lib\/disdex\/v12-v4/);
  assert.match(service, /flock -n \/run\/disdex-v4-evidence-refresh\/refresh\.lock/);
  assert.match(service, /\/usr\/bin\/node \/home\/deploy\/disdex-trading\/releases\/%i\/node_modules\/tsx\/dist\/cli\.mjs/);
  assert.doesNotMatch(service, /node_modules\/\.bin\/tsx/);
  assert.match(service, /disdex-v4-dynamic-evidence-refresh\.ts --sha %i --apply/);
  assert.match(service, /--lease \/var\/lib\/disdex\/unified-deploy\/refresh-leases\/v4\/%i\.json/);
  assert.doesNotMatch(service, /disdex-v4-evidence-expiry-watch/);
  assert.doesNotMatch(service, /systemctl\s+(restart|start|stop)/);
});

test("refresh service loads the canonical root-owned Aster credentials", () => {
  assert.match(service, /^EnvironmentFile=\/etc\/disdex\/disdex-v12-aster-credentials\.env$/m);
  assert.doesNotMatch(service, /EnvironmentFile=-\/etc\/disdex\/aster\.env/);
});

test("refresh service retains only the capability needed to traverse the protected release root", () => {
  assert.match(service, /^CapabilityBoundingSet=CAP_DAC_READ_SEARCH$/m);
  assert.doesNotMatch(service, /^CapabilityBoundingSet=$/m);
});

test("refresh service owns a private writable runtime directory for its flock lock", () => {
  assert.match(service, /^RuntimeDirectory=disdex-v4-evidence-refresh$/m);
  assert.match(service, /^RuntimeDirectoryMode=0750$/m);
  assert.match(service, /^ReadWritePaths=.*\/run\/disdex-v4-evidence-refresh/m);
  assert.match(service, /flock -n \/run\/disdex-v4-evidence-refresh\/refresh\.lock/);
  assert.doesNotMatch(service, /flock -n \/run\/lock\/disdex-v4-evidence-refresh\.lock/);
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
