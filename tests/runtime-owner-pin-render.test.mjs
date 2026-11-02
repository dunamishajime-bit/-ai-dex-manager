import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const q102 = "b".repeat(40);
const fet = "c".repeat(40);
const source = readFileSync(resolve("scripts/ops/root/disdex-current-runtime-wiring"), "utf8").replaceAll("\r\n", "\n");

function values(rendered) {
  return Object.fromEntries(rendered.split("\n").filter((line) => line.includes("=")).map((line) => {
    const at = line.indexOf("=");
    return [line.slice(0, at), line.slice(at + 1)];
  }));
}

test("common runtime environment renders independent Q102 and FET owner pins", () => {
  const template = source.match(/write_atomic "\$CONTRACT_ENV_FILE" "([\s\S]*?)"\s*\n\s*retarget_account_config_readiness/);
  assert.ok(template, "the common environment template must be available");
  assert.doesNotMatch(template[1], /\$\(|`/, "the isolated renderer must not execute template commands");
  const output = execFileSync(bash, ["-c", `printf '%s\\n' "${template[1]}"`], {
    encoding: "utf8", env: { ...process.env, Q102_SHA: q102, FET_SHA: fet },
  });
  const env = values(output);
  assert.equal(env.DISDEX_Q102_RUNTIME_SHA, q102);
  assert.equal(env.FET_BRK48_RUNTIME_SHA, fet);
  assert.equal(env.QUALITY102_CAUSAL_V1_STATE_PATH, "/var/lib/disdex/quality102-causal-v1/state.json");
  assert.equal(env.FET_BRK48_STATE_PATH, "/var/lib/disdex/fet-brk48-residual/state.json");
});

test("V4 runtime environment renders independent Q102 and FET owner pins", () => {
  const dir = mkdtempSync(join(tmpdir(), "disdex-pin-render-"));
  try {
    const base = join(dir, "v4.env");
    writeFileSync(base, "V12_V4_PEER_STATE_PATHS_JSON=[]\n");
    assert.match(source, /\nmain "\$@"\s*$/, "do not execute the script's real main function");
    assert.ok(source.includes("v4_base_env=/etc/disdex/disdex-v12-v4.env"), "V4 fixture substitution must succeed");
    const program = source.replace("v4_base_env=/etc/disdex/disdex-v12-v4.env", 'v4_base_env="$TEST_V4_BASE_ENV"')
      .replace(/\nmain "\$@"\s*$/, "\n");
    assert.notEqual(program, source, "the script must be loaded without invoking its main function");
    const output = execFileSync(bash, [], {
      input: `${program}\nset +u\nwrite_atomic_preserve_existing() { printf '%s\\n' "$2"; }\nPRIMARY_V12_MODE=V4\nPRIMARY_V12_MODE_FILE=MODE\nV4_CONTRACT_ENV_FILE=V4\nQ102_SHA=${q102}\nFET_SHA=${fet}\nwrite_v4_primary_runtime_artifacts\n`,
      encoding: "utf8", env: { ...process.env, TEST_V4_BASE_ENV: base.replaceAll("\\", "/") },
    });
    const env = values(output);
    assert.equal(env.DISDEX_Q102_RUNTIME_SHA, q102);
    assert.equal(env.FET_BRK48_RUNTIME_SHA, fet);
    assert.equal(env.QUALITY102_CAUSAL_V1_STATE_PATH, "/var/lib/disdex/quality102-causal-v1/state.json");
    assert.equal(env.FET_BRK48_STATE_PATH, "/var/lib/disdex/fet-brk48-residual/state.json");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
